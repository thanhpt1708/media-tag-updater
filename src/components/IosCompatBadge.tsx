import React from 'react';
import { Smartphone } from 'lucide-react';
import { IosCompatInfo, IosCompatLevel } from '../shared/types';

export const IOS_LEVEL_META: Record<
  IosCompatLevel | 'pending',
  { label: string; short: string; tone: string; desc: string }
> = {
  compatible: {
    label: 'iPhone ✓',
    short: 'Tương thích',
    tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    desc: 'Giải mã phần cứng trên iPhone/iOS, container MP4/MOV – phát ngay được',
  },
  remux: {
    label: 'iPhone ~',
    short: 'Cần remux',
    tone: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    desc: 'Hình đã đạt chuẩn – chỉ cần đổi container/audio (nhanh, không mất chất lượng)',
  },
  transcode: {
    label: 'iPhone ✗',
    short: 'Cần encode',
    tone: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    desc: 'iPhone không giải mã phần cứng được – cần encode lại',
  },
  unknown: {
    label: 'iPhone ?',
    short: 'Không rõ',
    tone: 'bg-slate-500/15 text-slate-400 border-slate-500/30 border-dashed',
    desc: 'Không phân tích được file',
  },
  pending: {
    label: 'iPhone …',
    short: 'Đang phân tích',
    tone: 'bg-slate-500/10 text-slate-500 border-slate-600/30 border-dashed',
    desc: 'Đang phân tích bằng ffprobe (hoặc chưa có ffprobe.exe)',
  },
};

export function buildIosTooltip(info?: IosCompatInfo): string {
  if (!info) return IOS_LEVEL_META.pending.desc;
  const meta = IOS_LEVEL_META[info.level];
  const lines = [meta.desc];
  if (info.summary) lines.push('', info.summary + (info.container ? ` · ${info.container}` : ''));
  if (info.reasons.length > 0) lines.push('', ...info.reasons.map((r) => `• ${r}`));
  if (info.notes.length > 0) lines.push('', ...info.notes.map((n) => `ⓘ ${n}`));
  return lines.join('\n');
}

export const IosCompatBadge: React.FC<{ info?: IosCompatInfo; showText?: boolean }> = ({
  info,
  showText,
}) => {
  const meta = IOS_LEVEL_META[info?.level ?? 'pending'];
  return (
    <span
      title={buildIosTooltip(info)}
      className={`shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-semibold rounded border whitespace-nowrap ${meta.tone}`}
    >
      <Smartphone className="w-2.5 h-2.5" />
      {showText ? meta.short : meta.label.replace('iPhone ', '')}
    </span>
  );
};
