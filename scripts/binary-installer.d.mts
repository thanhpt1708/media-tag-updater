export interface BinaryPackageFile {
  /** Đường dẫn trong file zip (file hoặc thư mục) */
  from: string;
  /** Đường dẫn đích, tương đối với thư mục bin */
  to: string;
}

export interface BinaryPackageVerify {
  exe: string;
  args: string[];
  /** Các chuỗi phải xuất hiện trong stdout/stderr */
  expect: string[];
}

export interface BinaryPackage {
  id: string;
  name: string;
  version: string;
  url: string;
  sha256: string;
  files: BinaryPackageFile[];
  verify?: BinaryPackageVerify[];
}

export interface BinaryManifest {
  packages: BinaryPackage[];
}

export interface InstallResult {
  id: string;
  version: string;
  status: 'installed' | 'skipped' | 'failed';
  error?: string;
}

export const VERSIONS_FILE: string;

export function readInstalledVersions(binDir: string): Record<string, { version: string; sha256: string }>;

export function isPackageInstalled(
  pkg: BinaryPackage,
  binDir: string,
  installed?: Record<string, { version: string; sha256: string }>
): boolean;

export function installBinaries(opts: {
  manifest: BinaryManifest;
  binDir: string;
  force?: boolean;
  log?: (msg: string) => void;
}): Promise<InstallResult[]>;

export function verifyBinaries(opts: { manifest: BinaryManifest; binDir: string }): Promise<string[]>;
