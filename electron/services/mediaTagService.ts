import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  File as TagLibFile,
  ByteVector,
  Picture,
  PictureType,
  ReadStyle,
} from 'node-taglib-sharp';
import ExifReader from 'exifreader';
import piexif from 'piexifjs';
import { MediaFileItem, MediaMetadata, MediaType } from '../../src/shared/types';
import { parseSceneFilename } from './sceneReleaseParser';
import { getBinaryStatus } from './binaryManagerService';
import {
  readVideoMetadataNativeFast,
  writeVideoMetadataInPlace,
} from './fastVideoTagEditor';

const execFileAsync = promisify(execFile);

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mkv', '.mov', '.avi', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.heic']);

// Chỉ đọc tối đa 256 KB đầu tiên của file ảnh để bóc tách EXIF/IPTC/XMP/GPS (không nạp cả file ảnh lớn vào RAM)
const IMAGE_HEADER_READ_LIMIT = 256 * 1024;

export function detectMediaType(filePath: string): MediaType | null {
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}

function parseDataUrlToBuffer(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1] || 'image/jpeg',
    buffer: Buffer.from(match[2], 'base64'),
  };
}

/**
 * Tạo Thumbnail nhẹ (240x240 JPEG ~8KB) thông qua Windows Shell Thumbnail Cache của Electron
 * Không đọc toàn bộ file video/ảnh gốc vào RAM.
 */
async function getFastShellThumbnailDataUrl(filePath: string): Promise<string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (electron?.nativeImage?.createThumbnailFromPath) {
      const img = await electron.nativeImage.createThumbnailFromPath(filePath, {
        width: 240,
        height: 240,
      });
      if (img && !img.isEmpty()) {
        const jpegBuf = img.toJPEG(78);
        return `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
      }
    }
  } catch {
    // Bỏ qua nếu môi trường test CLI không có Electron
  }
  return undefined;
}

/**
 * Quét danh sách đường dẫn bất đồng bộ, nhường Event Loop giữa các file để giao diện luôn mượt mà
 */
export async function scanMediaPaths(inputPaths: string[]): Promise<MediaFileItem[]> {
  const discoveredFiles = new Set<string>();

  const walk = async (targetPath: string, depth = 0) => {
    if (depth > 12 || !fs.existsSync(targetPath)) return;
    const stat = await fs.promises.stat(targetPath);
    if (stat.isFile()) {
      if (detectMediaType(targetPath)) {
        discoveredFiles.add(path.resolve(targetPath));
      }
    } else if (stat.isDirectory()) {
      const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'exiftool_files'
        ) {
          continue;
        }
        await walk(path.join(targetPath, entry.name), depth + 1);
      }
    }
  };

  for (const p of inputPaths) {
    try {
      await walk(p);
    } catch (err) {
      console.warn('Error scanning path:', p, err);
    }
  }

  const items: MediaFileItem[] = [];
  for (const filePath of discoveredFiles) {
    try {
      // Nhường Event Loop của Electron Main Process trước mỗi file để cửa sổ không bao giờ bị Not Responding
      await new Promise<void>((resolve) => setImmediate(resolve));
      const item = await readMediaFileItem(filePath);
      if (item) items.push(item);
    } catch (err) {
      console.warn('Error reading media file:', filePath, err);
    }
  }

  return items.sort((a, b) => a.fileName.localeCompare(b.fileName, 'vi'));
}

/**
 * Đọc thông tin Metadata & Thumbnail của 1 file media (Chỉ đọc Header, không nạp cả file vào RAM)
 */
export async function readMediaFileItem(filePath: string): Promise<MediaFileItem | null> {
  const mediaType = detectMediaType(filePath);
  if (!mediaType || !fs.existsSync(filePath)) return null;

  const stat = await fs.promises.stat(filePath);
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const directory = path.dirname(filePath);

  let metadata: MediaMetadata = {};
  let hasEmbeddedThumbnail = false;

  if (mediaType === 'audio') {
    const res = await readAudioHeaderMetadata(filePath, stat.size);
    metadata = res.metadata;
    hasEmbeddedThumbnail = res.hasEmbeddedThumbnail;
  } else if (mediaType === 'video') {
    const res = await readVideoHeaderMetadata(filePath);
    metadata = res.metadata;
    hasEmbeddedThumbnail = res.hasEmbeddedThumbnail;
  } else if (mediaType === 'image') {
    const res = await readImageHeaderMetadata(filePath, stat.size);
    metadata = res.metadata;
    hasEmbeddedThumbnail = res.hasEmbeddedThumbnail;
  }

  const sceneInfo = mediaType === 'video' ? parseSceneFilename(fileName) : undefined;
  if (sceneInfo?.releaseGroup && !metadata.releaseGroup) {
    metadata.releaseGroup = sceneInfo.releaseGroup;
  }

  return {
    id: filePath,
    filePath,
    fileName,
    extension,
    directory,
    fileSize: stat.size,
    modifiedAt: stat.mtimeMs,
    mediaType,
    metadata,
    sceneInfo,
    hasEmbeddedThumbnail,
    isModified: false,
  };
}

/**
 * Đọc Header Tag của file Nhạc với ReadStyle.None (chỉ đọc vài KB vùng Tag, không quét audio frames)
 */
async function readAudioHeaderMetadata(
  filePath: string,
  fileSize: number
): Promise<{
  metadata: MediaMetadata;
  hasEmbeddedThumbnail: boolean;
}> {
  const metadata: MediaMetadata = {};
  let hasEmbeddedThumbnail = false;

  // Bảo vệ: Nếu file audio bất thường > 300MB thì dùng ExifTool -fast2 thay vì TagLib
  if (fileSize > 300 * 1024 * 1024) {
    return readMetadataViaExiftoolFast(filePath);
  }

  try {
    // ReadStyle.None (0): Chỉ đọc phần Tag ở đầu/cuối file, tuyệt đối không quét luồng âm thanh
    const tFile = TagLibFile.createFromPath(filePath, undefined, ReadStyle.None);
    try {
      const tag = tFile.tag;
      if (tag) {
        if (tag.title) metadata.title = tag.title;
        if (tag.firstPerformer) metadata.artist = tag.firstPerformer;
        else if (tag.firstAlbumArtist) metadata.artist = tag.firstAlbumArtist;
        if (tag.firstAlbumArtist) metadata.albumArtist = tag.firstAlbumArtist;
        if (tag.album) metadata.album = tag.album;
        if (tag.year && tag.year > 0) metadata.year = tag.year;
        if (tag.firstGenre) metadata.genre = tag.firstGenre;
        if (tag.track && tag.track > 0) metadata.trackNumber = tag.track;
        if (tag.disc && tag.disc > 0) metadata.seasonNumber = tag.disc;
        if (tag.comment) metadata.comment = tag.comment;
        if (tag.copyright) metadata.copyright = tag.copyright;

        if (tag.pictures && tag.pictures.length > 0) {
          const pic = tag.pictures[0];
          // Chỉ nạp ảnh bìa nếu kích thước hợp lý (< 5MB)
          if (pic.data && pic.data.length > 0 && pic.data.length < 5 * 1024 * 1024) {
            const mime = pic.mimeType || 'image/jpeg';
            const b64 = Buffer.from(pic.data.toByteArray()).toString('base64');
            metadata.thumbnailDataUrl = `data:${mime};base64,${b64}`;
            hasEmbeddedThumbnail = true;
          }
        }
      }
    } finally {
      tFile.dispose();
    }
  } catch {
    // Fallback nếu file nhạc có header đặc biệt
  }

  return { metadata, hasEmbeddedThumbnail };
}

/**
 * Đọc Header của file Video bất đồng bộ (Tuyệt đối KHÔNG dùng TagLib quét Cluster của file .mkv/.mp4 hàng GB)
 * Ưu tiên đọc trực tiếp cấu trúc nhị phân (.mp4/.m4v/.mov/.mkv/.webm) trong < 5ms, sau đó kết hợp ExifTool -fast2 nếu cần.
 */
async function readVideoHeaderMetadata(filePath: string): Promise<{
  metadata: MediaMetadata;
  hasEmbeddedThumbnail: boolean;
}> {
  const nativeRes = await readVideoMetadataNativeFast(filePath);
  if (nativeRes) {
    const hasAnyTextTag = Boolean(
      nativeRes.metadata.title ||
        nativeRes.metadata.artist ||
        nativeRes.metadata.comment ||
        nativeRes.metadata.year ||
        nativeRes.metadata.genre
    );
    if (!hasAnyTextTag) {
      const exifRes = await readMetadataViaExiftoolFast(filePath);
      nativeRes.metadata = { ...exifRes.metadata, ...nativeRes.metadata };
    }
    if (!nativeRes.metadata.thumbnailDataUrl) {
      const shellThumb = await getFastShellThumbnailDataUrl(filePath);
      if (shellThumb) {
        nativeRes.metadata.thumbnailDataUrl = shellThumb;
      }
    }
    return nativeRes;
  }

  const res = await readMetadataViaExiftoolFast(filePath);

  if (!res.metadata.thumbnailDataUrl) {
    const shellThumb = await getFastShellThumbnailDataUrl(filePath);
    if (shellThumb) {
      res.metadata.thumbnailDataUrl = shellThumb;
    }
  }

  return res;
}

/**
 * Sử dụng ExifTool với cờ -fast2 để chỉ đọc Header đầu file (mất ~25ms, không đọc sâu vào nội dung file)
 */
async function readMetadataViaExiftoolFast(filePath: string): Promise<{
  metadata: MediaMetadata;
  hasEmbeddedThumbnail: boolean;
}> {
  const metadata: MediaMetadata = {};
  let hasEmbeddedThumbnail = false;

  const binStatus = getBinaryStatus();
  if (binStatus.exiftoolAvailable && binStatus.exiftoolPath) {
    try {
      const { stdout } = await execFileAsync(
        binStatus.exiftoolPath,
        ['-j', '-fast2', '-charset', 'utf8', filePath],
        {
          timeout: 4000,
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        }
      );
      const arr = JSON.parse(stdout);
      const info = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
      if (info) {
        if (info.Title) metadata.title = String(info.Title);
        if (info.Artist || info.Director || info.Author) {
          metadata.artist = String(info.Artist || info.Director || info.Author);
        }
        if (info.Album || info.TVShow || info.Collection) {
          metadata.album = String(info.Album || info.TVShow || info.Collection);
        }
        if (info.Genre) metadata.genre = String(info.Genre);
        if (info.Comment || info.Description || info.Synopsis) {
          metadata.comment = String(info.Comment || info.Description || info.Synopsis);
        }
        if (info.Copyright) metadata.copyright = String(info.Copyright);
        if (info.TrackNumber || info.TVEpisode) {
          const tNum = parseInt(String(info.TrackNumber || info.TVEpisode), 10);
          if (!Number.isNaN(tNum)) metadata.trackNumber = tNum;
        }
        if (info.DiscNumber || info.TVSeason) {
          const sNum = parseInt(String(info.DiscNumber || info.TVSeason), 10);
          if (!Number.isNaN(sNum)) metadata.seasonNumber = sNum;
        }
        const rawYear = info.Year || info.ContentCreateDate || info.CreateDate || info.ReleaseDate;
        if (rawYear) {
          const ym = String(rawYear).match(/\b(19\d{2}|20[0-3]\d)\b/);
          if (ym) metadata.year = parseInt(ym[1], 10);
        }
      }
    } catch {
      // ignore
    }
  }

  return { metadata, hasEmbeddedThumbnail };
}

/**
 * Đọc Header EXIF/IPTC/XMP của file Ảnh:
 * Chỉ đọc đúng 256 KB đầu tiên của file từ ổ đĩa (fh.read), không nạp toàn bộ file ảnh nặng vào RAM!
 */
async function readImageHeaderMetadata(
  filePath: string,
  fileSize: number
): Promise<{
  metadata: MediaMetadata;
  hasEmbeddedThumbnail: boolean;
}> {
  const metadata: MediaMetadata = {};
  let hasEmbeddedThumbnail = false;

  try {
    const readLength = Math.min(fileSize, IMAGE_HEADER_READ_LIMIT);
    const headerBuffer = Buffer.allocUnsafe(readLength);

    const fh = await fs.promises.open(filePath, 'r');
    try {
      await fh.read(headerBuffer, 0, readLength, 0);
    } finally {
      await fh.close();
    }

    const tags = ExifReader.load(headerBuffer, { expanded: true }) as Record<string, any>;

    const exif: Record<string, any> = tags.exif || {};
    const iptc: Record<string, any> = tags.iptc || {};
    const xmp: Record<string, any> = tags.xmp || {};
    const gps: Record<string, any> = tags.gps || {};

    metadata.title =
      xmp.title?.description ||
      iptc['Object Name']?.description ||
      exif.XPTitle?.description ||
      exif.ImageDescription?.description ||
      undefined;

    metadata.artist =
      exif.Artist?.description ||
      xmp.creator?.description ||
      iptc['By-line']?.description ||
      exif.XPAuthor?.description ||
      undefined;

    metadata.comment =
      xmp.description?.description ||
      iptc['Caption/Abstract']?.description ||
      exif.UserComment?.description ||
      exif.ImageDescription?.description ||
      undefined;

    metadata.copyright =
      exif.Copyright?.description ||
      xmp.rights?.description ||
      iptc['Copyright Notice']?.description ||
      undefined;

    metadata.cameraModel =
      [exif.Make?.description, exif.Model?.description].filter(Boolean).join(' ').trim() ||
      undefined;

    const dateStr =
      exif.DateTimeOriginal?.description ||
      exif.CreateDate?.description ||
      exif.DateTime?.description;
    if (dateStr) {
      metadata.dateTaken = dateStr;
      const yearMatch = String(dateStr).match(/\b(19\d{2}|20\d{2})\b/);
      if (yearMatch) {
        metadata.year = parseInt(yearMatch[1], 10);
      }
    }

    if (typeof gps.Latitude === 'number' && typeof gps.Longitude === 'number') {
      metadata.gpsLatitude = Number(gps.Latitude.toFixed(6));
      metadata.gpsLongitude = Number(gps.Longitude.toFixed(6));
    }

    if (iptc.Keywords) {
      if (Array.isArray(iptc.Keywords)) {
        metadata.keywords = iptc.Keywords.map((k: any) => k.description).filter(Boolean);
      } else if (iptc.Keywords.description) {
        metadata.keywords = [iptc.Keywords.description];
      }
    } else if (exif.XPKeywords?.description) {
      metadata.keywords = String(exif.XPKeywords.description)
        .split(/[;,]/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    }

    // 1. Ưu tiên dùng Thumbnail nhúng sẵn trong EXIF Header (chỉ nặng ~5-15KB, không tốn thêm I/O)
    if (tags.Thumbnail && tags.Thumbnail.base64) {
      metadata.thumbnailDataUrl = `data:image/jpeg;base64,${tags.Thumbnail.base64}`;
      hasEmbeddedThumbnail = true;
    } else {
      // 2. Lấy Thumbnail thu nhỏ (240x240) từ Windows Shell Cache của Electron
      const shellThumb = await getFastShellThumbnailDataUrl(filePath);
      if (shellThumb) {
        metadata.thumbnailDataUrl = shellThumb;
        hasEmbeddedThumbnail = true;
      } else if (fileSize <= 256 * 1024) {
        // 3. Chỉ dùng buffer trực tiếp nếu file ảnh rất nhỏ (<= 256KB)
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        metadata.thumbnailDataUrl = `data:${mime};base64,${headerBuffer.toString('base64')}`;
        hasEmbeddedThumbnail = true;
      }
    }
  } catch (err) {
    console.warn('Error reading EXIF header from image:', filePath, err);
  }

  return { metadata, hasEmbeddedThumbnail };
}

/**
 * Lưu thông tin Metadata & Thumbnail vào file media (Bất đồng bộ, không gây đơ giao diện)
 */
export async function writeMediaFileMetadata(
  filePath: string,
  metadata: MediaMetadata
): Promise<MediaFileItem> {
  const mediaType = detectMediaType(filePath);
  if (!mediaType || !fs.existsSync(filePath)) {
    throw new Error(`File không tồn tại hoặc không hỗ trợ: ${filePath}`);
  }

  if (mediaType === 'audio') {
    await writeAudioMetadata(filePath, metadata);
  } else if (mediaType === 'video') {
    await writeVideoMetadata(filePath, metadata);
  } else if (mediaType === 'image') {
    await writeImageMetadata(filePath, metadata);
  }

  const updated = await readMediaFileItem(filePath);
  if (!updated) {
    throw new Error(`Không thể đọc lại file sau khi lưu: ${filePath}`);
  }
  return updated;
}

async function writeAudioMetadata(filePath: string, metadata: MediaMetadata): Promise<void> {
  const tFile = TagLibFile.createFromPath(filePath, undefined, ReadStyle.None);
  try {
    const tag = tFile.tag;
    tag.title = metadata.title || '';
    tag.performers = metadata.artist ? [metadata.artist] : [];
    tag.albumArtists = metadata.albumArtist
      ? [metadata.albumArtist]
      : metadata.artist
      ? [metadata.artist]
      : [];
    tag.album = metadata.album || '';
    tag.year = metadata.year && metadata.year > 0 ? Number(metadata.year) : 0;
    tag.genres = metadata.genre ? [metadata.genre] : [];
    tag.track = metadata.trackNumber && metadata.trackNumber > 0 ? Number(metadata.trackNumber) : 0;
    tag.disc = metadata.seasonNumber && metadata.seasonNumber > 0 ? Number(metadata.seasonNumber) : 0;
    tag.comment = metadata.comment || '';
    tag.copyright = metadata.copyright || '';

    if (metadata.thumbnailDataUrl) {
      const parsedImg = parseDataUrlToBuffer(metadata.thumbnailDataUrl);
      if (parsedImg) {
        const byteVector = ByteVector.fromByteArray(parsedImg.buffer);
        const pic = Picture.fromFullData(
          byteVector,
          PictureType.FrontCover,
          parsedImg.mimeType,
          'Cover Art'
        );
        tag.pictures = [pic];
      }
    }

    tFile.save();
  } finally {
    tFile.dispose();
  }
}

async function writeVideoMetadata(filePath: string, metadata: MediaMetadata): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();

  // Ưu tiên 1 (Tức thì < 20ms): Ghi trực tiếp In-Place vào Header/Trailer của file .mp4/.m4v/.mov và .mkv/.webm
  // Tuyệt đối KHÔNG render lại và KHÔNG copy lại toàn bộ luồng video hàng chục GB trên ổ đĩa!
  const inPlaceSuccess = await writeVideoMetadataInPlace(filePath, metadata);
  if (inPlaceSuccess) {
    return;
  }

  const binStatus = getBinaryStatus();

  // Ưu tiên 2: Dự phòng với ExifTool nếu có
  if (
    binStatus.exiftoolAvailable &&
    binStatus.exiftoolPath &&
    (ext === '.mp4' || ext === '.m4v' || ext === '.mov') &&
    !metadata.thumbnailDataUrl
  ) {
    const args: string[] = ['-overwrite_original', '-charset', 'utf8'];
    if (metadata.title !== undefined) args.push(`-Title=${metadata.title}`);
    if (metadata.artist !== undefined) {
      args.push(`-Artist=${metadata.artist}`);
      args.push(`-Director=${metadata.artist}`);
    }
    if (metadata.album !== undefined) {
      args.push(`-Album=${metadata.album}`);
      args.push(`-TVShow=${metadata.album}`);
    }
    if (metadata.year !== undefined) args.push(`-CreateDate=${metadata.year}`);
    if (metadata.genre !== undefined) args.push(`-Genre=${metadata.genre}`);
    if (metadata.comment !== undefined) {
      args.push(`-Comment=${metadata.comment}`);
      args.push(`-Description=${metadata.comment}`);
    }
    if (metadata.copyright !== undefined) args.push(`-Copyright=${metadata.copyright}`);
    args.push(filePath);

    await execFileAsync(binStatus.exiftoolPath, args, {
      timeout: 30000,
      windowsHide: true,
    });
    return;
  }

  // Ưu tiên 2: Sử dụng FFmpeg (-c copy) bất đồng bộ cho mọi định dạng video (.mkv, .mp4, .avi, .mov, .webm)
  if (binStatus.ffmpegAvailable && binStatus.ffmpegPath) {
    const tmpOut = `${filePath}.mtu_tmp${ext}`;
    let tmpCoverPath: string | null = null;

    try {
      const args: string[] = ['-y', '-i', filePath];

      // Nếu có ảnh Poster mới và container hỗ trợ attached_pic (.mp4, .m4v, .mkv)
      const parsedCover = metadata.thumbnailDataUrl
        ? parseDataUrlToBuffer(metadata.thumbnailDataUrl)
        : null;
      const canAttachCover =
        parsedCover && (ext === '.mp4' || ext === '.m4v' || ext === '.mkv');

      if (canAttachCover && parsedCover) {
        const imgExt = parsedCover.mimeType.includes('png') ? '.png' : '.jpg';
        tmpCoverPath = path.join(os.tmpdir(), `mtu-cover-${Date.now()}${imgExt}`);
        await fs.promises.writeFile(tmpCoverPath, parsedCover.buffer);

        if (ext === '.mkv') {
          args.push(
            '-attach',
            tmpCoverPath,
            '-metadata:s:t',
            `mimetype=${parsedCover.mimeType}`,
            '-metadata:s:t',
            `filename=cover${imgExt}`
          );
        } else {
          args.push('-i', tmpCoverPath, '-map', '0', '-map', '1', '-disposition:v:1', 'attached_pic');
        }
      }

      args.push('-c', 'copy');

      if (metadata.title !== undefined) args.push('-metadata', `title=${metadata.title}`);
      if (metadata.artist !== undefined) args.push('-metadata', `artist=${metadata.artist}`);
      if (metadata.album !== undefined) args.push('-metadata', `album=${metadata.album}`);
      if (metadata.year !== undefined) args.push('-metadata', `date=${metadata.year}`);
      if (metadata.genre !== undefined) args.push('-metadata', `genre=${metadata.genre}`);
      if (metadata.comment !== undefined) {
        args.push('-metadata', `comment=${metadata.comment}`);
        args.push('-metadata', `description=${metadata.comment}`);
      }
      if (metadata.copyright !== undefined) {
        args.push('-metadata', `copyright=${metadata.copyright}`);
      }

      args.push(tmpOut);

      await execFileAsync(binStatus.ffmpegPath, args, {
        timeout: 120000,
        windowsHide: true,
      });

      if (fs.existsSync(tmpOut)) {
        await fs.promises.rename(tmpOut, filePath);
      }
      return;
    } catch (ffErr) {
      if (fs.existsSync(tmpOut)) {
        await fs.promises.rm(tmpOut, { force: true });
      }
      throw new Error(`Không thể ghi metadata bằng FFmpeg: ${(ffErr as Error).message}`);
    } finally {
      if (tmpCoverPath && fs.existsSync(tmpCoverPath)) {
        await fs.promises.rm(tmpCoverPath, { force: true });
      }
    }
  }

  throw new Error(
    `Định dạng ${ext} cần công cụ FFmpeg trong thư mục ./bin để ghi Metadata. Vui lòng kiểm tra trong phần Cài đặt.`
  );
}

function toWindowsXpUtf16Bytes(str: string): number[] {
  const buf = Buffer.from(str + '\0', 'utf16le');
  return Array.from(buf);
}

function decimalToDmsRational(dec: number): [[number, number], [number, number], [number, number]] {
  const abs = Math.abs(dec);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 10000);
  return [
    [deg, 1],
    [min, 1],
    [sec, 10000],
  ];
}

async function writeImageMetadata(filePath: string, metadata: MediaMetadata): Promise<void> {
  const binStatus = getBinaryStatus();

  // 1. Ưu tiên sử dụng ExifTool bất đồng bộ (hỗ trợ UTF-8 hoàn hảo và không cần nạp cả file vào JS RAM)
  if (binStatus.exiftoolAvailable && binStatus.exiftoolPath) {
    const args: string[] = ['-overwrite_original', '-charset', 'utf8'];
    if (metadata.title !== undefined) {
      args.push(`-Title=${metadata.title}`);
      args.push(`-XPTitle=${metadata.title}`);
    }
    if (metadata.artist !== undefined) {
      args.push(`-Artist=${metadata.artist}`);
      args.push(`-Creator=${metadata.artist}`);
      args.push(`-By-line=${metadata.artist}`);
    }
    if (metadata.comment !== undefined) {
      args.push(`-ImageDescription=${metadata.comment}`);
      args.push(`-Description=${metadata.comment}`);
      args.push(`-Caption-Abstract=${metadata.comment}`);
    }
    if (metadata.copyright !== undefined) {
      args.push(`-Copyright=${metadata.copyright}`);
      args.push(`-Rights=${metadata.copyright}`);
    }
    if (metadata.keywords !== undefined) {
      args.push(`-Keywords=${metadata.keywords.join(', ')}`);
      args.push(`-Subject=${metadata.keywords.join(', ')}`);
    }
    if (typeof metadata.gpsLatitude === 'number' && typeof metadata.gpsLongitude === 'number') {
      args.push(`-GPSLatitude=${metadata.gpsLatitude}`);
      args.push(`-GPSLatitudeRef=${metadata.gpsLatitude >= 0 ? 'N' : 'S'}`);
      args.push(`-GPSLongitude=${metadata.gpsLongitude}`);
      args.push(`-GPSLongitudeRef=${metadata.gpsLongitude >= 0 ? 'E' : 'W'}`);
    }
    args.push(filePath);

    await execFileAsync(binStatus.exiftoolPath, args, {
      timeout: 15000,
      windowsHide: true,
    });
    return;
  }

  // 2. Fallback thuần JS qua piexifjs cho ảnh JPEG (.jpg / .jpeg)
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    const rawBuffer = await fs.promises.readFile(filePath);
    const dataUrl = `data:image/jpeg;base64,${rawBuffer.toString('base64')}`;

    let exifObj: any;
    try {
      exifObj = piexif.load(dataUrl);
    } catch {
      exifObj = { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {} };
    }

    exifObj['0th'] = exifObj['0th'] || {};
    exifObj.Exif = exifObj.Exif || {};
    exifObj.GPS = exifObj.GPS || {};

    if (metadata.title !== undefined) {
      exifObj['0th'][piexif.ImageIFD.XPTitle] = toWindowsXpUtf16Bytes(metadata.title);
      exifObj['0th'][piexif.ImageIFD.ImageDescription] = Buffer.from(
        metadata.comment || metadata.title,
        'utf-8'
      ).toString('binary');
    }
    if (metadata.comment !== undefined) {
      exifObj['0th'][piexif.ImageIFD.XPComment] = toWindowsXpUtf16Bytes(metadata.comment);
      if (!metadata.title) {
        exifObj['0th'][piexif.ImageIFD.ImageDescription] = Buffer.from(
          metadata.comment,
          'utf-8'
        ).toString('binary');
      }
    }
    if (metadata.artist !== undefined) {
      exifObj['0th'][piexif.ImageIFD.Artist] = Buffer.from(metadata.artist, 'utf-8').toString('binary');
      exifObj['0th'][piexif.ImageIFD.XPAuthor] = toWindowsXpUtf16Bytes(metadata.artist);
    }
    if (metadata.copyright !== undefined) {
      exifObj['0th'][piexif.ImageIFD.Copyright] = Buffer.from(metadata.copyright, 'utf-8').toString('binary');
    }
    if (metadata.keywords && metadata.keywords.length > 0) {
      exifObj['0th'][piexif.ImageIFD.XPKeywords] = toWindowsXpUtf16Bytes(metadata.keywords.join('; '));
    }

    if (typeof metadata.gpsLatitude === 'number' && typeof metadata.gpsLongitude === 'number') {
      exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = metadata.gpsLatitude >= 0 ? 'N' : 'S';
      exifObj.GPS[piexif.GPSIFD.GPSLatitude] = decimalToDmsRational(metadata.gpsLatitude);
      exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = metadata.gpsLongitude >= 0 ? 'E' : 'W';
      exifObj.GPS[piexif.GPSIFD.GPSLongitude] = decimalToDmsRational(metadata.gpsLongitude);
    }

    const exifBytes = piexif.dump(exifObj);
    const updatedDataUrl = piexif.insert(exifBytes, dataUrl);
    const parsed = parseDataUrlToBuffer(updatedDataUrl);
    if (parsed) {
      await fs.promises.writeFile(filePath, parsed.buffer);
    }
    return;
  }

  throw new Error(
    `Định dạng ảnh ${ext} cần công cụ ExifTool trong thư mục ./bin để ghi Tag. Vui lòng nhấn "Tự động cài đặt vào bin/" trong phần Cài đặt.`
  );
}
