import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const binDir = path.join(projectRoot, 'bin');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

console.log('====================================================');
console.log('  CÀI ĐẶT CÔNG CỤ BINARY VÀO THƯ MỤC ./bin');
console.log('====================================================\n');

// 1. Thiết lập ffmpeg.exe từ ffmpeg-static (nếu đã cài npm) hoặc tải về
async function setupFfmpeg() {
  const targetFfmpeg = path.join(binDir, 'ffmpeg.exe');
  if (fs.existsSync(targetFfmpeg)) {
    console.log('[FFmpeg] Đã tồn tại tại:', targetFfmpeg);
    return true;
  }

  try {
    const ffmpegStaticModule = await import('ffmpeg-static');
    const sourcePath = ffmpegStaticModule.default;
    if (sourcePath && fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, targetFfmpeg);
      console.log('[FFmpeg] Đã sao chép thành công từ ffmpeg-static ->', targetFfmpeg);
      return true;
    }
  } catch {
    // ffmpeg-static chưa sẵn sàng hoặc lỗi
  }

  console.log('[FFmpeg] Không tìm thấy từ ffmpeg-static, bạn có thể chạy "npm install" trước hoặc đặt thủ công ffmpeg.exe vào ./bin/');
  return false;
}

// 2. Thiết lập exiftool.exe (tải bản Windows 64-bit từ exiftool.org / sourceforge mirror)
async function setupExiftool() {
  const targetExiftool = path.join(binDir, 'exiftool.exe');
  if (fs.existsSync(targetExiftool)) {
    console.log('[ExifTool] Đã tồn tại tại:', targetExiftool);
    return true;
  }

  try {
    console.log('[ExifTool] Đang kiểm tra phiên bản mới nhất từ exiftool.org...');
    const verRes = await fetch('https://exiftool.org/ver.txt');
    if (!verRes.ok) throw new Error(`HTTP ${verRes.status}`);
    const ver = (await verRes.text()).trim();
    const zipUrl = `https://exiftool.org/exiftool-${ver}_64.zip`;
    const zipPath = path.join(binDir, `exiftool-${ver}_64.zip`);
    const extractDir = path.join(binDir, '_exiftool_tmp');

    console.log(`[ExifTool] Đang tải ${zipUrl}...`);
    const zipRes = await fetch(zipUrl);
    if (!zipRes.ok) throw new Error(`Không thể tải ${zipUrl} (HTTP ${zipRes.status})`);
    const arrayBuffer = await zipRes.arrayBuffer();
    fs.writeFileSync(zipPath, Buffer.from(arrayBuffer));

    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(extractDir, { recursive: true });

    console.log('[ExifTool] Đang giải nén...');
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`
    ]);

    // Tìm thư mục con giải nén
    const entries = fs.readdirSync(extractDir, { withFileTypes: true });
    let innerDir = extractDir;
    const subFolder = entries.find((e) => e.isDirectory());
    if (subFolder) {
      innerDir = path.join(extractDir, subFolder.name);
    }

    const exeCandidate = path.join(innerDir, 'exiftool(-k).exe');
    const exeCandidate2 = path.join(innerDir, 'exiftool.exe');
    if (fs.existsSync(exeCandidate)) {
      fs.copyFileSync(exeCandidate, targetExiftool);
    } else if (fs.existsSync(exeCandidate2)) {
      fs.copyFileSync(exeCandidate2, targetExiftool);
    }

    const filesDirCandidate = path.join(innerDir, 'exiftool_files');
    const targetFilesDir = path.join(binDir, 'exiftool_files');
    if (fs.existsSync(filesDirCandidate)) {
      if (fs.existsSync(targetFilesDir)) {
        fs.rmSync(targetFilesDir, { recursive: true, force: true });
      }
      fs.cpSync(filesDirCandidate, targetFilesDir, { recursive: true });
    }

    // Dọn dẹp file tạm
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });

    if (fs.existsSync(targetExiftool)) {
      console.log('[ExifTool] Đã cài đặt thành công tại:', targetExiftool);
      return true;
    }
  } catch (err) {
    console.warn('[ExifTool] Không thể tải tự động (có thể do giới hạn mạng):', err.message);
    console.log('-> Xem hướng dẫn cài đặt thủ công trong bin/README.md');
  }
  return false;
}

async function main() {
  await setupFfmpeg();
  await setupExiftool();
  console.log('\nHoàn tất kiểm tra thư mục ./bin. Xem chi tiết tại bin/README.md');
}

main();
