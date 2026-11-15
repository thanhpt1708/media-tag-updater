/**
 * Đánh giá mức tương thích iPhone / iOS (giải mã phần cứng qua VideoToolbox) từ output ffprobe
 * và dựng lệnh ffmpeg để remux / encode lại cho phù hợp.
 *
 * Module thuần (không phụ thuộc Electron) để có thể unit test.
 *
 * Quy tắc giải mã phần cứng trên iPhone:
 *  - H.264: 8-bit 4:2:0, profile Baseline/Main/High (Hi10P, 4:2:2, 4:4:4 → phần mềm)
 *  - HEVC:  Main / Main 10, 4:2:0 (chip A9+ / iPhone 6s+)
 *  - AV1:   chỉ A17 Pro / A18 trở lên → coi là cần encode lại để hỗ trợ rộng
 *  - VP9, VP8, MPEG-2, MPEG-4 ASP, WMV/VC-1, RealVideo...: không có giải mã phần cứng
 *  - Container: MP4/MOV (MKV không được AVPlayer/Ảnh/Files hỗ trợ). HEVC phải mang tag `hvc1`.
 */
import {
  IosCompatInfo,
  IosEncodeOptions,
  IosQualityMode,
  IosVideoEncoder,
} from '../../src/shared/types';

// ---------------------------------------------------------------------------
// Kiểu dữ liệu ffprobe (chỉ những trường cần dùng)
// ---------------------------------------------------------------------------

export interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  codec_tag_string?: string;
  profile?: string;
  pix_fmt?: string;
  level?: number;
  width?: number;
  height?: number;
  channels?: number;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
  color_range?: string;
  disposition?: { attached_pic?: number; default?: number };
  tags?: Record<string, string>;
  side_data_list?: { side_data_type?: string; dv_profile?: number }[];
  bit_rate?: string;
}

export interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string; bit_rate?: string };
}

/** Bitrate 1 luồng: trường bit_rate (MP4) hoặc tag thống kê BPS của mkvmerge (MKV) */
function streamBitRate(s: FfprobeStream): number | undefined {
  const direct = Number(s.bit_rate);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const tags = s.tags || {};
  const bpsKey = Object.keys(tags).find((k) => /^BPS(-|$)/i.test(k));
  const bps = bpsKey ? Number(tags[bpsKey]) : NaN;
  return Number.isFinite(bps) && bps > 0 ? bps : undefined;
}

/**
 * Bitrate luồng hình gốc (bit/s). Không có số liệu trực tiếp thì ước lượng:
 * bitrate toàn file − tổng bitrate audio (audio thiếu số liệu thì tính ~192 kbps/luồng).
 */
export function estimateVideoBitRate(probe: FfprobeOutput, video: FfprobeStream): number | undefined {
  const direct = streamBitRate(video);
  if (direct) return direct;
  const total = Number(probe.format?.bit_rate);
  if (!Number.isFinite(total) || total <= 0) return undefined;
  let audio = 0;
  for (const a of (probe.streams || []).filter((s) => s.codec_type === 'audio')) {
    audio += streamBitRate(a) ?? 192_000;
  }
  const est = Math.round((total - audio) * 0.98); // trừ ~2% overhead container/phụ đề
  return est > 100_000 ? est : undefined;
}

// ---------------------------------------------------------------------------
// Kế hoạch xử lý từng luồng
// ---------------------------------------------------------------------------

export interface VideoStreamPlan {
  index: number;
  action: 'copy' | 'transcode';
  codec: string;
  width?: number;
  height?: number;
  is10Bit: boolean;
  chroma: '420' | '422' | '444' | 'other';
  /** Bitrate hình gốc (bit/s) */
  bitRate?: number;
  hdr?: IosCompatInfo['hdr'];
  dvProfile?: number;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
}

export interface AudioStreamPlan {
  index: number;
  action: 'copy' | 'aac';
  codec: string;
  channels: number;
}

export interface SubtitleStreamPlan {
  index: number;
  action: 'mov_text' | 'drop';
  codec: string;
}

export interface IosStreamPlan {
  compat: IosCompatInfo;
  video?: VideoStreamPlan;
  audio: AudioStreamPlan[];
  subtitles: SubtitleStreamPlan[];
  durationSec?: number;
  /** Đã là MP4/MOV */
  isMp4Family: boolean;
}

const MP4_FAMILY_EXTS = new Set(['.mp4', '.m4v', '.mov']);

/** Audio iOS phát được trong MP4 */
const AUDIO_COPY_CODECS = new Set(['aac', 'ac3', 'eac3', 'alac', 'mp3']);
/** Phụ đề dạng text chuyển được sang mov_text */
const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);

const H264_OK_PROFILES = new Set(['baseline', 'constrained baseline', 'main', 'high']);
const HEVC_OK_PROFILES = new Set(['main', 'main 10']);

const CODEC_LABEL: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg2video: 'MPEG-2',
  mpeg4: 'MPEG-4 ASP (Xvid/DivX)',
  msmpeg4v3: 'MS-MPEG4 (DivX 3)',
  wmv3: 'WMV9',
  wmv2: 'WMV8',
  vc1: 'VC-1',
  prores: 'ProRes',
  mjpeg: 'MJPEG',
  theora: 'Theora',
  rv40: 'RealVideo',
  flv1: 'Sorenson (FLV)',
  aac: 'AAC',
  ac3: 'AC3',
  eac3: 'E-AC3',
  dts: 'DTS',
  truehd: 'TrueHD',
  flac: 'FLAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  mp3: 'MP3',
  alac: 'ALAC',
  mp2: 'MP2',
  wmav2: 'WMA',
};

export function codecLabel(codec?: string): string {
  if (!codec) return '?';
  if (codec.startsWith('pcm_')) return 'PCM';
  return CODEC_LABEL[codec] || codec.toUpperCase();
}

function channelLabel(ch?: number): string {
  if (!ch) return '';
  if (ch === 1) return 'mono';
  if (ch === 2) return '2.0';
  if (ch === 6) return '5.1';
  if (ch === 8) return '7.1';
  return `${ch}ch`;
}

function pixInfo(pixFmt?: string): { bitDepth: number; chroma: '420' | '422' | '444' | 'other' } {
  const p = (pixFmt || '').toLowerCase();
  const bitMatch = p.match(/p(\d{2})(le|be)?$/);
  const bitDepth = bitMatch ? Number(bitMatch[1]) : p === 'p010le' || p === 'p010be' ? 10 : 8;
  let chroma: '420' | '422' | '444' | 'other' = 'other';
  if (/420|nv12|nv21|p010/.test(p)) chroma = '420';
  else if (/422|yuyv|uyvy/.test(p)) chroma = '422';
  else if (/444|gbr|rgb/.test(p)) chroma = '444';
  return { bitDepth, chroma };
}

function detectHdr(v: FfprobeStream): { hdr?: IosCompatInfo['hdr']; dvProfile?: number } {
  const dv = v.side_data_list?.find((s) => /dovi/i.test(s.side_data_type || ''));
  if (dv) return { hdr: 'Dolby Vision', dvProfile: dv.dv_profile };
  if (v.color_transfer === 'smpte2084') return { hdr: 'HDR10' };
  if (v.color_transfer === 'arib-std-b67') return { hdr: 'HLG' };
  return {};
}

function formatContainer(formatName: string | undefined, ext: string): string {
  const f = (formatName || '').toLowerCase();
  if (f.includes('matroska')) return ext === '.webm' ? 'WebM' : 'MKV';
  if (f.includes('mp4') || f.includes('mov')) return ext === '.mov' ? 'MOV' : 'MP4';
  if (f.includes('avi')) return 'AVI';
  if (f.includes('asf')) return 'WMV/ASF';
  if (f.includes('mpegts')) return 'MPEG-TS';
  return f.split(',')[0]?.toUpperCase() || ext.replace('.', '').toUpperCase();
}

/**
 * Phân tích output ffprobe → mức tương thích iOS + kế hoạch xử lý từng luồng.
 * `extension` là phần mở rộng file gốc (vd ".mkv"), dùng để phân biệt MP4/MOV/WebM.
 */
export function analyzeIosCompat(probe: FfprobeOutput, extension: string): IosStreamPlan {
  const ext = extension.toLowerCase();
  const streams = probe.streams || [];
  const reasons: string[] = [];
  const notes: string[] = [];
  const formatName = probe.format?.format_name || '';
  const container = formatContainer(formatName, ext);
  const isMp4Family =
    MP4_FAMILY_EXTS.has(ext) && /mp4|mov/.test(formatName.toLowerCase());
  const durationSec = Number(probe.format?.duration) || undefined;

  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  let video: VideoStreamPlan | undefined;
  let needTranscode = false;
  let needRemux = false;
  const summaryParts: string[] = [];

  if (!v) {
    return {
      compat: {
        level: 'unknown',
        summary: 'Không tìm thấy luồng hình',
        reasons: ['Không tìm thấy luồng video trong file'],
        notes: [],
        container,
        audioCodecs: [],
      },
      audio: [],
      subtitles: [],
      durationSec,
      isMp4Family,
    };
  }

  const codec = (v.codec_name || '').toLowerCase();
  const profile = (v.profile || '').toLowerCase();
  const { bitDepth, chroma } = pixInfo(v.pix_fmt);
  const { hdr, dvProfile } = detectHdr(v);
  const is10Bit = bitDepth >= 10;
  let videoOk = false;

  if (codec === 'h264') {
    if (bitDepth > 8) {
      reasons.push(`H.264 ${bitDepth}-bit (Hi10P) – iPhone không giải mã phần cứng`);
    } else if (chroma !== '420') {
      reasons.push(`H.264 ${chroma === '422' ? '4:2:2' : '4:4:4'} – iPhone chỉ giải mã phần cứng 4:2:0`);
    } else if (profile && !H264_OK_PROFILES.has(profile)) {
      reasons.push(`H.264 profile "${v.profile}" – không được giải mã phần cứng`);
    } else if (v.level && v.level > 52) {
      reasons.push(`H.264 level ${(v.level / 10).toFixed(1)} vượt mức 5.2`);
    } else {
      videoOk = true;
    }
  } else if (codec === 'hevc') {
    if (chroma !== '420') {
      reasons.push(`HEVC ${chroma === '422' ? '4:2:2' : '4:4:4'} – iPhone chỉ giải mã phần cứng 4:2:0`);
    } else if (bitDepth > 10) {
      reasons.push(`HEVC ${bitDepth}-bit – iPhone chỉ hỗ trợ tối đa 10-bit`);
    } else if (profile && !HEVC_OK_PROFILES.has(profile)) {
      reasons.push(`HEVC profile "${v.profile}" – chỉ Main / Main 10 được giải mã phần cứng`);
    } else if (v.level && v.level > 156) {
      reasons.push(`HEVC level ${(v.level / 30).toFixed(1)} (vd 8K) vượt khả năng giải mã của iPhone`);
    } else {
      videoOk = true;
      if (isMp4Family && v.codec_tag_string && v.codec_tag_string.toLowerCase() === 'hev1') {
        needRemux = true;
        reasons.push('HEVC mang tag "hev1" – Ảnh/Files/AVPlayer không phát, cần đổi sang "hvc1"');
      }
    }
  } else if (codec === 'av1') {
    reasons.push('AV1 – chỉ iPhone 15 Pro (A17 Pro) trở lên giải mã phần cứng');
  } else {
    reasons.push(`${codecLabel(codec)} – iPhone không giải mã phần cứng`);
  }

  if (!videoOk) needTranscode = true;

  const videoBitRate = estimateVideoBitRate(probe, v);
  video = {
    index: v.index,
    action: videoOk ? 'copy' : 'transcode',
    codec,
    width: v.width,
    height: v.height,
    is10Bit,
    chroma,
    bitRate: videoBitRate,
    hdr,
    dvProfile,
    colorPrimaries: v.color_primaries,
    colorTransfer: v.color_transfer,
    colorSpace: v.color_space,
  };

  const profileLabel = v.profile && !/^unknown$/i.test(v.profile) ? ` ${v.profile}` : '';
  summaryParts.push(`${codecLabel(codec)}${profileLabel}${is10Bit && !/10/.test(profileLabel) ? ' 10-bit' : ''}`);
  if (v.width && v.height) summaryParts.push(`${v.width}×${v.height}`);
  if (videoBitRate) summaryParts.push(`${(videoBitRate / 1_000_000).toFixed(1)} Mbps`);
  if (hdr) summaryParts.push(dvProfile ? `${hdr} P${dvProfile}` : hdr);

  // --- Audio ---
  const audio: AudioStreamPlan[] = [];
  const audioCodecs: string[] = [];
  for (const a of streams.filter((s) => s.codec_type === 'audio')) {
    const ac = (a.codec_name || '').toLowerCase();
    const ch = a.channels || 2;
    audioCodecs.push(`${codecLabel(ac)}${ch ? ' ' + channelLabel(ch) : ''}`);
    if (AUDIO_COPY_CODECS.has(ac)) {
      audio.push({ index: a.index, action: 'copy', codec: ac, channels: ch });
    } else {
      audio.push({ index: a.index, action: 'aac', codec: ac, channels: ch });
      needRemux = true;
      reasons.push(`Audio ${codecLabel(ac)} – iOS không phát được, cần chuyển sang AAC`);
    }
  }
  if (audioCodecs.length > 0) summaryParts.push(audioCodecs.join(' + '));

  // --- Phụ đề ---
  const subtitles: SubtitleStreamPlan[] = [];
  for (const s of streams.filter((st) => st.codec_type === 'subtitle')) {
    const sc = (s.codec_name || '').toLowerCase();
    if (TEXT_SUB_CODECS.has(sc)) {
      subtitles.push({ index: s.index, action: 'mov_text', codec: sc });
      if (sc === 'ass' || sc === 'ssa') {
        notes.push('Phụ đề ASS/SSA sẽ chuyển sang mov_text (mất hiệu ứng / font chữ)');
      }
    } else {
      subtitles.push({ index: s.index, action: 'drop', codec: sc });
      notes.push(`Phụ đề dạng hình (${sc || 'không rõ'}) không đưa được vào MP4 – sẽ bị bỏ`);
    }
  }

  if (!isMp4Family) {
    needRemux = true;
    reasons.push(`Container ${container} – Ảnh/Files/Safari trên iOS không mở được, cần MP4`);
  }

  if (codec === 'av1') notes.push('Trên iPhone 15 Pro trở lên AV1 vẫn phát mượt');
  if (hdr === 'Dolby Vision' && !videoOk) {
    notes.push('Encode lại sẽ mất lớp Dolby Vision (giữ HDR10 nếu nguồn có)');
  }

  const level: IosCompatInfo['level'] = needTranscode
    ? 'transcode'
    : needRemux
      ? 'remux'
      : 'compatible';

  return {
    compat: {
      level,
      summary: summaryParts.join(' · '),
      reasons,
      notes: Array.from(new Set(notes)),
      container,
      videoCodec: codec,
      videoProfile: v.profile,
      pixFmt: v.pix_fmt,
      width: v.width,
      height: v.height,
      durationMs: durationSec ? Math.round(durationSec * 1000) : undefined,
      videoBitRate,
      hdr,
      audioCodecs,
    },
    video,
    audio,
    subtitles,
    durationSec,
    isMp4Family,
  };
}

// ---------------------------------------------------------------------------
// Dựng lệnh ffmpeg
// ---------------------------------------------------------------------------

export const HEVC_ENCODERS: IosVideoEncoder[] = ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265'];
export const H264_ENCODERS: IosVideoEncoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];

/** Chọn encoder thực tế theo preset + lựa chọn người dùng + danh sách encoder chạy được trên máy */
export function resolveEncoder(
  preset: 'hevc' | 'h264',
  requested: IosVideoEncoder,
  available: IosVideoEncoder[]
): IosVideoEncoder {
  const family = preset === 'hevc' ? HEVC_ENCODERS : H264_ENCODERS;
  if (requested !== 'auto' && family.includes(requested) && available.includes(requested)) {
    return requested;
  }
  return family.find((e) => available.includes(e)) || (preset === 'hevc' ? 'libx265' : 'libx264');
}

/**
 * Bảng quy đổi mức chất lượng → CRF/CQ theo từng encoder.
 * Thang số của mỗi encoder khác nhau (NVENC/QSV/AMF nén kém hơn x265 một chút) nên cùng một mức
 * cần giá trị khác nhau để cho chất lượng hình tương đương.
 */
const QUALITY_TABLE: Record<Exclude<IosQualityMode, 'custom'>, Record<IosVideoEncoder, number>> = {
  'near-source': {
    auto: 18,
    libx265: 18, hevc_nvenc: 19, hevc_qsv: 20, hevc_amf: 20,
    libx264: 17, h264_nvenc: 19, h264_qsv: 19, h264_amf: 19,
  },
  balanced: {
    auto: 24,
    libx265: 24, hevc_nvenc: 25, hevc_qsv: 25, hevc_amf: 24,
    libx264: 21, h264_nvenc: 23, h264_qsv: 23, h264_amf: 22,
  },
  compact: {
    auto: 28,
    libx265: 28, hevc_nvenc: 29, hevc_qsv: 29, hevc_amf: 28,
    libx264: 25, h264_nvenc: 27, h264_qsv: 27, h264_amf: 26,
  },
};

/** CRF/CQ thực tế dùng cho encoder theo mức chất lượng đã chọn */
export function resolveQualityValue(
  mode: IosQualityMode | undefined,
  customQuality: number,
  encoder: IosVideoEncoder
): number {
  if (!mode || mode === 'custom') return customQuality;
  return QUALITY_TABLE[mode][encoder] ?? QUALITY_TABLE[mode].auto;
}

/** Encoder hỗ trợ giới hạn bitrate (VBV) cùng lúc với CRF/CQ */
const SUPPORTS_MAXRATE = new Set<IosVideoEncoder>(['libx265', 'libx264', 'hevc_nvenc', 'h264_nvenc']);

export interface FfmpegArgsInput {
  inputPath: string;
  outputPath: string;
  plan: IosStreamPlan;
  options: Pick<IosEncodeOptions, 'preset' | 'quality' | 'maxResolution'> &
    Partial<Pick<IosEncodeOptions, 'qualityMode' | 'capToSourceBitrate'>>;
  /** Encoder đã resolve (chỉ dùng khi phải transcode video) */
  encoder: IosVideoEncoder;
  /** Ảnh poster (jpg/png) để nhúng làm cover, tuỳ chọn */
  coverPath?: string;
  /** Tag text ghi vào file đích */
  metadata?: Record<string, string | number | undefined>;
  /**
   * Giải mã nguồn bằng GPU NVIDIA (NVDEC) và giữ khung hình trên GPU tới NVENC.
   * Chỉ có tác dụng khi encoder là *_nvenc và nguồn thuộc loại NVDEC giải mã được.
   */
  allowGpuDecode?: boolean;
}

/**
 * Nguồn mà NVDEC giải mã được trên mọi GPU NVIDIA còn được hỗ trợ (từ Pascal / GTX 10xx):
 * H.264 8-bit 4:2:0, HEVC 8/10-bit 4:2:0, VP9 4:2:0, MPEG-2, VC-1.
 * Không gồm: H.264 10-bit (Hi10P), 4:2:2/4:4:4, AV1 (chỉ RTX 30+), MPEG-4 ASP.
 */
export function canNvdecDecode(v: VideoStreamPlan): boolean {
  if (v.chroma !== '420') return false;
  switch (v.codec) {
    case 'h264':
      return !v.is10Bit;
    case 'hevc':
    case 'vp9':
      return true;
    case 'mpeg2video':
    case 'vc1':
    case 'wmv3':
      return !v.is10Bit;
    default:
      return false;
  }
}

export interface FfmpegArgsResult {
  args: string[];
  mode: 'remux' | 'transcode';
  warnings: string[];
  /** Lệnh dùng NVDEC (GPU decode) */
  gpuDecode: boolean;
}

function scaleFilter(v: VideoStreamPlan, maxRes: number): string | undefined {
  if (!maxRes || !v.width || !v.height) return undefined;
  const shortSide = Math.min(v.width, v.height);
  if (shortSide <= maxRes) return undefined;
  return v.width >= v.height ? `scale=-2:${maxRes}` : `scale=${maxRes}:-2`;
}

function videoEncodeArgs(
  encoder: IosVideoEncoder,
  q: number,
  tenBit: boolean,
  height: number
): string[] {
  const quality = String(Math.round(q));
  switch (encoder) {
    case 'libx265':
      return [
        '-c:v:0', 'libx265', '-preset', 'medium', '-crf', quality,
        '-profile:v:0', tenBit ? 'main10' : 'main',
        '-pix_fmt:v:0', tenBit ? 'yuv420p10le' : 'yuv420p',
        '-x265-params', 'log-level=error',
      ];
    case 'hevc_nvenc':
      return [
        '-c:v:0', 'hevc_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr',
        '-cq', quality, '-b:v:0', '0', '-spatial-aq', '1',
        '-profile:v:0', tenBit ? 'main10' : 'main',
        '-pix_fmt:v:0', tenBit ? 'p010le' : 'yuv420p',
      ];
    case 'hevc_qsv':
      return [
        '-c:v:0', 'hevc_qsv', '-preset', 'medium', '-global_quality', quality,
        '-profile:v:0', tenBit ? 'main10' : 'main',
        '-pix_fmt:v:0', tenBit ? 'p010le' : 'nv12',
      ];
    case 'hevc_amf':
      return [
        '-c:v:0', 'hevc_amf', '-quality', 'quality', '-rc', 'cqp',
        '-qp_i', quality, '-qp_p', quality,
        '-profile:v:0', tenBit ? 'main10' : 'main',
        '-pix_fmt:v:0', tenBit ? 'p010le' : 'yuv420p',
      ];
    case 'libx264':
      return [
        '-c:v:0', 'libx264', '-preset', 'medium', '-crf', quality,
        '-profile:v:0', 'high', '-level:v:0', height > 1088 ? '5.1' : '4.1',
        '-pix_fmt:v:0', 'yuv420p',
      ];
    case 'h264_nvenc':
      return [
        '-c:v:0', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr',
        '-cq', quality, '-b:v:0', '0', '-spatial-aq', '1',
        '-profile:v:0', 'high', '-pix_fmt:v:0', 'yuv420p',
      ];
    case 'h264_qsv':
      return [
        '-c:v:0', 'h264_qsv', '-preset', 'medium', '-global_quality', quality,
        '-profile:v:0', 'high', '-pix_fmt:v:0', 'nv12',
      ];
    case 'h264_amf':
      return [
        '-c:v:0', 'h264_amf', '-quality', 'quality', '-rc', 'cqp',
        '-qp_i', quality, '-qp_p', quality,
        '-profile:v:0', 'high', '-pix_fmt:v:0', 'yuv420p',
      ];
    default:
      return videoEncodeArgs('libx265', q, tenBit, height);
  }
}

/** Dựng toàn bộ tham số ffmpeg cho 1 file (đã có `-progress pipe:1`) */
export function buildIosFfmpegArgs(input: FfmpegArgsInput): FfmpegArgsResult {
  const { plan, options, inputPath, outputPath, coverPath, metadata } = input;
  const warnings: string[] = [];
  const v = plan.video;
  if (!v) throw new Error('File không có luồng video');

  const scale = scaleFilter(v, options.maxResolution);
  const mustTranscode = v.action === 'transcode' || !!scale;
  if (mustTranscode && options.preset === 'remux-only') {
    throw new Error('Video cần encode lại nhưng đang chọn chế độ "Chỉ remux"');
  }
  const mode: 'remux' | 'transcode' = mustTranscode ? 'transcode' : 'remux';

  const outPreset = options.preset === 'h264' ? 'h264' : 'hevc';
  const outTenBit = outPreset === 'hevc' && (v.is10Bit || !!v.hdr);
  // GPU decode: khung hình giải mã bằng NVDEC nằm luôn trên GPU và đi thẳng vào NVENC
  // (không phải chép qua RAM). Chỉ bật khi không cần đổi độ sâu màu (đổi 10-bit ↔ 8-bit phải làm trên CPU).
  const gpuDecode =
    mode === 'transcode' &&
    !!input.allowGpuDecode &&
    input.encoder.endsWith('_nvenc') &&
    canNvdecDecode(v) &&
    outTenBit === v.is10Bit;

  const args: string[] = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
  if (gpuDecode) args.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda');
  args.push('-i', inputPath);
  if (coverPath) args.push('-i', coverPath);

  // --- Map luồng ---
  args.push('-map', `0:${v.index}`);
  for (const a of plan.audio) args.push('-map', `0:${a.index}`);
  const keptSubs = plan.subtitles.filter((s) => s.action !== 'drop');
  for (const s of keptSubs) args.push('-map', `0:${s.index}`);
  if (coverPath) args.push('-map', '1:0');

  // --- Video ---
  let outCodec = v.codec;
  if (mode === 'remux') {
    args.push('-c:v:0', 'copy');
  } else {
    const preset = options.preset === 'h264' ? 'h264' : 'hevc';
    outCodec = preset === 'h264' ? 'h264' : 'hevc';
    const tenBit = preset === 'hevc' && (v.is10Bit || !!v.hdr);
    if (preset === 'h264' && v.hdr) {
      warnings.push('Nguồn HDR nhưng H.264 chỉ 8-bit SDR – màu có thể nhạt. Nên dùng preset HEVC.');
    }
    const outH = scale
      ? Math.min(v.height || 0, options.maxResolution) || v.height || 1080
      : v.height || 1080;
    const q = resolveQualityValue(options.qualityMode, options.quality, input.encoder);
    let rawArgs = videoEncodeArgs(input.encoder, q, tenBit, outH);
    if (gpuDecode) {
      // Khung hình CUDA đã đúng định dạng (nv12 / p010) – đặt -pix_fmt sẽ buộc ffmpeg kéo về CPU để đổi
      const i = rawArgs.indexOf('-pix_fmt:v:0');
      if (i >= 0) rawArgs = [...rawArgs.slice(0, i), ...rawArgs.slice(i + 2)];
    }
    // Trần bitrate = bitrate hình gốc → file đích không phình to hơn bản gốc
    if (options.capToSourceBitrate) {
      if (!v.bitRate) {
        warnings.push('Không đọc được bitrate gốc – bỏ qua giới hạn "Không vượt bitrate gốc".');
      } else if (!SUPPORTS_MAXRATE.has(input.encoder)) {
        warnings.push(`Encoder ${input.encoder} không hỗ trợ giới hạn bitrate cùng chế độ chất lượng – bỏ qua.`);
      } else {
        const maxrate = Math.round(v.bitRate / 1000);
        rawArgs.push('-maxrate', `${maxrate}k`, '-bufsize', `${maxrate * 2}k`);
      }
    }
    // Gắn stream specifier `:v:0` cho mọi option để không áp nhầm vào luồng poster (v:1)
    const encArgs = rawArgs.map((a) => (a.startsWith('-') && !a.includes(':') ? `${a}:v:0` : a));
    args.push(...encArgs);
    if (scale) args.push('-filter:v:0', gpuDecode ? scale.replace(/^scale=/, 'scale_cuda=') : scale);
    // Giữ thông tin màu (quan trọng với HDR10 / HLG)
    if (v.colorPrimaries && v.colorPrimaries !== 'unknown') args.push('-color_primaries:v:0', v.colorPrimaries);
    if (v.colorTransfer && v.colorTransfer !== 'unknown' && preset === 'hevc') {
      args.push('-color_trc:v:0', v.colorTransfer);
    }
    if (v.colorSpace && v.colorSpace !== 'unknown') args.push('-colorspace:v:0', v.colorSpace);
    if (v.hdr === 'Dolby Vision') {
      warnings.push('Encode lại sẽ mất lớp Dolby Vision.');
    }
  }
  if (outCodec === 'hevc') {
    // Dolby Vision profile 5 không có lớp tương thích HDR10 → dùng tag dvh1
    const dvh1 = mode === 'remux' && v.hdr === 'Dolby Vision' && v.dvProfile === 5;
    args.push('-tag:v:0', dvh1 ? 'dvh1' : 'hvc1');
  } else if (outCodec === 'h264') {
    args.push('-tag:v:0', 'avc1');
  }

  // --- Audio ---
  plan.audio.forEach((a, i) => {
    if (a.action === 'copy') {
      args.push(`-c:a:${i}`, 'copy');
    } else {
      const ch = Math.min(a.channels || 2, 6);
      args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, ch > 2 ? '384k' : '192k', `-ac:a:${i}`, String(ch));
    }
    args.push(`-disposition:a:${i}`, i === 0 ? 'default' : '0');
  });

  // --- Phụ đề ---
  keptSubs.forEach((_s, i) => {
    args.push(`-c:s:${i}`, 'mov_text');
  });
  const dropped = plan.subtitles.length - keptSubs.length;
  if (dropped > 0) warnings.push(`Bỏ ${dropped} phụ đề dạng hình (PGS/VobSub) – MP4 không hỗ trợ.`);

  // --- Poster ---
  if (coverPath) {
    args.push('-c:v:1', 'copy');
    args.push('-disposition:v:1', 'attached_pic');
  }

  // --- Metadata & chương ---
  args.push('-map_metadata', '0', '-map_chapters', '0');
  if (metadata) {
    for (const [k, val] of Object.entries(metadata)) {
      if (val === undefined || val === null || val === '') continue;
      args.push('-metadata', `${k}=${val}`);
    }
  }

  args.push('-movflags', '+faststart', '-strict', 'unofficial', '-max_muxing_queue_size', '4096');
  args.push('-f', 'mp4', '-progress', 'pipe:1', '-nostats');
  args.push(outputPath);

  return { args, mode, warnings, gpuDecode };
}

// ---------------------------------------------------------------------------
// Đọc tiến độ từ `-progress pipe:1`
// ---------------------------------------------------------------------------

export interface FfmpegProgress {
  outTimeSec?: number;
  speed?: number;
  done: boolean;
}

/** Phân tích 1 khối key=value của `-progress` (có thể chứa nhiều dòng) */
export function parseFfmpegProgressChunk(chunk: string): FfmpegProgress {
  const res: FfmpegProgress = { done: false };
  for (const line of chunk.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key === 'out_time_us' || key === 'out_time_ms') {
      // Cả hai đều là micro giây (out_time_ms đặt tên sai trong ffmpeg)
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) res.outTimeSec = n / 1_000_000;
    } else if (key === 'speed') {
      const n = parseFloat(val.replace('x', ''));
      if (Number.isFinite(n)) res.speed = n;
    } else if (key === 'progress' && val === 'end') {
      res.done = true;
    }
  }
  return res;
}

/** Tên file đầu ra: "<tên gốc><hậu tố>.mp4" */
export function buildOutputFileName(sourceFileName: string, suffix: string): string {
  const dot = sourceFileName.lastIndexOf('.');
  const base = dot > 0 ? sourceFileName.slice(0, dot) : sourceFileName;
  return `${base}${suffix || ''}.mp4`;
}
