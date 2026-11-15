import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Copy,
  Image as ImageIcon,
  Music,
  Film,
  ExternalLink,
  Trash2,
  Wand2,
  ListChecks,
  RefreshCw,
  Loader2,
  Crown,
} from 'lucide-react';
import { DuplicateGroup, DuplicateKind, DuplicateScanResult, MediaFileItem } from '../shared/types';

interface DuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: DuplicateScanResult | null;
  items: MediaFileItem[];
  isChecking: boolean;
  showLowConfidence: boolean;
  onToggleLowConfidence: (show: boolean) => void;
  onRescan: () => void;
  onSelectInList: (filePaths: string[]) => void;
  onOpenInExplorer: (filePath: string) => void;
  onMoveToTrash: (filePaths: string[]) => Promise<void>;
}

const KIND_LABEL: Record<DuplicateKind, { label: string; tone: string }> = {
  identical: { label: 'Trùng hoàn toàn', tone: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  'similar-image': { label: 'Ảnh giống nhau', tone: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  'similar-video': { label: 'Video giống nhau', tone: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  'same-title': { label: 'Cùng nội dung (Tag)', tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  'same-duration': {
    label: 'Cùng thời lượng',
    tone: 'bg-slate-500/15 text-slate-300 border-slate-500/40 border-dashed',
  },
  'same-size': {
    label: 'Cùng dung lượng',
    tone: 'bg-slate-500/15 text-slate-300 border-slate-500/40 border-dashed',
  },
};

const KIND_TABS: DuplicateKind[] = [
  'identical',
  'similar-image',
  'similar-video',
  'same-title',
  'same-duration',
  'same-size',
];

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Chọn file "nên giữ" trong nhóm – dùng CÙNG một quy tắc cho mọi loại nhóm để một file
 * không bị gợi ý "Giữ" ở nhóm này nhưng lại bị đánh dấu xóa ở nhóm khác:
 * dung lượng lớn nhất (chất lượng cao hơn) → đường dẫn ngắn nhất (thường là bản gốc) → file cũ nhất.
 * Với nhóm identical mọi file cùng kích thước nên thực chất là chọn đường dẫn ngắn nhất.
 */
function pickKeeper(group: DuplicateGroup, itemMap: Map<string, MediaFileItem>): string {
  const members = group.filePaths.map((fp) => itemMap.get(fp)).filter(Boolean) as MediaFileItem[];
  if (members.length === 0) return group.filePaths[0];
  const sorted = members
    .slice()
    .sort(
      (a, b) =>
        b.fileSize - a.fileSize ||
        a.filePath.length - b.filePath.length ||
        a.modifiedAt - b.modifiedAt ||
        a.filePath.localeCompare(b.filePath)
    );
  return sorted[0].filePath;
}

export const DuplicatesModal: React.FC<DuplicatesModalProps> = ({
  isOpen,
  onClose,
  result,
  items,
  isChecking,
  showLowConfidence,
  onToggleLowConfidence,
  onRescan,
  onSelectInList,
  onOpenInExplorer,
  onMoveToTrash,
}) => {
  const [kindFilter, setKindFilter] = useState<'all' | DuplicateKind>('all');
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [isTrashing, setIsTrashing] = useState(false);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.filePath, i])), [items]);

  // Bỏ đánh dấu những file không còn tồn tại trong kết quả mới
  useEffect(() => {
    if (!result) return;
    const valid = new Set(result.groups.flatMap((g) => g.filePaths));
    setMarked((prev) => new Set([...prev].filter((p) => valid.has(p))));
  }, [result]);

  if (!isOpen) return null;

  const allGroups = result?.groups || [];
  const lowCount = allGroups.filter((g) => g.confidence === 'low').length;
  const visibleGroups = allGroups.filter((g) => showLowConfidence || g.confidence === 'high');
  const groups = visibleGroups.filter((g) => kindFilter === 'all' || g.kind === kindFilter);
  const counts = visibleGroups.reduce<Record<string, number>>((acc, g) => {
    acc[g.kind] = (acc[g.kind] || 0) + 1;
    return acc;
  }, {});
  const tabs = KIND_TABS.filter((k) => (counts[k] || 0) > 0 || k === kindFilter);
  const durations = result?.videoDurations || {};
  // Nhóm "có thể trùng" chưa chắc là cùng nội dung → không tính vào dung lượng có thể giải phóng
  const totalReclaimable = groups
    .filter((g) => g.confidence === 'high')
    .reduce((s, g) => s + g.reclaimableBytes, 0);
  const markedBytes = [...marked].reduce((s, fp) => s + (itemMap.get(fp)?.fileSize || 0), 0);

  const toggleMark = (fp: string) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const autoMark = (onlyIdentical: boolean) => {
    const next = new Set<string>();
    for (const g of groups) {
      if (onlyIdentical && g.kind !== 'identical') continue;
      // Không tự động đánh dấu xóa trong nhóm "có thể trùng" – người dùng tự kiểm tra
      if (g.confidence === 'low') continue;
      const keeper = pickKeeper(g, itemMap);
      for (const fp of g.filePaths) if (fp !== keeper) next.add(fp);
    }
    setMarked(next);
  };

  const handleTrash = async () => {
    if (marked.size === 0) return;
    // Chặn trường hợp đánh dấu xóa toàn bộ file trong một nhóm
    const wipesWholeGroup = groups.some((g) => g.filePaths.every((fp) => marked.has(fp)));
    const msg =
      `Chuyển ${marked.size} file (${formatFileSize(markedBytes)}) vào Thùng rác (Recycle Bin)?\n` +
      (wipesWholeGroup
        ? '\n⚠️ Có nhóm bị đánh dấu TẤT CẢ các file – sẽ không còn bản nào được giữ lại!\n'
        : '') +
      '\nBạn có thể khôi phục lại từ Thùng rác của Windows.';
    if (!window.confirm(msg)) return;
    setIsTrashing(true);
    try {
      await onMoveToTrash([...marked]);
      setMarked(new Set());
    } finally {
      setIsTrashing(false);
    }
  };

  const renderTypeIcon = (item?: MediaFileItem) => {
    if (item?.mediaType === 'audio') return <Music className="w-4 h-4 text-slate-600" />;
    if (item?.mediaType === 'video') return <Film className="w-4 h-4 text-slate-600" />;
    return <ImageIcon className="w-4 h-4 text-slate-600" />;
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs flex items-center justify-center p-6">
      <div className="w-full max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
              <Copy className="w-4 h-4 text-rose-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Phát hiện Media trùng lặp</h2>
              <p className="text-[11px] text-slate-400">
                {result
                  ? `${visibleGroups.length} nhóm • quét ${result.scannedCount} file trong ${(
                      result.durationMs / 1000
                    ).toFixed(1)}s • có thể giải phóng ~${formatFileSize(totalReclaimable)}`
                  : 'Chưa có kết quả quét'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRescan}
              disabled={isChecking}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-50"
            >
              {isChecking ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Quét lại
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs lọc + hành động */}
        <div className="px-5 py-2.5 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['all', ...tabs] as const).map((k) => {
              const active = kindFilter === k;
              const label = k === 'all' ? 'Tất cả' : KIND_LABEL[k].label;
              const count = k === 'all' ? visibleGroups.length : counts[k] || 0;
              return (
                <button
                  key={k}
                  onClick={() => setKindFilter(k)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                    active
                      ? 'bg-indigo-600/20 text-indigo-200 border-indigo-500/40'
                      : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
                  }`}
                >
                  {label} <span className="opacity-70">({count})</span>
                </button>
              );
            })}
            <label
              title="Video cùng thời lượng nhưng chưa khớp hình ảnh, hoặc cùng dung lượng nhưng khác nội dung – cần tự kiểm tra"
              className={`ml-1 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border border-dashed cursor-pointer select-none ${
                showLowConfidence
                  ? 'border-slate-500 text-slate-200 bg-slate-800'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              <input
                type="checkbox"
                checked={showLowConfidence}
                onChange={(e) => {
                  onToggleLowConfidence(e.target.checked);
                  if (!e.target.checked) setKindFilter('all');
                }}
                className="w-3 h-3 rounded border-slate-600 bg-slate-900"
              />
              Hiện nhóm có thể trùng ({lowCount})
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => autoMark(true)}
              disabled={groups.length === 0}
              title="Đánh dấu tất cả bản thừa trong các nhóm trùng hoàn toàn, giữ lại 1 bản"
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40"
            >
              <Wand2 className="w-3.5 h-3.5 text-amber-400" />
              Tự chọn bản thừa (trùng hoàn toàn)
            </button>
            <button
              onClick={() => autoMark(false)}
              disabled={groups.length === 0}
              title="Đánh dấu bản thừa trong mọi nhóm đang hiển thị, giữ lại file chất lượng cao nhất"
              className="px-2.5 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40"
            >
              Tự chọn (tất cả nhóm)
            </button>
            {marked.size > 0 && (
              <button
                onClick={() => setMarked(new Set())}
                className="px-2 py-1 text-[11px] rounded-lg text-slate-400 hover:text-slate-200"
              >
                Bỏ chọn
              </button>
            )}
          </div>
        </div>

        {/* Danh sách nhóm */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isChecking && !result && (
            <div className="py-16 flex flex-col items-center gap-3 text-slate-400 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              Đang so sánh nội dung các file...
            </div>
          )}
          {result && groups.length === 0 && (
            <div className="py-16 text-center text-xs text-slate-400">
              🎉 Không phát hiện file trùng lặp nào{kindFilter !== 'all' ? ' trong mục này' : ''}.
            </div>
          )}

          {groups.map((g) => {
            const keeper = g.confidence === 'high' ? pickKeeper(g, itemMap) : null;
            return (
              <div
                key={g.id}
                className={`rounded-xl border bg-slate-950/50 overflow-hidden ${
                  g.confidence === 'low' ? 'border-dashed border-slate-700' : 'border-slate-800'
                }`}
              >
                <div className="px-3.5 py-2 flex items-center justify-between gap-3 bg-slate-900/70 border-b border-slate-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`shrink-0 px-1.5 py-0.5 text-[10px] font-semibold rounded border ${KIND_LABEL[g.kind].tone}`}
                    >
                      {KIND_LABEL[g.kind].label}
                    </span>
                    {g.confidence === 'low' && (
                      <span className="shrink-0 px-1.5 py-0.5 text-[9px] rounded bg-slate-800 text-slate-400 border border-slate-700">
                        Độ tin cậy thấp
                      </span>
                    )}
                    <span className="text-[11px] text-slate-300 truncate" title={g.reason}>
                      {g.reason}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-500">
                      {g.filePaths.length} file
                      {g.confidence === 'high'
                        ? ` • thừa ${formatFileSize(g.reclaimableBytes)}`
                        : ' • cần tự kiểm tra'}
                    </span>
                    <button
                      onClick={() => onSelectInList(g.filePaths)}
                      title="Chọn nhóm này trong danh sách chính"
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                    >
                      <ListChecks className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-800/60">
                  {g.filePaths.map((fp) => {
                    const item = itemMap.get(fp);
                    const isMarked = marked.has(fp);
                    const isKeeper = fp === keeper;
                    return (
                      <div
                        key={fp}
                        onClick={() => toggleMark(fp)}
                        className={`px-3.5 py-2 flex items-center gap-3 cursor-pointer transition ${
                          isMarked ? 'bg-rose-950/30 hover:bg-rose-950/40' : 'hover:bg-slate-900/70'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isMarked}
                          onChange={() => {}}
                          className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-900 cursor-pointer"
                        />
                        <div className="w-10 h-10 rounded-md bg-slate-900 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                          {item?.metadata.thumbnailDataUrl ? (
                            <img src={item.metadata.thumbnailDataUrl} className="w-full h-full object-cover" />
                          ) : (
                            renderTypeIcon(item)
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-xs font-medium truncate ${
                                isMarked ? 'text-rose-200 line-through' : 'text-slate-100'
                              }`}
                              title={fp}
                            >
                              {item?.fileName || fp}
                            </span>
                            {isKeeper && (
                              <span
                                title="Gợi ý giữ lại file này"
                                className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                              >
                                <Crown className="w-2.5 h-2.5" /> Giữ
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 truncate" title={item?.directory}>
                            {item?.directory}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] font-mono text-slate-300">
                            {durations[fp] !== undefined && (
                              <span className="text-violet-300/90 mr-2">{formatDuration(durations[fp])}</span>
                            )}
                            {item ? formatFileSize(item.fileSize) : '—'}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {item ? new Date(item.modifiedAt).toLocaleDateString('vi-VN') : ''}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenInExplorer(fp);
                          }}
                          title="Mở trong Explorer"
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {marked.size > 0
              ? `Đã đánh dấu ${marked.size} file • ${formatFileSize(markedBytes)}`
              : 'Bấm vào file để đánh dấu bản cần loại bỏ'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSelectInList([...marked])}
              disabled={marked.size === 0}
              className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40"
            >
              Chọn trong danh sách
            </button>
            <button
              onClick={handleTrash}
              disabled={marked.size === 0 || isTrashing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40"
            >
              {isTrashing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Chuyển vào Thùng rác
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
