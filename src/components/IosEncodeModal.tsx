import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Smartphone,
  Play,
  Square,
  Loader2,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  SkipForward,
} from 'lucide-react';
import {
  IosCompatInfo,
  IosEncodeJobState,
  IosEncodeOptions,
  IosEncoderDetection,
  MediaFileItem,
} from '../shared/types';
import { getMediaApi } from '../utils/ipcClient';
import { IosCompatBadge, buildIosTooltip } from './IosCompatBadge';
import { IosEncodeOptionsPanel } from './IosEncodeOptionsPanel';

interface IosEncodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetItems: MediaFileItem[];
  iosCompatMap: Record<string, IosCompatInfo>;
  ffprobeAvailable: boolean;
  /** filePath → job mới nhất của file đó */
  jobsByFile: Record<string, IosEncodeJobState>;
}

const DEFAULT_OPTIONS: IosEncodeOptions = {
  uiMode: 'simple',
  profile: 'balanced',
  preset: 'hevc',
  encoder: 'auto',
  qualityMode: 'balanced',
  quality: 24,
  capToSourceBitrate: true,
  maxResolution: 0,
  skipCompatible: true,
  outputMode: 'same-folder',
  outputDir: '',
  outputSuffix: '.ios',
  afterSuccess: 'keep',
};

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function formatEta(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const ACTIVE_STATUSES = new Set(['queued', 'running', 'verifying']);

export const IosEncodeModal: React.FC<IosEncodeModalProps> = ({
  isOpen,
  onClose,
  targetItems,
  iosCompatMap,
  ffprobeAvailable,
  jobsByFile,
}) => {
  const [options, setOptions] = useState<IosEncodeOptions>(DEFAULT_OPTIONS);
  const [detection, setDetection] = useState<IosEncoderDetection | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videos = useMemo(() => targetItems.filter((i) => i.mediaType === 'video'), [targetItems]);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    const api = getMediaApi();
    api
      .getConfig()
      .then((cfg) => cfg.iosEncode && setOptions({ ...DEFAULT_OPTIONS, ...cfg.iosEncode }))
      .catch(() => {});
    if (!detection) {
      api
        .getAvailableEncoders()
        .then(setDetection)
        .catch(() => setDetection({ encoders: [], notes: [] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /** Dự đoán hành động cho từng file theo tuỳ chọn hiện tại */
  const planFor = (item: MediaFileItem): { label: string; tone: string } => {
    const info = iosCompatMap[item.filePath];
    if (!info || info.level === 'unknown') return { label: 'Phân tích khi chạy', tone: 'text-slate-400' };
    const shortSide = Math.min(info.width || 0, info.height || 0);
    const needScale = options.maxResolution > 0 && shortSide > options.maxResolution;
    if (info.level === 'transcode' || needScale) {
      if (options.preset === 'remux-only') return { label: 'Không remux được', tone: 'text-rose-400' };
      return { label: needScale && info.level !== 'transcode' ? 'Encode (thu nhỏ)' : 'Encode', tone: 'text-orange-300' };
    }
    if (info.level === 'compatible' && options.skipCompatible) {
      return { label: 'Bỏ qua', tone: 'text-emerald-400' };
    }
    return { label: 'Remux', tone: 'text-sky-300' };
  };

  const counts = useMemo(() => {
    const c = { compatible: 0, remux: 0, transcode: 0, unknown: 0 };
    for (const v of videos) {
      const lv = iosCompatMap[v.filePath]?.level ?? 'unknown';
      c[lv]++;
    }
    return c;
  }, [videos, iosCompatMap]);

  const activeJobs = videos
    .map((v) => jobsByFile[v.filePath])
    .filter((j): j is IosEncodeJobState => !!j && ACTIVE_STATUSES.has(j.status));

  if (!isOpen) return null;

  const handleStart = async () => {
    setError(null);
    if (options.outputMode === 'custom-folder' && !options.outputDir) {
      setError('Hãy chọn thư mục lưu file kết quả.');
      return;
    }
    const filePaths = videos
      .filter((v) => !jobsByFile[v.filePath] || !ACTIVE_STATUSES.has(jobsByFile[v.filePath].status))
      .filter((v) => planFor(v).label !== 'Bỏ qua')
      .map((v) => v.filePath);
    if (filePaths.length === 0) {
      setError('Không có file nào cần xử lý.');
      return;
    }
    setIsStarting(true);
    try {
      await getMediaApi().startIosEncode(filePaths, options);
    } catch (err: any) {
      setError(err?.message || 'Không bắt đầu được');
    } finally {
      setIsStarting(false);
    }
  };

  const renderJob = (job?: IosEncodeJobState) => {
    if (!job) return null;
    const warn = job.warnings.length > 0 ? job.warnings.join('\n') : undefined;
    switch (job.status) {
      case 'queued':
        return <span className="text-slate-400">Đang chờ...</span>;
      case 'running':
      case 'verifying':
        return (
          <div className="space-y-1 min-w-[180px]">
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all ${job.mode === 'remux' ? 'bg-sky-500' : 'bg-orange-500'}`}
                style={{ width: `${job.percent.toFixed(1)}%` }}
              />
            </div>
            <div className="flex justify-between gap-2 text-[10px] text-slate-400">
              <span className="truncate" title={job.message}>
                {job.status === 'verifying' ? 'Đang kiểm tra...' : `${job.percent.toFixed(1)}%`}
                {job.speed ? ` • ${job.speed.toFixed(2)}×` : ''}
                {job.status === 'running' && job.mode === 'transcode'
                  ? job.gpuDecode
                    ? ' • GPU decode'
                    : job.encoder && /_(nvenc|qsv|amf)$/.test(job.encoder)
                      ? ' • CPU decode'
                      : ''
                  : ''}
              </span>
              {job.etaSeconds ? <span>còn {formatEta(job.etaSeconds)}</span> : null}
            </div>
          </div>
        );
      case 'done':
        return (
          <span className="flex items-center gap-1.5 text-emerald-400" title={warn}>
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {job.message} {job.outputSize ? `• ${formatBytes(job.outputSize)}` : ''}
              {job.sourceTrashed ? ' • gốc → Thùng rác' : ''}
            </span>
            {warn && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
            {job.outputPath && (
              <button
                onClick={() => getMediaApi().openPathInExplorer(job.outputPath!)}
                title="Mở trong Explorer"
                className="p-0.5 rounded hover:bg-slate-800 text-slate-400 shrink-0"
              >
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </span>
        );
      case 'skipped':
        return (
          <span className="flex items-center gap-1.5 text-slate-400">
            <SkipForward className="w-3.5 h-3.5" /> {job.message}
          </span>
        );
      case 'cancelled':
        return <span className="text-slate-500">Đã huỷ</span>;
      case 'failed':
        return (
          <span className="flex items-center gap-1.5 text-rose-400" title={job.message}>
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{job.message}</span>
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs flex items-center justify-center p-6">
      <div className="w-full max-w-6xl max-h-[92vh] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Encode cho iPhone / iOS</h2>
              <p className="text-[11px] text-slate-400">
                {videos.length} video • {counts.compatible} tương thích • {counts.remux} cần remux •{' '}
                {counts.transcode} cần encode
                {counts.unknown > 0 ? ` • ${counts.unknown} chưa phân tích` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              // Nhớ lựa chọn (chế độ Đơn giản/Nâng cao, hồ sơ...) cho lần mở sau
              getMediaApi().saveConfig({ iosEncode: options }).catch(() => {});
              onClose();
            }}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!ffprobeAvailable && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-950/60 border border-amber-700/40 text-[11px] text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Chưa tìm thấy ffprobe.exe – hãy đặt cạnh ffmpeg.exe trong thư mục ./bin rồi mở lại app.
          </div>
        )}

        <div className="flex-1 overflow-hidden flex min-h-0">
          {/* Tuỳ chọn */}
          <div className="w-80 shrink-0 border-r border-slate-800 p-4 overflow-y-auto text-xs">
            <IosEncodeOptionsPanel options={options} onChange={setOptions} detection={detection} />
          </div>

          {/* Danh sách file */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left font-semibold py-2 px-3">File</th>
                  <th className="text-left font-semibold py-2 px-3">Hiện tại</th>
                  <th className="text-left font-semibold py-2 px-3">Sẽ làm</th>
                  <th className="text-left font-semibold py-2 px-3 w-[260px]">Tiến độ</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((v) => {
                  const info = iosCompatMap[v.filePath];
                  const job = jobsByFile[v.filePath];
                  const plan = planFor(v);
                  return (
                    <tr key={v.filePath} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="py-2 px-3 max-w-[260px]">
                        <div className="truncate text-slate-200 font-medium" title={v.filePath}>
                          {v.fileName}
                        </div>
                        <div className="truncate text-[10px] text-slate-500" title={info?.summary}>
                          {info?.summary || '—'}
                        </div>
                      </td>
                      <td className="py-2 px-3" title={buildIosTooltip(info)}>
                        <IosCompatBadge info={info} showText />
                      </td>
                      <td className={`py-2 px-3 font-medium ${plan.tone}`}>{plan.label}</td>
                      <td className="py-2 px-3 max-w-[260px]">{renderJob(job)}</td>
                    </tr>
                  );
                })}
                {videos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-slate-500">
                      Chưa chọn video nào. Hãy chọn video trong danh sách (hoặc bỏ chọn để áp dụng cho tất cả).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-400 min-w-0 truncate">
            {error ? (
              <span className="text-rose-400">{error}</span>
            ) : activeJobs.length > 0 ? (
              `Đang xử lý ${activeJobs.length} file – có thể đóng hộp thoại, tiến trình vẫn chạy nền.`
            ) : (
              'Rê chuột vào badge để xem lý do chi tiết.'
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeJobs.length > 0 && (
              <button
                onClick={() => getMediaApi().cancelIosEncode()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 border border-slate-700 text-xs font-medium"
              >
                <Square className="w-3.5 h-3.5" /> Huỷ tất cả
              </button>
            )}
            <button
              onClick={handleStart}
              disabled={isStarting || videos.length === 0 || !ffprobeAvailable}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-xs font-semibold shadow"
            >
              {isStarting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Bắt đầu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
