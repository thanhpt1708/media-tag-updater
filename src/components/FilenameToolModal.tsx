import React, { useEffect, useState } from 'react';
import {
  X,
  FileSignature,
  Wand2,
  ArrowRight,
  Check,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import {
  ExtractTagPreviewItem,
  MediaFileItem,
  MediaMetadata,
  RenamePreviewItem,
} from '../shared/types';
import { getMediaApi } from '../utils/ipcClient';

interface FilenameToolModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetItems: MediaFileItem[];
  onApplyExtractedTags: (
    updates: { filePath: string; metadata: Partial<MediaMetadata> }[]
  ) => Promise<void>;
  onExecuteRenames: (
    renames: { oldPath: string; newPath: string }[]
  ) => Promise<void>;
}

const RENAME_PRESETS = [
  { label: 'Nhạc: {artist} - {title}', pattern: '{artist} - {title}' },
  { label: 'Nhạc (Track): {track} - {artist} - {title}', pattern: '{track} - {artist} - {title}' },
  { label: 'Phim lẻ: {title} ({year})', pattern: '{title} ({year})' },
  { label: 'Phim lẻ + Độ phân giải: {title} ({year}) [{resolution}]', pattern: '{title} ({year}) [{resolution}]' },
  { label: 'Phim bộ: {album} - S{season}E{episode} - {title}', pattern: '{album} - S{season}E{episode} - {title}' },
  { label: 'Ảnh: {date}_{location}_{title}', pattern: '{date}_{location}_{title}' },
];

export const FilenameToolModal: React.FC<FilenameToolModalProps> = ({
  isOpen,
  onClose,
  targetItems,
  onApplyExtractedTags,
  onExecuteRenames,
}) => {
  const [activeTab, setActiveTab] = useState<'extract' | 'rename'>('extract');

  // State cho Tab 1: Filename -> Tag
  const [extractMode, setExtractMode] = useState<'smart-scene' | 'pattern'>('smart-scene');
  const [extractPattern, setExtractPattern] = useState('{artist} - {title} ({year})');
  const [extractPreviews, setExtractPreviews] = useState<ExtractTagPreviewItem[]>([]);

  // State cho Tab 2: Tag -> Filename
  const [renamePattern, setRenamePattern] = useState('{artist} - {title}');
  const [renamePreviews, setRenamePreviews] = useState<RenamePreviewItem[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!isOpen || targetItems.length === 0) return;
    // Chọn mẫu mặc định theo loại file đầu tiên
    const firstType = targetItems[0].mediaType;
    if (firstType === 'video') {
      if (targetItems[0].sceneInfo?.isTvShow) {
        setRenamePattern('{album} - S{season}E{episode} - {title}');
      } else {
        setRenamePattern('{title} ({year}) [{resolution}]');
      }
    } else if (firstType === 'image') {
      setRenamePattern('{date}_{location}_{title}');
    } else {
      setRenamePattern('{artist} - {title}');
    }
  }, [isOpen, targetItems]);

  useEffect(() => {
    if (!isOpen || targetItems.length === 0) return;
    const api = getMediaApi();
    if (activeTab === 'extract') {
      void api
        .previewExtractTags(targetItems, extractMode, extractPattern)
        .then(setExtractPreviews);
    } else {
      void api
        .previewRenameFiles(targetItems, renamePattern)
        .then(setRenamePreviews);
    }
  }, [isOpen, activeTab, extractMode, extractPattern, renamePattern, targetItems]);

  if (!isOpen) return null;

  const handleApplyExtract = async () => {
    const valid = extractPreviews.filter((p) => Object.keys(p.extracted).length > 0);
    if (valid.length === 0) return;

    setIsProcessing(true);
    try {
      await onApplyExtractedTags(
        valid.map((v) => ({
          filePath: v.filePath,
          metadata: v.extracted,
        }))
      );
      onClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyRename = async () => {
    const valid = renamePreviews.filter((r) => r.willChange && !r.hasConflict);
    if (valid.length === 0) return;

    setIsProcessing(true);
    try {
      await onExecuteRenames(
        valid.map((r) => ({
          oldPath: r.filePath,
          newPath: r.newPath,
        }))
      );
      onClose();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <FileSignature className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                Công cụ Phân tích Tên File Nhóm Rip (Scene/P2P) & Đổi Tên Hàng loạt
              </h2>
              <p className="text-[11px] text-slate-400">
                Đang thao tác trên {targetItems.length} file đã chọn
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chuyển Tab */}
        <div className="px-6 pt-3 bg-slate-950/60 border-b border-slate-800 flex gap-2">
          <button
            onClick={() => setActiveTab('extract')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 transition flex items-center gap-2 ${
              activeTab === 'extract'
                ? 'border-amber-400 text-amber-300 bg-slate-900/80'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            1. Trích xuất Tag từ Tên File (Scene / Smart Parser)
          </button>
          <button
            onClick={() => setActiveTab('rename')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 transition flex items-center gap-2 ${
              activeTab === 'rename'
                ? 'border-indigo-400 text-indigo-300 bg-slate-900/80'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileSignature className="w-3.5 h-3.5" />
            2. Đổi Tên File tự động theo Cấu trúc Tag
          </button>
        </div>

        {/* TAB 1: TRÍCH XUẤT TAG TỪ TÊN FILE */}
        {activeTab === 'extract' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 bg-slate-900/60 border-b border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="extractMode"
                    checked={extractMode === 'smart-scene'}
                    onChange={() => setExtractMode('smart-scene')}
                    className="text-amber-500 bg-slate-900 border-slate-600"
                  />
                  <span>
                    <strong>Tự động nhận diện Chuẩn Nhóm Rip (Scene / P2P / Anime / Nhạc)</strong> — Khuyên dùng
                  </span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="radio"
                    name="extractMode"
                    checked={extractMode === 'pattern'}
                    onChange={() => setExtractMode('pattern')}
                    className="text-amber-500 bg-slate-900 border-slate-600"
                  />
                  <span>Theo mẫu cấu trúc tùy chỉnh</span>
                </label>
              </div>

              {extractMode === 'pattern' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Mẫu tên file:</span>
                  <input
                    type="text"
                    value={extractPattern}
                    onChange={(e) => setExtractPattern(e.target.value)}
                    placeholder="{artist} - {title} ({year})"
                    className="flex-1 max-w-md px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                  />
                  <span className="text-[11px] text-slate-400">
                    Biến hỗ trợ: {'{title}'}, {'{artist}'}, {'{album}'}, {'{year}'}, {'{track}'}, {'{season}'}, {'{episode}'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
              {extractPreviews.map((item) => (
                <div
                  key={item.filePath}
                  className="p-3.5 grid grid-cols-12 gap-3 items-center text-xs hover:bg-slate-800/30"
                >
                  <div className="col-span-5 min-w-0">
                    <div className="font-medium text-slate-200 truncate" title={item.fileName}>
                      {item.fileName}
                    </div>
                    {item.sceneInfo && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.sceneInfo.resolution && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-950/70 text-amber-300 text-[10px] font-mono">
                            {item.sceneInfo.resolution}
                          </span>
                        )}
                        {item.sceneInfo.source && (
                          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {item.sceneInfo.source}
                          </span>
                        )}
                        {item.sceneInfo.videoCodec && (
                          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {item.sceneInfo.videoCodec}
                          </span>
                        )}
                        {item.sceneInfo.audioCodec && (
                          <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {item.sceneInfo.audioCodec}
                          </span>
                        )}
                        {item.sceneInfo.releaseGroup && (
                          <span className="px-1.5 py-0.2 rounded bg-indigo-950/70 text-indigo-300 text-[10px] font-mono">
                            -{item.sceneInfo.releaseGroup}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="col-span-1 flex justify-center">
                    <ArrowRight className="w-4 h-4 text-amber-400" />
                  </div>

                  <div className="col-span-6 flex flex-wrap gap-2 text-[11px]">
                    {item.extracted.title && (
                      <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-700/40 text-emerald-300">
                        Title: <strong>{item.extracted.title}</strong>
                      </span>
                    )}
                    {item.extracted.artist && (
                      <span className="px-2 py-0.5 rounded bg-sky-950/70 border border-sky-700/40 text-sky-300">
                        Artist: <strong>{item.extracted.artist}</strong>
                      </span>
                    )}
                    {item.extracted.album && (
                      <span className="px-2 py-0.5 rounded bg-purple-950/70 border border-purple-700/40 text-purple-300">
                        Series/Album: <strong>{item.extracted.album}</strong>
                      </span>
                    )}
                    {item.extracted.year && (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200">
                        Năm: <strong>{item.extracted.year}</strong>
                      </span>
                    )}
                    {item.extracted.seasonNumber !== undefined && (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300">
                        Mùa: <strong>{item.extracted.seasonNumber}</strong>
                      </span>
                    )}
                    {item.extracted.trackNumber !== undefined && (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300">
                        Track/Tập: <strong>{item.extracted.trackNumber}</strong>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-3.5 border-t border-slate-800 flex items-center justify-end gap-3 bg-slate-900">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
              >
                Hủy
              </button>
              <button
                onClick={handleApplyExtract}
                disabled={isProcessing}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-semibold shadow transition"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Ghi các Tag đã trích xuất vào File
              </button>
            </div>
          </div>
        ) : (
          /* TAB 2: ĐỔI TÊN FILE HÀNG LOẠT THEO CẤU TRÚC TAG */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 bg-slate-900/60 border-b border-slate-800 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-300">Cấu trúc tên mới:</span>
                <input
                  type="text"
                  value={renamePattern}
                  onChange={(e) => setRenamePattern(e.target.value)}
                  className="flex-1 max-w-md px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {RENAME_PRESETS.map((preset) => (
                  <button
                    key={preset.pattern}
                    type="button"
                    onClick={() => setRenamePattern(preset.pattern)}
                    className={`px-2.5 py-1 rounded text-[11px] border transition ${
                      renamePattern === preset.pattern
                        ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/70">
              {renamePreviews.map((p) => (
                <div
                  key={p.filePath}
                  className="p-3.5 grid grid-cols-12 gap-3 items-center text-xs hover:bg-slate-800/30"
                >
                  <div className="col-span-5 text-slate-400 truncate" title={p.oldName}>
                    {p.oldName}
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <ArrowRight className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div className="col-span-6 flex items-center justify-between gap-2 min-w-0">
                    <span
                      className={`font-medium truncate ${
                        p.hasConflict
                          ? 'text-rose-400'
                          : p.willChange
                          ? 'text-emerald-300'
                          : 'text-slate-500'
                      }`}
                      title={p.newName}
                    >
                      {p.newName}
                    </span>
                    {p.hasConflict && (
                      <span className="flex items-center gap-1 text-[10px] text-rose-400 shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5" /> Trùng tên
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-3.5 border-t border-slate-800 flex items-center justify-between bg-slate-900">
              <div className="text-xs text-slate-400">
                Sẵn sàng đổi tên:{' '}
                <strong className="text-emerald-400">
                  {renamePreviews.filter((r) => r.willChange && !r.hasConflict).length}
                </strong>{' '}
                file
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                >
                  Hủy
                </button>
                <button
                  onClick={handleApplyRename}
                  disabled={
                    isProcessing ||
                    renamePreviews.filter((r) => r.willChange && !r.hasConflict).length === 0
                  }
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow transition"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Thực hiện Đổi tên File
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
