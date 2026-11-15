import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  buildTitleKey,
  clearDuplicateHashCache,
  dHashFromGray9x8,
  findDuplicateMedia,
  hammingDistanceHex,
  normalizeForCompare,
} from '../electron/services/duplicateDetectionService';
import { MediaFileItem, MediaType } from '../src/shared/types';
import { parseSceneFilename } from '../electron/services/sceneReleaseParser';

let tmpDir: string;

function writeFile(rel: string, content: Buffer): MediaFileItem {
  const filePath = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mediaType: MediaType = ['.jpg', '.png'].includes(ext)
    ? 'image'
    : ['.mkv', '.mp4'].includes(ext)
      ? 'video'
      : 'audio';
  return {
    id: filePath,
    filePath,
    fileName: path.basename(filePath),
    extension: ext,
    directory: path.dirname(filePath),
    fileSize: stat.size,
    modifiedAt: stat.mtimeMs,
    mediaType,
    metadata: {},
    sceneInfo: mediaType === 'video' ? parseSceneFilename(path.basename(filePath)) : undefined,
    hasEmbeddedThumbnail: false,
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtu-dup-'));
  clearDuplicateHashCache();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('DuplicateDetectionService - tiện ích', () => {
  it('chuẩn hóa tiêu đề tiếng Việt', () => {
    expect(normalizeForCompare('  Đừng Làm Trái Tim Anh Đau!! ')).toBe('dung lam trai tim anh dau');
  });

  it('tính khoảng cách Hamming giữa 2 hash hex', () => {
    expect(hammingDistanceHex('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistanceHex('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistanceHex('8000000000000001', '0000000000000000')).toBe(2);
  });

  it('dHash ổn định với thay đổi độ sáng đều', () => {
    const gray = Array.from({ length: 72 }, (_, i) => (i * 37) % 255);
    const brighter = gray.map((g) => g + 10);
    expect(dHashFromGray9x8(gray)).toBe(dHashFromGray9x8(brighter));
    expect(dHashFromGray9x8(gray)).toHaveLength(16);
  });

  it('tạo khóa tiêu đề cho tập phim TV từ tên Scene', () => {
    const a = writeFile('tv/Breaking.Bad.S01E02.720p.HDTV.x264-CTU.mkv', Buffer.from('a'));
    const b = writeFile('tv/Breaking Bad - S01E02 - 1080p WEB-DL.mkv', Buffer.from('bb'));
    expect(buildTitleKey(a)).toBeTruthy();
    expect(buildTitleKey(a)).toBe(buildTitleKey(b));
  });
});

describe('DuplicateDetectionService - findDuplicateMedia', () => {
  it('phát hiện file trùng byte dù khác tên / thư mục', async () => {
    const data = crypto.randomBytes(300 * 1024);
    const a = writeFile('exact/a/song.mp3', data);
    const b = writeFile('exact/b/song (copy).mp3', data);
    // Cùng kích thước nhưng khác nội dung ở giữa → không được coi là trùng
    const altered = Buffer.from(data);
    altered[150 * 1024] ^= 0xff;
    const c = writeFile('exact/c/other.mp3', altered);

    const res = await findDuplicateMedia([a, b, c]);
    const identical = res.groups.filter((g) => g.kind === 'identical');
    expect(identical).toHaveLength(1);
    expect(identical[0].filePaths.sort()).toEqual([a.filePath, b.filePath].sort());
    expect(identical[0].reclaimableBytes).toBe(data.length);
  });

  it('file lớn dùng hash mẫu nhiều điểm', async () => {
    const data = crypto.randomBytes(3 * 1024 * 1024);
    const a = writeFile('big/x.mkv', data);
    const b = writeFile('big/y.mkv', data);
    const res = await findDuplicateMedia([a, b], { fullHashSizeLimit: 1024 * 1024 });
    const g = res.groups.find((x) => x.kind === 'identical');
    expect(g?.filePaths).toHaveLength(2);
    expect(g?.reason).toContain('32 mẫu');
  });

  it('phát hiện bài hát cùng Tag nhưng khác file (khác bitrate)', async () => {
    const a = writeFile('tag/a.mp3', crypto.randomBytes(1000));
    const b = writeFile('tag/b.flac', crypto.randomBytes(2000));
    const c = writeFile('tag/c.mp3', crypto.randomBytes(1500));
    a.metadata = { title: 'Nơi Này Có Anh', artist: 'Sơn Tùng M-TP' };
    b.metadata = { title: 'noi nay co anh', artist: 'Son Tung M-TP' };
    c.metadata = { title: 'Nơi Này Có Anh (Remix)', artist: 'Sơn Tùng M-TP' };

    const res = await findDuplicateMedia([a, b, c]);
    const sameTitle = res.groups.filter((g) => g.kind === 'same-title');
    expect(sameTitle).toHaveLength(1);
    expect([...sameTitle[0].filePaths].sort()).toEqual([a.filePath, b.filePath].sort());
    // File lớn nhất (chất lượng cao) đứng đầu nhóm
    expect(sameTitle[0].filePaths[0]).toBe(b.filePath);
  });

  it('không báo trùng Tag khi các file đã nằm trong cùng nhóm identical', async () => {
    const data = crypto.randomBytes(5000);
    const a = writeFile('both/a.mp3', data);
    const b = writeFile('both/b.mp3', data);
    a.metadata = { title: 'Same', artist: 'X' };
    b.metadata = { title: 'Same', artist: 'X' };
    const res = await findDuplicateMedia([a, b]);
    expect(res.groups.map((g) => g.kind)).toEqual(['identical']);
  });

  it('gom ảnh gần giống nhau bằng perceptual hash', async () => {
    const p1 = writeFile('img/p1.jpg', crypto.randomBytes(800));
    const p2 = writeFile('img/p1_small.png', crypto.randomBytes(400));
    const p3 = writeFile('img/other.jpg', crypto.randomBytes(600));
    const fakeHashes: Record<string, string> = {
      [p1.filePath]: 'f0f0f0f00f0f0f0f',
      [p2.filePath]: 'f0f0f0f00f0f0f0e', // lệch 1 bit
      [p3.filePath]: '0f0f0f0ff0f0f0f0',
    };
    const res = await findDuplicateMedia([p1, p2, p3], {
      computeImageHash: async (fp) => fakeHashes[fp] ?? null,
    });
    const similar = res.groups.filter((g) => g.kind === 'similar-image');
    expect(similar).toHaveLength(1);
    expect(similar[0].filePaths.sort()).toEqual([p1.filePath, p2.filePath].sort());
    expect(similar[0].similarity).toBe(98);
  });

  it('bỏ qua video tên chung chung không có năm / Title Tag', async () => {
    const a = writeFile('cam1/video.mp4', crypto.randomBytes(100));
    const b = writeFile('cam2/video.mp4', crypto.randomBytes(200));
    const res = await findDuplicateMedia([a, b]);
    expect(res.groups).toHaveLength(0);
  });
});
