import React, { useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { MediaFileList } from './components/MediaFileList';
import { TagInspectorPanel } from './components/TagInspectorPanel';
import { OnlineSearchModal } from './components/OnlineSearchModal';
import { FilenameToolModal } from './components/FilenameToolModal';
import { SettingsModal } from './components/SettingsModal';
import { MediaFileItem, MediaMetadata, MediaType } from './shared/types';
import { getMediaApi } from './utils/ipcClient';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export function App() {
  const [items, setItems] = useState<MediaFileItem[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<
    'all' | MediaType | 'missing-tag' | 'missing-thumb'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Điều khiển các Modal
  const [onlineModalTargets, setOnlineModalTargets] = useState<MediaFileItem[] | null>(null);
  const [isFilenameModalOpen, setIsFilenameModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  const mergeScannedItems = (newItems: MediaFileItem[]) => {
    setItems((prev) => {
      const map = new Map<string, MediaFileItem>();
      for (const p of prev) map.set(p.filePath, p);
      for (const n of newItems) map.set(n.filePath, n);
      return Array.from(map.values()).sort((a, b) =>
        a.fileName.localeCompare(b.fileName, 'vi')
      );
    });
    if (newItems.length > 0 && selectedPaths.size === 0) {
      setSelectedPaths(new Set([newItems[0].filePath]));
    }
  };

  const handleOpenFolder = async () => {
    try {
      const api = getMediaApi();
      const folder = await api.selectFolder();
      if (!folder) return;
      setIsScanning(true);
      const scanned = await api.scanPaths([folder]);
      mergeScannedItems(scanned);
      showToast('success', `Đã quét và tải ${scanned.length} file media từ thư mục.`);
    } catch (err: any) {
      showToast('error', err?.message || 'Không thể mở thư mục');
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddFiles = async () => {
    try {
      const api = getMediaApi();
      const files = await api.selectFiles();
      if (!files || files.length === 0) return;
      setIsScanning(true);
      const scanned = await api.scanPaths(files);
      mergeScannedItems(scanned);
      showToast('success', `Đã thêm ${scanned.length} file media.`);
    } catch (err: any) {
      showToast('error', err?.message || 'Không thể thêm file');
    } finally {
      setIsScanning(false);
    }
  };

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFiles = Array.from(e.dataTransfer.files);
    const paths = droppedFiles
      .map((f) => (f as any).path as string)
      .filter(Boolean);
    if (paths.length === 0) return;

    try {
      setIsScanning(true);
      const api = getMediaApi();
      const scanned = await api.scanPaths(paths);
      mergeScannedItems(scanned);
      showToast('success', `Đã nạp ${scanned.length} file media.`);
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi nạp file kéo thả');
    } finally {
      setIsScanning(false);
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeFilter === 'audio' && item.mediaType !== 'audio') return false;
      if (activeFilter === 'video' && item.mediaType !== 'video') return false;
      if (activeFilter === 'image' && item.mediaType !== 'image') return false;
      if (activeFilter === 'missing-tag' && item.metadata.title) return false;
      if (activeFilter === 'missing-thumb' && item.metadata.thumbnailDataUrl) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.fileName.toLowerCase().includes(q);
        const matchDir = item.directory.toLowerCase().includes(q);
        const matchTitle = item.metadata.title?.toLowerCase().includes(q);
        const matchArtist = item.metadata.artist?.toLowerCase().includes(q);
        const matchAlbum = item.metadata.album?.toLowerCase().includes(q);
        const matchGroup = item.sceneInfo?.releaseGroup?.toLowerCase().includes(q);
        return matchName || matchDir || matchTitle || matchArtist || matchAlbum || matchGroup;
      }

      return true;
    });
  }, [items, activeFilter, searchQuery]);

  const selectedItems = useMemo(() => {
    return items.filter((i) => selectedPaths.has(i.filePath));
  }, [items, selectedPaths]);

  const handleSelectItem = (filePath: string, multi: boolean) => {
    setSelectedPaths((prev) => {
      if (!multi) {
        return new Set([filePath]);
      }
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const handleSelectGroup = (filePaths: string[], shouldSelect: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const fp of filePaths) {
        if (shouldSelect) {
          next.add(fp);
        } else {
          next.delete(fp);
        }
      }
      return next;
    });
  };

  const handleSaveSingle = async (filePath: string, metadata: MediaMetadata) => {
    setIsSaving(true);
    try {
      const api = getMediaApi();
      const updatedItem = await api.saveFileMetadata(filePath, metadata);
      setItems((prev) =>
        prev.map((item) => (item.filePath === filePath ? updatedItem : item))
      );
      showToast('success', `Đã lưu Tag & Thumbnail cho "${updatedItem.fileName}"`);
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi lưu Tag vào file');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBatchSaveUpdates = async (
    updates: { filePath: string; metadata: Partial<MediaMetadata> }[]
  ) => {
    setIsSaving(true);
    try {
      const api = getMediaApi();
      const res = await api.batchSaveMetadata(updates);
      const updatedMap = new Map(res.updated.map((u) => [u.filePath, u]));
      setItems((prev) =>
        prev.map((item) => updatedMap.get(item.filePath) || item)
      );

      if (res.errors.length > 0) {
        showToast(
          'error',
          `Đã lưu ${res.updated.length} file, lỗi ${res.errors.length} file: ${res.errors[0].error}`
        );
      } else {
        showToast('success', `Đã cập nhật thành công cho ${res.updated.length} file!`);
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi lưu hàng loạt');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExecuteRenames = async (
    renames: { oldPath: string; newPath: string }[]
  ) => {
    setIsSaving(true);
    try {
      const api = getMediaApi();
      const res = await api.executeRenameFiles(renames);
      const renamedMap = new Map(res.renamed.map((r) => [r.oldPath, r.newItem]));

      setItems((prev) =>
        prev.map((item) => renamedMap.get(item.filePath) || item)
      );
      setSelectedPaths((prev) => {
        const next = new Set<string>();
        for (const p of prev) {
          const renamedItem = renamedMap.get(p);
          next.add(renamedItem ? renamedItem.filePath : p);
        }
        return next;
      });

      if (res.errors.length > 0) {
        showToast(
          'error',
          `Đã đổi tên ${res.renamed.length} file, lỗi ${res.errors.length} file.`
        );
      } else {
        showToast('success', `Đã đổi tên thành công ${res.renamed.length} file!`);
      }
    } catch (err: any) {
      showToast('error', err?.message || 'Lỗi khi đổi tên file');
    } finally {
      setIsSaving(false);
    }
  };

  const activeTargetsForTools =
    selectedItems.length > 0 ? selectedItems : filteredItems;

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropFiles}
      className="h-screen w-screen flex bg-slate-950 text-slate-100 overflow-hidden relative"
    >
      {/* Thanh bên trái */}
      <Sidebar
        items={items}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        onOpenFolder={handleOpenFolder}
        onAddFiles={handleAddFiles}
        onClearList={() => {
          setItems([]);
          setSelectedPaths(new Set());
        }}
        onOpenBatchOnline={() => setOnlineModalTargets(activeTargetsForTools)}
        onOpenFilenameTool={() => setIsFilenameModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        selectedCount={selectedPaths.size}
      />

      {/* Danh sách trung tâm */}
      <MediaFileList
        items={filteredItems}
        selectedPaths={selectedPaths}
        onSelectItem={handleSelectItem}
        onSelectGroup={handleSelectGroup}
        onSelectAll={() =>
          setSelectedPaths(new Set(filteredItems.map((i) => i.filePath)))
        }
        onDeselectAll={() => setSelectedPaths(new Set())}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenFolder={handleOpenFolder}
        onQuickSearchOnline={(item) => setOnlineModalTargets([item])}
        onBatchSearchGroup={(groupItems) => setOnlineModalTargets(groupItems)}
        onOpenInExplorer={(filePath) => getMediaApi().openPathInExplorer(filePath)}
      />

      {/* Bảng chỉnh sửa chi tiết bên phải */}
      <TagInspectorPanel
        selectedItems={selectedItems}
        onSaveSingle={handleSaveSingle}
        onSaveBatch={(filePaths, partialMeta) =>
          handleBatchSaveUpdates(
            filePaths.map((fp) => ({ filePath: fp, metadata: partialMeta }))
          )
        }
        onChooseLocalThumbnail={() => getMediaApi().selectImageFile()}
        onOpenOnlineSearch={(item) => setOnlineModalTargets([item])}
        isSaving={isSaving}
      />

      {/* Các Hộp thoại Chức năng */}
      <OnlineSearchModal
        isOpen={!!onlineModalTargets && onlineModalTargets.length > 0}
        onClose={() => setOnlineModalTargets(null)}
        targetItems={onlineModalTargets || []}
        onApplyUpdates={handleBatchSaveUpdates}
      />

      <FilenameToolModal
        isOpen={isFilenameModalOpen}
        onClose={() => setIsFilenameModalOpen(false)}
        targetItems={activeTargetsForTools}
        onApplyExtractedTags={handleBatchSaveUpdates}
        onExecuteRenames={handleExecuteRenames}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />

      {/* Overlay đang quét file */}
      {isScanning && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center">
          <div className="px-6 py-4 rounded-xl bg-slate-900 border border-slate-700 flex items-center gap-3 shadow-2xl">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
            <span className="text-xs font-medium text-slate-200">
              Đang đọc thông tin Tag & Thumbnail từ các file media...
            </span>
          </div>
        </div>
      )}

      {/* Toast thông báo */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl border shadow-xl flex items-center gap-2.5 text-xs font-medium transition ${
            toast.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-600/50 text-emerald-200'
              : 'bg-rose-950/95 border-rose-600/50 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
