import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

/**
 * Đọc thời lượng video & trích "dấu vân tay hình ảnh" của video phục vụ phát hiện trùng lặp.
 *  - Thời lượng: đọc trực tiếp header MP4/MOV (mvhd) và MKV/WEBM (Segment Info) – chỉ vài KB,
 *    định dạng khác (AVI...) hoặc header bất thường thì dùng `ffmpeg -i`.
 *  - Khung hình: ffmpeg seek nhanh tới từng mốc %, thu nhỏ về 9x8 xám và xuất raw qua pipe
 *    (không ghi file tạm), sau đó tính dHash 64-bit.
 */

const MP4_EXTS = new Set(['.mp4', '.m4v', '.mov']);
const MKV_EXTS = new Set(['.mkv', '.webm']);
const HEAD_READ = 256 * 1024;

/** Các mốc (% thời lượng) để trích khung hình so sánh */
export const VIDEO_FRAME_POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

function execFileBuffer(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout as Buffer,
          stderr: (stderr as Buffer)?.toString('utf8') || '',
          code: err ? ((err as any).code ?? 1) : 0,
        });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// MP4 / MOV
// ---------------------------------------------------------------------------

export interface VideoProbeInfo {
  durationMs?: number;
  width?: number;
  height?: number;
}

function isComplete(info: VideoProbeInfo): boolean {
  return !!info.durationMs && !!info.width && !!info.height;
}

/** Đọc mvhd (thời lượng) và tkhd của track hình đầu tiên (kích thước hiển thị) */
async function readMp4Info(fh: fs.promises.FileHandle, fileSize: number): Promise<VideoProbeInfo> {
  const info: VideoProbeInfo = {};
  const hdr = Buffer.alloc(16);
  let offset = 0;
  while (offset + 8 <= fileSize) {
    const { bytesRead } = await fh.read(hdr, 0, 16, offset);
    if (bytesRead < 8) return info;
    let size = hdr.readUInt32BE(0);
    const type = hdr.toString('latin1', 4, 8);
    let headerLen = 8;
    if (size === 1) {
      if (bytesRead < 16) return info;
      size = Number(hdr.readBigUInt64BE(8));
      headerLen = 16;
    } else if (size === 0) {
      size = fileSize - offset;
    }
    if (size < headerLen) return info;

    if (type === 'moov') {
      const payloadLen = Math.min(size - headerLen, HEAD_READ);
      const moov = Buffer.alloc(payloadLen);
      await fh.read(moov, 0, payloadLen, offset + headerLen);
      let p = 0;
      while (p + 8 <= moov.length) {
        const childSize = moov.readUInt32BE(p);
        const childType = moov.toString('latin1', p + 4, p + 8);
        if (childType === 'mvhd' && p + 28 <= moov.length) {
          const b = p + 8;
          const version = moov[b];
          const timescale = moov.readUInt32BE(b + (version === 1 ? 20 : 12));
          const duration =
            version === 1 ? Number(moov.readBigUInt64BE(b + 24)) : moov.readUInt32BE(b + 16);
          if (timescale && duration && duration !== 0xffffffff) {
            info.durationMs = Math.round((duration / timescale) * 1000);
          }
        } else if (childType === 'trak' && !info.width) {
          // tkhd luôn là box con đầu tiên của trak
          const t = p + 8;
          if (t + 8 <= moov.length && moov.toString('latin1', t + 4, t + 8) === 'tkhd') {
            const b = t + 8;
            const whOff = b + (moov[b] === 1 ? 88 : 76);
            if (whOff + 8 <= moov.length) {
              const w = Math.round(moov.readUInt32BE(whOff) / 65536);
              const h = Math.round(moov.readUInt32BE(whOff + 4) / 65536);
              // Track âm thanh có width/height = 0 → bỏ qua
              if (w > 0 && h > 0) {
                info.width = w;
                info.height = h;
              }
            }
          }
        }
        if (isComplete(info) || childSize < 8) break;
        p += childSize;
      }
      return info;
    }
    offset += size;
  }
  return info;
}

// ---------------------------------------------------------------------------
// MKV / WEBM (EBML)
// ---------------------------------------------------------------------------

function readVintId(buf: Buffer, off: number): { id: number; len: number } | null {
  if (off >= buf.length) return null;
  const first = buf[off];
  let len = 1;
  let mask = 0x80;
  while (len <= 4 && !(first & mask)) {
    mask >>= 1;
    len++;
  }
  if (len > 4 || off + len > buf.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[off + i];
  return { id, len };
}

function readVintSize(buf: Buffer, off: number): { size: number; len: number } | null {
  if (off >= buf.length) return null;
  const first = buf[off];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || off + len > buf.length) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[off + i];
    if (buf[off + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? -1 : value, len };
}

const EBML_HEADER = 0x1a45dfa3;
const EBML_SEGMENT = 0x18538067;
const EBML_INFO = 0x1549a966;
const EBML_CLUSTER = 0x1f43b675;
const EBML_TIMECODE_SCALE = 0x2ad7b1;
const EBML_DURATION = 0x4489;
const EBML_TRACKS = 0x1654ae6b;
const EBML_TRACK_ENTRY = 0xae;
const EBML_TRACK_TYPE = 0x83;
const EBML_VIDEO = 0xe0;
const EBML_PIXEL_WIDTH = 0xb0;
const EBML_PIXEL_HEIGHT = 0xba;

/** Duyệt các phần tử con trong khoảng [start, end) của buffer */
function* ebmlChildren(buf: Buffer, start: number, end: number) {
  let p = start;
  const limit = Math.min(end, buf.length);
  while (p < limit) {
    const cid = readVintId(buf, p);
    if (!cid) return;
    const csz = readVintSize(buf, p + cid.len);
    if (!csz || csz.size < 0) return;
    const data = p + cid.len + csz.len;
    if (data + csz.size > buf.length) return;
    yield { id: cid.id, data, size: csz.size };
    p = data + csz.size;
  }
}

function readEbmlUint(buf: Buffer, off: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + buf[off + i];
  return v;
}

function readMkvInfoFromHead(buf: Buffer): VideoProbeInfo {
  const info: VideoProbeInfo = {};
  const hId = readVintId(buf, 0);
  if (!hId || hId.id !== EBML_HEADER) return info;
  const hSize = readVintSize(buf, hId.len);
  if (!hSize || hSize.size < 0) return info;
  let off = hId.len + hSize.len + hSize.size;

  const sId = readVintId(buf, off);
  if (!sId || sId.id !== EBML_SEGMENT) return info;
  const sSize = readVintSize(buf, off + sId.len);
  if (!sSize) return info;
  off += sId.len + sSize.len;

  while (off < buf.length && !isComplete(info)) {
    const id = readVintId(buf, off);
    if (!id) break;
    const size = readVintSize(buf, off + id.len);
    if (!size || size.size < 0) break;
    const dataOff = off + id.len + size.len;
    if (id.id === EBML_CLUSTER) break;

    if (id.id === EBML_INFO) {
      let scale = 1_000_000; // ns mặc định
      let duration: number | null = null;
      for (const c of ebmlChildren(buf, dataOff, dataOff + size.size)) {
        if (c.id === EBML_TIMECODE_SCALE) {
          const v = readEbmlUint(buf, c.data, c.size);
          if (v > 0) scale = v;
        } else if (c.id === EBML_DURATION) {
          if (c.size === 4) duration = buf.readFloatBE(c.data);
          else if (c.size === 8) duration = buf.readDoubleBE(c.data);
        }
      }
      if (duration !== null && isFinite(duration) && duration > 0) {
        info.durationMs = Math.round((duration * scale) / 1_000_000);
      }
    } else if (id.id === EBML_TRACKS) {
      for (const entry of ebmlChildren(buf, dataOff, dataOff + size.size)) {
        if (entry.id !== EBML_TRACK_ENTRY || info.width) continue;
        let trackType = 0;
        let w = 0;
        let h = 0;
        for (const c of ebmlChildren(buf, entry.data, entry.data + entry.size)) {
          if (c.id === EBML_TRACK_TYPE) trackType = readEbmlUint(buf, c.data, c.size);
          else if (c.id === EBML_VIDEO) {
            for (const v of ebmlChildren(buf, c.data, c.data + c.size)) {
              if (v.id === EBML_PIXEL_WIDTH) w = readEbmlUint(buf, v.data, v.size);
              else if (v.id === EBML_PIXEL_HEIGHT) h = readEbmlUint(buf, v.data, v.size);
            }
          }
        }
        if (trackType === 1 && w > 0 && h > 0) {
          info.width = w;
          info.height = h;
        }
      }
    }
    off = dataOff + size.size;
  }
  return info;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Phân tích output `ffmpeg -i` lấy thời lượng + độ phân giải của luồng video đầu tiên */
export function parseFfmpegProbeOutput(stderr: string): VideoProbeInfo {
  const info: VideoProbeInfo = {};
  const d = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (d) {
    const ms = (Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 1000;
    if (ms > 0) info.durationMs = Math.round(ms);
  }
  // vd: "Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 25 fps"
  // Bỏ qua luồng ảnh bìa (attached pic) – thường là mjpeg/png
  for (const line of stderr.split(/\r?\n/)) {
    if (!/Stream #.*Video:/.test(line) || /attached pic/.test(line)) continue;
    const r = line.match(/,\s*(\d{2,5})x(\d{2,5})[\s,]/);
    if (r) {
      info.width = Number(r[1]);
      info.height = Number(r[2]);
      break;
    }
  }
  return info;
}

/** Đọc thời lượng (ms) + độ phân giải video. Ưu tiên header; thiếu thông tin nào thì hỏi ffmpeg */
export async function probeVideoInfo(filePath: string, ffmpegPath?: string): Promise<VideoProbeInfo> {
  const ext = path.extname(filePath).toLowerCase();
  let info: VideoProbeInfo = {};
  try {
    if (MP4_EXTS.has(ext) || MKV_EXTS.has(ext)) {
      const fh = await fs.promises.open(filePath, 'r');
      try {
        const { size } = await fh.stat();
        if (MP4_EXTS.has(ext)) {
          info = await readMp4Info(fh, size);
        } else {
          const len = Math.min(size, HEAD_READ);
          const head = Buffer.alloc(len);
          await fh.read(head, 0, len, 0);
          info = readMkvInfoFromHead(head);
        }
      } finally {
        await fh.close();
      }
    }
  } catch {
    // rơi xuống ffmpeg
  }
  if (isComplete(info) || !ffmpegPath) return info;
  try {
    // `ffmpeg -i <file>` không có output → thoát mã 1 nhưng vẫn in thông tin ra stderr
    const { stderr } = await execFileBuffer(ffmpegPath, ['-hide_banner', '-i', filePath], 30_000);
    const ff = parseFfmpegProbeOutput(stderr);
    return {
      durationMs: info.durationMs || ff.durationMs,
      width: info.width || ff.width,
      height: info.height || ff.height,
    };
  } catch {
    return info;
  }
}

/** Thời lượng video (mili giây), null nếu không đọc được */
export async function probeVideoDurationMs(
  filePath: string,
  ffmpegPath?: string
): Promise<number | null> {
  return (await probeVideoInfo(filePath, ffmpegPath)).durationMs ?? null;
}

/** Trích 1 khung hình tại `seconds`, trả về 72 giá trị độ sáng (9x8) hoặc null */
export async function extractGrayFrame9x8(
  ffmpegPath: string,
  filePath: string,
  seconds: number
): Promise<Uint8Array | null> {
  const { stdout } = await execFileBuffer(
    ffmpegPath,
    [
      '-v', 'error',
      '-ss', seconds.toFixed(3),
      '-i', filePath,
      '-an', '-sn', '-dn',
      '-frames:v', '1',
      '-vf', 'scale=9:8:flags=area,format=gray',
      '-f', 'rawvideo',
      'pipe:1',
    ],
    30_000
  );
  if (!stdout || stdout.length < 72) return null;
  return new Uint8Array(stdout.subarray(0, 72));
}
