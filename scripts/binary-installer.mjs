// Logic tải / giải nén / kiểm tra binary trong ./bin theo scripts/binaries.json.
// Dùng chung cho: scripts/setup-binaries.mjs (dev + CI) và nút "Tự động tải" trong app (Electron main).
// Chỉ dùng module có sẵn của Node để chạy được ở cả hai nơi.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const execFileAsync = promisify(execFile);

export const VERSIONS_FILE = '.versions.json';

/** @returns {Record<string, { version: string; sha256: string }>} */
export function readInstalledVersions(binDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(binDir, VERSIONS_FILE), 'utf-8'));
  } catch {
    return {};
  }
}

function writeInstalledVersions(binDir, data) {
  fs.writeFileSync(path.join(binDir, VERSIONS_FILE), JSON.stringify(data, null, 2) + '\n');
}

/** Gói đã cài đúng version (khớp sha256) và đủ file đích */
export function isPackageInstalled(pkg, binDir, installed = readInstalledVersions(binDir)) {
  return (
    installed[pkg.id]?.sha256 === pkg.sha256 &&
    pkg.files.every((f) => fs.existsSync(path.join(binDir, f.to)))
  );
}

/**
 * Mở luồng tải bằng node:https, tự theo chuyển hướng (SourceForge chuyển qua nhiều mirror).
 * Không dùng fetch(): undici trong Node 24 có lỗi `assert(!this.paused)` làm crash cả tiến trình
 * khi server đóng kết nối lúc luồng đang tạm dừng (backpressure) – gặp khi tải từ SourceForge trên CI.
 */
function openDownload(url, redirectsLeft = 10) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(
      url,
      // SourceForge trả 403 cho User-Agent lạ nhưng cho phép các công cụ tải phổ biến (wget/curl)
      { headers: { 'User-Agent': 'Wget/1.21.4', Accept: '*/*' }, timeout: 60_000 },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error(`Quá nhiều lần chuyển hướng khi tải ${url}`));
          const next = new URL(res.headers.location, url).toString();
          return resolve(openDownload(next, redirectsLeft - 1));
        }
        if (status !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${status} khi tải ${url}`));
        }
        resolve(res);
      }
    );
    req.on('timeout', () => req.destroy(new Error(`Hết thời gian chờ khi tải ${url}`)));
    req.on('error', reject);
  });
}

/** Tải file về `dest`, trả về sha256 (hex). Thử lại tối đa 3 lần khi lỗi mạng. */
async function download(url, dest) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await openDownload(url);
      const hash = crypto.createHash('sha256');
      const hasher = new Transform({
        transform(chunk, _enc, cb) {
          hash.update(chunk);
          cb(null, chunk);
        },
      });
      await pipeline(res, hasher, fs.createWriteStream(dest));
      return hash.digest('hex');
    } catch (err) {
      lastErr = err;
      await fs.promises.rm(dest, { force: true }).catch(() => {});
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

/** Dùng bsdtar có sẵn của Windows (giải nén được .zip). Chỉ định đường dẫn tuyệt đối để
 *  không gọi nhầm GNU tar của Git Bash (không đọc được zip) trên máy build. */
function windowsTar() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

async function extractZip(zipPath, destDir) {
  await execFileAsync(windowsTar(), ['-xf', zipPath, '-C', destDir], {
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function copyEntry(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`Không thấy "${src}" trong gói đã giải nén`);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.rm(dest, { recursive: true, force: true });
  if ((await fs.promises.stat(src)).isDirectory()) {
    await fs.promises.cp(src, dest, { recursive: true });
  } else {
    await fs.promises.copyFile(src, dest);
  }
}

/**
 * Cài các gói còn thiếu / sai version vào binDir.
 * @param {{ manifest: any; binDir: string; force?: boolean; log?: (msg: string) => void }} opts
 */
export async function installBinaries({ manifest, binDir, force = false, log = console.log }) {
  await fs.promises.mkdir(binDir, { recursive: true });
  const installed = readInstalledVersions(binDir);
  const results = [];

  for (const pkg of manifest.packages) {
    if (!force && isPackageInstalled(pkg, binDir, installed)) {
      log(`[${pkg.id}] Đã có bản ${pkg.version}, bỏ qua.`);
      results.push({ id: pkg.id, version: pkg.version, status: 'skipped' });
      continue;
    }

    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `mtu-${pkg.id}-`));
    try {
      const zipPath = path.join(workDir, 'package.zip');
      log(`[${pkg.id}] Đang tải ${pkg.name} ${pkg.version}...`);
      const sha = await download(pkg.url, zipPath);
      if (sha !== pkg.sha256.toLowerCase()) {
        throw new Error(`Sai SHA256 (nhận ${sha}, cần ${pkg.sha256})`);
      }

      const extractDir = path.join(workDir, 'x');
      await fs.promises.mkdir(extractDir);
      log(`[${pkg.id}] Đang giải nén...`);
      await extractZip(zipPath, extractDir);

      for (const f of pkg.files) {
        await copyEntry(path.join(extractDir, f.from), path.join(binDir, f.to));
      }

      installed[pkg.id] = { version: pkg.version, sha256: pkg.sha256 };
      writeInstalledVersions(binDir, installed);
      log(`[${pkg.id}] Đã cài ${pkg.name} ${pkg.version}.`);
      results.push({ id: pkg.id, version: pkg.version, status: 'installed' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[${pkg.id}] LỖI: ${message}`);
      results.push({ id: pkg.id, version: pkg.version, status: 'failed', error: message });
    } finally {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  return results;
}

/**
 * Chạy các lệnh kiểm tra trong manifest (version, danh sách encoder...).
 * @returns {Promise<string[]>} danh sách lỗi; rỗng = đạt
 */
export async function verifyBinaries({ manifest, binDir }) {
  const problems = [];
  for (const pkg of manifest.packages) {
    for (const v of pkg.verify || []) {
      const exe = path.join(binDir, v.exe);
      if (!fs.existsSync(exe)) {
        problems.push(`[${pkg.id}] Thiếu ${v.exe}`);
        continue;
      }
      let output = '';
      try {
        const { stdout, stderr } = await execFileAsync(exe, v.args, {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 16 * 1024 * 1024,
        });
        output = `${stdout}\n${stderr}`;
      } catch (err) {
        problems.push(`[${pkg.id}] Không chạy được "${v.exe} ${v.args.join(' ')}": ${err?.message || err}`);
        continue;
      }
      const missing = v.expect.filter((s) => !output.includes(s));
      if (missing.length > 0) {
        problems.push(`[${pkg.id}] "${v.exe} ${v.args.join(' ')}" thiếu: ${missing.join(', ')}`);
      }
    }
  }
  return problems;
}
