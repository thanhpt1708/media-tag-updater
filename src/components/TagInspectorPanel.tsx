import React, { useEffect, useState } from 'react';
import {
  Save,
  RotateCcw,
  Sparkles,
  ImagePlus,
  Trash2,
  Wand2,
  Layers,
  MapPin,
  Film,
  Music,
  Image as ImageIcon,
} from 'lucide-react';
import { MediaFileItem, MediaMetadata } from '../shared/types';

interface TagInspectorPanelProps {
  selectedItems: MediaFileItem[];
  onSaveSingle: (filePath: string, metadata: MediaMetadata) => Promise<void>;
  onSaveBatch: (
    filePaths: string[],
    partialMetadata: Partial<MediaMetadata>
  ) => Promise<void>;
  onChooseLocalThumbnail: () => Promise<string | null>;
  onOpenOnlineSearch: (item: MediaFileItem) => void;
  isSaving: boolean;
}

export const TagInspectorPanel: React.FC<TagInspectorPanelProps> = ({
  selectedItems,
  onSaveSingle,
  onSaveBatch,
  onChooseLocalThumbnail,
  onOpenOnlineSearch,
  isSaving,
}) => {
  const singleItem = selectedItems.length === 1 ? selectedItems[0] : null;
  const isBatch = selectedItems.length > 1;

  // State cho chế độ chỉnh sửa 1 file
  const [form, setForm] = useState<MediaMetadata>({});
  const [keywordsText, setKeywordsText] = useState('');

  // State cho chế độ chỉnh sửa hàng loạt (Batch Edit)
  const [batchEnabledFields, setBatchEnabledFields] = useState<Record<string, boolean>>({});
  const [batchForm, setBatchForm] = useState<Partial<MediaMetadata>>({});

  useEffect(() => {
    if (singleItem) {
      setForm({ ...singleItem.metadata });
      setKeywordsText((singleItem.metadata.keywords || []).join(', '));
    } else if (isBatch) {
      setBatchEnabledFields({});
      setBatchForm({});
    }
  }, [singleItem?.filePath, singleItem?.modifiedAt, isBatch]);

  if (selectedItems.length === 0) {
    return (
      <aside className="w-96 bg-slate-900 border-l border-slate-800 p-6 flex flex-col items-center justify-center text-center select-none shrink-0">
        <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mb-3">
          <Layers className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Chưa chọn file Media</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Nhấp vào 1 file trong danh sách để xem và chỉnh sửa chi tiết Tag/Thumbnail, hoặc chọn nhiều file để chỉnh sửa hàng loạt (Batch Edit).
        </p>
      </aside>
    );
  }

  // CHẾ ĐỘ CHỈNH SỬA HÀNG LOẠT (BATCH EDIT)
  if (isBatch) {
    const toggleBatchField = (field: string) => {
      setBatchEnabledFields((prev) => ({ ...prev, [field]: !prev[field] }));
    };

    const handleBatchSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const payload: Partial<MediaMetadata> = {};
      for (const [key, enabled] of Object.entries(batchEnabledFields)) {
        if (enabled) {
          (payload as any)[key] = (batchForm as any)[key];
        }
      }
      if (Object.keys(payload).length === 0) return;
      await onSaveBatch(
        selectedItems.map((i) => i.filePath),
        payload
      );
    };

    return (
      <aside className="w-96 bg-slate-900 border-l border-slate-800 flex flex-col h-full shrink-0">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-100">
              Chỉnh sửa Hàng loạt ({selectedItems.length} file)
            </h2>
            <p className="text-[11px] text-slate-400">
              Tích chọn các trường bạn muốn áp dụng chung
            </p>
          </div>
        </div>

        <form onSubmit={handleBatchSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Thumbnail chung */}
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={!!batchEnabledFields.thumbnailDataUrl}
                onChange={() => toggleBatchField('thumbnailDataUrl')}
                className="rounded border-slate-600 text-indigo-600 bg-slate-900"
              />
              Ghi đè Thumbnail / Cover Art chung
            </label>
            {batchEnabledFields.thumbnailDataUrl && (
              <div className="flex items-center gap-3 pt-1">
                <div className="w-16 h-16 rounded-lg bg-slate-900 border border-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                  {batchForm.thumbnailDataUrl ? (
                    <img
                      src={batchForm.thumbnailDataUrl}
                      alt="Batch cover"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-slate-600" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const dataUrl = await onChooseLocalThumbnail();
                    if (dataUrl) {
                      setBatchForm((prev) => ({ ...prev, thumbnailDataUrl: dataUrl }));
                    }
                  }}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg border border-slate-700 transition"
                >
                  Chọn ảnh từ máy...
                </button>
              </div>
            )}
          </div>

          {[
            { key: 'artist', label: 'Nghệ sĩ / Đạo diễn / Tác giả', placeholder: 'Nhập tên nghệ sĩ hoặc đạo diễn...' },
            { key: 'album', label: 'Album / Tên Series Phim', placeholder: 'Nhập tên Album hoặc Series...' },
            { key: 'year', label: 'Năm phát hành', placeholder: 'Ví dụ: 2024', type: 'number' },
            { key: 'genre', label: 'Thể loại (Genre)', placeholder: 'Ví dụ: Pop, Action, Sci-Fi...' },
            { key: 'copyright', label: 'Bản quyền (Copyright)', placeholder: 'Nhập thông tin bản quyền...' },
            { key: 'comment', label: 'Ghi chú / Mô tả chung', placeholder: 'Nhập mô tả...' },
          ].map((field) => (
            <div key={field.key} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!batchEnabledFields[field.key]}
                  onChange={() => toggleBatchField(field.key)}
                  className="rounded border-slate-600 text-indigo-600 bg-slate-900"
                />
                {field.label}
              </label>
              {batchEnabledFields[field.key] && (
                <input
                  type={field.type || 'text'}
                  value={(batchForm as any)[field.key] || ''}
                  onChange={(e) =>
                    setBatchForm((prev) => ({
                      ...prev,
                      [field.key]:
                        field.type === 'number'
                          ? e.target.value
                            ? parseInt(e.target.value, 10)
                            : undefined
                          : e.target.value,
                    }))
                  }
                  placeholder={field.placeholder}
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={isSaving || Object.values(batchEnabledFields).every((v) => !v)}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow transition"
          >
            <Save className="w-4 h-4" />
            {isSaving
              ? 'Đang lưu hàng loạt...'
              : `Lưu cập nhật cho ${selectedItems.length} file`}
          </button>
        </form>
      </aside>
    );
  }

  // CHẾ ĐỘ CHỈNH SỬA 1 FILE ĐƠN LẺ
  if (!singleItem) return null;
  const scene = singleItem.sceneInfo;

  const handleApplySceneInfo = () => {
    if (!scene) return;
    setForm((prev) => ({
      ...prev,
      title: scene.isTvShow && scene.episodeTitle ? scene.episodeTitle : scene.cleanTitle,
      album: scene.isTvShow ? scene.cleanTitle : prev.album,
      year: scene.year ?? prev.year,
      seasonNumber: scene.season ?? prev.seasonNumber,
      trackNumber: scene.episode ?? prev.trackNumber,
      releaseGroup: scene.releaseGroup ?? prev.releaseGroup,
    }));
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const updatedMeta: MediaMetadata = {
      ...form,
      keywords: keywordsText
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    };
    await onSaveSingle(singleItem.filePath, updatedMeta);
  };

  return (
    <aside className="w-96 bg-slate-900 border-l border-slate-800 flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-100 truncate" title={singleItem.fileName}>
            {singleItem.fileName}
          </h2>
          <p className="text-[11px] text-slate-400 truncate" title={singleItem.directory}>
            {singleItem.directory}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenOnlineSearch(singleItem)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow shrink-0 transition"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Tìm Online
        </button>
      </div>

      <form onSubmit={handleSingleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Khu vực Thumbnail / Poster / Cover Art */}
        <div className="flex gap-3.5 items-center p-3 rounded-xl bg-slate-950/70 border border-slate-800">
          <div className="w-24 h-24 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0">
            {form.thumbnailDataUrl ? (
              <img
                src={form.thumbnailDataUrl}
                alt="Thumbnail"
                className="w-full h-full object-cover"
              />
            ) : singleItem.mediaType === 'audio' ? (
              <Music className="w-8 h-8 text-slate-600" />
            ) : singleItem.mediaType === 'video' ? (
              <Film className="w-8 h-8 text-slate-600" />
            ) : (
              <ImageIcon className="w-8 h-8 text-slate-600" />
            )}
          </div>
          <div className="space-y-1.5 flex-1">
            <div className="text-xs font-semibold text-slate-200">
              {singleItem.mediaType === 'audio'
                ? 'Ảnh bìa (Cover Art)'
                : singleItem.mediaType === 'video'
                ? 'Poster / Thumbnail Phim'
                : 'Xem trước Hình ảnh'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  const dataUrl = await onChooseLocalThumbnail();
                  if (dataUrl) {
                    setForm((prev) => ({ ...prev, thumbnailDataUrl: dataUrl }));
                  }
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded-lg border border-slate-700 transition"
              >
                <ImagePlus className="w-3.5 h-3.5 text-indigo-400" />
                Chọn ảnh
              </button>
              {form.thumbnailDataUrl && singleItem.mediaType !== 'image' && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, thumbnailDataUrl: undefined }))}
                  className="flex items-center gap-1 px-2 py-1.5 bg-slate-800 hover:bg-rose-950/70 text-slate-400 hover:text-rose-300 text-[11px] rounded-lg border border-slate-700 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-500">
              Hoặc bấm &ldquo;Tìm Online&rdquo; để tải ảnh bìa/poster chất lượng cao từ mạng.
            </p>
          </div>
        </div>

        {/* Hộp thông tin phân tích chuẩn nhóm Rip Scene/P2P (Dành cho File Phim) */}
        {singleItem.mediaType === 'video' && scene && (
          <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-700/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5">
                <Wand2 className="w-3.5 h-3.5" />
                Phân tích Cú pháp Nhóm Rip (Scene/P2P)
              </span>
              <button
                type="button"
                onClick={handleApplySceneInfo}
                className="px-2 py-1 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 text-[10px] font-semibold rounded border border-amber-500/40 transition"
              >
                Áp dụng vào Tag
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
              <div className="col-span-2 text-slate-300">
                Tên sạch: <strong className="text-white">{scene.cleanTitle}</strong>
                {scene.year ? ` (${scene.year})` : ''}
              </div>
              {scene.isTvShow && (
                <div className="col-span-2 text-purple-300">
                  Phim bộ: Mùa {scene.season ?? '?'} • Tập {scene.episode ?? '?'}
                  {scene.episodeTitle ? ` (${scene.episodeTitle})` : ''}
                </div>
              )}
              {scene.resolution && (
                <div className="text-slate-400">
                  Độ phân giải: <span className="text-slate-200">{scene.resolution}</span>
                </div>
              )}
              {scene.source && (
                <div className="text-slate-400">
                  Nguồn: <span className="text-slate-200">{scene.source}</span>
                </div>
              )}
              {scene.videoCodec && (
                <div className="text-slate-400">
                  Video:{' '}
                  <span className="text-slate-200">
                    {scene.videoCodec}
                    {scene.hdrFormat && scene.hdrFormat.length > 0
                      ? ` (${scene.hdrFormat.join(', ')})`
                      : ''}
                  </span>
                </div>
              )}
              {scene.audioCodec && (
                <div className="text-slate-400">
                  Audio:{' '}
                  <span className="text-slate-200">
                    {scene.audioCodec} {scene.audioChannels || ''}
                  </span>
                </div>
              )}
              {scene.releaseGroup && (
                <div className="text-slate-400">
                  Nhóm Rip: <span className="text-indigo-300 font-mono">{scene.releaseGroup}</span>
                </div>
              )}
              {scene.edition && scene.edition.length > 0 && (
                <div className="text-slate-400">
                  Bản dựng: <span className="text-amber-300">{scene.edition.join(', ')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Các trường Metadata */}
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              {singleItem.mediaType === 'video' && scene?.isTvShow
                ? 'Tiêu đề Tập phim (Title)'
                : 'Tiêu đề (Title)'}
            </label>
            <input
              type="text"
              value={form.title || ''}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Nhập tiêu đề bài hát, tên phim hoặc tiêu đề ảnh..."
              className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              {singleItem.mediaType === 'audio'
                ? 'Nghệ sĩ / Ca sĩ (Artist)'
                : singleItem.mediaType === 'video'
                ? 'Đạo diễn / Diễn viên (Director / Artist)'
                : 'Tác giả / Nhiếp ảnh gia (Author / Artist)'}
            </label>
            <input
              type="text"
              value={form.artist || ''}
              onChange={(e) => setForm({ ...form, artist: e.target.value })}
              placeholder="Nhập tên nghệ sĩ, đạo diễn hoặc tác giả..."
              className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {singleItem.mediaType !== 'image' && (
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                {singleItem.mediaType === 'audio'
                  ? 'Album'
                  : 'Tên Series Phim Bộ / Bộ sưu tập (Series / Collection)'}
              </label>
              <input
                type="text"
                value={form.album || ''}
                onChange={(e) => setForm({ ...form, album: e.target.value })}
                placeholder={
                  singleItem.mediaType === 'audio' ? 'Nhập tên Album...' : 'Nhập tên Series phim...'
                }
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Năm phát hành (Year)
              </label>
              <input
                type="number"
                value={form.year || ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    year: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  })
                }
                placeholder="2024"
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Thể loại (Genre)
              </label>
              <input
                type="text"
                value={form.genre || ''}
                onChange={(e) => setForm({ ...form, genre: e.target.value })}
                placeholder="Pop, Sci-Fi, Action..."
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {singleItem.mediaType !== 'image' && (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {singleItem.mediaType === 'audio' ? 'Track Số' : 'Tập phim (Episode)'}
                </label>
                <input
                  type="number"
                  value={form.trackNumber || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      trackNumber: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                  placeholder="1"
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {singleItem.mediaType === 'audio' ? 'Đĩa số (Disc)' : 'Mùa phim (Season)'}
                </label>
                <input
                  type="number"
                  value={form.seasonNumber || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      seasonNumber: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                  placeholder="1"
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          )}

          {/* Thông tin EXIF/GPS cho File Ảnh */}
          {singleItem.mediaType === 'image' && (
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2.5">
              <div className="text-[11px] font-semibold text-sky-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Thông tin Ảnh (EXIF / Tọa độ GPS / Từ khóa)
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">Vĩ độ (Latitude)</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={form.gpsLatitude ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        gpsLatitude: e.target.value ? parseFloat(e.target.value) : undefined,
                      })
                    }
                    placeholder="21.028511"
                    className="w-full px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">Kinh độ (Longitude)</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={form.gpsLongitude ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        gpsLongitude: e.target.value ? parseFloat(e.target.value) : undefined,
                      })
                    }
                    placeholder="105.804817"
                    className="w-full px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">
                  Từ khóa (Keywords - phân cách bằng dấu phẩy)
                </label>
                <input
                  type="text"
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="Hà Nội, Phong cảnh, Du lịch..."
                  className="w-full px-2.5 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-100"
                />
              </div>

              {(form.cameraModel || form.dateTaken) && (
                <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                  {form.cameraModel && <div>Thiết bị: {form.cameraModel}</div>}
                  {form.dateTaken && <div>Ngày chụp: {form.dateTaken}</div>}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              {singleItem.mediaType === 'video'
                ? 'Tóm tắt nội dung phim (Overview / Plot)'
                : 'Mô tả / Lời bình (Comment / Description)'}
            </label>
            <textarea
              rows={3}
              value={form.comment || ''}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              placeholder="Nhập tóm tắt nội dung phim hoặc ghi chú..."
              className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Bản quyền (Copyright)
            </label>
            <input
              type="text"
              value={form.copyright || ''}
              onChange={(e) => setForm({ ...form, copyright: e.target.value })}
              placeholder="© 2024..."
              className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Nút Lưu & Khôi phục */}
        <div className="pt-2 flex gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow transition"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Đang lưu...' : 'Lưu Tag vào File'}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm({ ...singleItem.metadata });
              setKeywordsText((singleItem.metadata.keywords || []).join(', '));
            }}
            title="Khôi phục lại giá trị ban đầu"
            className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </form>
    </aside>
  );
};
