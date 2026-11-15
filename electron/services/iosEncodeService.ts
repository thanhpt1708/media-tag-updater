/**
 * Phần chạy thực tế (Electron main) cho tính năng tương thích iPhone/iOS:
 *  - ffprobe chạy nền + cache kết quả theo (đường dẫn, dung lượng, thời gian sửa)
 *  - Dò encoder video chạy được thật trên máy (NVENC / QSV / AMF / x265 / x264)
 *  - Hàng đợi encode/remux tuần tự, báo tiến độ qua sự kiện, kiểm tra lại file đích
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import {
  IosCompatInfo,
  IosEncodeJobState,
  IosEncodeOptions,
  IosEncoderDetection,
  IosEncoderInfo,
  IosVideoEncoder,
} from '../../src/shared/types';
import {
  FfprobeOutput,
  H264_ENCODERS,
  HEVC_ENCODERS,
  analyzeIosCompat,
  buildIosFfmpegArgs,
  buildOutputFileName,
  parseFfmpegProgressChunk,
  resolveEncoder,
} from './iosCompat';
import { getBinaryStatus, listFfmpegCandidates, shortFfmpegVersion } from './binaryManagerService';
import { readMediaFileItem } from './mediaTagService';
import { parseDataUrlToImageBuffer } from './fastVideoTagEditor';

type EventSink = (channel: string, payload: unknown) => void;
let emit: EventSink = () => {};

export function setIosEventSink(sink: EventSink): void {
  emit = sink;
}

// ============================================================================
// ffprobe
// ============================================================================

export function runFfprobe(ffprobePath: string, filePath: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error((stderr || err.message || 'ffprobe lỗi').trim().split(/\r?\n/)[0]));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as FfprobeOutput);
        } catch {
          reject(new Error('Không đọc được kết quả ffprobe'));
        }
      }
    );
  });
}

// ============================================================================
// Cache kết quả phân tích
// ============================================================================

/** Tăng khi đổi quy tắc đánh giá để cache cũ tự hết hiệu lực */
const CACHE_VERSION = 2;

interface CacheEntry {
  size: number;
  mtimeMs: number;
  info: IosCompatInfo;
}

let cache: Map<string, CacheEntry> | null = null;
let cacheSaveTimer: NodeJS.Timeout | null = null;

function getCacheFilePath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (electron?.app?.isReady?.()) {
      return path.join(electron.app.getPath('userData'), 'ios-compat-cache.json');
    }
  } catch {
    // môi trường test
  }
  return path.join(os.tmpdir(), 'media-tag-updater-ios-compat-cache.json');
}

function cacheKey(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}

function loadCache(): Map<string, CacheEntry> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(getCacheFilePath(), 'utf-8'));
    if (raw?.version === CACHE_VERSION && raw.entries) {
      for (const [k, v] of Object.entries(raw.entries)) cache.set(k, v as CacheEntry);
    }
  } catch {
    // chưa có cache
  }
  return cache;
}

function scheduleCacheSave(): void {
  if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
  cacheSaveTimer = setTimeout(() => {
    cacheSaveTimer = null;
    if (!cache) return;
    // Giới hạn kích thước cache: giữ 20.000 mục gần nhất
    const entries = Array.from(cache.entries()).slice(-20_000);
    try {
      fs.writeFileSync(
        getCacheFilePath(),
        JSON.stringify({ version: CACHE_VERSION, entries: Object.fromEntries(entries) }),
        'utf-8'
      );
    } catch (err) {
      console.warn('Không ghi được cache tương thích iOS:', err);
    }
  }, 1500);
}

async function getCached(filePath: string): Promise<IosCompatInfo | null> {
  const entry = loadCache().get(cacheKey(filePath));
  if (!entry) return null;
  try {
    const st = await fs.promises.stat(filePath);
    if (st.size === entry.size && Math.round(st.mtimeMs) === Math.round(entry.mtimeMs)) {
      return entry.info;
    }
  } catch {
    // file không còn
  }
  return null;
}

async function putCache(filePath: string, info: IosCompatInfo): Promise<void> {
  try {
    const st = await fs.promises.stat(filePath);
    loadCache().set(cacheKey(filePath), { size: st.size, mtimeMs: st.mtimeMs, info });
    scheduleCacheSave();
  } catch {
    // bỏ qua
  }
}

/** Phân tích 1 file (luôn chạy ffprobe mới) và cập nhật cache */
export async function analyzeFile(filePath: string) {
  const bin = getBinaryStatus();
  if (!bin.ffprobeAvailable || !bin.ffprobePath) {
    throw new Error('Chưa có ffprobe.exe – hãy đặt cạnh ffmpeg.exe trong thư mục ./bin');
  }
  const probe = await runFfprobe(bin.ffprobePath, filePath);
  const plan = analyzeIosCompat(probe, path.extname(filePath));
  await putCache(filePath, plan.compat);
  return plan;
}

// ============================================================================
// Probe nền cho danh sách file
// ============================================================================

const PROBE_CONCURRENCY = 4;
const probeQueue: string[] = [];
const probeQueued = new Set<string>();
let probeRunning = 0;
let pendingUpdates: { filePath: string; info: IosCompatInfo }[] = [];
let updateTimer: NodeJS.Timeout | null = null;

function pushUpdate(filePath: string, info: IosCompatInfo): void {
  pendingUpdates.push({ filePath, info });
  if (updateTimer) return;
  updateTimer = setTimeout(() => {
    updateTimer = null;
    const batch = pendingUpdates;
    pendingUpdates = [];
    if (batch.length > 0) emit('media:iosCompatUpdated', batch);
  }, 250);
}

function pumpProbeQueue(): void {
  while (probeRunning < PROBE_CONCURRENCY && probeQueue.length > 0) {
    const filePath = probeQueue.shift()!;
    probeRunning++;
    analyzeFile(filePath)
      .then((plan) => pushUpdate(filePath, plan.compat))
      .catch((err: any) =>
        pushUpdate(filePath, {
          level: 'unknown',
          summary: 'Không phân tích được',
          reasons: [err?.message || 'ffprobe lỗi'],
          notes: [],
          audioCodecs: [],
        })
      )
      .finally(() => {
        probeRunning--;
        probeQueued.delete(cacheKey(filePath));
        pumpProbeQueue();
      });
  }
}

/**
 * Trả ngay các kết quả đã có trong cache; file chưa có (hoặc đã thay đổi) được đưa vào hàng đợi
 * ffprobe chạy nền, kết quả gửi về qua sự kiện `media:iosCompatUpdated`.
 */
export async function probeIosCompat(filePaths: string[]): Promise<Record<string, IosCompatInfo>> {
  const result: Record<string, IosCompatInfo> = {};
  const bin = getBinaryStatus();
  for (const fp of filePaths) {
    const cached = await getCached(fp);
    if (cached) {
      result[fp] = cached;
      continue;
    }
    if (!bin.ffprobeAvailable) continue;
    const key = cacheKey(fp);
    if (probeQueued.has(key)) continue;
    probeQueued.add(key);
    probeQueue.push(fp);
  }
  pumpProbeQueue();
  return result;
}

// ============================================================================
// Dò encoder khả dụng
// ============================================================================

let detectionPromise: Promise<IosEncoderDetection> | null = null;

/** Encode thử 3 khung hình; trả về null nếu chạy được, ngược lại là dòng lỗi đầu tiên của ffmpeg */
function testEncoder(ffmpegPath: string, encoder: IosVideoEncoder): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      [
        '-hide_banner', '-nostdin', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=25:d=0.2',
        '-frames:v', '3',
        '-c:v', encoder,
        '-pix_fmt', encoder.endsWith('_qsv') ? 'nv12' : 'yuv420p',
        '-f', 'null', '-',
      ],
      { timeout: 20_000, windowsHide: true, encoding: 'utf8' },
      (err, _stdout, stderr) => {
        if (!err) return resolve(null);
        const first = String(stderr || err.message || '')
          .split(/\r?\n/)
          .map((l) => l.replace(/^\[[^\]]+\]\s*/, '').trim())
          .find(Boolean);
        resolve(first || 'không rõ lỗi');
      }
    );
  });
}

const GPU_VENDOR: Record<string, string> = { nvenc: 'NVIDIA NVENC', qsv: 'Intel Quick Sync', amf: 'AMD AMF' };

/**
 * Dò encoder chạy được thật. Với mỗi encoder thử lần lượt các bản ffmpeg (bản chính trước, sau đó
 * ./bin/ffmpeg-compat) và ghi nhớ bản đầu tiên chạy được → GPU cũ (vd GTX 10xx, driver 58x) vẫn dùng
 * được NVENC qua bản ffmpeg build với SDK cũ hơn.
 */
export function getAvailableEncoders(forceRefresh = false): Promise<IosEncoderDetection> {
  if (detectionPromise && !forceRefresh) return detectionPromise;
  detectionPromise = (async () => {
    const candidates = listFfmpegCandidates();
    const encoders: IosEncoderInfo[] = [];
    const notes: string[] = [];
    if (candidates.length === 0) return { encoders, notes: ['Chưa có ffmpeg'] };
    const primary = candidates[0].path;

    // Chạy tuần tự để tránh tranh chấp GPU khi khởi tạo
    for (const enc of [...HEVC_ENCODERS, ...H264_ENCODERS]) {
      const errors: string[] = [];
      for (const c of candidates) {
        const err = await testEncoder(c.path, enc);
        if (err === null) {
          encoders.push({
            encoder: enc,
            ffmpegPath: c.path,
            ffmpegVersion: c.version,
            isFallback: c.path !== primary,
          });
          break;
        }
        errors.push(`ffmpeg ${c.version || '?'}: ${err}`);
      }
      const ok = encoders.some((e) => e.encoder === enc);
      const vendorKey = Object.keys(GPU_VENDOR).find((k) => enc.endsWith(`_${k}`));
      // Chỉ ghi lý do cho GPU encoder HEVC (đại diện cho cả hãng), bỏ qua lỗi "không có thiết bị"
      if (!ok && vendorKey && enc.startsWith('hevc') && errors.length > 0) {
        const driverErr = errors.find((e) => /driver|api version/i.test(e));
        if (driverErr) notes.push(`${GPU_VENDOR[vendorKey]} không dùng được – ${driverErr}`);
      }
    }
    const fallbackUsed = encoders.filter((e) => e.isFallback && /_nvenc|_qsv|_amf/.test(e.encoder));
    if (fallbackUsed.length > 0) {
      const v = fallbackUsed[0].ffmpegVersion;
      notes.push(
        `Encoder GPU chạy qua ffmpeg ${v || 'dự phòng'} vì bản ffmpeg chính đòi driver GPU mới hơn driver đang cài.`
      );
    }
    return { encoders, notes };
  })();
  return detectionPromise;
}

// ============================================================================
// Hàng đợi encode
// ============================================================================

interface EncodeJob {
  state: IosEncodeJobState;
  options: IosEncodeOptions;
  proc?: ChildProcess;
  cancelled: boolean;
}

const jobs: EncodeJob[] = [];
let jobSeq = 0;
let workerRunning = false;

function publish(job: EncodeJob): void {
  emit('media:iosEncodeProgress', { ...job.state, warnings: [...job.state.warnings] });
}

async function uniqueOutputPath(desired: string, sourcePath: string): Promise<string> {
  const dir = path.dirname(desired);
  const ext = path.extname(desired);
  const base = path.basename(desired, ext);
  let candidate = desired;
  let n = 2;
  const reserved = new Set(
    jobs
      .filter((j) => j.state.outputPath && ['running', 'verifying'].includes(j.state.status))
      .map((j) => j.state.outputPath!.toLowerCase())
  );
  while (
    fs.existsSync(candidate) ||
    reserved.has(candidate.toLowerCase()) ||
    path.resolve(candidate).toLowerCase() === path.resolve(sourcePath).toLowerCase()
  ) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n++;
  }
  return candidate;
}

export function startIosEncode(filePaths: string[], options: IosEncodeOptions): IosEncodeJobState[] {
  const created: IosEncodeJobState[] = [];
  for (const fp of filePaths) {
    const already = jobs.find(
      (j) => j.state.filePath === fp && ['queued', 'running', 'verifying'].includes(j.state.status)
    );
    if (already) continue;
    const state: IosEncodeJobState = {
      jobId: `ios-${Date.now()}-${++jobSeq}`,
      filePath: fp,
      fileName: path.basename(fp),
      status: 'queued',
      percent: 0,
      warnings: [],
    };
    jobs.push({ state, options: { ...options }, cancelled: false });
    created.push({ ...state });
  }
  void runWorker();
  return created;
}

export function cancelIosEncode(jobId?: string): void {
  for (const job of jobs) {
    if (jobId && job.state.jobId !== jobId) continue;
    if (!['queued', 'running', 'verifying'].includes(job.state.status)) continue;
    job.cancelled = true;
    if (job.state.status === 'queued') {
      job.state.status = 'cancelled';
      job.state.message = 'Đã huỷ';
      publish(job);
    } else if (job.proc && !job.proc.killed) {
      job.proc.kill();
    }
  }
}

async function runWorker(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    for (;;) {
      const job = jobs.find((j) => j.state.status === 'queued' && !j.cancelled);
      if (!job) break;
      await runJob(job);
    }
  } finally {
    workerRunning = false;
    // Dọn job đã xong cũ để không phình bộ nhớ
    while (jobs.length > 500) jobs.shift();
  }
}

function buildMetadataTags(meta: Awaited<ReturnType<typeof readMediaFileItem>>) {
  const m = meta?.metadata;
  if (!m) return undefined;
  return {
    title: m.title,
    artist: m.artist,
    album_artist: m.albumArtist,
    album: m.album,
    date: m.year,
    genre: m.genre,
    comment: m.comment,
    copyright: m.copyright,
    track: m.trackNumber,
  };
}

async function runJob(job: EncodeJob): Promise<void> {
  const s = job.state;
  const bin = getBinaryStatus();
  let tmpOut: string | undefined;
  let coverPath: string | undefined;

  const fail = (message: string) => {
    s.status = job.cancelled ? 'cancelled' : 'failed';
    s.message = job.cancelled ? 'Đã huỷ' : message;
    publish(job);
  };

  try {
    s.status = 'running';
    s.message = 'Đang phân tích...';
    publish(job);

    if (!bin.ffmpegAvailable || !bin.ffmpegPath) throw new Error('Chưa có ffmpeg.exe');
    const plan = await analyzeFile(s.filePath);
    if (job.cancelled) return fail('Đã huỷ');

    if (!plan.video) throw new Error('File không có luồng video');
    if (plan.compat.level === 'compatible' && job.options.skipCompatible) {
      s.status = 'skipped';
      s.percent = 100;
      s.message = 'Đã tương thích iPhone sẵn – bỏ qua';
      publish(job);
      return;
    }

    // --- Encoder ---
    const preset = job.options.preset === 'h264' ? 'h264' : 'hevc';
    const detection = await getAvailableEncoders();
    const encoder = resolveEncoder(
      preset,
      job.options.encoder,
      detection.encoders.map((e) => e.encoder)
    );
    const encoderInfo = detection.encoders.find((e) => e.encoder === encoder);

    // --- Đường dẫn đầu ra ---
    const outDir =
      job.options.outputMode === 'custom-folder' && job.options.outputDir
        ? job.options.outputDir
        : path.dirname(s.filePath);
    await fs.promises.mkdir(outDir, { recursive: true });
    const outPath = await uniqueOutputPath(
      path.join(outDir, buildOutputFileName(path.basename(s.filePath), job.options.outputSuffix)),
      s.filePath
    );
    s.outputPath = outPath;
    tmpOut = outPath.replace(/\.mp4$/i, '.part.mp4');

    // --- Poster & Tag hiện có của file gốc ---
    const sourceItem = await readMediaFileItem(s.filePath).catch(() => null);
    if (sourceItem?.hasEmbeddedThumbnail && sourceItem.metadata.thumbnailDataUrl) {
      const img = parseDataUrlToImageBuffer(sourceItem.metadata.thumbnailDataUrl);
      if (img && /jpe?g|png/.test(img.mimeType)) {
        coverPath = path.join(
          os.tmpdir(),
          `mtu-cover-${s.jobId}.${img.mimeType.includes('png') ? 'png' : 'jpg'}`
        );
        await fs.promises.writeFile(coverPath, img.buffer);
      }
    }

    const buildArgs = (allowGpuDecode: boolean) =>
      buildIosFfmpegArgs({
        inputPath: s.filePath,
        outputPath: tmpOut!,
        plan,
        options: job.options,
        encoder,
        coverPath,
        metadata: buildMetadataTags(sourceItem),
        allowGpuDecode,
      });
    let built = buildArgs(true);
    const { mode, warnings } = built;
    // Remux / x265 / x264 dùng bản ffmpeg chính; encoder GPU có thể phải chạy qua bản dự phòng
    const ffmpegExe =
      mode === 'transcode' && encoderInfo ? encoderInfo.ffmpegPath : bin.ffmpegPath;
    s.mode = mode;
    s.encoder = mode === 'transcode' ? encoder : 'copy';
    s.ffmpegVersion =
      mode === 'transcode' && encoderInfo
        ? encoderInfo.ffmpegVersion
        : shortFfmpegVersion(bin.ffmpegVersion);
    s.warnings.push(...warnings);
    const setRunningMessage = () => {
      s.gpuDecode = built.gpuDecode;
      s.message =
        mode === 'remux'
          ? 'Đang remux (giữ nguyên hình)...'
          : `Đang encode (${built.gpuDecode ? 'GPU decode + ' : ''}${encoder}${
              s.ffmpegVersion ? ` · ffmpeg ${s.ffmpegVersion}` : ''
            })...`;
    };
    setRunningMessage();
    publish(job);

    // --- Chạy ffmpeg ---
    const duration = plan.durationSec || 0;
    const startedAt = Date.now();
    let stderrTail = '';
    const runFfmpeg = (args: string[]) => new Promise<number>((resolve) => {
      stderrTail = '';
      const proc = spawn(ffmpegExe!, args, { windowsHide: true });
      job.proc = proc;
      let lastEmit = 0;
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        const p = parseFfmpegProgressChunk(chunk);
        if (p.outTimeSec !== undefined && duration > 0) {
          s.percent = Math.max(0, Math.min(99.5, (p.outTimeSec / duration) * 100));
          const elapsed = (Date.now() - startedAt) / 1000;
          if (s.percent > 0.5) {
            s.etaSeconds = Math.round((elapsed * (100 - s.percent)) / s.percent);
          }
        }
        if (p.speed !== undefined) s.speed = p.speed;
        const now = Date.now();
        if (now - lastEmit > 500) {
          lastEmit = now;
          publish(job);
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-4000);
      });
      proc.on('error', (err) => {
        stderrTail += `\n${err.message}`;
        resolve(-1);
      });
      proc.on('close', (code) => resolve(code ?? -1));
    });
    let exitCode = await runFfmpeg(built.args);
    job.proc = undefined;

    // GPU decode lỗi (driver, luồng lạ...) → chạy lại một lần bằng CPU decode
    if (exitCode !== 0 && built.gpuDecode && !job.cancelled) {
      const reason = stderrTail.trim().split(/\r?\n/).slice(-1)[0] || `mã ${exitCode}`;
      s.warnings.push(`GPU decode lỗi (${reason}) – đã chạy lại bằng CPU decode.`);
      built = buildArgs(false);
      s.percent = 0;
      s.etaSeconds = undefined;
      setRunningMessage();
      publish(job);
      exitCode = await runFfmpeg(built.args);
      job.proc = undefined;
    }

    if (job.cancelled) throw new Error('Đã huỷ');
    if (exitCode !== 0) {
      const lastLines = stderrTail.trim().split(/\r?\n/).slice(-3).join(' | ');
      throw new Error(`ffmpeg lỗi (mã ${exitCode}): ${lastLines || 'không rõ nguyên nhân'}`);
    }

    // --- Kiểm tra lại file đích ---
    s.status = 'verifying';
    s.percent = 100;
    s.message = 'Đang kiểm tra file kết quả...';
    publish(job);

    const outProbe = await runFfprobe(bin.ffprobePath!, tmpOut);
    const outPlan = analyzeIosCompat(outProbe, '.mp4');
    if (outPlan.compat.level !== 'compatible') {
      throw new Error(`File kết quả chưa đạt chuẩn: ${outPlan.compat.reasons.join('; ')}`);
    }
    if (duration > 0 && outPlan.durationSec && Math.abs(outPlan.durationSec - duration) > 2) {
      throw new Error(
        `Thời lượng lệch ${(outPlan.durationSec - duration).toFixed(1)}s so với file gốc – có thể bị cắt`
      );
    }

    await fs.promises.rename(tmpOut, outPath);
    tmpOut = undefined;
    await putCache(outPath, outPlan.compat);
    s.outputSize = (await fs.promises.stat(outPath)).size;

    // --- Xử lý file gốc ---
    if (job.options.afterSuccess === 'trash') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { shell } = require('electron');
        await shell.trashItem(s.filePath);
        s.sourceTrashed = true;
      } catch (err: any) {
        s.warnings.push(`Không chuyển được file gốc vào Thùng rác: ${err?.message || err}`);
      }
    }

    s.status = 'done';
    s.etaSeconds = 0;
    const took = Math.round((Date.now() - startedAt) / 1000);
    s.message = `${mode === 'remux' ? 'Remux' : s.gpuDecode ? 'Encode (GPU decode)' : 'Encode'} xong sau ${took}s`;
    publish(job);
  } catch (err: any) {
    fail(err?.message || String(err));
  } finally {
    job.proc = undefined;
    if (tmpOut) await fs.promises.rm(tmpOut, { force: true }).catch(() => {});
    if (coverPath) await fs.promises.rm(coverPath, { force: true }).catch(() => {});
  }
}
