import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {
  clearDuplicateHashCache,
  compareVideoFingerprints,
  createFfmpegVideoTools,
  findDuplicateMedia,
} from '../electron/services/duplicateDetectionService';
import {
  parseFfmpegProbeOutput,
  probeVideoDurationMs,
  probeVideoInfo,
} from '../electron/services/videoProbeService';
import { resolutionLabel } from '../src/utils/videoFormat';
import { MediaFileItem } from '../src/shared/types';

const ffmpeg = ffmpegStatic as unknown as string;
let dir: string;

function makeVideo(name: string, source: string, size: string, seconds: number, extra: string[] = []) {
  const out = path.join(dir, name);
  execFileSync(
    ffmpeg,
    [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `${source}=size=${size}:rate=25`,
      '-t', String(seconds),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      ...extra,
      out,
    ],
    { windowsHide: true }
  );
  return out;
}

function toItem(filePath: string): MediaFileItem {
  const stat = fs.statSync(filePath);
  return {
    id: filePath,
    filePath,
    fileName: path.basename(filePath),
    extension: path.extname(filePath),
    directory: path.dirname(filePath),
    fileSize: stat.size,
    modifiedAt: stat.mtimeMs,
    mediaType: 'video',
    metadata: {},
    hasEmbeddedThumbnail: false,
  };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtu-vdup-'));
  clearDuplicateHashCache();
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('VideoProbeService - đọc thời lượng', () => {
  it('đọc thời lượng từ header MP4 và MKV (không cần ffmpeg)', async () => {
    const mp4 = makeVideo('d.mp4', 'testsrc', '160x90', 7);
    const mkv = makeVideo('d.mkv', 'testsrc', '160x90', 7);
    const a = await probeVideoDurationMs(mp4);
    const b = await probeVideoDurationMs(mkv);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a! - 7000)).toBeLessThan(100);
    expect(Math.abs(b! - 7000)).toBeLessThan(100);
  });

  it('dùng ffmpeg cho định dạng khác (AVI)', async () => {
    const avi = path.join(dir, 'd.avi');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=25:duration=5', avi], {
      windowsHide: true,
    });
    expect(await probeVideoDurationMs(avi)).toBeNull();
    const ms = await probeVideoDurationMs(avi, ffmpeg);
    expect(Math.abs(ms! - 5000)).toBeLessThan(100);
  });
});

describe('VideoProbeService - độ phân giải', () => {
  it('đọc độ phân giải từ header MP4 (tkhd) và MKV (Tracks/Video)', async () => {
    const mp4 = makeVideo('r.mp4', 'testsrc', '1280x720', 2);
    const mkv = makeVideo('r.mkv', 'testsrc', '854x480', 2);
    expect(await probeVideoInfo(mp4)).toMatchObject({ width: 1280, height: 720 });
    expect(await probeVideoInfo(mkv)).toMatchObject({ width: 854, height: 480 });
  });

  it('MP4 có Poster nhúng vẫn lấy đúng độ phân giải của luồng video', async () => {
    const src = makeVideo('poster-src.mp4', 'testsrc', '640x360', 2);
    const cover = path.join(dir, 'cover.jpg');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:size=1000x1500', '-frames:v', '1', cover], {
      windowsHide: true,
    });
    const out = path.join(dir, 'with-poster.mp4');
    execFileSync(
      ffmpeg,
      ['-v', 'error', '-y', '-i', src, '-i', cover, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:1', 'attached_pic', out],
      { windowsHide: true }
    );
    expect(await probeVideoInfo(out, ffmpeg)).toMatchObject({ width: 640, height: 360 });
  });

  it('AVI lấy độ phân giải qua ffmpeg', async () => {
    const avi = path.join(dir, 'r.avi');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=720x576:rate=25', '-t', '2', avi], {
      windowsHide: true,
    });
    expect(await probeVideoInfo(avi, ffmpeg)).toMatchObject({ width: 720, height: 576 });
  });

  it('bỏ qua luồng ảnh bìa (attached pic) khi phân tích output ffmpeg', () => {
    const out = [
      '  Duration: 01:02:03.50, start: 0.000000, bitrate: 5000 kb/s',
      '  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc), 1000x1500, 90k tbr (attached pic)',
      '  Stream #0:1(eng): Video: hevc (Main 10), yuv420p10le(tv), 3840x1608 [SAR 1:1 DAR 160:67], 23.98 fps',
    ].join('\n');
    expect(parseFfmpegProbeOutput(out)).toEqual({ durationMs: 3723500, width: 3840, height: 1608 });
  });

  it('gắn nhãn độ phân giải đúng cả với video cắt viền / 4:3 / quay dọc', () => {
    expect(resolutionLabel(3840, 1608)).toBe('4K');
    expect(resolutionLabel(1920, 1080)).toBe('1080p');
    expect(resolutionLabel(1920, 800)).toBe('1080p');
    expect(resolutionLabel(1440, 1080)).toBe('1080p');
    expect(resolutionLabel(1080, 1920)).toBe('1080p');
    expect(resolutionLabel(1280, 720)).toBe('720p');
    expect(resolutionLabel(854, 480)).toBe('480p');
    expect(resolutionLabel(320, 180)).toBe('180p');
  });
});

describe('DuplicateDetectionService - video', () => {
  it('nhận ra bản encode lại khác độ phân giải là "Video giống nhau"', async () => {
    const hi = makeVideo('Movie.1080p.mkv', 'testsrc', '640x360', 12);
    const lo = makeVideo('Movie.480p.mp4', 'testsrc', '320x180', 12, ['-crf', '40']);
    const other = makeVideo('Other.mp4', 'mandelbrot', '320x180', 12);

    const res = await findDuplicateMedia([hi, lo, other].map(toItem), createFfmpegVideoTools(ffmpeg));
    const similar = res.groups.filter((g) => g.kind === 'similar-video');
    expect(similar).toHaveLength(1);
    expect([...similar[0].filePaths].sort()).toEqual([hi, lo].sort());
    expect(similar[0].confidence).toBe('high');
    expect(similar[0].filePaths[0]).toBe(hi); // file lớn hơn đứng đầu
    expect(Object.keys(res.videoInfo)).toHaveLength(3);
    expect(res.videoInfo[hi]).toMatchObject({ width: 640, height: 360 });
    expect(res.videoInfo[lo]).toMatchObject({ width: 320, height: 180 });
    // Video dưới 60 giây khác nội dung → không bị xếp vào nhóm "có thể trùng"
    expect(res.groups.some((g) => g.kind === 'same-duration')).toBe(false);
  }, 60_000);

  it('video dài cùng thời lượng nhưng khác hình ảnh → nhóm "có thể trùng" (độ tin cậy thấp)', async () => {
    const a = makeVideo('Long.A.mp4', 'testsrc', '160x90', 61);
    const b = makeVideo('Long.B.mp4', 'mandelbrot', '160x90', 61);
    const res = await findDuplicateMedia([a, b].map(toItem), createFfmpegVideoTools(ffmpeg));
    const low = res.groups.filter((g) => g.kind === 'same-duration');
    expect(low).toHaveLength(1);
    expect(low[0].confidence).toBe('low');
    expect(low[0].reason).toContain('hình ảnh không khớp');
    expect(res.groups.some((g) => g.kind === 'similar-video')).toBe(false);
  }, 60_000);

  it('không có ffmpeg → video cùng thời lượng chỉ ở mức "có thể trùng"', async () => {
    const a = makeVideo('NoFf.A.mkv', 'testsrc', '160x90', 61);
    const b = makeVideo('NoFf.B.mkv', 'testsrc', '320x180', 61);
    const res = await findDuplicateMedia([a, b].map(toItem), createFfmpegVideoTools(undefined));
    const low = res.groups.find((g) => g.kind === 'same-duration');
    expect(low?.reason).toContain('chưa so sánh được hình ảnh');
  }, 60_000);

  it('video cùng dung lượng chính xác nhưng khác nội dung → nhóm "Cùng dung lượng"', async () => {
    const size = 2 * 1024 * 1024;
    const p1 = path.join(dir, 'same1.mkv');
    const p2 = path.join(dir, 'same2.mkv');
    fs.writeFileSync(p1, crypto.randomBytes(size));
    fs.writeFileSync(p2, crypto.randomBytes(size));
    const res = await findDuplicateMedia([p1, p2].map(toItem));
    expect(res.groups.map((g) => [g.kind, g.confidence])).toEqual([['same-size', 'low']]);
  });

  it('so sánh dấu vân tay bỏ qua khung hình đen / lỗi', () => {
    const a = ['f0f0f0f00f0f0f0f', '0000000000000000', '', '1234567890abcdef'];
    const b = ['f0f0f0f00f0f0f0e', '0000000000000000', 'aaaaaaaaaaaaaaaa', '1234567890abcdef'];
    expect(compareVideoFingerprints(a, b)).toEqual({ compared: 2, matched: 2 });
  });
});
