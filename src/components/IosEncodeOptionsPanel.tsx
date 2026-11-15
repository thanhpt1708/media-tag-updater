import React, { useMemo, useState } from 'react';
import { Cpu, FolderOpen, HelpCircle, Loader2, SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  IosEncodeOptions,
  IosEncodePreset,
  IosEncoderDetection,
  IosQualityMode,
  IosVideoEncoder,
} from '../shared/types';
import { IOS_ENCODE_HELP, IOS_ENCODE_PROFILES, applyProfile, getProfile } from '../shared/iosEncodeProfiles';
import { resolveQualityValue } from '../../electron/services/iosCompat';
import { getMediaApi } from '../utils/ipcClient';

const PRESETS: { id: IosEncodePreset; title: string; desc: string }[] = [
  { id: 'hevc', title: 'HEVC (H.265) – Khuyên dùng', desc: 'iPhone 6s trở lên • file nhỏ • giữ HDR' },
  { id: 'h264', title: 'H.264 – Tương thích tối đa', desc: 'Mọi iPhone/iPad • file lớn hơn ~40% • chỉ SDR' },
  { id: 'remux-only', title: 'Chỉ remux', desc: 'Không encode lại hình – bỏ qua file bắt buộc phải encode' },
];

const QUALITY_MODES: { id: IosQualityMode; title: string; desc: string }[] = [
  { id: 'near-source', title: 'Gần như gốc', desc: 'Không phân biệt được bằng mắt' },
  { id: 'balanced', title: 'Cân bằng', desc: 'Khó thấy khác, nhỏ hơn rõ' },
  { id: 'compact', title: 'Tiết kiệm', desc: 'File nhỏ, hơi mờ cảnh khó' },
  { id: 'custom', title: 'Tuỳ chỉnh', desc: 'Tự chọn CRF/CQ' },
];

const ENCODER_LABEL: Record<IosVideoEncoder, string> = {
  auto: 'Tự động (ưu tiên GPU)',
  hevc_nvenc: 'NVIDIA NVENC (HEVC)',
  hevc_qsv: 'Intel Quick Sync (HEVC)',
  hevc_amf: 'AMD AMF (HEVC)',
  libx265: 'x265 – CPU (chậm, nén tốt nhất)',
  h264_nvenc: 'NVIDIA NVENC (H.264)',
  h264_qsv: 'Intel Quick Sync (H.264)',
  h264_amf: 'AMD AMF (H.264)',
  libx264: 'x264 – CPU',
};

const isGpu = (e: IosVideoEncoder) => /_(nvenc|qsv|amf)$/.test(e);

/** Tiêu đề mục kèm nút (?) mở/đóng phần giải thích */
const SectionTitle: React.FC<{ title: React.ReactNode; help?: string; right?: React.ReactNode }> = ({
  title,
  help,
  right,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span className="flex items-center gap-1.5">
          {title}
          {help && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              title="Giải thích"
              className={`rounded-full ${open ? 'text-orange-300' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
        {right}
      </div>
      {help && open && (
        <div className="px-2.5 py-2 rounded-lg bg-slate-800/60 border border-slate-700/60 text-[10.5px] leading-relaxed text-slate-300 normal-case tracking-normal font-normal whitespace-pre-line">
          {help}
        </div>
      )}
    </div>
  );
};

interface Props {
  options: IosEncodeOptions;
  onChange: (next: IosEncodeOptions) => void;
  detection: IosEncoderDetection | null;
}

export const IosEncodeOptionsPanel: React.FC<Props> = ({ options, onChange, detection }) => {
  /** Thay đổi ở chế độ Nâng cao → chuyển hồ sơ sang "Tuỳ chỉnh" */
  const updateCustom = (patch: Partial<IosEncodeOptions>) =>
    onChange({ ...options, ...patch, profile: 'custom' });
  /** Thay đổi không liên quan tới mã hoá (nơi lưu, file gốc...) → giữ hồ sơ */
  const updateKeep = (patch: Partial<IosEncodeOptions>) => onChange({ ...options, ...patch });

  const presetFamily = options.preset === 'h264' ? 'h264' : 'hevc';
  const encoderChoices = useMemo<IosVideoEncoder[]>(() => {
    const list = (detection?.encoders || [])
      .map((e) => e.encoder)
      .filter((e) =>
        presetFamily === 'hevc' ? e.startsWith('hevc') || e === 'libx265' : e.startsWith('h264') || e === 'libx264'
      );
    return ['auto', ...list];
  }, [detection, presetFamily]);
  const autoEncoder = encoderChoices.find((e) => e !== 'auto');
  const hasGpu = (detection?.encoders || []).some((e) => isGpu(e.encoder));

  const effectiveEncoder: IosVideoEncoder =
    options.encoder !== 'auto' && encoderChoices.includes(options.encoder)
      ? options.encoder
      : autoEncoder || (presetFamily === 'hevc' ? 'libx265' : 'libx264');
  const effectiveQuality = resolveQualityValue(options.qualityMode, options.quality, effectiveEncoder);

  const encoderLabel = (e: IosVideoEncoder) => {
    const info = detection?.encoders.find((x) => x.encoder === e);
    return `${ENCODER_LABEL[e]}${info?.ffmpegVersion ? ` · ffmpeg ${info.ffmpegVersion}` : ''}`;
  };

  /** Mô tả ngắn cấu hình sẽ chạy thật */
  const summary =
    options.preset === 'remux-only'
      ? 'Chỉ remux – không encode lại hình'
      : [
          presetFamily === 'hevc' ? 'HEVC' : 'H.264',
          detection ? encoderLabel(effectiveEncoder).replace(/ \(.*?\)/, '') : '…',
          `${effectiveEncoder.startsWith('lib') ? 'CRF' : 'CQ'} ${effectiveQuality}`,
          options.capToSourceBitrate ? 'không vượt bitrate gốc' : null,
          options.maxResolution ? `tối đa ${options.maxResolution}p` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const handlePickFolder = async () => {
    const dir = await getMediaApi().selectFolder();
    if (dir) updateKeep({ outputMode: 'custom-folder', outputDir: dir });
  };

  const selectedProfile = getProfile(options.profile);

  // ------------------------------------------------------------------------
  // Phần dùng chung: nơi lưu & file gốc
  // ------------------------------------------------------------------------
  const outputSection = (advanced: boolean) => (
    <div className="space-y-1.5">
      <SectionTitle title="Nơi lưu" help={advanced ? IOS_ENCODE_HELP.output : undefined} />
      <label className="flex items-center gap-2 text-slate-300">
        <input
          type="radio"
          checked={options.outputMode === 'same-folder'}
          onChange={() => updateKeep({ outputMode: 'same-folder' })}
        />
        Cùng thư mục với file gốc
      </label>
      <label className="flex items-center gap-2 text-slate-300">
        <input
          type="radio"
          checked={options.outputMode === 'custom-folder'}
          onChange={() => (options.outputDir ? updateKeep({ outputMode: 'custom-folder' }) : handlePickFolder())}
        />
        Thư mục khác
      </label>
      {options.outputMode === 'custom-folder' && (
        <button
          onClick={handlePickFolder}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
          title={options.outputDir}
        >
          <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">{options.outputDir || 'Chọn thư mục...'}</span>
        </button>
      )}
      {advanced && (
        <>
          <label className="flex items-center gap-2 text-slate-300">
            Hậu tố tên file
            <input
              value={options.outputSuffix}
              onChange={(e) => updateKeep({ outputSuffix: e.target.value.replace(/[\\/:*?"<>|]/g, '') })}
              className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-800 border border-slate-700 font-mono text-slate-200"
            />
          </label>
          <div className="text-[10px] text-slate-500 font-mono truncate">vd: Phim{options.outputSuffix}.mp4</div>
        </>
      )}
    </div>
  );

  const otherSection = (advanced: boolean) => (
    <div className="space-y-1.5">
      <SectionTitle title="Khác" help={advanced ? IOS_ENCODE_HELP.other : undefined} />
      {advanced && (
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            checked={options.skipCompatible}
            onChange={(e) => updateKeep({ skipCompatible: e.target.checked })}
          />
          Bỏ qua file đã tương thích iPhone
        </label>
      )}
      <label className="flex items-center gap-2 text-slate-300">
        <input
          type="checkbox"
          checked={options.afterSuccess === 'trash'}
          onChange={(e) => updateKeep({ afterSuccess: e.target.checked ? 'trash' : 'keep' })}
        />
        Chuyển file gốc vào Thùng rác khi xong
      </label>
      {options.afterSuccess === 'trash' && (
        <div className="text-[10px] text-amber-300/80">
          Chỉ thực hiện sau khi file mới đã được kiểm tra đạt chuẩn. Có thể khôi phục từ Thùng rác.
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Công tắc Đơn giản / Nâng cao */}
      <div className="grid grid-cols-2 p-0.5 rounded-lg bg-slate-800/70 border border-slate-700/60">
        {(
          [
            { id: 'simple', label: 'Đơn giản', icon: <Sparkles className="w-3.5 h-3.5" /> },
            { id: 'advanced', label: 'Nâng cao', icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            onClick={() => updateKeep({ uiMode: m.id })}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition ${
              options.uiMode === m.id ? 'bg-orange-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {options.uiMode === 'simple' ? (
        <>
          <div className="space-y-1.5">
            <SectionTitle title="Chọn nhanh" />
            {IOS_ENCODE_PROFILES.map((p) => {
              const active = options.profile === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onChange(applyProfile(options, p.id))}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition ${
                    active
                      ? 'bg-orange-500/10 border-orange-500/40'
                      : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm leading-none">{p.icon}</span>
                    <span className={`font-semibold ${active ? 'text-orange-200' : 'text-slate-200'}`}>{p.title}</span>
                    {p.recommended && (
                      <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Khuyên dùng
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5 pl-6">{p.tagline}</div>
                  {active && <div className="text-[10.5px] text-slate-300 mt-1.5 pl-6 leading-relaxed">{p.details}</div>}
                  {active && p.wantsGpu && detection && !hasGpu && (
                    <div className="text-[10px] text-amber-300/90 mt-1 pl-6">
                      Máy không có GPU encode dùng được – sẽ chạy bằng CPU (chậm hơn).
                    </div>
                  )}
                </button>
              );
            })}
            {options.profile === 'custom' && (
              <div className="px-3 py-2 rounded-lg border bg-orange-500/10 border-orange-500/40">
                <div className="font-semibold text-orange-200">🛠️ Tuỳ chỉnh của bạn</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Đang dùng thiết lập riêng từ chế độ Nâng cao.{' '}
                  <button onClick={() => updateKeep({ uiMode: 'advanced' })} className="text-orange-300 underline">
                    Sửa
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="px-2.5 py-2 rounded-lg bg-slate-950/60 border border-slate-800 text-[10.5px] text-slate-400">
            <span className="text-slate-500">Sẽ chạy: </span>
            <span className="text-slate-200">{summary}</span>
            <div className="text-[10px] text-slate-500 mt-1">
              File chỉ cần remux luôn được giữ nguyên hình 100%, chỉ file bắt buộc mới bị encode lại.
            </div>
          </div>

          {outputSection(false)}
          {otherSection(false)}
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <SectionTitle title="Bắt đầu từ hồ sơ" />
            <select
              value={options.profile}
              onChange={(e) => {
                const id = e.target.value;
                if (id !== 'custom') onChange(applyProfile(options, id as Exclude<typeof options.profile, 'custom'>));
              }}
              className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200"
            >
              {IOS_ENCODE_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.title}
                </option>
              ))}
              <option value="custom">🛠️ Tuỳ chỉnh</option>
            </select>
            <div className="text-[10px] text-slate-500">
              {selectedProfile
                ? 'Chỉnh bất kỳ mục nào bên dưới sẽ chuyển sang "Tuỳ chỉnh".'
                : 'Đang dùng thiết lập riêng. Chọn một hồ sơ để đặt lại.'}{' '}
              Bấm <HelpCircle className="w-3 h-3 inline -mt-0.5" /> cạnh mỗi mục để xem giải thích.
            </div>
          </div>

          <div className="space-y-1.5">
            <SectionTitle title="Định dạng đích" help={IOS_ENCODE_HELP.preset} />
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => updateCustom({ preset: p.id, encoder: 'auto' })}
                className={`w-full text-left px-3 py-2 rounded-lg border transition ${
                  options.preset === p.id
                    ? 'bg-orange-500/10 border-orange-500/40 text-orange-200'
                    : 'bg-slate-800/50 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="font-semibold">{p.title}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{p.desc}</div>
              </button>
            ))}
          </div>

          {options.preset !== 'remux-only' && (
            <>
              <div className="space-y-1.5">
                <SectionTitle
                  title={
                    <>
                      <Cpu className="w-3 h-3" /> Bộ encode
                    </>
                  }
                  help={IOS_ENCODE_HELP.encoder}
                />
                {detection === null ? (
                  <div className="flex items-center gap-2 text-slate-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang dò GPU / encoder...
                  </div>
                ) : (
                  <select
                    value={encoderChoices.includes(options.encoder) ? options.encoder : 'auto'}
                    onChange={(e) => updateCustom({ encoder: e.target.value as IosVideoEncoder })}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200"
                  >
                    {encoderChoices.map((e) => (
                      <option key={e} value={e}>
                        {e === 'auto' && autoEncoder ? `Tự động → ${encoderLabel(autoEncoder)}` : encoderLabel(e)}
                      </option>
                    ))}
                  </select>
                )}
                {detection?.notes.map((n) => (
                  <div key={n} className="text-[10px] text-amber-300/80 leading-snug">
                    ⓘ {n}
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <SectionTitle
                  title="Chất lượng"
                  help={IOS_ENCODE_HELP.quality}
                  right={
                    <span className="font-mono text-orange-300 normal-case">
                      {effectiveEncoder.startsWith('lib') ? 'CRF' : 'CQ'} {effectiveQuality}
                    </span>
                  }
                />
                <div className="grid grid-cols-2 gap-1.5">
                  {QUALITY_MODES.map((m) => (
                    <button
                      key={m.id}
                      onClick={() =>
                        updateCustom(
                          m.id === 'custom' ? { qualityMode: 'custom', quality: effectiveQuality } : { qualityMode: m.id }
                        )
                      }
                      className={`px-2 py-1.5 rounded-lg border text-left transition ${
                        options.qualityMode === m.id
                          ? 'bg-orange-500/10 border-orange-500/40 text-orange-200'
                          : 'bg-slate-800/50 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <div className="font-semibold text-[11px]">{m.title}</div>
                      <div className="text-[9px] text-slate-400 leading-tight">{m.desc}</div>
                    </button>
                  ))}
                </div>
                {options.qualityMode === 'custom' && (
                  <>
                    <input
                      type="range"
                      min={14}
                      max={34}
                      value={options.quality}
                      onChange={(e) => updateCustom({ quality: Number(e.target.value) })}
                      className="w-full accent-orange-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>Đẹp, file lớn</span>
                      <span>Nhỏ, mờ hơn</span>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-1.5">
                <SectionTitle title="Giới hạn dung lượng" help={IOS_ENCODE_HELP.cap} />
                <label className="flex items-start gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={options.capToSourceBitrate}
                    onChange={(e) => updateCustom({ capToSourceBitrate: e.target.checked })}
                  />
                  <span>
                    Không vượt bitrate gốc
                    <span className="block text-[10px] text-slate-500">
                      File mới xấp xỉ hoặc nhỏ hơn bản gốc (x265/x264/NVENC)
                    </span>
                  </span>
                </label>
              </div>

              <div className="space-y-1.5">
                <SectionTitle title="Độ phân giải tối đa" help={IOS_ENCODE_HELP.resolution} />
                <select
                  value={options.maxResolution}
                  onChange={(e) =>
                    updateCustom({ maxResolution: Number(e.target.value) as IosEncodeOptions['maxResolution'] })
                  }
                  className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200"
                >
                  <option value={0}>Giữ nguyên</option>
                  <option value={2160}>4K (2160p)</option>
                  <option value={1080}>1080p</option>
                  <option value={720}>720p</option>
                </select>
              </div>
            </>
          )}

          <div className="px-2.5 py-2 rounded-lg bg-slate-950/60 border border-slate-800 text-[10.5px] text-slate-400">
            <span className="text-slate-500">Sẽ chạy: </span>
            <span className="text-slate-200">{summary}</span>
          </div>

          {outputSection(true)}
          {otherSection(true)}
        </>
      )}
    </div>
  );
};
