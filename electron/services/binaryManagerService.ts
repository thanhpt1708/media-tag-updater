import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BinaryStatusInfo } from '../../src/shared/types';
import { getConfig } from './configService';
import binaryManifest from '../../scripts/binaries.json';
import { installBinaries, verifyBinaries, type BinaryManifest } from '../../scripts/binary-installer.mjs';

/** Bản ffmpeg build với NVENC SDK cũ, dự phòng cho GPU/driver đời cũ (xem scripts/binaries.json) */
const COMPAT_FFMPEG_REL = path.join('ffmpeg-compat', 'ffmpeg.exe');

let cachedBinaryStatus: BinaryStatusInfo | null = null;

export function invalidateBinaryStatusCache(): void {
  cachedBinaryStatus = null;
}

export function getProjectBinDir(): string {
  if (process.resourcesPath) {
    const packagedBin = path.join(process.resourcesPath, 'bin');
    if (fs.existsSync(packagedBin)) {
      return packagedBin;
    }
  }
  const cwdBin = path.resolve(process.cwd(), 'bin');
  if (!fs.existsSync(cwdBin)) {
    try {
      fs.mkdirSync(cwdBin, { recursive: true });
    } catch {
      // ignore
    }
  }
  return cwdBin;
}

function getBinaryVersionSync(exePath: string, args: string[]): string | undefined {
  try {
    const out = execFileSync(exePath, args, {
      encoding: 'utf-8',
      timeout: 4000,
      windowsHide: true,
    });
    const firstLine = out.split(/\r?\n/)[0]?.trim();
    return firstLine || 'Available';
  } catch {
    return undefined;
  }
}

function findInSystemPath(exeName: string): string | undefined {
  try {
    const out = execFileSync('where.exe', [exeName], {
      encoding: 'utf-8',
      timeout: 2500,
      windowsHide: true,
    });
    const first = out.split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) {
      return first;
    }
  } catch {
    // Không có trong PATH
  }
  return undefined;
}

export function getCompatFfmpegPath(): string | undefined {
  const p = path.join(getProjectBinDir(), COMPAT_FFMPEG_REL);
  return fs.existsSync(p) ? p : undefined;
}

/** "ffmpeg version 6.1.1-essentials_build-www.gyan.dev ..." → "6.1.1" */
export function shortFfmpegVersion(versionLine?: string): string | undefined {
  const m = versionLine?.match(/version\s+n?([0-9][\w.]*?)(?:-|\s|$)/i);
  return m?.[1];
}

export interface FfmpegCandidate {
  path: string;
  /** vd "9.0.2" */
  version?: string;
  source: BinaryStatusInfo['ffmpegSource'];
}

/**
 * Các bản ffmpeg có thể dùng để encode, theo thứ tự ưu tiên: bản chính (custom / ./bin / ...) trước,
 * sau đó bản tương thích `./bin/ffmpeg-compat/ffmpeg.exe`. Dùng khi bản chính không chạy được một
 * encoder nào đó (vd: ffmpeg mới build với NVENC SDK 13.1 đòi driver 610+, GPU Pascal chỉ có driver 58x).
 */
export function listFfmpegCandidates(): FfmpegCandidate[] {
  const status = getBinaryStatus();
  const list: FfmpegCandidate[] = [];
  const seen = new Set<string>();
  const add = (p: string | undefined, source: FfmpegCandidate['source'], versionLine?: string) => {
    if (!p || !fs.existsSync(p)) return;
    const key = path.resolve(p).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ path: p, source, version: shortFfmpegVersion(versionLine) });
  };
  if (status.ffmpegAvailable) add(status.ffmpegPath, status.ffmpegSource, status.ffmpegVersion);
  const compatPath = getCompatFfmpegPath();
  if (compatPath) add(compatPath, 'project-bin-compat', getBinaryVersionSync(compatPath, ['-version']));
  return list;
}

export function getBinaryStatus(forceRefresh = false): BinaryStatusInfo {
  if (cachedBinaryStatus && !forceRefresh) {
    return cachedBinaryStatus;
  }

  const config = getConfig();
  const projectBinDir = getProjectBinDir();

  const status: BinaryStatusInfo = {
    ffmpegAvailable: false,
    ffmpegSource: 'none',
    ffprobeAvailable: false,
    ffprobeSource: 'none',
    exiftoolAvailable: false,
    exiftoolSource: 'none',
    projectBinDir,
  };

  // 1. Dò tìm FFmpeg
  const customFfmpeg = config.customFfmpegPath?.trim();
  const projectFfmpeg = path.join(projectBinDir, 'ffmpeg.exe');
  const compatFfmpeg = getCompatFfmpegPath();

  if (customFfmpeg && fs.existsSync(customFfmpeg)) {
    const ver = getBinaryVersionSync(customFfmpeg, ['-version']);
    if (ver) {
      status.ffmpegAvailable = true;
      status.ffmpegPath = customFfmpeg;
      status.ffmpegSource = 'custom';
      status.ffmpegVersion = ver;
    }
  }
  if (!status.ffmpegAvailable && fs.existsSync(projectFfmpeg)) {
    const ver = getBinaryVersionSync(projectFfmpeg, ['-version']);
    if (ver) {
      status.ffmpegAvailable = true;
      status.ffmpegPath = projectFfmpeg;
      status.ffmpegSource = 'project-bin';
      status.ffmpegVersion = ver;
    }
  }
  if (!status.ffmpegAvailable && compatFfmpeg) {
    const ver = getBinaryVersionSync(compatFfmpeg, ['-version']);
    if (ver) {
      status.ffmpegAvailable = true;
      status.ffmpegPath = compatFfmpeg;
      status.ffmpegSource = 'project-bin-compat';
      status.ffmpegVersion = ver;
    }
  }
  if (!status.ffmpegAvailable) {
    const systemFfmpeg = findInSystemPath('ffmpeg.exe');
    if (systemFfmpeg) {
      const ver = getBinaryVersionSync(systemFfmpeg, ['-version']);
      if (ver) {
        status.ffmpegAvailable = true;
        status.ffmpegPath = systemFfmpeg;
        status.ffmpegSource = 'system-path';
        status.ffmpegVersion = ver;
      }
    }
  }

  // 1b. Dò tìm FFprobe: đường dẫn tự chọn → cùng thư mục với ffmpeg đang dùng → ./bin → PATH
  const ffprobeCandidates: { p: string; source: BinaryStatusInfo['ffprobeSource'] }[] = [];
  const customFfprobe = config.customFfprobePath?.trim();
  if (customFfprobe) ffprobeCandidates.push({ p: customFfprobe, source: 'custom' });
  if (status.ffmpegPath) {
    ffprobeCandidates.push({
      p: path.join(path.dirname(status.ffmpegPath), 'ffprobe.exe'),
      source: 'next-to-ffmpeg',
    });
  }
  ffprobeCandidates.push({ p: path.join(projectBinDir, 'ffprobe.exe'), source: 'project-bin' });
  for (const { p: candidate, source } of ffprobeCandidates) {
    if (!fs.existsSync(candidate)) continue;
    const ver = getBinaryVersionSync(candidate, ['-version']);
    if (ver) {
      status.ffprobeAvailable = true;
      status.ffprobePath = candidate;
      // ffmpeg nằm trong ./bin thì "cạnh ffmpeg" cũng chính là ./bin
      status.ffprobeSource =
        source === 'next-to-ffmpeg' &&
        path.resolve(path.dirname(candidate)).toLowerCase() === path.resolve(projectBinDir).toLowerCase()
          ? 'project-bin'
          : source;
      status.ffprobeVersion = ver;
      break;
    }
  }
  if (!status.ffprobeAvailable) {
    const systemFfprobe = findInSystemPath('ffprobe.exe');
    if (systemFfprobe) {
      const ver = getBinaryVersionSync(systemFfprobe, ['-version']);
      if (ver) {
        status.ffprobeAvailable = true;
        status.ffprobePath = systemFfprobe;
        status.ffprobeSource = 'system-path';
        status.ffprobeVersion = ver;
      }
    }
  }

  // 2. Dò tìm ExifTool
  const customExiftool = config.customExiftoolPath?.trim();
  const projectExiftool = path.join(projectBinDir, 'exiftool.exe');

  if (customExiftool && fs.existsSync(customExiftool)) {
    const ver = getBinaryVersionSync(customExiftool, ['-ver']);
    if (ver) {
      status.exiftoolAvailable = true;
      status.exiftoolPath = customExiftool;
      status.exiftoolSource = 'custom';
      status.exiftoolVersion = `ExifTool v${ver}`;
    }
  }
  if (!status.exiftoolAvailable && fs.existsSync(projectExiftool)) {
    const ver = getBinaryVersionSync(projectExiftool, ['-ver']);
    if (ver) {
      status.exiftoolAvailable = true;
      status.exiftoolPath = projectExiftool;
      status.exiftoolSource = 'project-bin';
      status.exiftoolVersion = `ExifTool v${ver}`;
    }
  }
  if (!status.exiftoolAvailable) {
    const systemExiftool = findInSystemPath('exiftool.exe');
    if (systemExiftool) {
      const ver = getBinaryVersionSync(systemExiftool, ['-ver']);
      if (ver) {
        status.exiftoolAvailable = true;
        status.exiftoolPath = systemExiftool;
        status.exiftoolSource = 'system-path';
        status.exiftoolVersion = `ExifTool v${ver}`;
      }
    }
  }

  cachedBinaryStatus = status;
  return status;
}

/**
 * Tải / cập nhật ffmpeg, ffprobe, ffmpeg-compat và exiftool vào thư mục bin (dev: ./bin, bản đóng gói:
 * resources/bin) theo đúng version khai báo trong scripts/binaries.json – cùng logic với
 * `npm run setup:binaries` và CI.
 */
export async function installBinariesToProject(): Promise<{
  success: boolean;
  message: string;
  status: BinaryStatusInfo;
}> {
  const binDir = getProjectBinDir();
  const manifest = binaryManifest as BinaryManifest;
  const messages: string[] = [];

  try {
    const results = await installBinaries({ manifest, binDir, log: () => {} });
    for (const r of results) {
      const pkg = manifest.packages.find((p) => p.id === r.id);
      const name = `${pkg?.name ?? r.id} ${r.version}`;
      if (r.status === 'installed') messages.push(`Đã cài ${name}.`);
      else if (r.status === 'skipped') messages.push(`${name} đã có sẵn.`);
      else messages.push(`Không cài được ${name}: ${r.error}.`);
    }
    const problems = await verifyBinaries({ manifest, binDir });
    messages.push(...problems.map((p) => `Kiểm tra: ${p}.`));
    invalidateBinaryStatusCache();
    const status = getBinaryStatus(true);
    const ok = results.every((r) => r.status !== 'failed') && problems.length === 0;
    if (!ok) messages.push('Có thể cài thủ công theo hướng dẫn tại bin/README.md.');
    return { success: ok, message: messages.join(' '), status };
  } catch (err: any) {
    messages.push(`Lỗi khi cài binary (${err?.message || 'không rõ'}). Xem hướng dẫn tại bin/README.md.`);
    return { success: false, message: messages.join(' '), status: getBinaryStatus(true) };
  }
}
