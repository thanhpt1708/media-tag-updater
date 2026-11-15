import React, { useMemo, useState, useEffect } from 'react';
import {
  Music,
  Film,
  Image as ImageIcon,
  Search,
  CheckSquare,
  Square,
  FolderOpen,
  Folder,
  FolderTree,
  Layers,
  Disc,
  ShieldAlert,
  LayoutList,
  LayoutGrid,
  Table as TableIcon,
  ArrowUpDown,
  ChevronRight,
  ChevronDown,
  CornerLeftUp,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  Copy,
  AlertTriangle,
} from 'lucide-react';
import { DuplicateKind, IosCompatInfo, MediaFileItem, VideoTechInfo } from '../shared/types';
import { normalizeResolutionLabel, resolutionLabel, resolutionRank } from '../utils/videoFormat';
import { IosCompatBadge } from './IosCompatBadge';

const DUPLICATE_BADGE: Record<DuplicateKind, { label: string; title: string; tone: string }> = {
  identical: {
    label: 'Trùng',
    title: 'File có nội dung giống hệt một file khác',
    tone: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  'similar-image': {
    label: 'Ảnh giống',
    title: 'Hình ảnh gần giống một ảnh khác (bản resize / nén lại)',
    tone: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  'similar-video': {
    label: 'Video giống',
    title: 'Cùng thời lượng và khớp hình ảnh với một video khác (bản encode lại / khác độ phân giải)',
    tone: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  'same-title': {
    label: 'Trùng Tag',
    title: 'Cùng bài hát / phim với một file khác (theo Tag hoặc tên Scene)',
    tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  'same-duration': {
    label: 'Cùng thời lượng',
    title: 'Có thể trùng: cùng thời lượng với một video khác nhưng chưa khớp được hình ảnh',
    tone: 'bg-slate-500/15 text-slate-300 border-slate-500/30 border-dashed',
  },
  'same-size': {
    label: 'Cùng dung lượng',
    title: 'Có thể trùng: cùng dung lượng chính xác với một video khác nhưng nội dung khác',
    tone: 'bg-slate-500/15 text-slate-300 border-slate-500/30 border-dashed',
  },
};

function renderDuplicateBadge(kind?: DuplicateKind) {
  if (!kind) return null;
  const b = DUPLICATE_BADGE[kind];
  return (
    <span
      title={b.title}
      className={`shrink-0 inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-semibold rounded border ${b.tone}`}
    >
      <Copy className="w-2.5 h-2.5" />
      {b.label}
    </span>
  );
}

export type BrowseMode =
  | 'flat'
  | 'folder-explorer'
  | 'by-folder'
  | 'by-collection'
  | 'by-status';

export type LayoutViewMode = 'list' | 'grid' | 'table';

export type SortField = 'fileName' | 'title' | 'year' | 'fileSize' | 'directory';

interface MediaFileListProps {
  items: MediaFileItem[];
  selectedPaths: Set<string>;
  onSelectItem: (filePath: string, multi: boolean) => void;
  onSelectGroup: (filePaths: string[], shouldSelect: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenFolder: () => void;
  onQuickSearchOnline: (item: MediaFileItem) => void;
  onBatchSearchGroup: (groupItems: MediaFileItem[]) => void;
  onOpenInExplorer: (filePath: string) => void;
  /** filePath → loại trùng lặp nghiêm trọng nhất mà file thuộc về */
  duplicateKinds?: Map<string, DuplicateKind>;
  /** Thông tin video bổ sung (đọc bằng ffmpeg khi quét trùng lặp) cho file không đọc được header */
  videoInfoMap?: Record<string, VideoTechInfo>;
  /** filePath → mức tương thích iPhone/iOS (phân tích bằng ffprobe chạy nền) */
  iosCompatMap?: Record<string, IosCompatInfo>;
}

interface MediaGroupSection {
  id: string;
  title: string;
  subtitle?: string;
  badgeText?: string;
  badgeTone?: 'indigo' | 'amber' | 'emerald' | 'rose' | 'slate';
  items: MediaFileItem[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function normalizeWinPath(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/, '');
}

/**
 * Tìm đường dẫn thư mục cha chung gần nhất của danh sách file
 */
function findCommonRootDirectory(items: MediaFileItem[]): string {
  if (items.length === 0) return '';
  const splitDirs = items.map((i) => normalizeWinPath(i.directory).split('\\'));
  const first = splitDirs[0];
  let commonLen = first.length;

  for (let i = 1; i < splitDirs.length; i++) {
    const cur = splitDirs[i];
    let j = 0;
    while (
      j < commonLen &&
      j < cur.length &&
      first[j].toLowerCase() === cur[j].toLowerCase()
    ) {
      j++;
    }
    commonLen = j;
  }

  if (commonLen === 0) return '';
  return first.slice(0, commonLen).join('\\');
}

function getRelativeSubPath(fullDir: string, rootDir: string): string {
  const normFull = normalizeWinPath(fullDir);
  const normRoot = normalizeWinPath(rootDir);
  if (!normRoot) return normFull;
  if (normFull.toLowerCase() === normRoot.toLowerCase()) return '';
  if (normFull.toLowerCase().startsWith(normRoot.toLowerCase() + '\\')) {
    return normFull.slice(normRoot.length + 1);
  }
  return normFull;
}

export const MediaFileList: React.FC<MediaFileListProps> = ({
  items,
  selectedPaths,
  onSelectItem,
  onSelectGroup,
  onSelectAll,
  onDeselectAll,
  searchQuery,
  onSearchChange,
  onOpenFolder,
  onQuickSearchOnline,
  onBatchSearchGroup,
  onOpenInExplorer,
  duplicateKinds,
  videoInfoMap,
  iosCompatMap,
}) => {
  const renderIosBadge = (item: MediaFileItem) =>
    item.mediaType === 'video' ? (
      <IosCompatBadge info={iosCompatMap?.[item.filePath]} />
    ) : null;

  const [browseMode, setBrowseMode] = useState<BrowseMode>('flat');
  const [layoutMode, setLayoutMode] = useState<LayoutViewMode>('list');
  const [sortField, setSortField] = useState<SortField>('fileName');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Trạng thái thư mục đang mở khi ở chế độ `folder-explorer` (chuỗi tương đối tính từ commonRoot)
  const [currentRelFolder, setCurrentRelFolder] = useState<string>('');
  // Danh sách các nhóm đang bị thu gọn khi ở chế độ `by-folder`, `by-collection`, `by-status`
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());

  const commonRootDir = useMemo(() => findCommonRootDirectory(items), [items]);

  // Reset về thư mục gốc nếu commonRootDir thay đổi và đường dẫn con không còn tồn tại
  useEffect(() => {
    if (!currentRelFolder) return;
    const stillExists = items.some((item) => {
      const rel = getRelativeSubPath(item.directory, commonRootDir);
      return (
        rel.toLowerCase() === currentRelFolder.toLowerCase() ||
        rel.toLowerCase().startsWith(currentRelFolder.toLowerCase() + '\\')
      );
    });
    if (!stillExists) {
      setCurrentRelFolder('');
    }
  }, [items, commonRootDir, currentRelFolder]);

  // Sắp xếp danh sách file theo tiêu chí người dùng chọn
  const sortedItems = useMemo(() => {
    const copy = [...items];
    const dirFactor = sortAsc ? 1 : -1;

    copy.sort((a, b) => {
      if (sortField === 'fileName') {
        return a.fileName.localeCompare(b.fileName, 'vi') * dirFactor;
      }
      if (sortField === 'title') {
        const tA = a.metadata.title || a.sceneInfo?.cleanTitle || a.fileName;
        const tB = b.metadata.title || b.sceneInfo?.cleanTitle || b.fileName;
        return tA.localeCompare(tB, 'vi') * dirFactor;
      }
      if (sortField === 'year') {
        const yA = a.metadata.year || a.sceneInfo?.year || 0;
        const yB = b.metadata.year || b.sceneInfo?.year || 0;
        if (yA !== yB) return (yA - yB) * dirFactor;
        return a.fileName.localeCompare(b.fileName, 'vi');
      }
      if (sortField === 'fileSize') {
        if (a.fileSize !== b.fileSize) return (a.fileSize - b.fileSize) * dirFactor;
        return a.fileName.localeCompare(b.fileName, 'vi');
      }
      if (sortField === 'directory') {
        const cmp = a.directory.localeCompare(b.directory, 'vi');
        if (cmp !== 0) return cmp * dirFactor;
        return a.fileName.localeCompare(b.fileName, 'vi');
      }
      return 0;
    });

    return copy;
  }, [items, sortField, sortAsc]);

  // Dữ liệu cho chế độ `folder-explorer` (Duyệt cây thư mục từng cấp)
  const explorerData = useMemo(() => {
    if (browseMode !== 'folder-explorer') {
      return { subfolders: [], directFiles: [] as MediaFileItem[], allInCurrentBranch: [] as MediaFileItem[] };
    }

    const prefixLower = currentRelFolder ? currentRelFolder.toLowerCase() + '\\' : '';
    const subfolderMap = new Map<
      string,
      {
        name: string;
        relPath: string;
        fullPath: string;
        items: MediaFileItem[];
        audioCount: number;
        videoCount: number;
        imageCount: number;
        totalSize: number;
      }
    >();
    const directFiles: MediaFileItem[] = [];
    const allInCurrentBranch: MediaFileItem[] = [];

    for (const item of sortedItems) {
      const rel = getRelativeSubPath(item.directory, commonRootDir);
      const relLower = rel.toLowerCase();

      if (relLower === currentRelFolder.toLowerCase()) {
        directFiles.push(item);
        allInCurrentBranch.push(item);
      } else if (!currentRelFolder || relLower.startsWith(prefixLower)) {
        allInCurrentBranch.push(item);
        const remainder = currentRelFolder ? rel.slice(currentRelFolder.length + 1) : rel;
        const firstSeg = remainder.split('\\')[0];
        if (firstSeg) {
          const childRelPath = currentRelFolder ? `${currentRelFolder}\\${firstSeg}` : firstSeg;
          const key = childRelPath.toLowerCase();
          let existing = subfolderMap.get(key);
          if (!existing) {
            existing = {
              name: firstSeg,
              relPath: childRelPath,
              fullPath: commonRootDir ? `${commonRootDir}\\${childRelPath}` : childRelPath,
              items: [],
              audioCount: 0,
              videoCount: 0,
              imageCount: 0,
              totalSize: 0,
            };
            subfolderMap.set(key, existing);
          }
          existing.items.push(item);
          existing.totalSize += item.fileSize;
          if (item.mediaType === 'audio') existing.audioCount++;
          else if (item.mediaType === 'video') existing.videoCount++;
          else existing.imageCount++;
        }
      }
    }

    const subfolders = Array.from(subfolderMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'vi')
    );

    return { subfolders, directFiles, allInCurrentBranch };
  }, [browseMode, sortedItems, commonRootDir, currentRelFolder]);

  // Dữ liệu phân nhóm cho các chế độ `by-folder`, `by-collection`, `by-status`
  const groupedSections = useMemo<MediaGroupSection[]>(() => {
    if (browseMode === 'by-folder') {
      const map = new Map<string, { dir: string; rel: string; list: MediaFileItem[] }>();
      for (const item of sortedItems) {
        const key = normalizeWinPath(item.directory).toLowerCase();
        const rel = getRelativeSubPath(item.directory, commonRootDir);
        let group = map.get(key);
        if (!group) {
          group = {
            dir: item.directory,
            rel: rel ? `.\\${rel}` : '. (Thư mục gốc)',
            list: [],
          };
          map.set(key, group);
        }
        group.list.push(item);
      }
      return Array.from(map.entries())
        .sort((a, b) => a[1].rel.localeCompare(b[1].rel, 'vi'))
        .map(([key, g]) => {
          const totalBytes = g.list.reduce((acc, i) => acc + i.fileSize, 0);
          return {
            id: `folder:${key}`,
            title: g.rel,
            subtitle: g.dir,
            badgeText: `${g.list.length} file • ${formatFileSize(totalBytes)}`,
            badgeTone: 'indigo',
            items: g.list,
          };
        });
    }

    if (browseMode === 'by-collection') {
      const map = new Map<string, { title: string; subtitle: string; list: MediaFileItem[] }>();
      for (const item of sortedItems) {
        let groupTitle = '';
        let groupSubtitle = '';

        if (item.mediaType === 'video') {
          if (item.sceneInfo?.isTvShow && item.sceneInfo.cleanTitle) {
            const s =
              item.sceneInfo.season !== undefined
                ? ` - Season ${String(item.sceneInfo.season).padStart(2, '0')}`
                : '';
            groupTitle = `📺 Series: ${item.metadata.album || item.sceneInfo.cleanTitle}${s}`;
            groupSubtitle = 'Phim bộ / TV Series';
          } else {
            const yearStr = item.metadata.year || item.sceneInfo?.year;
            const baseTitle = item.metadata.title || item.sceneInfo?.cleanTitle || item.fileName;
            groupTitle = `🎬 Phim: ${baseTitle}${yearStr ? ` (${yearStr})` : ''}`;
            groupSubtitle = item.metadata.artist ? `Đạo diễn: ${item.metadata.artist}` : 'Phim lẻ';
          }
        } else if (item.mediaType === 'audio') {
          if (item.metadata.album) {
            groupTitle = `💿 Album: ${item.metadata.album}`;
            groupSubtitle = item.metadata.artist ? `Nghệ sĩ: ${item.metadata.artist}` : 'Album nhạc';
          } else if (item.metadata.artist) {
            groupTitle = `🎤 Nghệ sĩ: ${item.metadata.artist}`;
            groupSubtitle = 'Chưa phân loại Album';
          } else {
            groupTitle = '🎵 Nhạc chưa có thông tin Album / Nghệ sĩ';
            groupSubtitle = 'Cần tra cứu Tag';
          }
        } else {
          const rel = getRelativeSubPath(item.directory, commonRootDir);
          const fallbackFolderName = item.directory.split(/[\\/]/).pop() || 'Thư mục gốc';
          groupTitle = `📷 Bộ ảnh: ${rel || fallbackFolderName}`;
          groupSubtitle = item.metadata.cameraModel || 'Hình ảnh / EXIF';
        }

        const key = groupTitle.toLowerCase();
        let entry = map.get(key);
        if (!entry) {
          entry = { title: groupTitle, subtitle: groupSubtitle, list: [] };
          map.set(key, entry);
        }
        entry.list.push(item);
      }

      return Array.from(map.entries())
        .sort((a, b) => a[1].title.localeCompare(b[1].title, 'vi'))
        .map(([key, g]) => ({
          id: `col:${key}`,
          title: g.title,
          subtitle: g.subtitle,
          badgeText: `${g.list.length} file`,
          badgeTone: 'amber',
          items: g.list,
        }));
    }

    if (browseMode === 'by-status') {
      const missingTextTag: MediaFileItem[] = [];
      const missingThumbOnly: MediaFileItem[] = [];
      const completeItems: MediaFileItem[] = [];

      for (const item of sortedItems) {
        const hasTitle = Boolean(item.metadata.title?.trim());
        const hasThumb = Boolean(item.metadata.thumbnailDataUrl);

        if (!hasTitle) {
          missingTextTag.push(item);
        } else if (!hasThumb) {
          missingThumbOnly.push(item);
        } else {
          completeItems.push(item);
        }
      }

      const sections: MediaGroupSection[] = [];
      if (missingTextTag.length > 0) {
        sections.push({
          id: 'status:missing-tag',
          title: '⚠️ Chưa có Tiêu đề / Tag cơ bản',
          subtitle: 'Các file chỉ mới có tên file thô, cần tra cứu Online hoặc trích xuất từ tên file',
          badgeText: `${missingTextTag.length} file cần cập nhật`,
          badgeTone: 'rose',
          items: missingTextTag,
        });
      }
      if (missingThumbOnly.length > 0) {
        sections.push({
          id: 'status:missing-thumb',
          title: '🖼️ Đã có Tiêu đề nhưng thiếu Ảnh bìa / Poster',
          subtitle: 'Có thể tra cứu Online để tự động gắn Poster / Cover Art độ phân giải cao',
          badgeText: `${missingThumbOnly.length} file thiếu ảnh`,
          badgeTone: 'amber',
          items: missingThumbOnly,
        });
      }
      if (completeItems.length > 0) {
        sections.push({
          id: 'status:complete',
          title: '✅ Đã có đầy đủ Tag & Ảnh bìa / Thumbnail',
          subtitle: 'Các file đã có thông tin tiêu đề và hình thu nhỏ',
          badgeText: `${completeItems.length} file hoàn chỉnh`,
          badgeTone: 'emerald',
          items: completeItems,
        });
      }
      return sections;
    }

    return [];
  }, [browseMode, sortedItems, commonRootDir]);

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleSortColumnClick = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const allSelected = items.length > 0 && items.every((i) => selectedPaths.has(i.filePath));

  // Render Type Badge nhỏ gọn
  const renderMediaTypeBadge = (mediaType: MediaFileItem['mediaType']) => {
    if (mediaType === 'audio') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
          <Music className="w-3 h-3" /> Nhạc
        </span>
      );
    }
    if (mediaType === 'video') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
          <Film className="w-3 h-3" /> Phim
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20 shrink-0">
        <ImageIcon className="w-3 h-3" /> Ảnh
      </span>
    );
  };

  /**
   * Badge độ phân giải: ưu tiên độ phân giải THỰC đọc từ luồng video; nếu không đọc được thì
   * dùng nhãn trong tên file (Scene). Khi tên file ghi khác thực tế → hiện cảnh báo ⚠.
   */
  const renderResolutionBadge = (item: MediaFileItem, variant: 'overlay' | 'inline') => {
    if (item.mediaType !== 'video') return null;
    const vi = item.videoInfo?.width ? item.videoInfo : videoInfoMap?.[item.filePath];
    const claimed = item.sceneInfo?.resolution;
    const sizeCls =
      variant === 'overlay' ? 'px-1.5 py-0.5 text-[10px]' : 'px-1.5 py-0.2 text-[10px]';

    if (vi?.width && vi?.height) {
      const actual = resolutionLabel(vi.width, vi.height);
      const claimedNorm = claimed ? normalizeResolutionLabel(claimed) : undefined;
      const mismatch = !!claimedNorm && claimedNorm !== actual;
      const lower = mismatch && resolutionRank(actual) < resolutionRank(claimedNorm!);
      const title = mismatch
        ? `Tên file ghi ${claimed} nhưng video thực tế là ${vi.width}×${vi.height} (${actual})${
            lower ? ' – thấp hơn so với tên file' : ''
          }`
        : `Độ phân giải thực: ${vi.width}×${vi.height}`;
      const tone = mismatch
        ? 'bg-rose-950/80 text-rose-300 border-rose-600/50'
        : variant === 'overlay'
          ? 'bg-cyan-950/90 text-cyan-200 border-cyan-600/50'
          : 'bg-cyan-950/60 text-cyan-300 border-cyan-700/40';
      return (
        <span
          title={title}
          className={`inline-flex items-center gap-0.5 rounded border font-mono font-semibold shrink-0 ${sizeCls} ${tone}`}
        >
          {mismatch && <AlertTriangle className="w-2.5 h-2.5" />}
          {actual}
          {variant === 'inline' && (
            <span className="font-normal opacity-60 ml-0.5">
              {vi.width}×{vi.height}
            </span>
          )}
        </span>
      );
    }

    if (claimed) {
      return (
        <span
          title="Độ phân giải theo tên file (chưa đọc được thông tin thực từ video)"
          className={`rounded border font-mono font-semibold shrink-0 bg-amber-950/70 text-amber-300 border-amber-700/40 ${sizeCls}`}
        >
          {claimed}
        </span>
      );
    }
    return null;
  };

  // ============================================================================
  // RENDER 3 KIỂU HIỂN THỊ: LIST (DANH SÁCH), GRID (LƯỚI POSTER), TABLE (BẢNG CỘT)
  // ============================================================================

  const renderItemsByLayout = (list: MediaFileItem[]) => {
    if (list.length === 0) {
      return (
        <div className="p-6 text-center text-xs text-slate-500 italic">
          Không có file trực tiếp nào ở cấp này.
        </div>
      );
    }

    // 1. Kiểu GRID (Lưới Poster / Ảnh bìa trực quan)
    if (layoutMode === 'grid') {
      return (
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3.5">
          {list.map((item) => {
            const isSelected = selectedPaths.has(item.filePath);
            const meta = item.metadata;
            const scene = item.sceneInfo;
            const relDir = getRelativeSubPath(item.directory, commonRootDir);

            return (
              <div
                key={item.filePath}
                onClick={(e) => onSelectItem(item.filePath, e.ctrlKey || e.metaKey || e.shiftKey)}
                className={`group rounded-xl border overflow-hidden flex flex-col cursor-pointer transition relative ${
                  isSelected
                    ? 'bg-indigo-950/40 border-indigo-500 shadow-lg shadow-indigo-950/50'
                    : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                {/* Khung Ảnh Poster / Cover */}
                <div className="relative aspect-[4/3] w-full bg-slate-950 overflow-hidden flex items-center justify-center border-b border-slate-800/80">
                  {meta.thumbnailDataUrl ? (
                    <img
                      src={meta.thumbnailDataUrl}
                      alt={meta.title || item.fileName}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                  ) : item.mediaType === 'audio' ? (
                    <Music className="w-10 h-10 text-slate-700" />
                  ) : item.mediaType === 'video' ? (
                    <Film className="w-10 h-10 text-slate-700" />
                  ) : (
                    <ImageIcon className="w-10 h-10 text-slate-700" />
                  )}

                  {/* Checkbox góc trái trên */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectItem(item.filePath, true);
                    }}
                    className="absolute top-2 left-2 w-6 h-6 rounded-md bg-slate-950/80 backdrop-blur-xs border border-slate-700 flex items-center justify-center"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="w-3.5 h-3.5 rounded border-slate-600 text-indigo-600 bg-slate-900 cursor-pointer"
                    />
                  </div>

                  {/* Nhãn độ phân giải / Năm góc phải trên */}
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    {renderResolutionBadge(item, 'overlay')}
                    {(meta.year || scene?.year) && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-950/85 text-slate-200 border border-slate-700 text-[10px] font-mono">
                        {meta.year || scene?.year}
                      </span>
                    )}
                  </div>

                  {/* Nút thao tác nhanh khi hover */}
                  <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickSearchOnline(item);
                      }}
                      title="Tìm Tag & Poster trên mạng"
                      className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenInExplorer(item.filePath);
                      }}
                      title="Mở trong Windows Explorer"
                      className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 shadow-md"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Nội dung Card */}
                <div className="p-2.5 flex-1 flex flex-col justify-between gap-1.5">
                  <div>
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <span className="flex items-center gap-1">
                        {renderMediaTypeBadge(item.mediaType)}
                        {renderDuplicateBadge(duplicateKinds?.get(item.filePath))}
                        {renderIosBadge(item)}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {formatFileSize(item.fileSize)}
                      </span>
                    </div>
                    <div
                      className="text-xs font-semibold text-slate-100 line-clamp-1"
                      title={meta.title || item.fileName}
                    >
                      {meta.title || (
                        <span className="text-amber-300/90 italic">
                          {scene?.cleanTitle || item.fileName}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[11px] text-slate-400 truncate mt-0.5"
                      title={item.fileName}
                    >
                      {meta.artist || item.fileName}
                    </div>
                  </div>

                  {relDir && browseMode === 'flat' && (
                    <div
                      className="text-[10px] text-slate-500 truncate flex items-center gap-1 pt-1 border-t border-slate-800/60"
                      title={item.directory}
                    >
                      <Folder className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                      <span className="truncate">{relDir}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // 2. Kiểu TABLE (Bảng dữ liệu chia cột như Spreadsheet, có thể bấm vào cột để Sort)
    if (layoutMode === 'table') {
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] font-semibold text-slate-400 select-none">
                <th className="py-2.5 px-3 w-8 text-center">#</th>
                <th
                  onClick={() => handleSortColumnClick('fileName')}
                  className="py-2.5 px-3 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    Tên File
                    {sortField === 'fileName' && <ArrowUpDown className="w-3 h-3 text-indigo-400" />}
                  </div>
                </th>
                <th
                  onClick={() => handleSortColumnClick('title')}
                  className="py-2.5 px-3 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    Tiêu đề (Title Tag)
                    {sortField === 'title' && <ArrowUpDown className="w-3 h-3 text-indigo-400" />}
                  </div>
                </th>
                <th className="py-2.5 px-3">Nghệ sĩ / Đạo diễn</th>
                <th className="py-2.5 px-3">Album / Series</th>
                <th
                  onClick={() => handleSortColumnClick('year')}
                  className="py-2.5 px-3 w-20 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    Năm
                    {sortField === 'year' && <ArrowUpDown className="w-3 h-3 text-indigo-400" />}
                  </div>
                </th>
                <th className="py-2.5 px-3 w-28">Phân giải</th>
                <th
                  onClick={() => handleSortColumnClick('directory')}
                  className="py-2.5 px-3 cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center gap-1">
                    Thư mục con
                    {sortField === 'directory' && <ArrowUpDown className="w-3 h-3 text-indigo-400" />}
                  </div>
                </th>
                <th
                  onClick={() => handleSortColumnClick('fileSize')}
                  className="py-2.5 px-3 w-24 text-right cursor-pointer hover:text-slate-200"
                >
                  <div className="flex items-center justify-end gap-1">
                    Kích thước
                    {sortField === 'fileSize' && <ArrowUpDown className="w-3 h-3 text-indigo-400" />}
                  </div>
                </th>
                <th className="py-2.5 px-3 w-20 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {list.map((item) => {
                const isSelected = selectedPaths.has(item.filePath);
                const meta = item.metadata;
                const relDir = getRelativeSubPath(item.directory, commonRootDir);

                return (
                  <tr
                    key={item.filePath}
                    onClick={(e) =>
                      onSelectItem(item.filePath, e.ctrlKey || e.metaKey || e.shiftKey)
                    }
                    className={`cursor-pointer transition ${
                      isSelected
                        ? 'bg-indigo-950/40 hover:bg-indigo-950/60'
                        : 'hover:bg-slate-900/70'
                    }`}
                  >
                    <td
                      className="py-2 px-3 text-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectItem(item.filePath, true);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="w-3.5 h-3.5 rounded border-slate-600 text-indigo-600 bg-slate-900 cursor-pointer"
                      />
                    </td>
                    <td className="py-2 px-3 max-w-[220px]">
                      <div className="flex items-center gap-2">
                        {renderMediaTypeBadge(item.mediaType)}
                        <span className="truncate text-slate-200 font-medium" title={item.fileName}>
                          {item.fileName}
                        </span>
                        {renderDuplicateBadge(duplicateKinds?.get(item.filePath))}
                        {renderIosBadge(item)}
                      </div>
                    </td>
                    <td className="py-2 px-3 max-w-[200px]">
                      {meta.title ? (
                        <span className="text-emerald-300 font-medium truncate block" title={meta.title}>
                          {meta.title}
                        </span>
                      ) : (
                        <span className="text-slate-500 italic text-[11px]">Chưa có Title</span>
                      )}
                    </td>
                    <td className="py-2 px-3 max-w-[150px] truncate text-slate-300">
                      {meta.artist || <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-2 px-3 max-w-[150px] truncate text-slate-400">
                      {meta.album || <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-300">
                      {meta.year || item.sceneInfo?.year || <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-2 px-3">
                      {renderResolutionBadge(item, 'overlay') || <span className="text-slate-600">—</span>}
                    </td>
                    <td
                      className="py-2 px-3 max-w-[160px] truncate text-[11px] text-slate-400"
                      title={item.directory}
                    >
                      {relDir ? `.\\${relDir}` : '.'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-[11px] text-slate-400">
                      {formatFileSize(item.fileSize)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickSearchOnline(item);
                          }}
                          title="Tra cứu Online"
                          className="p-1 rounded bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white transition"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenInExplorer(item.filePath);
                          }}
                          title="Mở trong Explorer"
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    // 3. Kiểu LIST (Danh sách chi tiết mặc định)
    return (
      <div className="divide-y divide-slate-800/70">
        {list.map((item) => {
          const isSelected = selectedPaths.has(item.filePath);
          const meta = item.metadata;
          const scene = item.sceneInfo;
          const relDir = getRelativeSubPath(item.directory, commonRootDir);

          return (
            <div
              key={item.filePath}
              onClick={(e) => onSelectItem(item.filePath, e.ctrlKey || e.metaKey || e.shiftKey)}
              className={`flex items-center gap-3.5 px-4 py-3 cursor-pointer transition ${
                isSelected
                  ? 'bg-indigo-950/40 hover:bg-indigo-950/60'
                  : 'hover:bg-slate-900/70'
              }`}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => {}}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectItem(item.filePath, true);
                }}
                className="w-4 h-4 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500 bg-slate-900 cursor-pointer"
              />

              {/* Thumbnail */}
              <div className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0 relative">
                {meta.thumbnailDataUrl ? (
                  <img
                    src={meta.thumbnailDataUrl}
                    alt={meta.title || item.fileName}
                    className="w-full h-full object-cover"
                  />
                ) : item.mediaType === 'audio' ? (
                  <Music className="w-5 h-5 text-slate-600" />
                ) : item.mediaType === 'video' ? (
                  <Film className="w-5 h-5 text-slate-600" />
                ) : (
                  <ImageIcon className="w-5 h-5 text-slate-600" />
                )}
              </div>

              {/* Thông tin chính */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  {renderMediaTypeBadge(item.mediaType)}
                  <span className="font-medium text-xs text-slate-100 truncate" title={item.fileName}>
                    {meta.title || (
                      <span className="text-slate-400 italic">
                        {item.fileName} (Chưa có Title Tag)
                      </span>
                    )}
                  </span>
                  {meta.year && (
                    <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono">
                      {meta.year}
                    </span>
                  )}
                  {renderDuplicateBadge(duplicateKinds?.get(item.filePath))}
                  {renderIosBadge(item)}
                </div>

                {/* Dòng 2: Thư mục con tương đối, Tên file thực tế & Nghệ sĩ / Album / Thông số Scene */}
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  {relDir && browseMode !== 'by-folder' && browseMode !== 'folder-explorer' && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-indigo-300/90 text-[10px]"
                      title={item.directory}
                    >
                      <Folder className="w-2.5 h-2.5" />
                      {relDir}
                    </span>
                  )}

                  <span className="truncate max-w-xs text-slate-500" title={item.filePath}>
                    {item.fileName}
                  </span>

                  {meta.artist && (
                    <span className="text-slate-300">
                      • {item.mediaType === 'video' ? 'Đạo diễn/Tác giả:' : 'Nghệ sĩ:'}{' '}
                      <strong>{meta.artist}</strong>
                    </span>
                  )}

                  {meta.album && (
                    <span className="text-slate-300">
                      • {item.mediaType === 'video' ? 'Series:' : 'Album:'} {meta.album}
                    </span>
                  )}

                  {/* Badge thông số Scene Release cho file Phim */}
                  {scene && (
                    <div className="flex items-center gap-1.5">
                      {scene.isTvShow &&
                        scene.season !== undefined &&
                        scene.episode !== undefined && (
                          <span className="px-1.5 py-0.2 bg-purple-950/80 text-purple-300 border border-purple-700/40 rounded text-[10px] font-mono">
                            S{String(scene.season).padStart(2, '0')}E
                            {String(scene.episode).padStart(2, '0')}
                          </span>
                        )}
                      {renderResolutionBadge(item, 'inline')}
                      {scene.source && (
                        <span className="px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded text-[10px]">
                          {scene.source}
                        </span>
                      )}
                      {scene.releaseGroup && (
                        <span className="px-1.5 py-0.2 bg-indigo-950/70 text-indigo-300 border border-indigo-800/40 rounded text-[10px] font-mono">
                          -{scene.releaseGroup}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Thông tin GPS nếu là Ảnh */}
                  {item.mediaType === 'image' &&
                    typeof meta.gpsLatitude === 'number' &&
                    typeof meta.gpsLongitude === 'number' && (
                      <span className="px-1.5 py-0.2 bg-sky-950/70 text-sky-300 border border-sky-700/40 rounded text-[10px]">
                        GPS: {meta.gpsLatitude.toFixed(4)}, {meta.gpsLongitude.toFixed(4)}
                      </span>
                    )}
                </div>
              </div>

              {/* Cột kích thước & nút tra cứu nhanh */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-slate-500 font-mono">
                  {formatFileSize(item.fileSize)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickSearchOnline(item);
                  }}
                  title="Tìm Tag & Thumbnail trên mạng cho file này"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white transition"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenInExplorer(item.filePath);
                  }}
                  title="Hiển thị trong Windows Explorer"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Breadcrumb segments cho chế độ `folder-explorer`
  const breadcrumbSegments = useMemo(() => {
    if (!currentRelFolder) return [];
    const parts = currentRelFolder.split('\\').filter(Boolean);
    return parts.map((name, idx) => ({
      name,
      relPath: parts.slice(0, idx + 1).join('\\'),
    }));
  }, [currentRelFolder]);

  return (
    <main className="flex-1 flex flex-col h-full bg-slate-950 min-w-0">
      {/* Thanh công cụ Tầng 1: Tìm kiếm + Tổng quan chọn file */}
      <div className="h-13 px-4 border-b border-slate-800/80 flex items-center justify-between gap-3 bg-slate-900/60">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Tìm theo tên file, thư mục con, tiêu đề, ca sĩ, nhóm rip..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>
            Tổng <strong className="text-slate-200">{items.length}</strong> file • Đã chọn{' '}
            <strong className="text-indigo-400">{selectedPaths.size}</strong>
          </span>
          <button
            onClick={allSelected ? onDeselectAll : onSelectAll}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 transition"
          >
            {allSelected ? (
              <>
                <Square className="w-3.5 h-3.5 text-slate-400" /> Bỏ chọn hết
              </>
            ) : (
              <>
                <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> Chọn tất cả
              </>
            )}
          </button>
        </div>
      </div>

      {/* Thanh công cụ Tầng 2: Chọn Chế độ Duyệt (Browse Mode) + Kiểu Hiển thị (Layout) + Sắp xếp (Sort) */}
      {items.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/30 flex flex-wrap items-center justify-between gap-2">
          {/* 5 Chế độ Duyệt / Phân nhóm */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setBrowseMode('flat')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                browseMode === 'flat'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="Trải phẳng toàn bộ file thành 1 danh sách"
            >
              <LayoutList className="w-3.5 h-3.5" />
              Trải phẳng
            </button>

            <button
              onClick={() => setBrowseMode('folder-explorer')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                browseMode === 'folder-explorer'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="Duyệt từng cấp thư mục cha - con như Windows Explorer"
            >
              <FolderTree className="w-3.5 h-3.5" />
              Cây thư mục
            </button>

            <button
              onClick={() => setBrowseMode('by-folder')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                browseMode === 'by-folder'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="Gom nhóm file theo từng thư mục chứa file"
            >
              <Layers className="w-3.5 h-3.5" />
              Nhóm Thư mục
            </button>

            <button
              onClick={() => setBrowseMode('by-collection')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                browseMode === 'by-collection'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="Gom nhóm theo Album nhạc, TV Series hoặc Bộ phim"
            >
              <Disc className="w-3.5 h-3.5" />
              Theo Album / Series
            </button>

            <button
              onClick={() => setBrowseMode('by-status')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                browseMode === 'by-status'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="Chia nhóm theo tình trạng Đủ Tag / Thiếu Tag / Thiếu Ảnh bìa"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Theo Trạng thái Tag
            </button>
          </div>

          {/* Bộ Sắp xếp & 3 Kiểu Hiển thị (List / Grid / Table) */}
          <div className="flex items-center gap-2">
            {/* Sắp xếp */}
            <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 text-[11px]">
              <span className="text-slate-500">Xếp:</span>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortField)}
                className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
              >
                <option value="fileName" className="bg-slate-900">
                  Tên file
                </option>
                <option value="title" className="bg-slate-900">
                  Tiêu đề Tag
                </option>
                <option value="year" className="bg-slate-900">
                  Năm phát hành
                </option>
                <option value="fileSize" className="bg-slate-900">
                  Dung lượng
                </option>
                <option value="directory" className="bg-slate-900">
                  Thư mục
                </option>
              </select>
              <button
                onClick={() => setSortAsc((prev) => !prev)}
                title={sortAsc ? 'Đang xếp Tăng dần (A->Z)' : 'Đang xếp Giảm dần (Z->A)'}
                className="p-0.5 rounded hover:bg-slate-800 text-indigo-400 font-mono text-[10px] px-1"
              >
                {sortAsc ? '↑ A-Z' : '↓ Z-A'}
              </button>
            </div>

            {/* 3 Kiểu Hiển thị: Danh sách / Lưới Poster / Bảng Cột */}
            <div className="flex items-center gap-0.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setLayoutMode('list')}
                title="Kiểu Danh sách chi tiết"
                className={`p-1 rounded transition ${
                  layoutMode === 'list'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setLayoutMode('grid')}
                title="Kiểu Lưới Poster / Ảnh bìa lớn"
                className={`p-1 rounded transition ${
                  layoutMode === 'grid'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setLayoutMode('table')}
                title="Kiểu Bảng Cột (Spreadsheet)"
                className={`p-1 rounded transition ${
                  layoutMode === 'table'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nội dung chính */}
      {items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4">
            <FolderOpen className="w-8 h-8 text-indigo-400" />
          </div>
          <h2 className="text-base font-semibold text-slate-200 mb-1">
            Chưa có file Media nào trong danh sách
          </h2>
          <p className="text-xs text-slate-400 max-w-md mb-5 leading-relaxed">
            Kéo thả trực tiếp các file hoặc cả thư mục lớn (hỗ trợ quét đệ quy nhiều tầng thư mục con) vào cửa sổ này, sau đó duyệt theo Cây thư mục, Album/Series hoặc Lưới Poster.
          </p>
          <button
            onClick={onOpenFolder}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-lg shadow-indigo-600/20 transition"
          >
            Chọn Thư Mục Media Ngay
          </button>
        </div>
      ) : browseMode === 'flat' ? (
        /* CHẾ ĐỘ 1: TRẢI PHẲNG */
        <div className="flex-1 overflow-y-auto">{renderItemsByLayout(sortedItems)}</div>
      ) : browseMode === 'folder-explorer' ? (
        /* CHẾ ĐỘ 2: DUYỆT CÂY THƯ MỤC TỪNG CẤP (FOLDER EXPLORER) */
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Thanh Breadcrumb đường dẫn thư mục */}
          <div className="px-4 py-2.5 bg-slate-900/70 border-b border-slate-800 flex items-center justify-between gap-2 sticky top-0 z-10 backdrop-blur-xs">
            <div className="flex items-center flex-wrap gap-1 text-xs">
              {currentRelFolder && (
                <button
                  onClick={() => {
                    const parts = currentRelFolder.split('\\').filter(Boolean);
                    parts.pop();
                    setCurrentRelFolder(parts.join('\\'));
                  }}
                  title="Lên thư mục cha"
                  className="mr-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 text-[11px]"
                >
                  <CornerLeftUp className="w-3.5 h-3.5 text-indigo-400" /> Lên 1 cấp
                </button>
              )}

              <button
                onClick={() => setCurrentRelFolder('')}
                className={`px-2 py-1 rounded flex items-center gap-1.5 font-medium transition ${
                  !currentRelFolder
                    ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-700/50'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title={commonRootDir}
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>{commonRootDir ? commonRootDir.split('\\').pop() || commonRootDir : 'Thư mục gốc'}</span>
              </button>

              {breadcrumbSegments.map((seg, idx) => {
                const isLast = idx === breadcrumbSegments.length - 1;
                return (
                  <React.Fragment key={seg.relPath}>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                    <button
                      onClick={() => setCurrentRelFolder(seg.relPath)}
                      className={`px-2 py-1 rounded font-medium transition ${
                        isLast
                          ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-700/50'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {seg.name}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Thao tác nhanh trên toàn bộ nhánh thư mục đang mở */}
            <div className="flex items-center gap-2 shrink-0">
              {(() => {
                const branchPaths = explorerData.allInCurrentBranch.map((i) => i.filePath);
                const allBranchSelected =
                  branchPaths.length > 0 && branchPaths.every((p) => selectedPaths.has(p));
                return (
                  <>
                    <button
                      onClick={() => onSelectGroup(branchPaths, !allBranchSelected)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] flex items-center gap-1"
                    >
                      <CheckSquare className="w-3 h-3 text-indigo-400" />
                      {allBranchSelected
                        ? `Bỏ chọn nhánh này (${branchPaths.length})`
                        : `Chọn cả nhánh (${branchPaths.length} file)`}
                    </button>
                    <button
                      onClick={() => onBatchSearchGroup(explorerData.allInCurrentBranch)}
                      className="px-2.5 py-1 rounded bg-indigo-600/90 hover:bg-indigo-500 text-white text-[11px] font-medium flex items-center gap-1"
                    >
                      <Sparkles className="w-3 h-3" />
                      Tra cứu Online nhánh này
                    </button>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Danh sách các Thư mục con (Subfolder Cards) tại cấp hiện tại */}
          {explorerData.subfolders.length > 0 && (
            <div className="p-4 border-b border-slate-800/80 bg-slate-900/20">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-amber-400" />
                Thư mục con ({explorerData.subfolders.length}) — Bấm vào thư mục để duyệt sâu hơn
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {explorerData.subfolders.map((sub) => {
                  const subPaths = sub.items.map((i) => i.filePath);
                  const isSubSelected =
                    subPaths.length > 0 && subPaths.every((p) => selectedPaths.has(p));

                  return (
                    <div
                      key={sub.relPath}
                      onClick={() => setCurrentRelFolder(sub.relPath)}
                      className={`group p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                        isSubSelected
                          ? 'bg-indigo-950/40 border-indigo-500/60'
                          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                          <Folder className="w-5 h-5 text-amber-400" />
                        </div>
                        <div className="min-w-0">
                          <div
                            className="text-xs font-semibold text-slate-100 truncate group-hover:text-indigo-300 transition"
                            title={sub.fullPath}
                          >
                            {sub.name}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                            <span>{sub.items.length} file</span>
                            <span>•</span>
                            <span className="font-mono text-[10px]">
                              {formatFileSize(sub.totalSize)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Nút chọn nhanh hoặc tra cứu cả thư mục con */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectGroup(subPaths, !isSubSelected);
                          }}
                          title={isSubSelected ? 'Bỏ chọn thư mục này' : 'Chọn tất cả file trong thư mục này'}
                          className={`p-1.5 rounded-lg border text-[10px] transition ${
                            isSubSelected
                              ? 'bg-indigo-600 border-indigo-500 text-white'
                              : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          <CheckSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onBatchSearchGroup(sub.items);
                          }}
                          title="Tra cứu Online toàn bộ file trong thư mục con này"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700 transition"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Các file nằm trực tiếp tại thư mục đang mở */}
          <div className="flex-1">
            <div className="px-4 py-2 bg-slate-900/40 border-b border-slate-800/60 text-[11px] font-semibold text-slate-400 flex items-center justify-between">
              <span>
                File nằm trực tiếp trong thư mục này ({explorerData.directFiles.length} file)
              </span>
            </div>
            {renderItemsByLayout(explorerData.directFiles)}
          </div>
        </div>
      ) : (
        /* CHẾ ĐỘ 3, 4, 5: GOM NHÓM THEO THƯ MỤC / ALBUM-SERIES / TRẠNG THÁI TAG */
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {groupedSections.map((section) => {
            const isCollapsed = collapsedGroupIds.has(section.id);
            const groupPaths = section.items.map((i) => i.filePath);
            const allGroupSelected =
              groupPaths.length > 0 && groupPaths.every((p) => selectedPaths.has(p));

            const badgeColor =
              section.badgeTone === 'rose'
                ? 'bg-rose-950/80 text-rose-300 border-rose-700/50'
                : section.badgeTone === 'amber'
                ? 'bg-amber-950/80 text-amber-300 border-amber-700/50'
                : section.badgeTone === 'emerald'
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/50'
                : 'bg-indigo-950/80 text-indigo-300 border-indigo-700/50';

            return (
              <div
                key={section.id}
                className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden"
              >
                {/* Header của Nhóm */}
                <div
                  onClick={() => toggleGroupCollapse(section.id)}
                  className="px-4 py-2.5 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-900 transition select-none"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-indigo-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-100 truncate">
                          {section.title}
                        </span>
                        {section.badgeText && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${badgeColor}`}
                          >
                            {section.badgeText}
                          </span>
                        )}
                      </div>
                      {section.subtitle && (
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {section.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Nút Chọn cả nhóm & Tra cứu Online cả nhóm */}
                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => onSelectGroup(groupPaths, !allGroupSelected)}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition ${
                        allGroupSelected
                          ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                          : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                      }`}
                    >
                      {allGroupSelected ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                          Đã chọn nhóm ({groupPaths.length})
                        </>
                      ) : (
                        <>
                          <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
                          Chọn nhóm ({groupPaths.length})
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => onBatchSearchGroup(section.items)}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium flex items-center gap-1 transition"
                      title="Tra cứu Tag & Poster hàng loạt cho riêng nhóm này"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Tra cứu nhóm
                    </button>
                  </div>
                </div>

                {/* Danh sách file bên trong Nhóm */}
                {!isCollapsed && renderItemsByLayout(section.items)}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
};
