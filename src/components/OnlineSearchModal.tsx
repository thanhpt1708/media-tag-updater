import React, { useEffect, useState } from 'react';
import {
  X,
  Search,
  Sparkles,
  Check,
  Loader2,
  ArrowRight,
  Terminal,
  Columns,
} from 'lucide-react';
import {
  AppConfig,
  MediaFileItem,
  MediaMetadata,
  OnlineMetadataResult,
  OnlineSearchLogEntry,
} from '../shared/types';
import { getMediaApi } from '../utils/ipcClient';

interface OnlineSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetItems: MediaFileItem[];
  onApplyUpdates: (
    updates: { filePath: string; metadata: Partial<MediaMetadata> }[]
  ) => Promise<void>;
}

interface BatchMatchRow {
  item: MediaFileItem;
  status: 'idle' | 'searching' | 'found' | 'not-found';
  results: OnlineMetadataResult[];
  selectedResult?: OnlineMetadataResult;
  includeInSave: boolean;
}

type DiffFieldKey =
  | 'thumbnail'
  | 'title'
  | 'artist'
  | 'album'
  | 'year'
  | 'genre'
  | 'seasonNumber'
  | 'trackNumber'
  | 'comment';

export const OnlineSearchModal: React.FC<OnlineSearchModalProps> = ({
  isOpen,
  onClose,
  targetItems,
  onApplyUpdates,
}) => {
  const isSingleMode = targetItems.length === 1;
  const singleItem = isSingleMode ? targetItems[0] : null;

  // State cho chế độ tìm 1 file
  const [query, setQuery] = useState('');
  const [artistFilter, setArtistFilter] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState('auto');
  const [isSearching, setIsSearching] = useState(false);
  const [singleResults, setSingleResults] = useState<OnlineMetadataResult[]>([]);
  const [selectedSingleResult, setSelectedSingleResult] = useState<OnlineMetadataResult | null>(
    null
  );
  const [selectedFields, setSelectedFields] = useState<Record<DiffFieldKey, boolean>>({
    thumbnail: true,
    title: true,
    artist: true,
    album: true,
    year: true,
    genre: true,
    seasonNumber: true,
    trackNumber: true,
    comment: true,
  });
  const [isApplying, setIsApplying] = useState(false);

  // State cho Debug Logs (Request / Response)
  const [searchLogs, setSearchLogs] = useState<OnlineSearchLogEntry[]>([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  // State cho chế độ Batch Auto-Tag nhiều file
  const [batchRows, setBatchRows] = useState<BatchMatchRow[]>([]);
  const [activeBatchRowIndex, setActiveBatchRowIndex] = useState<number>(0);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);

  const hasDiscogsKey = Boolean(appConfig?.discogsToken?.trim());
  const hasTmdbKey = Boolean(appConfig?.tmdbApiKey?.trim());
  const includeAdult = appConfig?.includeAdultContent !== false;
  const hasThePornDbKey = Boolean(appConfig?.theporndbApiKey?.trim()) && includeAdult;
  const hasStashBoxKey =
    Boolean(appConfig?.stashboxEndpoint?.trim() && appConfig?.stashboxApiKey?.trim()) &&
    includeAdult;

  const activeSourcesSummary = [
    'IMDb',
    hasTmdbKey ? 'TMDB' : null,
    'AniList',
    hasThePornDbKey ? 'ThePornDB' : null,
    hasStashBoxKey ? 'Stash-Box' : null,
    'iTunes',
    'Deezer',
    'MusicBrainz',
    hasDiscogsKey ? 'Discogs' : null,
    'TVMaze',
    'OpenStreetMap',
  ]
    .filter(Boolean)
    .join(', ');

  useEffect(() => {
    if (!isOpen) return;
    setSearchLogs([]);
    setSourceFilter('auto');
    void getMediaApi().getConfig().then(setAppConfig);

    if (singleItem) {
      const scene = singleItem.sceneInfo;
      const defaultQuery =
        scene?.javCode ||
        (scene?.isAdult && scene?.siteOrStudio
          ? [scene.siteOrStudio, scene.releaseDate, scene.cleanTitle].filter(Boolean).join(' ')
          : '') ||
        scene?.cleanTitle ||
        singleItem.metadata.title ||
        singleItem.fileName.replace(/\.[^.]+$/, '');
      setQuery(defaultQuery);
      setArtistFilter(singleItem.metadata.artist || '');
      setYearFilter(String(scene?.year || singleItem.metadata.year || ''));
      setSingleResults([]);
      setSelectedSingleResult(null);
      void triggerSingleSearch(
        defaultQuery,
        singleItem.metadata.artist || '',
        scene?.year || singleItem.metadata.year,
        'auto',
        singleItem
      );
    } else if (targetItems.length > 1) {
      const initialRows: BatchMatchRow[] = targetItems.map((item) => ({
        item,
        status: 'idle',
        results: [],
        includeInSave: false,
      }));
      setBatchRows(initialRows);
      setActiveBatchRowIndex(0);
    }
  }, [isOpen, singleItem?.filePath, targetItems.length]);

  // Khi người dùng chọn một kết quả khác, tự động bật tích chọn cho các trường mà kết quả mới có dữ liệu
  useEffect(() => {
    if (!selectedSingleResult) return;
    const m = selectedSingleResult.metadata;
    setSelectedFields({
      thumbnail: Boolean(selectedSingleResult.thumbnailUrl),
      title: m.title !== undefined && m.title !== '',
      artist: m.artist !== undefined && m.artist !== '',
      album: m.album !== undefined && m.album !== '',
      year: m.year !== undefined,
      genre: m.genre !== undefined && m.genre !== '',
      seasonNumber: m.seasonNumber !== undefined,
      trackNumber: m.trackNumber !== undefined,
      comment: m.comment !== undefined && m.comment !== '',
    });
  }, [selectedSingleResult]);

  const fetchAndPrintLogs = async (contextLabel: string) => {
    try {
      const api = getMediaApi();
      const logs = await api.getOnlineSearchLogs();
      setSearchLogs(logs);
      console.group(`[OnlineSearch] Request/Response Logs (${contextLabel})`);
      for (const entry of logs) {
        console.log(
          `[${entry.provider}] GET ${entry.url} -> HTTP ${entry.status ?? 'ERR'} (${
            entry.durationMs
          }ms) | Results: ${entry.resultCount}`,
          entry.error ? `| Error: ${entry.error}` : '',
          entry.responsePreview ? `\nResponse Preview: ${entry.responsePreview}` : ''
        );
      }
      console.groupEnd();
    } catch {
      // ignore
    }
  };

  const triggerSingleSearch = async (
    q: string,
    artist: string,
    yr: number | undefined,
    src: string,
    item: MediaFileItem
  ) => {
    setIsSearching(true);
    try {
      const api = getMediaApi();
      const reqPayload = {
        query: q,
        mediaType: item.mediaType,
        artist: artist || undefined,
        year: yr,
        season: item.sceneInfo?.season ?? item.metadata.seasonNumber,
        episode: item.sceneInfo?.episode ?? item.metadata.trackNumber,
        gpsLatitude: item.metadata.gpsLatitude,
        gpsLongitude: item.metadata.gpsLongitude,
        source: src,
      };
      console.log('[OnlineSearch] ⇢ Sending IPC searchOnlineMetadata:', reqPayload);

      const res = await api.searchOnlineMetadata(reqPayload);
      console.log(`[OnlineSearch] ⇠ Received ${res.length} parsed metadata results:`, res);
      await fetchAndPrintLogs(q);

      setSingleResults(res);
      if (res.length > 0) {
        setSelectedSingleResult(res[0]);
      } else {
        setSelectedSingleResult(null);
        setShowDebugLogs(true);
      }
    } catch (err) {
      console.error('Online search failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRunBatchAutoSearch = async () => {
    setIsBatchRunning(true);
    const api = getMediaApi();
    const accumulatedLogs: OnlineSearchLogEntry[] = [];

    for (let i = 0; i < batchRows.length; i++) {
      const row = batchRows[i];
      setBatchRows((prev) =>
        prev.map((r, idx) => (idx === i ? { ...r, status: 'searching' } : r))
      );

      try {
        const scene = row.item.sceneInfo;
        const q =
          scene?.javCode ||
          (scene?.isAdult && scene?.siteOrStudio
            ? [scene.siteOrStudio, scene.releaseDate, scene.cleanTitle].filter(Boolean).join(' ')
            : '') ||
          scene?.cleanTitle ||
          row.item.metadata.title ||
          row.item.fileName.replace(/\.[^.]+$/, '');

        const res = await api.searchOnlineMetadata({
          query: q,
          mediaType: row.item.mediaType,
          artist: row.item.metadata.artist,
          year: scene?.year || row.item.metadata.year,
          season: scene?.season ?? row.item.metadata.seasonNumber,
          episode: scene?.episode ?? row.item.metadata.trackNumber,
          gpsLatitude: row.item.metadata.gpsLatitude,
          gpsLongitude: row.item.metadata.gpsLongitude,
        });

        const itemLogs = await api.getOnlineSearchLogs();
        accumulatedLogs.push(...itemLogs);
        setSearchLogs([...accumulatedLogs]);

        setBatchRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: res.length > 0 ? 'found' : 'not-found',
                  results: res,
                  selectedResult: res[0],
                  includeInSave: res.length > 0,
                }
              : r
          )
        );
      } catch {
        setBatchRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: 'not-found' } : r))
        );
      }
    }

    setIsBatchRunning(false);
  };

  const handleApplySingleResult = async () => {
    if (!singleItem || !selectedSingleResult) return;
    setIsApplying(true);
    try {
      const api = getMediaApi();
      const m = selectedSingleResult.metadata;
      const merged: Partial<MediaMetadata> = {};

      if (selectedFields.title && m.title !== undefined) merged.title = m.title;
      if (selectedFields.artist && m.artist !== undefined) merged.artist = m.artist;
      if (selectedFields.album && m.album !== undefined) merged.album = m.album;
      if (selectedFields.year && m.year !== undefined) merged.year = m.year;
      if (selectedFields.genre && m.genre !== undefined) merged.genre = m.genre;
      if (selectedFields.seasonNumber && m.seasonNumber !== undefined) {
        merged.seasonNumber = m.seasonNumber;
      }
      if (selectedFields.trackNumber && m.trackNumber !== undefined) {
        merged.trackNumber = m.trackNumber;
      }
      if (selectedFields.comment && m.comment !== undefined) merged.comment = m.comment;

      if (selectedFields.thumbnail && selectedSingleResult.thumbnailUrl) {
        const downloaded = await api.fetchThumbnailAsDataUrl(selectedSingleResult.thumbnailUrl);
        if (downloaded) merged.thumbnailDataUrl = downloaded;
      }

      await onApplyUpdates([{ filePath: singleItem.filePath, metadata: merged }]);
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  const handleApplyBatchResults = async () => {
    const selectedRows = batchRows.filter((r) => r.includeInSave && r.selectedResult);
    if (selectedRows.length === 0) return;

    setIsApplying(true);
    try {
      const api = getMediaApi();
      const payload: { filePath: string; metadata: Partial<MediaMetadata> }[] = [];

      for (const row of selectedRows) {
        const res = row.selectedResult!;
        let thumbDataUrl = row.item.metadata.thumbnailDataUrl;
        if (res.thumbnailUrl) {
          const downloaded = await api.fetchThumbnailAsDataUrl(res.thumbnailUrl);
          if (downloaded) thumbDataUrl = downloaded;
        }
        payload.push({
          filePath: row.item.filePath,
          metadata: {
            ...res.metadata,
            thumbnailDataUrl: thumbDataUrl,
          },
        });
      }

      await onApplyUpdates(payload);
      onClose();
    } finally {
      setIsApplying(false);
    }
  };

  /**
   * Render Bảng So Sánh 2 Cột (Side-by-Side Diff Table) giữa File hiện tại và Kết quả Online
   */
  const renderSideBySideDiffTable = (
    currentItem: MediaFileItem,
    onlineResult: OnlineMetadataResult,
    interactiveCheckboxes: boolean
  ) => {
    const oldMeta = currentItem.metadata;
    const newMeta = onlineResult.metadata;

    const rows: {
      key: DiffFieldKey;
      label: string;
      oldVal?: string | number;
      newVal?: string | number;
      isMultiline?: boolean;
    }[] = [
      { key: 'title', label: 'Tiêu đề (Title)', oldVal: oldMeta.title, newVal: newMeta.title },
      {
        key: 'artist',
        label:
          currentItem.mediaType === 'video'
            ? 'Đạo diễn / Diễn viên'
            : currentItem.mediaType === 'audio'
            ? 'Nghệ sĩ / Ca sĩ'
            : 'Tác giả',
        oldVal: oldMeta.artist,
        newVal: newMeta.artist,
      },
      {
        key: 'album',
        label: currentItem.mediaType === 'video' ? 'Series / Bộ sưu tập' : 'Album',
        oldVal: oldMeta.album,
        newVal: newMeta.album,
      },
      { key: 'year', label: 'Năm phát hành', oldVal: oldMeta.year, newVal: newMeta.year },
      { key: 'genre', label: 'Thể loại (Genre)', oldVal: oldMeta.genre, newVal: newMeta.genre },
      {
        key: 'seasonNumber',
        label: currentItem.mediaType === 'video' ? 'Mùa (Season)' : 'Đĩa số (Disc)',
        oldVal: oldMeta.seasonNumber,
        newVal: newMeta.seasonNumber,
      },
      {
        key: 'trackNumber',
        label: currentItem.mediaType === 'video' ? 'Tập (Episode)' : 'Track số',
        oldVal: oldMeta.trackNumber,
        newVal: newMeta.trackNumber,
      },
      {
        key: 'comment',
        label: 'Mô tả / Tóm tắt (Plot)',
        oldVal: oldMeta.comment,
        newVal: newMeta.comment,
        isMultiline: true,
      },
    ];

    return (
      <div className="border border-slate-700/80 rounded-xl overflow-hidden bg-slate-900/90 shadow-lg">
        {/* Tiêu đề Bảng 3 Cột: Trường Tag | Bên Trái (Hiện tại) | Bên Phải (Mới từ Online) */}
        <div className="grid grid-cols-12 bg-slate-800/90 border-b border-slate-700 text-[11px] font-bold uppercase tracking-wider text-slate-300">
          <div className="col-span-3 px-3 py-2.5 border-r border-slate-700 flex items-center gap-1.5">
            <Columns className="w-3.5 h-3.5 text-indigo-400" />
            Trường Thông tin
          </div>
          <div className="col-span-4 px-3 py-2.5 border-r border-slate-700 text-slate-400">
            Đang có trong File (Cũ)
          </div>
          <div className="col-span-5 px-3 py-2.5 text-emerald-400 flex items-center justify-between">
            <span>Dữ liệu từ {onlineResult.sourceLabel} (Mới)</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
              Độ khớp {onlineResult.confidence}%
            </span>
          </div>
        </div>

        {/* Hàng 1: So sánh Thumbnail / Poster 2 bên */}
        <div className="grid grid-cols-12 border-b border-slate-800 items-center text-xs">
          <div className="col-span-3 px-3 py-3 border-r border-slate-800 flex items-center gap-2 font-medium text-slate-300 h-full">
            {interactiveCheckboxes && (
              <input
                type="checkbox"
                checked={selectedFields.thumbnail}
                disabled={!onlineResult.thumbnailUrl}
                onChange={() =>
                  setSelectedFields((prev) => ({ ...prev, thumbnail: !prev.thumbnail }))
                }
                className="rounded border-slate-600 text-indigo-600 bg-slate-950"
              />
            )}
            <span>Thumbnail / Poster</span>
          </div>

          {/* Cột Trái: Thumbnail Cũ */}
          <div className="col-span-4 px-3 py-3 border-r border-slate-800 flex items-center gap-3 bg-slate-950/30 h-full">
            <div className="w-16 h-20 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0">
              {oldMeta.thumbnailDataUrl ? (
                <img
                  src={oldMeta.thumbnailDataUrl}
                  alt="Old Thumbnail"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-[10px] text-slate-600 text-center px-1">Chưa có ảnh</span>
              )}
            </div>
            <div className="text-[11px] text-slate-500">
              {oldMeta.thumbnailDataUrl ? 'Ảnh hiện tại' : 'Trống'}
            </div>
          </div>

          {/* Cột Phải: Thumbnail Mới */}
          <div
            className={`col-span-5 px-3 py-3 flex items-center gap-3 h-full ${
              onlineResult.thumbnailUrl ? 'bg-emerald-950/15' : 'bg-slate-950/30'
            }`}
          >
            <div className="w-16 h-20 rounded-lg bg-slate-950 border border-indigo-500/40 overflow-hidden flex items-center justify-center shrink-0">
              {onlineResult.thumbnailUrl ? (
                <img
                  src={onlineResult.thumbnailUrl}
                  alt="New Thumbnail"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-[10px] text-slate-600 text-center px-1">Không có</span>
              )}
            </div>
            <div className="space-y-1">
              {onlineResult.thumbnailUrl ? (
                <>
                  <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Cập nhật Poster mới
                  </span>
                  <div className="text-[10px] text-slate-400">Độ phân giải cao (HD)</div>
                </>
              ) : (
                <span className="text-[11px] text-slate-500">Giữ nguyên ảnh cũ</span>
              )}
            </div>
          </div>
        </div>

        {/* Các hàng so sánh từng trường Tag bên trái vs bên phải */}
        <div className="divide-y divide-slate-800/80">
          {rows.map((row) => {
            const oldStr = row.oldVal !== undefined && row.oldVal !== '' ? String(row.oldVal) : '';
            const newStr = row.newVal !== undefined && row.newVal !== '' ? String(row.newVal) : '';
            const hasNewValue = newStr.length > 0;
            const isDifferent = hasNewValue && oldStr !== newStr;
            const isAdded = !oldStr && hasNewValue;

            return (
              <div
                key={row.key}
                className={`grid grid-cols-12 text-xs transition ${
                  !hasNewValue ? 'opacity-60' : ''
                }`}
              >
                {/* Cột 1: Tên trường + Checkbox */}
                <div className="col-span-3 px-3 py-2.5 border-r border-slate-800 flex items-start gap-2 font-medium text-slate-300 bg-slate-900/60">
                  {interactiveCheckboxes && (
                    <input
                      type="checkbox"
                      checked={selectedFields[row.key]}
                      disabled={!hasNewValue}
                      onChange={() =>
                        setSelectedFields((prev) => ({
                          ...prev,
                          [row.key]: !prev[row.key],
                        }))
                      }
                      className="mt-0.5 rounded border-slate-600 text-indigo-600 bg-slate-950"
                    />
                  )}
                  <span className="leading-snug">{row.label}</span>
                </div>

                {/* Cột 2 (Bên Trái): Giá trị hiện tại trong File */}
                <div
                  className={`col-span-4 px-3 py-2.5 border-r border-slate-800 break-words leading-relaxed ${
                    isDifferent && oldStr
                      ? 'bg-rose-950/15 text-rose-200/90 line-through decoration-rose-500/50'
                      : 'bg-slate-950/30 text-slate-400'
                  }`}
                >
                  {oldStr ? (
                    <div className={row.isMultiline ? 'max-h-28 overflow-y-auto pr-1' : ''}>
                      {oldStr}
                    </div>
                  ) : (
                    <span className="italic text-slate-600 text-[11px]">(Trống)</span>
                  )}
                </div>

                {/* Cột 3 (Bên Phải): Giá trị mới từ Online */}
                <div
                  className={`col-span-5 px-3 py-2.5 break-words leading-relaxed ${
                    isDifferent
                      ? 'bg-emerald-950/20 text-emerald-200 font-medium'
                      : 'bg-slate-950/30 text-slate-400'
                  }`}
                >
                  {hasNewValue ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                            isAdded
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : isDifferent
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {isAdded ? '+ Thêm mới' : isDifferent ? '↻ Thay đổi' : '= Giống nhau'}
                        </span>
                      </div>
                      <div
                        className={
                          row.isMultiline
                            ? 'max-h-32 overflow-y-auto pr-1 text-[11.5px] text-slate-100 font-normal leading-relaxed'
                            : 'text-emerald-200'
                        }
                      >
                        {newStr}
                      </div>
                    </div>
                  ) : (
                    <span className="italic text-slate-600 text-[11px]">
                      (Không có dữ liệu mới — Giữ nguyên)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                {isSingleMode
                  ? `Tra cứu & So sánh Tag Trực tuyến: ${singleItem?.fileName}`
                  : `Tự động Dò tìm & So sánh Tag Hàng loạt (${targetItems.length} file)`}
              </h2>
              <p className="text-[11px] text-slate-400">
                Nguồn đang kích hoạt: {activeSourcesSummary}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDebugLogs((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                showDebugLogs
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              Log Request/Response ({searchLogs.length})
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Khung hiển thị Log Request / Response trực tiếp */}
        {showDebugLogs && (
          <div className="bg-slate-950 border-b border-slate-800 p-3 max-h-44 overflow-y-auto font-mono text-[11px] space-y-1.5">
            <div className="text-slate-400 font-sans text-xs font-semibold flex items-center justify-between">
              <span>
                Nhật ký HTTP Request / Response (Cũng được in trực tiếp tại Terminal chạy npm run dev)
              </span>
              <button
                type="button"
                onClick={() => setShowDebugLogs(false)}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                Ẩn Log
              </button>
            </div>
            {searchLogs.length === 0 ? (
              <div className="text-slate-500">Chưa có request nào được ghi nhận.</div>
            ) : (
              searchLogs.map((log, i) => (
                <div
                  key={`${log.timestamp}-${i}`}
                  className="p-2 rounded bg-slate-900/90 border border-slate-800 space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-indigo-300 font-semibold">
                      [{log.provider}] GET {log.url}
                    </span>
                    <span
                      className={`shrink-0 px-1.5 py-0.2 rounded text-[10px] ${
                        log.status && log.status >= 200 && log.status < 300
                          ? 'bg-emerald-950 text-emerald-300'
                          : 'bg-rose-950 text-rose-300'
                      }`}
                    >
                      {log.status ? `HTTP ${log.status}` : 'ERROR'} • {log.durationMs}ms • Kết quả:{' '}
                      {log.resultCount}
                    </span>
                  </div>
                  {log.error && <div className="text-rose-400">Lỗi: {log.error}</div>}
                  {log.responsePreview && (
                    <div className="text-slate-400 break-all">Response: {log.responsePreview}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Nội dung cho chế độ 1 File */}
        {isSingleMode && singleItem ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Thanh tìm kiếm */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void triggerSingleSearch(
                  query,
                  artistFilter,
                  yearFilter ? parseInt(yearFilter, 10) : undefined,
                  sourceFilter,
                  singleItem
                );
              }}
              className="p-4 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center gap-2.5"
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nhập tên phim, bài hát, mã JAV (SONE-123), OnlyFans Creator, hoặc mã IMDb (tt15398776)..."
                className="flex-1 min-w-[220px] px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              {singleItem.mediaType === 'audio' && (
                <input
                  type="text"
                  value={artistFilter}
                  onChange={(e) => setArtistFilter(e.target.value)}
                  placeholder="Ca sĩ / Nghệ sĩ (Tùy chọn)"
                  className="w-44 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              )}
              {singleItem.mediaType !== 'image' && (
                <input
                  type="number"
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value)}
                  placeholder="Năm"
                  className="w-24 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              )}
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-200"
              >
                <option value="auto">Tất cả nguồn đang kích hoạt</option>
                {singleItem.mediaType === 'audio' && (
                  <>
                    <option value="itunes">iTunes Music</option>
                    <option value="deezer">Deezer Music</option>
                    <option value="musicbrainz">MusicBrainz</option>
                    {hasDiscogsKey && <option value="discogs">Discogs</option>}
                  </>
                )}
                {singleItem.mediaType === 'video' && (
                  <>
                    <option value="imdb">IMDb (Movies & TV)</option>
                    {hasTmdbKey && <option value="tmdb">TMDB (Movies, TV & 18+)</option>}
                    <option value="anilist">
                      {includeAdult ? 'AniList (Anime & 18+ Hentai)' : 'AniList (Anime)'}
                    </option>
                    <option value="itunes">iTunes Movies</option>
                    <option value="tvmaze">TVMaze (Phim bộ)</option>
                    {hasThePornDbKey && (
                      <option value="theporndb">ThePornDB (18+ Scenes, OnlyFans, JAV)</option>
                    )}
                    {hasStashBoxKey && (
                      <option value="stashbox">Stash-Box (FansDB / StashDB / JAVStash)</option>
                    )}
                  </>
                )}
              </select>
              <button
                type="submit"
                disabled={isSearching}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Tìm kiếm
              </button>

              {/* Hiển thị thông tin bóc tách tự động từ tên file (JAV Code / OnlyFans / Studio / Ngày phát hành) */}
              {(singleItem.sceneInfo?.javCode ||
                singleItem.sceneInfo?.siteOrStudio ||
                singleItem.sceneInfo?.releaseDate ||
                singleItem.sceneInfo?.isAdult) && (
                <div className="w-full pt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-slate-400">Nhận diện tự động từ tên file:</span>
                  {singleItem.sceneInfo?.javCode && (
                    <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-mono font-semibold">
                      Mã JAV: {singleItem.sceneInfo.javCode}
                    </span>
                  )}
                  {singleItem.sceneInfo?.siteOrStudio && (
                    <span className="px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 font-medium">
                      Studio / Creator: {singleItem.sceneInfo.siteOrStudio}
                    </span>
                  )}
                  {singleItem.sceneInfo?.releaseDate && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                      Ngày phát hành: {singleItem.sceneInfo.releaseDate}
                    </span>
                  )}
                  {singleItem.sceneInfo?.isAdult && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-600/30 text-rose-200 border border-rose-500/40 font-bold text-[10px]">
                      18+ / NSFW
                    </span>
                  )}
                </div>
              )}
            </form>

            {/* Khu vực kết quả (4 phần) + Bảng So sánh 2 bên Preview Diff (8 phần) */}
            <div className="flex-1 grid grid-cols-12 overflow-hidden">
              {/* Cột danh sách kết quả tìm được */}
              <div className="col-span-4 border-r border-slate-800 overflow-y-auto divide-y divide-slate-800/70">
                {isSearching ? (
                  <div className="p-12 flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                    Đang tra cứu dữ liệu từ các nguồn uy tín...
                  </div>
                ) : singleResults.length === 0 ? (
                  <div className="p-12 text-center text-xs text-slate-400 space-y-2">
                    <div>Không tìm thấy kết quả nào cho từ khóa hiện tại.</div>
                    <div className="text-[11px] text-slate-500">
                      Hãy kiểm tra bảng <strong>Log Request/Response</strong> ở phía trên hoặc rút gọn từ khóa tìm kiếm.
                    </div>
                  </div>
                ) : (
                  singleResults.map((r) => {
                    const isSelected = selectedSingleResult?.id === r.id;
                    return (
                      <div
                        key={r.id}
                        onClick={() => setSelectedSingleResult(r)}
                        className={`p-3 flex items-center gap-3 cursor-pointer transition ${
                          isSelected
                            ? 'bg-indigo-950/60 border-l-2 border-l-indigo-400'
                            : 'hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="w-11 h-14 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                          {r.thumbnailUrl ? (
                            <img
                              src={r.thumbnailUrl}
                              alt={r.metadata.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Sparkles className="w-4 h-4 text-slate-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                              {r.sourceLabel}
                            </span>
                            <span className="text-xs font-semibold text-slate-100 truncate">
                              {r.metadata.title}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            {r.metadata.artist ? `${r.metadata.artist} • ` : ''}
                            {r.extraInfo}
                          </div>
                          {r.metadata.comment && (
                            <div className="text-[10px] text-slate-500 truncate mt-0.5">
                              {r.metadata.comment}
                            </div>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-emerald-400 shrink-0">
                          {r.confidence}%
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Khu vực Bảng Đối Chiếu 2 Cột (Side-by-Side Preview Diff) */}
              <div className="col-span-8 p-4 overflow-y-auto bg-slate-950/50">
                {selectedSingleResult ? (
                  renderSideBySideDiffTable(singleItem, selectedSingleResult, true)
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-500">
                    Chọn một kết quả bên trái để xem bảng so sánh chi tiết 2 bên (Hiện tại vs Mới).
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-slate-800 flex items-center justify-between bg-slate-900">
              <div className="text-[11px] text-slate-400">
                💡 Bạn có thể tích chọn hoặc bỏ chọn từng dòng trong bảng so sánh trước khi bấm Lưu.
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                >
                  Đóng
                </button>
                <button
                  onClick={handleApplySingleResult}
                  disabled={!selectedSingleResult || isApplying}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow transition"
                >
                  {isApplying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Áp dụng các trường đã chọn & Lưu vào File
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Nội dung cho chế độ Batch Auto-Tag nhiều file (cũng có bảng so sánh 2 bên!) */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between">
              <div className="text-xs text-slate-300">
                Hệ thống tự động phân tích tên file (chuẩn nhóm Rip Scene/P2P) và dò tìm Tag + Poster. Nhấp vào từng file để xem bảng so sánh 2 bên.
              </div>
              <button
                onClick={handleRunBatchAutoSearch}
                disabled={isBatchRunning}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow transition"
              >
                {isBatchRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {isBatchRunning ? 'Đang tự động dò tìm...' : 'Bắt đầu Dò tìm Hàng loạt'}
              </button>
            </div>

            <div className="flex-1 grid grid-cols-12 overflow-hidden">
              {/* Cột trái: Danh sách các file trong Batch */}
              <div className="col-span-5 border-r border-slate-800 overflow-y-auto divide-y divide-slate-800">
                {batchRows.map((row, idx) => {
                  const isFocused = activeBatchRowIndex === idx;
                  return (
                    <div
                      key={row.item.filePath}
                      onClick={() => setActiveBatchRowIndex(idx)}
                      className={`p-3 flex items-center gap-3 text-xs cursor-pointer transition ${
                        isFocused
                          ? 'bg-indigo-950/50 border-l-2 border-l-indigo-400'
                          : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={row.includeInSave}
                        disabled={!row.selectedResult}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() =>
                          setBatchRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, includeInSave: !r.includeInSave } : r
                            )
                          )
                        }
                        className="rounded border-slate-600 text-indigo-600 bg-slate-900"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-200 truncate" title={row.item.fileName}>
                          {row.item.fileName}
                        </div>
                        <div className="mt-1">
                          {row.status === 'idle' && (
                            <span className="text-[11px] text-slate-500">Chưa tra cứu</span>
                          )}
                          {row.status === 'searching' && (
                            <span className="flex items-center gap-1.5 text-[11px] text-indigo-400">
                              <Loader2 className="w-3 h-3 animate-spin" /> Đang tìm trên mạng...
                            </span>
                          )}
                          {row.status === 'not-found' && (
                            <span className="text-[11px] text-rose-400">Không tìm thấy kết quả</span>
                          )}
                          {row.status === 'found' && row.selectedResult && (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                                <ArrowRight className="w-3 h-3 shrink-0" />
                                <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-[10px]">
                                  {row.selectedResult.sourceLabel}
                                </span>
                                <strong className="truncate">
                                  {row.selectedResult.metadata.title}
                                </strong>
                              </div>

                              {row.results.length > 1 && (
                                <select
                                  value={row.selectedResult.id}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    const found = row.results.find((x) => x.id === e.target.value);
                                    if (found) {
                                      setBatchRows((prev) =>
                                        prev.map((r, i) =>
                                          i === idx ? { ...r, selectedResult: found } : r
                                        )
                                      );
                                    }
                                  }}
                                  className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-[11px] text-slate-300"
                                >
                                  {row.results.map((opt) => (
                                    <option key={opt.id} value={opt.id}>
                                      [{opt.sourceLabel}] {opt.metadata.title} ({opt.metadata.year || '?'})
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Cột phải: Bảng so sánh 2 bên của file đang chọn trong Batch */}
              <div className="col-span-7 p-4 overflow-y-auto bg-slate-950/50">
                {batchRows[activeBatchRowIndex]?.selectedResult ? (
                  renderSideBySideDiffTable(
                    batchRows[activeBatchRowIndex].item,
                    batchRows[activeBatchRowIndex].selectedResult!,
                    false
                  )
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-500">
                    Nhấn &ldquo;Bắt đầu Dò tìm Hàng loạt&rdquo; và chọn 1 file bên trái để xem bảng so sánh 2 bên (Cũ vs Mới).
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-3.5 border-t border-slate-800 flex items-center justify-between bg-slate-900">
              <div className="text-xs text-slate-400">
                Đã chọn áp dụng:{' '}
                <strong className="text-indigo-400">
                  {batchRows.filter((r) => r.includeInSave && r.selectedResult).length}
                </strong>{' '}
                / {batchRows.length} file
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                >
                  Hủy
                </button>
                <button
                  onClick={handleApplyBatchResults}
                  disabled={
                    isApplying ||
                    batchRows.filter((r) => r.includeInSave && r.selectedResult).length === 0
                  }
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow transition"
                >
                  {isApplying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Lưu Tag & Thumbnail cho các file đã chọn
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
