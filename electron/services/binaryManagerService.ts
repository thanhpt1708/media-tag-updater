import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { BinaryStatusInfo } from '../../src/shared/types';
import { getConfig } from './configService';

const execFileAsync = promisify(execFile);

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

function getFfmpegStaticPath(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static');
    const resolved = typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic?.default;
    if (resolved && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Không tìm thấy gói ffmpeg-static
  }
  return undefined;
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
    exiftoolAvailable: false,
    exiftoolSource: 'none',
    projectBinDir,
  };

  // 1. Dò tìm FFmpeg
  const customFfmpeg = config.customFfmpegPath?.trim();
  const projectFfmpeg = path.join(projectBinDir, 'ffmpeg.exe');
  const staticFfmpeg = getFfmpegStaticPath();

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
  if (!status.ffmpegAvailable && staticFfmpeg) {
    const ver = getBinaryVersionSync(staticFfmpeg, ['-version']);
    if (ver) {
      status.ffmpegAvailable = true;
      status.ffmpegPath = staticFfmpeg;
      status.ffmpegSource = 'ffmpeg-static';
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
 * Tự động cài đặt/sao chép ffmpeg.exe và tải exiftool.exe vào thư mục ./bin của project
 */
export async function installBinariesToProject(): Promise<{
  success: boolean;
  message: string;
  status: BinaryStatusInfo;
}> {
  const binDir = getProjectBinDir();
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const messages: string[] = [];
  const targetFfmpeg = path.join(binDir, 'ffmpeg.exe');
  const targetExiftool = path.join(binDir, 'exiftool.exe');

  // 1. Cài đặt ffmpeg.exe vào ./bin
  if (!fs.existsSync(targetFfmpeg)) {
    const staticFfmpeg = getFfmpegStaticPath();
    if (staticFfmpeg && fs.existsSync(staticFfmpeg)) {
      await fs.promises.copyFile(staticFfmpeg, targetFfmpeg);
      messages.push('Đã sao chép ffmpeg.exe vào thư mục ./bin.');
    } else {
      messages.push('Chưa tìm thấy nguồn ffmpeg-static để chép vào ./bin.');
    }
  } else {
    messages.push('ffmpeg.exe đã có sẵn trong ./bin.');
  }

  // 2. Tải exiftool.exe vào ./bin nếu chưa có
  if (!fs.existsSync(targetExiftool)) {
    try {
      const verRes = await fetch('https://exiftool.org/ver.txt');
      if (!verRes.ok) throw new Error(`HTTP ${verRes.status}`);
      const ver = (await verRes.text()).trim();
      const zipUrl = `https://exiftool.org/exiftool-${ver}_64.zip`;
      const zipPath = path.join(binDir, `exiftool-${ver}_64.zip`);
      const extractDir = path.join(binDir, '_exiftool_tmp');

      const zipRes = await fetch(zipUrl);
      if (!zipRes.ok) throw new Error(`HTTP ${zipRes.status}`);
      const arrayBuffer = await zipRes.arrayBuffer();
      await fs.promises.writeFile(zipPath, Buffer.from(arrayBuffer));

      if (fs.existsSync(extractDir)) {
        await fs.promises.rm(extractDir, { recursive: true, force: true });
      }
      await fs.promises.mkdir(extractDir, { recursive: true });

      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`,
        ],
        { windowsHide: true }
      );

      const entries = await fs.promises.readdir(extractDir, { withFileTypes: true });
      let innerDir = extractDir;
      const subFolder = entries.find((e) => e.isDirectory());
      if (subFolder) {
        innerDir = path.join(extractDir, subFolder.name);
      }

      const exe1 = path.join(innerDir, 'exiftool(-k).exe');
      const exe2 = path.join(innerDir, 'exiftool.exe');
      if (fs.existsSync(exe1)) {
        await fs.promises.copyFile(exe1, targetExiftool);
      } else if (fs.existsSync(exe2)) {
        await fs.promises.copyFile(exe2, targetExiftool);
      }

      const filesDirCandidate = path.join(innerDir, 'exiftool_files');
      const targetFilesDir = path.join(binDir, 'exiftool_files');
      if (fs.existsSync(filesDirCandidate)) {
        if (fs.existsSync(targetFilesDir)) {
          await fs.promises.rm(targetFilesDir, { recursive: true, force: true });
        }
        await fs.promises.cp(filesDirCandidate, targetFilesDir, { recursive: true });
      }

      await fs.promises.rm(zipPath, { force: true });
      await fs.promises.rm(extractDir, { recursive: true, force: true });
      messages.push(`Đã tải và cài đặt ExifTool v${ver} vào ./bin.`);
    } catch (err: any) {
      messages.push(
        `Không thể tải tự động ExifTool (${err?.message || 'Lỗi mạng'}). Bạn có thể tải thủ công theo hướng dẫn tại bin/README.md.`
      );
    }
  } else {
    messages.push('exiftool.exe đã có sẵn trong ./bin.');
  }

  const status = getBinaryStatus(true);
  return {
    success: status.ffmpegAvailable || status.exiftoolAvailable,
    message: messages.join(' '),
    status,
  };
}
