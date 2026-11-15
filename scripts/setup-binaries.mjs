// Cài binary (ffmpeg, ffprobe, ffmpeg-compat, exiftool) vào ./bin theo scripts/binaries.json.
//
//   node scripts/setup-binaries.mjs               cài gói còn thiếu / sai version, rồi kiểm tra
//   node scripts/setup-binaries.mjs --force       tải lại toàn bộ
//   node scripts/setup-binaries.mjs --verify-only chỉ kiểm tra
//
// Thoát với mã 1 nếu tải lỗi hoặc kiểm tra không đạt (để CI dừng, không release bản thiếu binary).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBinaries, verifyBinaries } from './binary-installer.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(scriptDir, '..', 'bin');
const manifest = JSON.parse(fs.readFileSync(path.join(scriptDir, 'binaries.json'), 'utf-8'));

const args = new Set(process.argv.slice(2));
let failed = false;

if (!args.has('--verify-only')) {
  console.log(`Cài binary vào ${binDir}\n`);
  const results = await installBinaries({ manifest, binDir, force: args.has('--force') });
  failed = results.some((r) => r.status === 'failed');
}

console.log('\nKiểm tra binary...');
const problems = await verifyBinaries({ manifest, binDir });
for (const p of problems) console.error(`  ✗ ${p}`);
if (problems.length === 0) {
  for (const pkg of manifest.packages) console.log(`  ✓ ${pkg.name} ${pkg.version}`);
}

if (failed || problems.length > 0) {
  console.error('\nCài đặt binary KHÔNG thành công. Xem bin/README.md để cài thủ công.');
  process.exit(1);
}
console.log('\nHoàn tất.');
