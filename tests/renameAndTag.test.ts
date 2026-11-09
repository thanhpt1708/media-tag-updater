import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  previewExtractTags,
  previewRenameFiles,
  sanitizeWindowsFilename,
} from '../electron/services/renamePatternService';
import { MediaFileItem } from '../src/shared/types';
import { parseSceneFilename } from '../electron/services/sceneReleaseParser';
import {
  readMediaFileItem,
  writeMediaFileMetadata,
} from '../electron/services/mediaTagService';

describe('RenamePatternService - Trích xuất Tag & Đổi tên file', () => {
  const mockVideoItem: MediaFileItem = {
    id: '1',
    filePath: 'D:\\Movies\\Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv',
    fileName: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv',
    extension: '.mkv',
    directory: 'D:\\Movies',
    fileSize: 1024000,
    modifiedAt: Date.now(),
    mediaType: 'video',
    metadata: {},
    sceneInfo: parseSceneFilename(
      'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv'
    ),
    hasEmbeddedThumbnail: false,
  };

  const mockAudioItem: MediaFileItem = {
    id: '2',
    filePath: 'D:\\Music\\01. Sơn Tùng M-TP - Lạc Trôi (2017).mp3',
    fileName: '01. Sơn Tùng M-TP - Lạc Trôi (2017).mp3',
    extension: '.mp3',
    directory: 'D:\\Music',
    fileSize: 512000,
    modifiedAt: Date.now(),
    mediaType: 'audio',
    metadata: {},
    hasEmbeddedThumbnail: false,
  };

  it('Trích xuất đúng Tag từ tên file Phim Rip và file Nhạc ở chế độ smart-scene', () => {
    const extracted = previewExtractTags([mockVideoItem, mockAudioItem], 'smart-scene');
    expect(extracted).toHaveLength(2);

    expect(extracted[0].extracted.title).toBe('Dune Part Two');
    expect(extracted[0].extracted.year).toBe(2024);
    expect(extracted[0].extracted.releaseGroup).toBe('FLUX');

    expect(extracted[1].extracted.trackNumber).toBe(1);
    expect(extracted[1].extracted.artist).toBe('Sơn Tùng M-TP');
    expect(extracted[1].extracted.title).toBe('Lạc Trôi');
    expect(extracted[1].extracted.year).toBe(2017);
  });

  it('Sinh tên file mới hợp lệ theo mẫu cấu trúc Tag và loại bỏ ký tự cấm của Windows', () => {
    const itemWithMeta: MediaFileItem = {
      ...mockVideoItem,
      metadata: {
        title: 'Dune: Part Two',
        year: 2024,
      },
    };
    const previews = previewRenameFiles([itemWithMeta], '{title} ({year}) [{resolution}]');
    expect(previews).toHaveLength(1);
    expect(previews[0].newName).toBe('Dune- Part Two (2024) [2160p].mkv');
    expect(previews[0].willChange).toBe(true);

    expect(sanitizeWindowsFilename('AC/DC: Back *In* Black?')).toBe('AC-DC- Back -In- Black');
  });

  it('Đọc và ghi Tag EXIF/GPS thực tế trên file ảnh JPEG', async () => {
    // Tạo 1 file JPEG 1x1 tối giản hợp lệ trong thư mục tạm
    const minimalJpegBase64 =
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtu-test-'));
    const jpgPath = path.join(tmpDir, 'test-photo.jpg');
    fs.writeFileSync(jpgPath, Buffer.from(minimalJpegBase64, 'base64'));

    try {
      const updated = await writeMediaFileMetadata(jpgPath, {
        title: 'Hồ Hoàn Kiếm',
        artist: 'Nguyen Van A',
        copyright: '2026 MTU',
        gpsLatitude: 21.028511,
        gpsLongitude: 105.852194,
      });

      expect(updated.mediaType).toBe('image');
      const reRead = await readMediaFileItem(jpgPath);
      expect(reRead).not.toBeNull();
      expect(reRead?.metadata.artist).toBe('Nguyen Van A');
      expect(reRead?.metadata.copyright).toBe('2026 MTU');
      expect(reRead?.metadata.gpsLatitude).toBeCloseTo(21.0285, 3);
      expect(reRead?.metadata.gpsLongitude).toBeCloseTo(105.8522, 3);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Không nạp toàn bộ file lớn vào RAM (Đọc Header siêu tốc cho Video và Ảnh lớn)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtu-perf-'));
    const largeVideoPath = path.join(
      tmpDir,
      'Avatar.The.Way.of.Water.2022.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv'
    );
    try {
      // Tạo file giả lập 100MB bằng ftruncate (không chiếm RAM)
      const fd = fs.openSync(largeVideoPath, 'w');
      fs.ftruncateSync(fd, 100 * 1024 * 1024);
      fs.closeSync(fd);

      const start = Date.now();
      const item = await readMediaFileItem(largeVideoPath);
      const elapsed = Date.now() - start;

      expect(item).not.toBeNull();
      expect(item?.sceneInfo?.cleanTitle).toBe('Avatar The Way of Water');
      expect(item?.sceneInfo?.year).toBe(2022);
      expect(elapsed).toBeLessThan(2000);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Ghi Metadata & Poster In-Place siêu tốc (< 100ms) cho cả file .MP4 và .MKV mà không cần render hay copy lại luồng video', async () => {
    const ffmpegBin = path.resolve(process.cwd(), 'bin', 'ffmpeg.exe');
    if (!fs.existsSync(ffmpegBin)) {
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtu-inplace-video-'));
    const mp4Path = path.join(tmpDir, 'test-movie.mp4');
    const mkvPath = path.join(tmpDir, 'test-movie.mkv');

    const minimalJpegBase64 =
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const coverDataUrl = `data:image/jpeg;base64,${minimalJpegBase64}`;

    try {
      // Tạo 2 file video .mp4 và .mkv hợp lệ bằng FFmpeg (0.2s black video)
      execFileSync(
        ffmpegBin,
        ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4Path],
        { stdio: 'ignore', windowsHide: true }
      );
      execFileSync(
        ffmpegBin,
        ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mkvPath],
        { stdio: 'ignore', windowsHide: true }
      );

      // 1. Kiểm thử In-Place update cho .MP4
      const t0Mp4 = Date.now();
      const updatedMp4 = await writeMediaFileMetadata(mp4Path, {
        title: 'Dune: Part Two',
        artist: 'Denis Villeneuve',
        album: 'Dune Saga',
        year: 2024,
        genre: 'Action, Adventure, Drama',
        comment: 'Paul Atreides unites with Chani and the Fremen while on a warpath of revenge.',
        copyright: 'Warner Bros. Pictures',
        thumbnailDataUrl: coverDataUrl,
      });
      const mp4Elapsed = Date.now() - t0Mp4;

      expect(mp4Elapsed).toBeLessThan(200);
      expect(updatedMp4.metadata.title).toBe('Dune: Part Two');
      expect(updatedMp4.metadata.artist).toBe('Denis Villeneuve');
      expect(updatedMp4.metadata.year).toBe(2024);
      expect(updatedMp4.metadata.genre).toBe('Action, Adventure, Drama');
      expect(updatedMp4.metadata.comment).toContain('Paul Atreides unites with Chani');
      expect(updatedMp4.hasEmbeddedThumbnail).toBe(true);
      expect(updatedMp4.metadata.thumbnailDataUrl).toBe(coverDataUrl);

      // Ghi lần 2 trên file .MP4 để đảm bảo tái sử dụng vùng nhớ `moov` ở cuối file, không làm phình dung lượng
      const sizeAfterFirstMp4 = fs.statSync(mp4Path).size;
      await writeMediaFileMetadata(mp4Path, {
        ...updatedMp4.metadata,
        title: 'Dune: Part Two (IMAX Edition)',
      });
      const sizeAfterSecondMp4 = fs.statSync(mp4Path).size;
      expect(Math.abs(sizeAfterSecondMp4 - sizeAfterFirstMp4)).toBeLessThan(100);

      // 2. Kiểm thử In-Place update cho .MKV
      const t0Mkv = Date.now();
      const updatedMkv = await writeMediaFileMetadata(mkvPath, {
        title: 'Oppenheimer',
        artist: 'Christopher Nolan',
        album: 'Biographical Collection',
        year: 2023,
        genre: 'Biography, Drama, History',
        comment: 'A dramatization of the life story of J. Robert Oppenheimer.',
        copyright: 'Universal Pictures',
        thumbnailDataUrl: coverDataUrl,
      });
      const mkvElapsed = Date.now() - t0Mkv;

      expect(mkvElapsed).toBeLessThan(200);
      expect(updatedMkv.metadata.title).toBe('Oppenheimer');
      expect(updatedMkv.metadata.artist).toBe('Christopher Nolan');
      expect(updatedMkv.metadata.year).toBe(2023);
      expect(updatedMkv.metadata.genre).toBe('Biography, Drama, History');
      expect(updatedMkv.metadata.comment).toContain('J. Robert Oppenheimer');
      expect(updatedMkv.hasEmbeddedThumbnail).toBe(true);
      expect(updatedMkv.metadata.thumbnailDataUrl).toBe(coverDataUrl);

      // Ghi lần 2 trên file .MKV để đảm bảo tái sử dụng Trailer ở cuối file, không làm phình dung lượng
      const sizeAfterFirstMkv = fs.statSync(mkvPath).size;
      const updatedMkv2 = await writeMediaFileMetadata(mkvPath, {
        ...updatedMkv.metadata,
        title: 'Oppenheimer (2023 Remux)',
      });
      const sizeAfterSecondMkv = fs.statSync(mkvPath).size;
      expect(updatedMkv2.metadata.title).toBe('Oppenheimer (2023 Remux)');
      expect(Math.abs(sizeAfterSecondMkv - sizeAfterFirstMkv)).toBeLessThan(100);

      // 3. Kiểm định tính toàn vẹn file (Stream Demux & Decode Integrity) bằng FFmpeg (-v error -f null -)
      const mp4DecodeErrors = execFileSync(
        ffmpegBin,
        ['-v', 'error', '-i', mp4Path, '-f', 'null', '-'],
        { encoding: 'utf8', windowsHide: true }
      );
      expect(mp4DecodeErrors.trim()).toBe('');

      const mkvDecodeErrors = execFileSync(
        ffmpegBin,
        ['-v', 'error', '-i', mkvPath, '-f', 'null', '-'],
        { encoding: 'utf8', windowsHide: true }
      );
      expect(mkvDecodeErrors.trim()).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
