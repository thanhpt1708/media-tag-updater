import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DuplicateConfidence,
  DuplicateGroup,
  DuplicateKind,
  DuplicateScanResult,
  MediaFileItem,
  MediaType,
  VideoTechInfo,
} from '../../src/shared/types';
import {
  VIDEO_FRAME_POSITIONS,
  extractGrayFrame9x8,
  probeVideoInfo,
} from './videoProbeService';

/**
 * Dịch vụ phát hiện Media trùng lặp, gồm các tầng:
 *  1. identical     – Trùng byte: lọc theo kích thước → hash mẫu (đầu/giữa/cuối) → SHA-256 toàn file.
 *     same-size     – (tin cậy thấp) Video cùng dung lượng chính xác nhưng hash khác.
 *  2. similar-image – Ảnh giống nhau về nội dung (dHash 64-bit, so khoảng cách Hamming).
 *  3. similar-video – Video lệch thời lượng ≤ 1 giây VÀ khớp dHash các khung hình ở 10/30/50/70/90%.
 *     same-duration – (tin cậy thấp) Video lệch thời lượng ≤ 1 giây nhưng chưa khớp được hình ảnh.
 *  4. same-title    – Cùng bài hát / cùng phim / cùng tập phim theo Tag hoặc tên Scene Release.
 *
 * Kết quả hash được cache theo (đường dẫn + kích thước + mtime) để quét lại rất nhanh.
 */

/** File lớn hơn ngưỡng này chỉ so khớp bằng hash mẫu nhiều điểm (tránh đọc toàn bộ hàng chục GB phim) */
export const FULL_HASH_SIZE_LIMIT = 512 * 1024 * 1024;
const SAMPLE_CHUNK_SIZE = 64 * 1024;
const QUICK_SAMPLE_POINTS = 3;
const DEEP_SAMPLE_POINTS = 32;

/** Ngưỡng Hamming (trên 64 bit) để coi hai ảnh là giống nhau */
export const DEFAULT_IMAGE_HAMMING_THRESHOLD = 6;

/** Video lệch thời lượng tối đa bao nhiêu mili giây thì coi là "cùng thời lượng" */
export const VIDEO_DURATION_TOLERANCE_MS = 1000;
/** Video ngắn hơn ngưỡng này không xét trùng thời lượng (quá dễ trùng ngẫu nhiên) */
const MIN_VIDEO_DURATION_MS = 3000;
/** Nhóm "có thể trùng" (chưa khớp hình ảnh) chỉ xét video dài từ 60 giây */
const MIN_LOW_CONFIDENCE_DURATION_MS = 60_000;
/** Một dải thời lượng có quá nhiều video (vd: clip camera hành trình cắt cố định) → không trích khung hình */
const MAX_VIDEOS_PER_DURATION_BAND = 40;
/** Ngưỡng Hamming cho một khung hình video (nén video gây nhiễu nhiều hơn ảnh tĩnh) */
const VIDEO_FRAME_HAMMING_THRESHOLD = 10;
/** Tỷ lệ khung hình khớp tối thiểu để xác nhận 2 video giống nhau */
const VIDEO_MATCH_RATIO = 0.6;

export type ImageHashFn = (filePath: string) => Promise<string | null>;
/** Trả về danh sách dHash (hex 16 ký tự, '' nếu khung hình lỗi) theo VIDEO_FRAME_POSITIONS */
export type VideoFingerprintFn = (filePath: string, durationMs: number) => Promise<string[] | null>;
export type VideoInfoFn = (filePath: string) => Promise<VideoTechInfo | null>;

export interface FindDuplicatesOptions {
  /** Hàm tính perceptual hash (hex 16 ký tự) cho ảnh. Không truyền → bỏ qua tầng similar-image */
  computeImageHash?: ImageHashFn;
  /** Hàm đọc thời lượng + độ phân giải video. Không truyền → bỏ qua tầng similar-video / same-duration */
  probeVideoInfo?: VideoInfoFn;
  /** Hàm trích dấu vân tay khung hình video. Không truyền → mọi video cùng thời lượng chỉ ở mức "có thể trùng" */
  computeVideoFingerprint?: VideoFingerprintFn;
  imageHammingThreshold?: number;
  fullHashSizeLimit?: number;
}

/** Tạo các hàm đọc thời lượng / trích khung hình video dựa trên ffmpeg */
export function createFfmpegVideoTools(ffmpegPath?: string): {
  probeVideoInfo: VideoInfoFn;
  computeVideoFingerprint?: VideoFingerprintFn;
} {
  return {
    probeVideoInfo: (fp) => probeVideoInfo(fp, ffmpegPath),
    computeVideoFingerprint: ffmpegPath
      ? async (fp, durationMs) => {
          const frames = await Promise.all(
            VIDEO_FRAME_POSITIONS.map((pos) =>
              extractGrayFrame9x8(ffmpegPath, fp, (durationMs / 1000) * pos).catch(() => null)
            )
          );
          if (frames.every((f) => !f)) return null;
          return frames.map((f) => (f ? dHashFromGray9x8(f) : ''));
        }
      : undefined,
  };
}

function isInformativeHash(h: string): boolean {
  return h.length === 16 && h !== '0000000000000000' && h !== 'ffffffffffffffff';
}

/** So 2 dấu vân tay video theo từng mốc thời gian tương ứng */
export function compareVideoFingerprints(
  a: string[],
  b: string[]
): { compared: number; matched: number } {
  let compared = 0;
  let matched = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (!isInformativeHash(a[i]) || !isInformativeHash(b[i])) continue;
    compared++;
    if (hammingDistanceHex(a[i], b[i]) <= VIDEO_FRAME_HAMMING_THRESHOLD) matched++;
  }
  return { compared, matched };
}

export function formatDurationMs(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

type DuplicateInput = Pick<
  MediaFileItem,
  'filePath' | 'fileName' | 'fileSize' | 'modifiedAt' | 'mediaType' | 'metadata' | 'sceneInfo'
>;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const hashCache = new Map<string, string>();

function cacheKey(kind: string, item: DuplicateInput): string {
  return `${kind}|${item.filePath}|${item.fileSize}|${item.modifiedAt}`;
}

async function cached(
  kind: string,
  item: DuplicateInput,
  compute: () => Promise<string | null>
): Promise<string | null> {
  const key = cacheKey(kind, item);
  const hit = hashCache.get(key);
  if (hit !== undefined) return hit || null;
  const value = await compute();
  hashCache.set(key, value || '');
  return value;
}

export function clearDuplicateHashCache() {
  hashCache.clear();
}

// ---------------------------------------------------------------------------
// Hash nội dung
// ---------------------------------------------------------------------------

/**
 * Hash mẫu: đọc N đoạn 64KB phân bố đều trong file (luôn gồm đoạn đầu và cuối) + kích thước file.
 */
export async function computeSampledHash(
  filePath: string,
  fileSize: number,
  points: number
): Promise<string> {
  const hash = crypto.createHash('sha256');
  hash.update(String(fileSize));
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(SAMPLE_CHUNK_SIZE);
    if (fileSize <= SAMPLE_CHUNK_SIZE * points) {
      const whole = Buffer.alloc(fileSize);
      await handle.read(whole, 0, fileSize, 0);
      hash.update(whole);
    } else {
      const maxOffset = fileSize - SAMPLE_CHUNK_SIZE;
      for (let i = 0; i < points; i++) {
        const offset = Math.floor((maxOffset * i) / (points - 1));
        const { bytesRead } = await handle.read(buf, 0, SAMPLE_CHUNK_SIZE, offset);
        hash.update(buf.subarray(0, bytesRead));
      }
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export function computeFullHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

function groupBy<T>(list: T[], keyFn: (x: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const x of list) {
    const k = keyFn(x);
    if (!k) continue;
    const arr = map.get(k);
    if (arr) arr.push(x);
    else map.set(k, [x]);
  }
  return map;
}

/** Chuẩn hóa chuỗi để so sánh tiêu đề: bỏ dấu tiếng Việt, ký tự đặc biệt, khoảng trắng thừa */
export function normalizeForCompare(text?: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Khoảng cách Hamming giữa hai hash 64-bit dạng hex 16 ký tự */
export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return 64;
  const hiA = parseInt(a.slice(0, 8), 16);
  const loA = parseInt(a.slice(8), 16);
  const hiB = parseInt(b.slice(0, 8), 16);
  const loB = parseInt(b.slice(8), 16);
  return popcount32((hiA ^ hiB) >>> 0) + popcount32((loA ^ loB) >>> 0);
}

/**
 * Tính dHash 64-bit từ bitmap xám 9x8 (72 giá trị độ sáng, theo hàng).
 * Mỗi bit = pixel bên trái sáng hơn pixel bên phải.
 */
export function dHashFromGray9x8(gray: ArrayLike<number>): string {
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = gray[y * 9 + x];
      const right = gray[y * 9 + x + 1];
      if (left > right) {
        if (bit < 32) hi |= 1 << (31 - bit);
        else lo |= 1 << (63 - bit);
      }
      bit++;
    }
  }
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Union-Find đơn giản để gom cụm */
class DisjointSet {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function reclaimable(items: DuplicateInput[]): number {
  const total = items.reduce((s, i) => s + i.fileSize, 0);
  const largest = items.reduce((m, i) => Math.max(m, i.fileSize), 0);
  return total - largest;
}

function makeGroupId(kind: DuplicateKind, filePaths: string[]): string {
  const h = crypto.createHash('sha1').update(kind).update(filePaths.slice().sort().join('\n'));
  return `${kind}-${h.digest('hex').slice(0, 12)}`;
}

const LOW_CONFIDENCE_KINDS = new Set<DuplicateKind>(['same-duration', 'same-size']);

function buildGroup(
  kind: DuplicateKind,
  mediaType: MediaType,
  members: DuplicateInput[],
  reason: string,
  similarity?: number
): DuplicateGroup {
  const confidence: DuplicateConfidence = LOW_CONFIDENCE_KINDS.has(kind) ? 'low' : 'high';
  const sorted = members
    .slice()
    .sort((a, b) => b.fileSize - a.fileSize || a.modifiedAt - b.modifiedAt);
  const filePaths = sorted.map((m) => m.filePath);
  return {
    id: makeGroupId(kind, filePaths),
    kind,
    confidence,
    mediaType,
    filePaths,
    reason,
    reclaimableBytes: reclaimable(sorted),
    similarity,
  };
}

/**
 * Nhóm có ý nghĩa khi gồm ít nhất 2 "bản" khác nhau – nếu tất cả thành viên đều đã nằm chung
 * một nhóm identical thì không báo lại (tránh trùng lặp thông tin).
 */
function spansMultipleCopies(members: DuplicateInput[], identicalOf: Map<string, string>): boolean {
  const ids = new Set(members.map((m) => identicalOf.get(m.filePath) || m.filePath));
  return ids.size >= 2;
}

/** Gom các phần tử thành cụm theo danh sách cạnh */
function clustersFromEdges<T>(nodes: T[], edges: [number, number][]): T[][] {
  const dsu = new DisjointSet(nodes.length);
  const touched = new Set<number>();
  for (const [a, b] of edges) {
    dsu.union(a, b);
    touched.add(a);
    touched.add(b);
  }
  const map = new Map<number, T[]>();
  for (const i of touched) {
    const r = dsu.find(i);
    const arr = map.get(r);
    if (arr) arr.push(nodes[i]);
    else map.set(r, [nodes[i]]);
  }
  return [...map.values()].filter((c) => c.length >= 2);
}

// ---------------------------------------------------------------------------
// Khóa so sánh tiêu đề
// ---------------------------------------------------------------------------

export function buildTitleKey(item: DuplicateInput): string | null {
  const meta = item.metadata || {};
  if (item.mediaType === 'audio') {
    const title = normalizeForCompare(meta.title);
    if (!title) return null;
    const artist = normalizeForCompare(meta.artist || meta.albumArtist);
    return `audio|${artist}|${title}`;
  }
  if (item.mediaType === 'video') {
    const scene = item.sceneInfo;
    if (scene?.javCode) return `video|jav|${normalizeForCompare(scene.javCode)}`;
    const title = normalizeForCompare(scene?.cleanTitle || meta.title);
    if (!title) return null;
    const year = scene?.year || meta.year || '';
    if (scene?.isTvShow || scene?.season !== undefined || scene?.episode !== undefined) {
      if (scene?.episode === undefined) return null;
      return `video|tv|${title}|s${scene.season ?? 0}e${scene.episode}`;
    }
    // Tên chung chung như "video.mp4" ở nhiều thư mục khác nhau → chỉ so khi có năm hoặc Title Tag thật
    if (!year && !meta.title) return null;
    return `video|movie|${title}|${year}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hàm chính
// ---------------------------------------------------------------------------

export async function findDuplicateMedia(
  items: DuplicateInput[],
  options: FindDuplicatesOptions = {}
): Promise<DuplicateScanResult> {
  const startedAt = Date.now();
  const fullLimit = options.fullHashSizeLimit ?? FULL_HASH_SIZE_LIMIT;
  const threshold = options.imageHammingThreshold ?? DEFAULT_IMAGE_HAMMING_THRESHOLD;
  let hashedCount = 0;

  // Loại bỏ đường dẫn trùng (không phân biệt hoa thường trên Windows)
  const uniqueMap = new Map<string, DuplicateInput>();
  for (const it of items) uniqueMap.set(path.resolve(it.filePath).toLowerCase(), it);
  const list = Array.from(uniqueMap.values());

  const groups: DuplicateGroup[] = [];
  /** filePath → id nhóm identical chứa nó */
  const identicalOf = new Map<string, string>();

  // ---- Tầng 1: trùng byte ---------------------------------------------------
  const bySize = groupBy(list, (i) => (i.fileSize > 0 ? `${i.mediaType}|${i.fileSize}` : null));
  for (const sameSize of bySize.values()) {
    if (sameSize.length < 2) continue;

    const quick = new Map<DuplicateInput, string>();
    for (const it of sameSize) {
      try {
        await yieldToEventLoop();
        const h = await cached('quick', it, () =>
          computeSampledHash(it.filePath, it.fileSize, QUICK_SAMPLE_POINTS)
        );
        hashedCount++;
        if (h) quick.set(it, h);
      } catch {
        // File bị khóa / đã bị xóa → bỏ qua
      }
    }

    for (const sameQuick of groupBy(sameSize, (i) => quick.get(i) || null).values()) {
      if (sameQuick.length < 2) continue;
      const isLarge = sameQuick[0].fileSize > fullLimit;
      const strong = new Map<DuplicateInput, string>();
      for (const it of sameQuick) {
        try {
          await yieldToEventLoop();
          const h = isLarge
            ? await cached('deep', it, () =>
                computeSampledHash(it.filePath, it.fileSize, DEEP_SAMPLE_POINTS)
              )
            : await cached('full', it, () => computeFullHash(it.filePath));
          if (h) strong.set(it, h);
        } catch {
          // bỏ qua
        }
      }
      for (const members of groupBy(sameQuick, (i) => strong.get(i) || null).values()) {
        if (members.length < 2) continue;
        const g = buildGroup(
          'identical',
          members[0].mediaType,
          members,
          isLarge
            ? 'Nội dung giống hệt (cùng kích thước, khớp 32 mẫu dữ liệu)'
            : 'Nội dung giống hệt từng byte (SHA-256)'
        );
        groups.push(g);
        for (const m of members) identicalOf.set(m.filePath, g.id);
      }
    }

    // Video cùng dung lượng chính xác nhưng nội dung khác → có thể cùng bản encode, khác Tag / bị hỏng
    if (sameSize[0].mediaType === 'video' && sameSize[0].fileSize >= 1024 * 1024) {
      if (spansMultipleCopies(sameSize, identicalOf)) {
        groups.push(
          buildGroup(
            'same-size',
            'video',
            sameSize,
            'Cùng dung lượng chính xác từng byte nhưng nội dung khác – có thể cùng bản encode, khác Tag/Poster hoặc một bản bị hỏng'
          )
        );
      }
    }
  }

  // ---- Tầng 2: ảnh giống nhau về hình ảnh ----------------------------------
  if (options.computeImageHash) {
    const images = list.filter((i) => i.mediaType === 'image');
    const hashed: { item: DuplicateInput; hash: string }[] = [];
    for (const img of images) {
      try {
        await yieldToEventLoop();
        const h = await cached('dhash', img, () => options.computeImageHash!(img.filePath));
        if (h && h !== '0000000000000000' && h !== 'ffffffffffffffff') {
          hashed.push({ item: img, hash: h });
        }
      } catch {
        // bỏ qua ảnh không giải mã được
      }
    }

    const dsu = new DisjointSet(hashed.length);
    for (let i = 0; i < hashed.length; i++) {
      if (i % 200 === 0) await yieldToEventLoop();
      for (let j = i + 1; j < hashed.length; j++) {
        if (hammingDistanceHex(hashed[i].hash, hashed[j].hash) <= threshold) dsu.union(i, j);
      }
    }
    const clusters = new Map<number, number[]>();
    hashed.forEach((_, idx) => {
      const r = dsu.find(idx);
      const arr = clusters.get(r);
      if (arr) arr.push(idx);
      else clusters.set(r, [idx]);
    });

    for (const idxs of clusters.values()) {
      if (idxs.length < 2) continue;
      const members = idxs.map((k) => hashed[k].item);
      if (!spansMultipleCopies(members, identicalOf)) continue;
      let maxDist = 0;
      for (let a = 0; a < idxs.length; a++) {
        for (let b = a + 1; b < idxs.length; b++) {
          maxDist = Math.max(maxDist, hammingDistanceHex(hashed[idxs[a]].hash, hashed[idxs[b]].hash));
        }
      }
      const similarity = Math.round(((64 - maxDist) / 64) * 100);
      groups.push(
        buildGroup(
          'similar-image',
          'image',
          members,
          maxDist === 0
            ? 'Hình ảnh giống hệt nhau (khác định dạng / kích thước / độ nén / metadata)'
            : `Hình ảnh gần giống nhau (~${similarity}%), có thể là bản resize hoặc chỉnh sửa nhẹ`,
          similarity
        )
      );
    }
  }

  // ---- Tầng 3: video cùng thời lượng (+ xác nhận bằng hình ảnh) -------------
  const videoInfo: Record<string, VideoTechInfo> = {};
  if (options.probeVideoInfo) {
    const videos: { item: DuplicateInput; dur: number }[] = [];
    for (const v of list.filter((i) => i.mediaType === 'video')) {
      try {
        await yieldToEventLoop();
        const json = await cached('vinfo', v, async () => {
          const r = await options.probeVideoInfo!(v.filePath);
          return r && (r.durationMs || r.width) ? JSON.stringify(r) : null;
        });
        if (!json) continue;
        const info = JSON.parse(json) as VideoTechInfo;
        videoInfo[v.filePath] = info;
        const ms = info.durationMs || 0;
        if (ms >= MIN_VIDEO_DURATION_MS) videos.push({ item: v, dur: ms });
      } catch {
        // bỏ qua
      }
    }
    videos.sort((a, b) => a.dur - b.dur);

    // Chia thành các "dải" thời lượng liên tiếp (khoảng cách giữa 2 video kề nhau ≤ dung sai)
    const bands: number[][] = [];
    for (let i = 0; i < videos.length; i++) {
      const last = bands[bands.length - 1];
      if (last && videos[i].dur - videos[last[last.length - 1]].dur <= VIDEO_DURATION_TOLERANCE_MS) {
        last.push(i);
      } else {
        bands.push([i]);
      }
    }

    const fingerprints = new Map<number, string[] | null>();
    const getFingerprint = async (idx: number): Promise<string[] | null> => {
      if (!options.computeVideoFingerprint) return null;
      if (fingerprints.has(idx)) return fingerprints.get(idx)!;
      const { item, dur } = videos[idx];
      let fp: string[] | null = null;
      try {
        await yieldToEventLoop();
        const s = await cached('vfp', item, async () => {
          const r = await options.computeVideoFingerprint!(item.filePath, dur);
          return r ? r.join(',') : null;
        });
        fp = s ? s.split(',') : null;
      } catch {
        fp = null;
      }
      fingerprints.set(idx, fp);
      return fp;
    };

    const highEdges: [number, number][] = [];
    const highSimilarity = new Map<string, number>(); // "i|j" → % khung hình khớp
    const lowEdges: [number, number][] = [];
    type LowNote = 'mismatch' | 'uncomparable' | 'crowded';
    const lowNotes = new Map<string, LowNote>();

    for (const band of bands) {
      if (band.length < 2) continue;
      const crowded = band.length > MAX_VIDEOS_PER_DURATION_BAND;
      for (let a = 0; a < band.length; a++) {
        for (let b = a + 1; b < band.length; b++) {
          const i = band[a];
          const j = band[b];
          if (videos[j].dur - videos[i].dur > VIDEO_DURATION_TOLERANCE_MS) break;
          const ia = identicalOf.get(videos[i].item.filePath);
          if (ia && ia === identicalOf.get(videos[j].item.filePath)) continue;

          let note: LowNote | null = null;
          if (crowded) {
            note = 'crowded';
          } else {
            const [fa, fb] = [await getFingerprint(i), await getFingerprint(j)];
            const { compared, matched } = fa && fb ? compareVideoFingerprints(fa, fb) : { compared: 0, matched: 0 };
            if (compared >= 2 && matched / compared >= VIDEO_MATCH_RATIO) {
              highEdges.push([i, j]);
              highSimilarity.set(`${i}|${j}`, Math.round((matched / compared) * 100));
            } else {
              note = compared >= 2 ? 'mismatch' : 'uncomparable';
            }
          }
          if (note && videos[i].dur >= MIN_LOW_CONFIDENCE_DURATION_MS) {
            lowEdges.push([i, j]);
            lowNotes.set(`${i}|${j}`, note);
          }
        }
      }
    }

    const indices = videos.map((_, k) => k);
    /** filePath → id cụm (identical hoặc similar-video) để không báo lại ở nhóm tin cậy thấp */
    const confirmedOf = new Map(identicalOf);

    for (const cluster of clustersFromEdges(indices, highEdges)) {
      const members = cluster.map((k) => videos[k].item);
      if (!spansMultipleCopies(members, identicalOf)) continue;
      const set = new Set(cluster);
      let minSim = 100;
      for (const [key, sim] of highSimilarity) {
        const [x, y] = key.split('|').map(Number);
        if (set.has(x) && set.has(y)) minSim = Math.min(minSim, sim);
      }
      const durs = cluster.map((k) => videos[k].dur);
      const spread = Math.max(...durs) - Math.min(...durs);
      const g = buildGroup(
        'similar-video',
        'video',
        members,
        `Cùng thời lượng ${formatDurationMs(durs[0])} (lệch ${(spread / 1000).toFixed(1)}s) và khớp hình ảnh các khung hình mẫu (~${minSim}%) – có thể là bản encode lại / khác độ phân giải`,
        minSim
      );
      groups.push(g);
      for (const m of members) confirmedOf.set(m.filePath, g.id);
    }

    for (const cluster of clustersFromEdges(indices, lowEdges)) {
      const members = cluster.map((k) => videos[k].item);
      if (!spansMultipleCopies(members, confirmedOf)) continue;
      const dur = videos[cluster[0]].dur;
      const set = new Set(cluster);
      const kinds = new Set<LowNote>();
      for (const [key, n] of lowNotes) {
        const [x, y] = key.split('|').map(Number);
        if (set.has(x) && set.has(y)) kinds.add(n);
      }
      const notes: string[] = [];
      if (kinds.has('crowded')) {
        notes.push('rất nhiều video cùng độ dài – có thể là clip camera cắt cố định, chưa so hình ảnh');
      } else {
        if (kinds.has('mismatch')) {
          notes.push('hình ảnh không khớp (có thể khác viền đen / bản cắt, hoặc chỉ trùng ngẫu nhiên)');
        }
        if (kinds.has('uncomparable')) notes.push('chưa so sánh được hình ảnh');
      }
      groups.push(
        buildGroup(
          'same-duration',
          'video',
          members,
          `Cùng thời lượng ~${formatDurationMs(dur)} (lệch ≤ 1 giây)${notes.length ? ` – ${notes.join('; ')}` : ''}`
        )
      );
    }
  }

  // ---- Tầng 4: cùng tiêu đề (Tag / Scene) ----------------------------------
  for (const [key, members] of groupBy(list, buildTitleKey)) {
    if (members.length < 2) continue;
    if (!spansMultipleCopies(members, identicalOf)) continue;
    const mediaType = members[0].mediaType;
    const first = members[0];
    let reason: string;
    if (mediaType === 'audio') {
      reason = `Cùng bài hát "${first.metadata.title}"${
        first.metadata.artist ? ` - ${first.metadata.artist}` : ''
      } (khác file / chất lượng)`;
    } else if (key.startsWith('video|tv|')) {
      const s = first.sceneInfo;
      const se = `S${String(s?.season ?? 0).padStart(2, '0')}E${String(s?.episode ?? 0).padStart(2, '0')}`;
      reason = `Cùng tập phim "${s?.cleanTitle || first.metadata.title}" ${se} (khác bản Release)`;
    } else if (key.startsWith('video|jav|')) {
      reason = `Cùng mã phim ${first.sceneInfo?.javCode} (khác bản Release)`;
    } else {
      const title = first.sceneInfo?.cleanTitle || first.metadata.title;
      const year = first.sceneInfo?.year || first.metadata.year;
      reason = `Cùng phim "${title}"${year ? ` (${year})` : ''} – khác bản Release / độ phân giải`;
    }
    groups.push(buildGroup('same-title', mediaType, members, reason));
  }

  const kindOrder: Record<DuplicateKind, number> = {
    identical: 0,
    'similar-image': 1,
    'similar-video': 2,
    'same-title': 3,
    'same-duration': 4,
    'same-size': 5,
  };
  groups.sort(
    (a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.reclaimableBytes - a.reclaimableBytes
  );

  return {
    groups,
    scannedCount: list.length,
    hashedCount,
    durationMs: Date.now() - startedAt,
    videoInfo,
  };
}

/**
 * Tính dHash bằng nativeImage của Electron (không cần thư viện native bổ sung).
 * Ưu tiên giải mã trực tiếp; định dạng Chromium không đọc được (HEIC/TIFF/WEBP) thì dùng
 * Thumbnail của Windows Shell.
 */
export const electronImageHash: ImageHashFn = async (filePath) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nativeImage } = require('electron');
    if (!nativeImage) return null;
    let img = nativeImage.createFromPath(filePath);
    if (img.isEmpty() && nativeImage.createThumbnailFromPath) {
      img = await nativeImage.createThumbnailFromPath(filePath, { width: 128, height: 128 });
    }
    if (!img || img.isEmpty()) return null;

    // Thu nhỏ theo 2 bước để giảm răng cưa trước khi về 9x8
    const mid = img.resize({ width: 72, height: 64, quality: 'better' });
    const small = mid.resize({ width: 9, height: 8, quality: 'better' });
    const bmp: Buffer = small.toBitmap(); // BGRA
    const { width, height } = small.getSize();
    if (width !== 9 || height !== 8 || bmp.length < 9 * 8 * 4) return null;
    const stride = bmp.length / 8;
    const gray = new Array<number>(72);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 9; x++) {
        const o = y * stride + x * 4;
        gray[y * 9 + x] = 0.114 * bmp[o] + 0.587 * bmp[o + 1] + 0.299 * bmp[o + 2];
      }
    }
    return dHashFromGray9x8(gray);
  } catch {
    return null;
  }
};
