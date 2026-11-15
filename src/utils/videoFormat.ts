/**
 * Nhãn độ phân giải theo chuẩn thông dụng. Tính theo "cạnh dài quy đổi" = max(cạnh dài, cạnh ngắn × 16/9)
 * để video bị cắt viền (1920×800), 4:3 (1440×1080) hay quay dọc (1080×1920) vẫn ra đúng 1080p.
 */
export function resolutionLabel(width: number, height: number): string {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const eff = Math.max(long, (short * 16) / 9);
  if (eff >= 7000) return '8K';
  if (eff >= 3800) return '4K';
  if (eff >= 2500) return '1440p';
  if (eff >= 1880) return '1080p';
  if (eff >= 1240) return '720p';
  if (eff >= 1000) return '576p'; // PAL SD 720×576
  if (eff >= 940) return '540p';
  if (eff >= 820) return '480p';
  if (eff >= 620) return '360p';
  return `${short}p`;
}

/** Đưa nhãn độ phân giải lấy từ tên file Scene (2160p, 1080i...) về cùng hệ nhãn với resolutionLabel */
export function normalizeResolutionLabel(label: string): string {
  const l = label.trim().toLowerCase();
  if (l === '2160p' || l === '4k' || l === 'uhd') return '4K';
  if (l === '4320p' || l === '8k') return '8K';
  if (l === '1080i') return '1080p';
  return l;
}

/** Thứ tự để so sánh "cao hơn / thấp hơn" giữa các nhãn */
export function resolutionRank(label: string): number {
  const l = normalizeResolutionLabel(label);
  if (l === '8K') return 4320;
  if (l === '4K') return 2160;
  const m = l.match(/^(\d+)p$/);
  return m ? Number(m[1]) : 0;
}
