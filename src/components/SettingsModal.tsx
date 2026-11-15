import React, { useEffect, useState } from 'react';
import {
  X,
  Settings,
  Key,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Download,
  FolderOpen,
  RefreshCw,
  Save,
  Loader2,
} from 'lucide-react';
import { AppConfig, BinaryStatusInfo } from '../shared/types';
import { getMediaApi } from '../utils/ipcClient';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'api' | 'binaries'>('api');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatusInfo | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isInstallingBin, setIsInstallingBin] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStatusMessage(null);
    const api = getMediaApi();
    void api.getConfig().then(setConfig);
    void api.getBinaryStatus().then(setBinaryStatus);
  }, [isOpen]);

  if (!isOpen || !config) return null;

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const api = getMediaApi();
      const normalizedConfig: AppConfig = { ...config };
      if (
        normalizedConfig.preferredAudioSource === 'discogs' &&
        !normalizedConfig.discogsToken?.trim()
      ) {
        normalizedConfig.preferredAudioSource = 'auto';
      }
      if (
        (normalizedConfig.preferredVideoSource === 'tmdb' &&
          !normalizedConfig.tmdbApiKey?.trim()) ||
        (normalizedConfig.preferredVideoSource === 'theporndb' &&
          !normalizedConfig.theporndbApiKey?.trim()) ||
        (normalizedConfig.preferredVideoSource === 'stashbox' &&
          (!normalizedConfig.stashboxEndpoint?.trim() ||
            !normalizedConfig.stashboxApiKey?.trim()))
      ) {
        normalizedConfig.preferredVideoSource = 'auto';
      }
      const updated = await api.saveConfig(normalizedConfig);
      setConfig(updated);
      const binStat = await api.getBinaryStatus();
      setBinaryStatus(binStat);
      setStatusMessage('Đã lưu cấu hình thành công!');
    } finally {
      setIsSaving(false);
    }
  };

  const handleInstallBinaries = async () => {
    setIsInstallingBin(true);
    setStatusMessage('Đang thiết lập ffmpeg.exe và tải exiftool.exe vào thư mục ./bin...');
    try {
      const api = getMediaApi();
      const res = await api.installBinariesToProject();
      setBinaryStatus(res.status);
      setStatusMessage(res.message);
    } catch (err: any) {
      setStatusMessage(`Lỗi khi cài đặt binary: ${err?.message || 'Không xác định'}`);
    } finally {
      setIsInstallingBin(false);
    }
  };

  const handleRefreshBinaries = async () => {
    const api = getMediaApi();
    const stat = await api.getBinaryStatus();
    setBinaryStatus(stat);
    setStatusMessage('Đã cập nhật trạng thái công cụ Binary.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
              <Settings className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                Cài đặt Nguồn Tra cứu Trực tuyến & Công cụ Binary (./bin)
              </h2>
              <p className="text-[11px] text-slate-400">
                Tùy chỉnh ngôn ngữ, khóa API nâng cao và kiểm tra FFmpeg / ExifTool đi kèm dự án
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

        {/* Tabs */}
        <div className="px-6 pt-3 bg-slate-950/60 border-b border-slate-800 flex gap-2">
          <button
            onClick={() => setActiveTab('api')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 transition flex items-center gap-2 ${
              activeTab === 'api'
                ? 'border-indigo-400 text-indigo-300 bg-slate-900/80'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            1. Nguồn Metadata & API Keys
          </button>
          <button
            onClick={() => setActiveTab('binaries')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 transition flex items-center gap-2 ${
              activeTab === 'binaries'
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/80'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            2. Công cụ Binary Kèm Trong Project (./bin)
          </button>
        </div>

        <form onSubmit={handleSaveConfig} className="flex-1 overflow-y-auto p-6 space-y-5">
          {statusMessage && (
            <div className="p-3 rounded-lg bg-indigo-950/60 border border-indigo-500/40 text-xs text-indigo-200">
              {statusMessage}
            </div>
          )}

          {activeTab === 'api' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Ngôn ngữ ưu tiên khi tra cứu Phim / Địa danh
                  </label>
                  <select
                    value={config.language}
                    onChange={(e) =>
                      setConfig({ ...config, language: e.target.value as 'vi-VN' | 'en-US' })
                    }
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100"
                  >
                    <option value="vi-VN">Tiếng Việt (vi-VN)</option>
                    <option value="en-US">Tiếng Anh (en-US)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Nguồn Nhạc ưu tiên
                  </label>
                  <select
                    value={config.preferredAudioSource}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        preferredAudioSource: e.target.value as AppConfig['preferredAudioSource'],
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100"
                  >
                    <option value="auto">Tự động kết hợp các nguồn đang kích hoạt</option>
                    <option value="itunes">iTunes Search API (Nhanh, Ảnh bìa 1000x1000)</option>
                    <option value="deezer">Deezer Music API (Không cần Key, Ảnh bìa 1000x1000)</option>
                    <option value="musicbrainz">MusicBrainz + Cover Art Archive</option>
                    {Boolean(config.discogsToken?.trim()) && (
                      <option value="discogs">Discogs</option>
                    )}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Nguồn Phim / Video / Anime / 18+ / Creator ưu tiên
                  </label>
                  <select
                    value={config.preferredVideoSource}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        preferredVideoSource: e.target.value as AppConfig['preferredVideoSource'],
                      })
                    }
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-100"
                  >
                    <option value="auto">
                      Tự động kết hợp các nguồn đang kích hoạt
                    </option>
                    <option value="imdb">IMDb (Movies & TV - Không cần API Key)</option>
                    {Boolean(config.tmdbApiKey?.trim()) && (
                      <option value="tmdb">TMDB (The Movie Database)</option>
                    )}
                    <option value="anilist">AniList GraphQL (Anime & 18+ Hentai/OVA - Không cần Key)</option>
                    <option value="itunes">iTunes Movies</option>
                    <option value="tvmaze">TVMaze (Chuyên Phim Bộ)</option>
                    {Boolean(config.theporndbApiKey?.trim()) &&
                      config.includeAdultContent !== false && (
                        <option value="theporndb">
                          ThePornDB (18+ Scenes, OnlyFans/Creators, JAV, Movies)
                        </option>
                      )}
                    {Boolean(
                      config.stashboxEndpoint?.trim() && config.stashboxApiKey?.trim()
                    ) &&
                      config.includeAdultContent !== false && (
                        <option value="stashbox">
                          Stash-Box GraphQL (FansDB OnlyFans / StashDB / JAVStash)
                        </option>
                      )}
                  </select>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-500/30 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-rose-300">
                    Cho phép tra cứu nội dung 18+ / NSFW (Adult / OnlyFans / JAV / Hentai)
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Khi bật: Mở khóa <code className="text-rose-300">include_adult=true</code> trên TMDB, bật tìm Hentai 18+ trên AniList, và kích hoạt tra cứu ThePornDB / Stash-Box (FansDB, StashDB, JAVStash).
                  </p>
                </div>
                <label className="inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={config.includeAdultContent !== false}
                    onChange={(e) =>
                      setConfig({ ...config, includeAdultContent: e.target.checked })
                    }
                    className="w-4 h-4 rounded border-slate-600 text-rose-600 bg-slate-950"
                  />
                </label>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="text-xs font-semibold text-indigo-300">
                  1. Cấu hình API Key Phim & Nhạc Chính thống (Tùy chọn)
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Mặc định ứng dụng đã hoạt động ngay với <strong>IMDb</strong>, <strong>AniList</strong>, <strong>iTunes</strong>, <strong>Deezer</strong>, <strong>MusicBrainz</strong>, <strong>TVMaze</strong> và <strong>OpenStreetMap</strong> mà không cần khóa.
                </p>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    TMDB API Key (v3) hoặc Read Access Token (v4) — Tra cứu Phim Lẻ, Phim Bộ & Phim 18+ TMDB
                  </label>
                  <input
                    type="password"
                    value={config.tmdbApiKey}
                    onChange={(e) => setConfig({ ...config, tmdbApiKey: e.target.value })}
                    placeholder="Nhập TMDB API Key (từ themoviedb.org/settings/api)..."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Discogs Personal Access Token (Nhạc)
                    </label>
                    <input
                      type="password"
                      value={config.discogsToken}
                      onChange={(e) => setConfig({ ...config, discogsToken: e.target.value })}
                      placeholder="Nhập Discogs Token..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Last.fm API Key (Nhạc)
                    </label>
                    <input
                      type="password"
                      value={config.lastfmApiKey}
                      onChange={(e) => setConfig({ ...config, lastfmApiKey: e.target.value })}
                      placeholder="Nhập Last.fm API Key..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/60 border border-rose-500/25 space-y-3">
                <div className="text-xs font-semibold text-rose-300">
                  2. Nguồn Chuyên Biệt 18+ / OnlyFans / Fansly / JAV (ThePornDB & Stash-Box)
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Hỗ trợ tự động bóc tách mã JAV (<code className="text-rose-300">SONE-123</code>, <code className="text-rose-300">FC2-PPV-...</code>) và định dạng ngày phát hành OnlyFans/Scene (<code className="text-rose-300">OnlyFans.24.09.15.Creator...</code>) để lấy đúng tên Scene, Performer, Studio và Poster HD.
                </p>

                <div>
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    ThePornDB API Token (theporndb.net) — Tra cứu Scenes Âu Mỹ, OnlyFans/Creators, JAV & Movies
                  </label>
                  <input
                    type="password"
                    value={config.theporndbApiKey || ''}
                    onChange={(e) => setConfig({ ...config, theporndbApiKey: e.target.value })}
                    placeholder="Nhập API Bearer Token từ theporndb.net (Miễn phí đăng ký tài khoản)..."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                  />
                </div>

                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-7">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-slate-300">
                        Stash-Box GraphQL Endpoint (FansDB / StashDB / JAVStash)
                      </label>
                      <div className="flex items-center gap-1">
                        {[
                          { label: 'FansDB (OF)', url: 'https://fansdb.cc/graphql' },
                          { label: 'StashDB', url: 'https://stashdb.org/graphql' },
                          { label: 'JAVStash', url: 'https://javstash.org/graphql' },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() =>
                              setConfig({ ...config, stashboxEndpoint: preset.url })
                            }
                            className={`px-1.5 py-0.5 rounded text-[10px] border transition ${
                              config.stashboxEndpoint === preset.url
                                ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="text"
                      value={config.stashboxEndpoint || ''}
                      onChange={(e) => setConfig({ ...config, stashboxEndpoint: e.target.value })}
                      placeholder="https://fansdb.cc/graphql"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                    />
                  </div>
                  <div className="col-span-5">
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Stash-Box API Key
                    </label>
                    <input
                      type="password"
                      value={config.stashboxApiKey || ''}
                      onChange={(e) => setConfig({ ...config, stashboxApiKey: e.target.value })}
                      placeholder="Nhập API Key của FansDB / StashDB..."
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* TAB 2: QUẢN LÝ BINARY TRONG THƯ MỤC ./bin */
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-100">
                      Trạng thái Binary trong Project ({binaryStatus?.projectBinDir || './bin'})
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Hỗ trợ cài đặt trực tiếp <code className="text-indigo-300">ffmpeg.exe</code> và{' '}
                      <code className="text-indigo-300">exiftool.exe</code> vào thư mục <code className="text-indigo-300">./bin</code> của project.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleRefreshBinaries}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Kiểm tra lại
                    </button>
                    {binaryStatus?.projectBinDir && (
                      <button
                        type="button"
                        onClick={() =>
                          getMediaApi().openPathInExplorer(binaryStatus.projectBinDir)
                        }
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                        Mở thư mục ./bin
                      </button>
                    )}
                  </div>
                </div>

                {/* Trạng thái FFmpeg & ExifTool */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">FFmpeg (Xử lý Video)</span>
                      {binaryStatus?.ffmpegAvailable ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Sẵn sàng ({binaryStatus.ffmpegSource})
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-amber-400">
                          <AlertCircle className="w-3.5 h-3.5" /> Chưa có trong ./bin
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate" title={binaryStatus?.ffmpegPath}>
                      {binaryStatus?.ffmpegPath || 'Đang dùng TagLib tích hợp'}
                    </div>
                    {binaryStatus?.ffmpegVersion && (
                      <div className="text-[10px] text-slate-500 truncate">
                        {binaryStatus.ffmpegVersion}
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">FFprobe (Phân tích iPhone/iOS)</span>
                      {binaryStatus?.ffprobeAvailable ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Sẵn sàng ({binaryStatus.ffprobeSource})
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-amber-400">
                          <AlertCircle className="w-3.5 h-3.5" /> Chưa có
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate" title={binaryStatus?.ffprobePath}>
                      {binaryStatus?.ffprobePath ||
                        'Đặt ffprobe.exe cạnh ffmpeg.exe (./bin) để bật badge & Encode cho iPhone'}
                    </div>
                    {binaryStatus?.ffprobeVersion && (
                      <div className="text-[10px] text-slate-500 truncate">
                        {binaryStatus.ffprobeVersion}
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">ExifTool (Xử lý Ảnh nâng cao)</span>
                      {binaryStatus?.exiftoolAvailable ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Sẵn sàng ({binaryStatus.exiftoolSource})
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-amber-400">
                          <AlertCircle className="w-3.5 h-3.5" /> Đang dùng piexifjs
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate" title={binaryStatus?.exiftoolPath}>
                      {binaryStatus?.exiftoolPath || 'Chưa đặt exiftool.exe trong ./bin'}
                    </div>
                    {binaryStatus?.exiftoolVersion && (
                      <div className="text-[10px] text-slate-500 truncate">
                        {binaryStatus.exiftoolVersion}
                      </div>
                    )}
                  </div>
                </div>

                {/* Nút cài tự động vào ./bin */}
                <button
                  type="button"
                  onClick={handleInstallBinaries}
                  disabled={isInstallingBin}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow transition"
                >
                  {isInstallingBin ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {isInstallingBin
                    ? 'Đang cài đặt vào thư mục ./bin...'
                    : 'Tự động Tải & Cài đặt ffmpeg.exe + exiftool.exe vào ./bin'}
                </button>
              </div>

              {/* Tuỳ chọn trỏ đường dẫn thủ công */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="text-xs font-semibold text-slate-200">
                  Cấu hình Đường dẫn Binary Thủ công (Tùy chọn)
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Đường dẫn tới <code className="text-slate-200">ffmpeg.exe</code> (Để trống nếu dùng mặc định trong <code className="text-slate-200">./bin/ffmpeg.exe</code>)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={config.customFfmpegPath}
                      onChange={(e) => setConfig({ ...config, customFfmpegPath: e.target.value })}
                      placeholder="./bin/ffmpeg.exe"
                      className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const chosen = await getMediaApi().selectBinaryFile('Chọn file ffmpeg.exe');
                        if (chosen) setConfig({ ...config, customFfmpegPath: chosen });
                      }}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg border border-slate-700"
                    >
                      Chọn file...
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Đường dẫn tới <code className="text-slate-200">ffprobe.exe</code> (Để trống để tự tìm cạnh{' '}
                    <code className="text-slate-200">ffmpeg.exe</code> đang dùng, rồi trong{' '}
                    <code className="text-slate-200">./bin/ffprobe.exe</code>)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={config.customFfprobePath || ''}
                      onChange={(e) => setConfig({ ...config, customFfprobePath: e.target.value })}
                      placeholder="./bin/ffprobe.exe"
                      className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const chosen = await getMediaApi().selectBinaryFile('Chọn file ffprobe.exe');
                        if (chosen) setConfig({ ...config, customFfprobePath: chosen });
                      }}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg border border-slate-700"
                    >
                      Chọn file...
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Đường dẫn tới <code className="text-slate-200">exiftool.exe</code> (Để trống nếu dùng mặc định trong <code className="text-slate-200">./bin/exiftool.exe</code>)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={config.customExiftoolPath}
                      onChange={(e) => setConfig({ ...config, customExiftoolPath: e.target.value })}
                      placeholder="./bin/exiftool.exe"
                      className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const chosen = await getMediaApi().selectBinaryFile('Chọn file exiftool.exe');
                        if (chosen) setConfig({ ...config, customExiftoolPath: chosen });
                      }}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded-lg border border-slate-700"
                    >
                      Chọn file...
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 pt-1 leading-relaxed">
                  💡 <strong>Hướng dẫn cài đặt thủ công</strong>: Bạn có thể xem chi tiết trong file{' '}
                  <code className="text-indigo-300">bin/README.md</code> của project hoặc chạy lệnh{' '}
                  <code className="text-amber-300">npm run setup:binaries</code> trong Terminal.
                </div>
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Đang lưu...' : 'Lưu Cài đặt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
