import React from 'react';
import {
  FolderOpen,
  FilePlus,
  Layers,
  Music,
  Film,
  Image as ImageIcon,
  AlertCircle,
  Sparkles,
  FileSignature,
  Settings,
  Trash2,
  Copy,
  Loader2,
} from 'lucide-react';
import { MediaFileItem, MediaType } from '../shared/types';

export type SidebarFilter = 'all' | MediaType | 'missing-tag' | 'missing-thumb' | 'duplicates';

interface SidebarProps {
  items: MediaFileItem[];
  activeFilter: SidebarFilter;
  onFilterChange: (filter: SidebarFilter) => void;
  onOpenFolder: () => void;
  onAddFiles: () => void;
  onClearList: () => void;
  onOpenBatchOnline: () => void;
  onOpenFilenameTool: () => void;
  onOpenSettings: () => void;
  onOpenDuplicates: () => void;
  duplicateFileCount: number;
  duplicateGroupCount: number;
  isCheckingDuplicates: boolean;
  selectedCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  items,
  activeFilter,
  onFilterChange,
  onOpenFolder,
  onAddFiles,
  onClearList,
  onOpenBatchOnline,
  onOpenFilenameTool,
  onOpenSettings,
  onOpenDuplicates,
  duplicateFileCount,
  duplicateGroupCount,
  isCheckingDuplicates,
  selectedCount,
}) => {
  const audioCount = items.filter((i) => i.mediaType === 'audio').length;
  const videoCount = items.filter((i) => i.mediaType === 'video').length;
  const imageCount = items.filter((i) => i.mediaType === 'image').length;
  const missingTagCount = items.filter((i) => !i.metadata.title).length;
  const missingThumbCount = items.filter((i) => !i.metadata.thumbnailDataUrl).length;

  const navItems: {
    id: SidebarFilter;
    label: string;
    count: number;
    icon: React.ReactNode;
  }[] = [
    { id: 'all', label: 'Tất cả Media', count: items.length, icon: <Layers className="w-4 h-4 text-indigo-400" /> },
    { id: 'audio', label: 'File Nhạc (Audio)', count: audioCount, icon: <Music className="w-4 h-4 text-emerald-400" /> },
    { id: 'video', label: 'File Phim (Video)', count: videoCount, icon: <Film className="w-4 h-4 text-amber-400" /> },
    { id: 'image', label: 'File Ảnh (Image)', count: imageCount, icon: <ImageIcon className="w-4 h-4 text-sky-400" /> },
    {
      id: 'missing-tag',
      label: 'Thiếu Tiêu đề Tag',
      count: missingTagCount,
      icon: <AlertCircle className="w-4 h-4 text-rose-400" />,
    },
    {
      id: 'missing-thumb',
      label: 'Thiếu Thumbnail',
      count: missingThumbCount,
      icon: <AlertCircle className="w-4 h-4 text-orange-400" />,
    },
    {
      id: 'duplicates',
      label: 'File Trùng lặp',
      count: duplicateFileCount,
      icon: isCheckingDuplicates ? (
        <Loader2 className="w-4 h-4 text-fuchsia-400 animate-spin" />
      ) : (
        <Copy className="w-4 h-4 text-fuchsia-400" />
      ),
    },
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-full select-none shrink-0">
      {/* Thương hiệu ứng dụng */}
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-slate-100 text-sm tracking-tight">Media Tag Updater</h1>
          <p className="text-[11px] text-slate-400">Nhạc • Phim (Scene) • Ảnh</p>
        </div>
      </div>

      {/* Nút thêm thư mục / file */}
      <div className="p-3 space-y-2 border-b border-slate-800">
        <button
          onClick={onOpenFolder}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition"
        >
          <FolderOpen className="w-4 h-4" />
          Mở Thư Mục Media
        </button>
        <div className="flex gap-2">
          <button
            onClick={onAddFiles}
            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition"
          >
            <FilePlus className="w-3.5 h-3.5 text-indigo-400" />
            Thêm File
          </button>
          {items.length > 0 && (
            <button
              onClick={onClearList}
              title="Xóa danh sách hiện tại"
              className="px-2.5 py-2 bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 text-xs rounded-lg border border-slate-700 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Bộ lọc danh mục */}
      <div className="px-3 py-3 flex-1 overflow-y-auto space-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-2 mb-2">
          Danh mục & Bộ lọc
        </div>
        {navItems.map((nav) => {
          const isActive = activeFilter === nav.id;
          return (
            <button
              key={nav.id}
              onClick={() => onFilterChange(nav.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5">
                {nav.icon}
                {nav.label}
              </span>
              <span
                className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                  isActive ? 'bg-indigo-500/30 text-indigo-200' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {nav.count}
              </span>
            </button>
          );
        })}

        {/* Công cụ hàng loạt */}
        <div className="pt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-2 mb-2">
            Công cụ Hàng loạt ({selectedCount > 0 ? `${selectedCount} đã chọn` : 'Tất cả'})
          </div>
          <div className="space-y-1.5">
            <button
              onClick={onOpenBatchOnline}
              disabled={items.length === 0}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium bg-gradient-to-r from-indigo-950/80 to-purple-950/80 hover:from-indigo-900/80 hover:to-purple-900/80 text-indigo-200 border border-indigo-700/40 disabled:opacity-40 disabled:pointer-events-none transition"
            >
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
              <div className="text-left">
                <div>Tự động Tìm Tag Online</div>
                <div className="text-[10px] text-slate-400">iTunes, TMDB, MusicBrainz...</div>
              </div>
            </button>

            <button
              onClick={onOpenFilenameTool}
              disabled={items.length === 0}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium bg-slate-800/70 hover:bg-slate-800 text-slate-200 border border-slate-700/60 disabled:opacity-40 disabled:pointer-events-none transition"
            >
              <FileSignature className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="text-left">
                <div>Tên File ↔ Tag & Scene</div>
                <div className="text-[10px] text-slate-400">Phân tích nhóm Rip & Đổi tên</div>
              </div>
            </button>

            <button
              onClick={onOpenDuplicates}
              disabled={items.length === 0}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium bg-slate-800/70 hover:bg-slate-800 text-slate-200 border border-slate-700/60 disabled:opacity-40 disabled:pointer-events-none transition"
            >
              {isCheckingDuplicates ? (
                <Loader2 className="w-4 h-4 text-fuchsia-400 shrink-0 animate-spin" />
              ) : (
                <Copy className="w-4 h-4 text-fuchsia-400 shrink-0" />
              )}
              <div className="text-left flex-1">
                <div>Quản lý File Trùng lặp</div>
                <div className="text-[10px] text-slate-400">
                  {isCheckingDuplicates
                    ? 'Đang so sánh nội dung...'
                    : duplicateGroupCount > 0
                      ? `${duplicateGroupCount} nhóm trùng • ${duplicateFileCount} file`
                      : 'Hash nội dung, ảnh giống nhau, cùng Tag'}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Nút Cài đặt & Quản lý Binary */}
      <div className="p-3 border-t border-slate-800">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-slate-800 text-slate-300 border border-slate-700/50 transition"
        >
          <span className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-slate-400" />
            Cấu hình Nguồn & Binary
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">API / ./bin</span>
        </button>
      </div>
    </aside>
  );
};
