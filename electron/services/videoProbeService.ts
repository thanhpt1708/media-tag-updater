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

async function readMp4DurationMs(fh: fs.promises.FileHandle, fileSize: number): Promise<number | null> {
  const hdr = Buffer.alloc(16);
  let offset = 0;
  while (offset + 8 <= fileSize) {
    const { bytesRead } = await fh.read(hdr, 0, 16, offset);
    if (bytesRead < 8) return null;
    let size = hdr.readUInt32BE(0);
    const type = hdr.toString('latin1', 4, 8);
    let headerLen = 8;
    if (size === 1) {
      if (bytesRead < 16) return null;
      size = Number(hdr.readBigUInt64BE(8));
      headerLen = 16;
    } else if (size === 0) {
      size = fileSize - offset;
    }
    if (size < headerLen) return null;

    if (type === 'moov') {
      const payloadLen = Math.min(size - headerLen, HEAD_READ);
      const moov = Buffer.alloc(payloadLen);
      await fh.read(moov, 0, payloadLen, offset + headerLen);
      let p = 0;
      while (p + 8 <= moov.length) {
        const childSize = moov.readUInt32BE(p);
        const childType = moov.toString('latin1', p + 4, p + 8);
        if (childType === 'mvhd') {
          const b = p + 8;
          const version = moov[b];
          let timescale: number;
          let duration: number;
          if (version === 1) {
            timescale = moov.readUInt32BE(b + 20);
            duration = Number(moov.readBigUInt64BE(b + 24));
          } else {
            timescale = moov.readUInt32BE(b + 12);
            duration = moov.readUInt32BE(b + 16);
          }
          if (!timescale || !duration || duration === 0xffffffff) return null;
          return Math.round((duration / timescale) * 1000);
        }
        if (childSize < 8) break;
        p += childSize;
      }
      return null;
    }
    offset += size;
  }
  return null;
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

function readMkvDurationMsFromHead(buf: Buffer): number | null {
  const hId = readVintId(buf, 0);
  if (!hId || hId.id !== EBML_HEADER) return null;
  const hSize = readVintSize(buf, hId.len);
  if (!hSize || hSize.size < 0) return null;
  let off = hId.len + hSize.len + hSize.size;

  const sId = readVintId(buf, off);
  if (!sId || sId.id !== EBML_SEGMENT) return null;
  const sSize = readVintSize(buf, off + sId.len);
  if (!sSize) return null;
  off += sId.len + sSize.len;

  while (off < buf.length) {
    const id = readVintId(buf, off);
    if (!id) return null;
    const size = readVintSize(buf, off + id.len);
    if (!size || size.size < 0) return null;
    const dataOff = off + id.len + size.len;
    if (id.id === EBML_CLUSTER) return null;
    if (id.id === EBML_INFO) {
      const end = Math.min(dataOff + size.size, buf.length);
      let scale = 1_000_000; // ns mặc định
      let duration: number | null = null;
      let p = dataOff;
      while (p < end) {
        const cid = readVintId(buf, p);
        if (!cid) break;
        const csz = readVintSize(buf, p + cid.len);
        if (!csz || csz.size < 0) break;
        const cdata = p + cid.len + csz.len;
        if (cdata + csz.size > buf.length) break;
        if (cid.id === EBML_TIMECODE_SCALE) {
          let v = 0;
          for (let i = 0; i < csz.size; i++) v = v * 256 + buf[cdata + i];
          if (v > 0) scale = v;
        } else if (cid.id === EBML_DURATION) {
          if (csz.size === 4) duration = buf.readFloatBE(cdata);
          else if (csz.size === 8) duration = buf.readDoubleBE(cdata);
        }
        p = cdata + csz.size;
      }
      if (duration === null || !isFinite(duration) || duration <= 0) return null;
      return Math.round((duration * scale) / 1_000_000);
    }
    off = dataOff + size.size;
  }
  return null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function probeDurationWithFfmpeg(ffmpegPath: string, filePath: string): Promise<number | null> {
  // `ffmpeg -i <file>` không có output → thoát mã 1 nhưng vẫn in thông tin "Duration:" ra stderr
  const { stderr } = await execFileBuffer(ffmpegPath, ['-hide_banner', '-i', filePath], 30_000);
  const m = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!m) return null;
  const ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
  return ms > 0 ? Math.round(ms) : null;
}

/** Thời lượng video (mili giây), null nếu không đọc được */
export async function probeVideoDurationMs(
  filePath: string,
  ffmpegPath?: string
): Promise<number | null> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (MP4_EXTS.has(ext) || MKV_EXTS.has(ext)) {
      const fh = await fs.promises.open(filePath, 'r');
      try {
        const { size } = await fh.stat();
        if (MP4_EXTS.has(ext)) {
          const ms = await readMp4DurationMs(fh, size);
          if (ms) return ms;
        } else {
          const len = Math.min(size, HEAD_READ);
          const head = Buffer.alloc(len);
          await fh.read(head, 0, len, 0);
          const ms = readMkvDurationMsFromHead(head);
          if (ms) return ms;
        }
      } finally {
        await fh.close();
      }
    }
  } catch {
    // rơi xuống ffmpeg
  }
  if (!ffmpegPath) return null;
  try {
    return await probeDurationWithFfmpeg(ffmpegPath, filePath);
  } catch {
    return null;
  }
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
