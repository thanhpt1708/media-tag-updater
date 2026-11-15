import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  FfprobeOutput,
  FfprobeStream,
  analyzeIosCompat,
  buildIosFfmpegArgs,
  buildOutputFileName,
  estimateVideoBitRate,
  parseFfmpegProgressChunk,
  resolveEncoder,
  resolveQualityValue,
} from '../electron/services/iosCompat';
import { shortFfmpegVersion } from '../electron/services/binaryManagerService';
import { IOS_ENCODE_PROFILES, applyProfile } from '../src/shared/iosEncodeProfiles';
import { IosEncodeOptions } from '../src/shared/types';

function probe(
  video: Partial<FfprobeStream> | null,
  opts: { audio?: Partial<FfprobeStream>[]; subs?: Partial<FfprobeStream>[]; format?: string } = {}
): FfprobeOutput {
  const streams: FfprobeStream[] = [];
  let idx = 0;
  if (video) {
    streams.push({ index: idx++, codec_type: 'video', width: 1920, height: 1080, ...video });
  }
  for (const a of opts.audio ?? [{ codec_name: 'aac', channels: 2 }]) {
    streams.push({ index: idx++, codec_type: 'audio', ...a });
  }
  for (const s of opts.subs ?? []) {
    streams.push({ index: idx++, codec_type: 'subtitle', ...s });
  }
  return {
    streams,
    format: { format_name: opts.format ?? 'mov,mp4,m4a,3gp,3g2,mj2', duration: '120.5' },
  };
}

const H264_8BIT = { codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p', level: 41, codec_tag_string: 'avc1' };
const HEVC_MAIN10 = { codec_name: 'hevc', profile: 'Main 10', pix_fmt: 'yuv420p10le', level: 153, codec_tag_string: 'hvc1' };

describe('analyzeIosCompat', () => {
  it('H.264 8-bit trong MP4 + AAC → compatible', () => {
    const r = analyzeIosCompat(probe(H264_8BIT), '.mp4');
    expect(r.compat.level).toBe('compatible');
    expect(r.compat.reasons).toEqual([]);
    expect(r.video?.action).toBe('copy');
    expect(r.compat.summary).toContain('H.264 High');
  });

  it('HEVC Main 10 HDR10 trong MP4 (hvc1) → compatible và nhận diện HDR10', () => {
    const r = analyzeIosCompat(
      probe({ ...HEVC_MAIN10, color_transfer: 'smpte2084', color_primaries: 'bt2020' }, {
        audio: [{ codec_name: 'eac3', channels: 6 }],
      }),
      '.mp4'
    );
    expect(r.compat.level).toBe('compatible');
    expect(r.compat.hdr).toBe('HDR10');
    expect(r.compat.summary).toContain('E-AC3 5.1');
  });

  it('H.264 Hi10P trong MKV → transcode', () => {
    const r = analyzeIosCompat(
      probe({ codec_name: 'h264', profile: 'High 10', pix_fmt: 'yuv420p10le' }, { format: 'matroska,webm' }),
      '.mkv'
    );
    expect(r.compat.level).toBe('transcode');
    expect(r.video?.action).toBe('transcode');
    expect(r.compat.reasons.join(' ')).toMatch(/Hi10P/);
  });

  it('H.264 4:2:2 → transcode', () => {
    const r = analyzeIosCompat(probe({ codec_name: 'h264', profile: 'High 4:2:2', pix_fmt: 'yuv422p' }), '.mp4');
    expect(r.compat.level).toBe('transcode');
  });

  it('HEVC trong MKV + DTS → remux (copy hình, audio sang AAC)', () => {
    const r = analyzeIosCompat(
      probe(HEVC_MAIN10, { audio: [{ codec_name: 'dts', channels: 6 }], format: 'matroska,webm' }),
      '.mkv'
    );
    expect(r.compat.level).toBe('remux');
    expect(r.video?.action).toBe('copy');
    expect(r.audio[0].action).toBe('aac');
  });

  it('HEVC tag hev1 trong MP4 → remux', () => {
    const r = analyzeIosCompat(probe({ ...HEVC_MAIN10, codec_tag_string: 'hev1' }), '.mp4');
    expect(r.compat.level).toBe('remux');
    expect(r.compat.reasons.join(' ')).toMatch(/hev1/);
  });

  it('VP9 / AV1 / MPEG-4 ASP → transcode', () => {
    for (const codec of ['vp9', 'av1', 'mpeg4', 'wmv3', 'mpeg2video']) {
      const r = analyzeIosCompat(probe({ codec_name: codec, pix_fmt: 'yuv420p' }), '.mp4');
      expect(r.compat.level, codec).toBe('transcode');
    }
  });

  it('Bỏ qua luồng poster (attached_pic) khi chọn luồng hình', () => {
    const p = probe(H264_8BIT);
    p.streams!.unshift({
      index: 99,
      codec_type: 'video',
      codec_name: 'mjpeg',
      pix_fmt: 'yuvj420p',
      disposition: { attached_pic: 1 },
    });
    const r = analyzeIosCompat(p, '.mp4');
    expect(r.video?.codec).toBe('h264');
    expect(r.compat.level).toBe('compatible');
  });

  it('Phụ đề: SRT → mov_text, PGS → bỏ kèm ghi chú', () => {
    const r = analyzeIosCompat(
      probe(H264_8BIT, {
        subs: [{ codec_name: 'subrip' }, { codec_name: 'hdmv_pgs_subtitle' }],
        format: 'matroska,webm',
      }),
      '.mkv'
    );
    expect(r.subtitles.map((s) => s.action)).toEqual(['mov_text', 'drop']);
    expect(r.compat.notes.join(' ')).toMatch(/hình/);
  });

  it('Không có luồng hình → unknown', () => {
    const r = analyzeIosCompat(probe(null), '.mp4');
    expect(r.compat.level).toBe('unknown');
  });
});

describe('buildIosFfmpegArgs', () => {
  it('Remux HEVC MKV → copy hình, tag hvc1, faststart, audio DTS → AAC', () => {
    const plan = analyzeIosCompat(
      probe(HEVC_MAIN10, {
        audio: [{ codec_name: 'dts', channels: 6 }, { codec_name: 'aac', channels: 2 }],
        subs: [{ codec_name: 'subrip' }, { codec_name: 'hdmv_pgs_subtitle' }],
        format: 'matroska,webm',
      }),
      '.mkv'
    );
    const { args, mode, warnings } = buildIosFfmpegArgs({
      inputPath: 'in.mkv',
      outputPath: 'out.mp4',
      plan,
      options: { preset: 'hevc', quality: 24, maxResolution: 0 },
      encoder: 'libx265',
    });
    const joined = args.join(' ');
    expect(mode).toBe('remux');
    expect(joined).toContain('-c:v:0 copy');
    expect(joined).toContain('-tag:v:0 hvc1');
    expect(joined).toContain('-c:a:0 aac');
    expect(joined).toContain('-ac:a:0 6');
    expect(joined).toContain('-c:a:1 copy');
    expect(joined).toContain('-c:s:0 mov_text');
    expect(joined).toContain('+faststart');
    // PGS (index 4) không được map
    expect(joined).not.toContain('-map 0:4');
    expect(warnings.join(' ')).toMatch(/PGS/);
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('Transcode Hi10P bằng NVENC → HEVC Main (8-bit) với option gắn :v:0', () => {
    const plan = analyzeIosCompat(
      probe({ codec_name: 'h264', profile: 'High 10', pix_fmt: 'yuv420p10le' }, { format: 'matroska,webm' }),
      '.mkv'
    );
    const { args, mode } = buildIosFfmpegArgs({
      inputPath: 'in.mkv',
      outputPath: 'out.mp4',
      plan,
      options: { preset: 'hevc', quality: 26, maxResolution: 0 },
      encoder: 'hevc_nvenc',
    });
    const joined = args.join(' ');
    expect(mode).toBe('transcode');
    expect(joined).toContain('-c:v:0 hevc_nvenc');
    expect(joined).toContain('-cq:v:0 26');
    // Nguồn 10-bit → giữ Main10
    expect(joined).toContain('-profile:v:0 main10');
    expect(joined).toContain('-pix_fmt:v:0 p010le');
  });

  it('Giới hạn 1080p tự chuyển sang transcode và thêm scale', () => {
    const plan = analyzeIosCompat(probe({ ...H264_8BIT, width: 3840, height: 2160 }), '.mp4');
    const { args, mode } = buildIosFfmpegArgs({
      inputPath: 'in.mp4',
      outputPath: 'out.mp4',
      plan,
      options: { preset: 'h264', quality: 21, maxResolution: 1080 },
      encoder: 'libx264',
    });
    expect(mode).toBe('transcode');
    expect(args.join(' ')).toContain('-filter:v:0 scale=-2:1080');
    expect(args.join(' ')).toContain('-level:v:0 4.1');
  });

  it('Chế độ "Chỉ remux" báo lỗi khi video cần encode lại', () => {
    const plan = analyzeIosCompat(probe({ codec_name: 'vp9', pix_fmt: 'yuv420p' }), '.webm');
    expect(() =>
      buildIosFfmpegArgs({
        inputPath: 'in.webm',
        outputPath: 'out.mp4',
        plan,
        options: { preset: 'remux-only', quality: 24, maxResolution: 0 },
        encoder: 'libx265',
      })
    ).toThrow(/remux/);
  });

  it('Nhúng poster và metadata', () => {
    const plan = analyzeIosCompat(probe(H264_8BIT, { format: 'matroska,webm' }), '.mkv');
    const { args } = buildIosFfmpegArgs({
      inputPath: 'in.mkv',
      outputPath: 'out.mp4',
      plan,
      options: { preset: 'hevc', quality: 24, maxResolution: 0 },
      encoder: 'libx265',
      coverPath: 'cover.jpg',
      metadata: { title: 'Phim Hay', date: 2024, genre: undefined },
    });
    const joined = args.join(' ');
    expect(joined).toContain('-i cover.jpg');
    expect(joined).toContain('-map 1:0');
    expect(joined).toContain('-disposition:v:1 attached_pic');
    expect(args).toContain('title=Phim Hay');
    expect(args).toContain('date=2024');
    expect(joined).not.toContain('genre=');
  });
});

describe('Mức chất lượng & trần bitrate gốc', () => {
  it('resolveQualityValue quy đổi theo encoder, custom giữ nguyên', () => {
    expect(resolveQualityValue('near-source', 30, 'libx265')).toBe(18);
    expect(resolveQualityValue('near-source', 30, 'hevc_nvenc')).toBe(19);
    expect(resolveQualityValue('balanced', 30, 'libx264')).toBe(21);
    expect(resolveQualityValue('custom', 30, 'libx265')).toBe(30);
    expect(resolveQualityValue(undefined, 27, 'hevc_nvenc')).toBe(27);
  });

  it('estimateVideoBitRate: bit_rate trực tiếp, tag BPS của MKV, hoặc ước lượng từ tổng file', () => {
    const v: FfprobeStream = { index: 0, codec_type: 'video', bit_rate: '5000000' };
    expect(estimateVideoBitRate({ streams: [v] }, v)).toBe(5_000_000);

    const mkv: FfprobeStream = { index: 0, codec_type: 'video', tags: { 'BPS-eng': '3500000' } };
    expect(estimateVideoBitRate({ streams: [mkv] }, mkv)).toBe(3_500_000);

    const bare: FfprobeStream = { index: 0, codec_type: 'video' };
    const est = estimateVideoBitRate(
      {
        streams: [bare, { index: 1, codec_type: 'audio', bit_rate: '640000' }],
        format: { bit_rate: '8640000' },
      },
      bare
    );
    expect(est).toBe(Math.round(8_000_000 * 0.98));
  });

  it('Gần như gốc + trần bitrate → CRF 18 kèm -maxrate/-bufsize theo bitrate gốc', () => {
    const plan = analyzeIosCompat(
      probe({ codec_name: 'vp9', pix_fmt: 'yuv420p', bit_rate: '4000000' }),
      '.webm'
    );
    expect(plan.compat.summary).toContain('4.0 Mbps');
    const { args } = buildIosFfmpegArgs({
      inputPath: 'in.webm',
      outputPath: 'out.mp4',
      plan,
      options: { preset: 'hevc', quality: 30, qualityMode: 'near-source', capToSourceBitrate: true, maxResolution: 0 },
      encoder: 'libx265',
    });
    const joined = args.join(' ');
    expect(joined).toContain('-crf:v:0 18');
    expect(joined).toContain('-maxrate:v:0 4000k');
    expect(joined).toContain('-bufsize:v:0 8000k');
  });

  it('QSV không hỗ trợ trần bitrate → bỏ qua kèm cảnh báo', () => {
    const plan = analyzeIosCompat(probe({ codec_name: 'vp9', pix_fmt: 'yuv420p', bit_rate: '4000000' }), '.webm');
    const { args, warnings } = buildIosFfmpegArgs({
      inputPath: 'in.webm',
      outputPath: 'out.mp4',
      plan,
      options: { preset: 'hevc', quality: 24, qualityMode: 'balanced', capToSourceBitrate: true, maxResolution: 0 },
      encoder: 'hevc_qsv',
    });
    expect(args.join(' ')).not.toContain('-maxrate');
    expect(warnings.join(' ')).toMatch(/hevc_qsv/);
  });
});

describe('GPU decode (NVDEC)', () => {
  const opts = { preset: 'hevc' as const, quality: 24, maxResolution: 0 as const };

  it('VP9 → NVENC: bật -hwaccel cuda, bỏ -pix_fmt để khung hình ở lại GPU', () => {
    const plan = analyzeIosCompat(probe({ codec_name: 'vp9', pix_fmt: 'yuv420p' }), '.webm');
    const r = buildIosFfmpegArgs({ inputPath: 'in', outputPath: 'out.mp4', plan, options: opts, encoder: 'hevc_nvenc', allowGpuDecode: true });
    const joined = r.args.join(' ');
    expect(r.gpuDecode).toBe(true);
    expect(joined.indexOf('-hwaccel cuda -hwaccel_output_format cuda')).toBeLessThan(joined.indexOf('-i in'));
    expect(joined).not.toContain('-pix_fmt');
  });

  it('Thu nhỏ khi GPU decode dùng scale_cuda', () => {
    const plan = analyzeIosCompat(probe({ codec_name: 'vp9', pix_fmt: 'yuv420p', width: 3840, height: 2160 }), '.webm');
    const r = buildIosFfmpegArgs({
      inputPath: 'in', outputPath: 'out.mp4', plan,
      options: { ...opts, maxResolution: 1080 }, encoder: 'hevc_nvenc', allowGpuDecode: true,
    });
    expect(r.args.join(' ')).toContain('-filter:v:0 scale_cuda=-2:1080');
  });

  it('Không bật với Hi10P, encoder CPU, khi tắt allowGpuDecode, hoặc khi phải đổi 10-bit → 8-bit', () => {
    const hi10p = analyzeIosCompat(probe({ codec_name: 'h264', profile: 'High 10', pix_fmt: 'yuv420p10le' }), '.mkv');
    expect(buildIosFfmpegArgs({ inputPath: 'in', outputPath: 'o.mp4', plan: hi10p, options: opts, encoder: 'hevc_nvenc', allowGpuDecode: true }).gpuDecode).toBe(false);

    const vp9 = analyzeIosCompat(probe({ codec_name: 'vp9', pix_fmt: 'yuv420p' }), '.webm');
    expect(buildIosFfmpegArgs({ inputPath: 'in', outputPath: 'o.mp4', plan: vp9, options: opts, encoder: 'libx265', allowGpuDecode: true }).gpuDecode).toBe(false);
    expect(buildIosFfmpegArgs({ inputPath: 'in', outputPath: 'o.mp4', plan: vp9, options: opts, encoder: 'hevc_nvenc', allowGpuDecode: false }).gpuDecode).toBe(false);

    const vp9_10 = analyzeIosCompat(probe({ codec_name: 'vp9', pix_fmt: 'yuv420p10le' }), '.webm');
    const h264Out = buildIosFfmpegArgs({
      inputPath: 'in', outputPath: 'o.mp4', plan: vp9_10,
      options: { ...opts, preset: 'h264' }, encoder: 'h264_nvenc', allowGpuDecode: true,
    });
    expect(h264Out.gpuDecode).toBe(false);
    expect(h264Out.args.join(' ')).toContain('-pix_fmt:v:0 yuv420p');
  });
});

describe('Hồ sơ chọn nhanh (chế độ Đơn giản)', () => {
  const base: IosEncodeOptions = {
    uiMode: 'simple',
    profile: 'custom',
    preset: 'remux-only',
    encoder: 'hevc_qsv',
    qualityMode: 'custom',
    quality: 30,
    capToSourceBitrate: false,
    maxResolution: 720,
    skipCompatible: false,
    outputMode: 'custom-folder',
    outputDir: 'E:\\Out',
    outputSuffix: '.iphone',
    afterSuccess: 'trash',
  };

  it('applyProfile đặt phần mã hoá nhưng giữ nơi lưu, hậu tố, xử lý file gốc', () => {
    const r = applyProfile(base, 'best');
    expect(r).toMatchObject({
      profile: 'best',
      preset: 'hevc',
      encoder: 'libx265',
      qualityMode: 'near-source',
      capToSourceBitrate: false,
      maxResolution: 0,
      skipCompatible: true,
      outputDir: 'E:\\Out',
      outputSuffix: '.iphone',
      afterSuccess: 'trash',
    });
  });

  it('Mọi hồ sơ cho ra lệnh ffmpeg hợp lệ', () => {
    const plan = analyzeIosCompat(probe({ codec_name: 'vp9', pix_fmt: 'yuv420p', bit_rate: '3000000' }), '.webm');
    for (const p of IOS_ENCODE_PROFILES) {
      const opts = applyProfile(base, p.id);
      const encoder = resolveEncoder(opts.preset === 'h264' ? 'h264' : 'hevc', opts.encoder, ['libx265', 'libx264']);
      const { args, mode } = buildIosFfmpegArgs({ inputPath: 'in', outputPath: 'out.mp4', plan, options: opts, encoder });
      expect(mode, p.id).toBe('transcode');
      expect(args.join(' '), p.id).toContain(opts.preset === 'h264' ? '-c:v:0 libx264' : '-c:v:0 libx265');
    }
  });
});

describe('binaryManager – nhiều bản ffmpeg', () => {
  it('shortFfmpegVersion', () => {
    expect(shortFfmpegVersion('ffmpeg version 9.0.2-essentials_build-www.gyan.dev Copyright')).toBe('9.0.2');
    expect(shortFfmpegVersion('ffmpeg version 6.1.1-essentials_build-www.gyan.dev')).toBe('6.1.1');
    expect(shortFfmpegVersion('ffmpeg version n7.1 Copyright')).toBe('7.1');
    expect(shortFfmpegVersion(undefined)).toBeUndefined();
  });
});

describe('Tiện ích', () => {
  it('resolveEncoder ưu tiên GPU và rơi về phần mềm', () => {
    expect(resolveEncoder('hevc', 'auto', ['libx265', 'hevc_qsv'])).toBe('hevc_qsv');
    expect(resolveEncoder('hevc', 'auto', [])).toBe('libx265');
    expect(resolveEncoder('hevc', 'hevc_nvenc', ['libx265'])).toBe('libx265');
    expect(resolveEncoder('h264', 'libx264', ['h264_nvenc', 'libx264'])).toBe('libx264');
    // Chọn encoder HEVC nhưng preset H.264 → bỏ qua lựa chọn
    expect(resolveEncoder('h264', 'hevc_nvenc', ['hevc_nvenc', 'h264_nvenc'])).toBe('h264_nvenc');
  });

  it('parseFfmpegProgressChunk', () => {
    const p = parseFfmpegProgressChunk('frame=10\nout_time_us=12500000\nspeed=3.21x\nprogress=continue\n');
    expect(p.outTimeSec).toBeCloseTo(12.5);
    expect(p.speed).toBeCloseTo(3.21);
    expect(p.done).toBe(false);
    expect(parseFfmpegProgressChunk('progress=end').done).toBe(true);
  });

  it('buildOutputFileName', () => {
    expect(buildOutputFileName('Phim.2024.1080p.mkv', '.ios')).toBe('Phim.2024.1080p.ios.mp4');
    expect(buildOutputFileName('clip', '')).toBe('clip.mp4');
  });
});

// ---------------------------------------------------------------------------
// Kiểm thử thật với ffmpeg/ffprobe trong ./bin (bỏ qua nếu không có)
// ---------------------------------------------------------------------------
const BIN_FFMPEG = path.resolve('bin/ffmpeg.exe');
const BIN_FFPROBE = path.resolve('bin/ffprobe.exe');
const hasBins = fs.existsSync(BIN_FFMPEG) && fs.existsSync(BIN_FFPROBE);

describe.skipIf(!hasBins)('Encode thật bằng ffmpeg ./bin', () => {
  const ffprobeJson = (file: string): FfprobeOutput =>
    JSON.parse(
      execFileSync(BIN_FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
        encoding: 'utf8',
      })
    );

  it('Hi10P MKV + FLAC + SRT → HEVC MP4 tương thích iPhone', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-compat-'));
    try {
      const srt = path.join(dir, 'sub.srt');
      fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nXin chào\n');
      const src = path.join(dir, 'hi10p.mkv');
      execFileSync(BIN_FFMPEG, [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=2',
        '-f', 'lavfi', '-i', 'sine=f=440:d=2',
        '-i', srt,
        '-map', '0:v', '-map', '1:a', '-map', '2:s',
        '-c:v', 'libx264', '-profile:v', 'high10', '-pix_fmt', 'yuv420p10le',
        '-c:a', 'flac', '-c:s', 'srt',
        src,
      ]);

      const plan = analyzeIosCompat(ffprobeJson(src), '.mkv');
      expect(plan.compat.level).toBe('transcode');

      const out = path.join(dir, 'out.mp4');
      const { args } = buildIosFfmpegArgs({
        inputPath: src,
        outputPath: out,
        plan,
        options: { preset: 'hevc', quality: 28, maxResolution: 0 },
        encoder: 'libx265',
        metadata: { title: 'Thử nghiệm' },
      });
      execFileSync(BIN_FFMPEG, args, { stdio: 'pipe' });

      const outProbe = ffprobeJson(out);
      const outPlan = analyzeIosCompat(outProbe, '.mp4');
      expect(outPlan.compat.level).toBe('compatible');
      const v = outProbe.streams!.find((s) => s.codec_type === 'video')!;
      expect(v.codec_name).toBe('hevc');
      expect(v.codec_tag_string).toBe('hvc1');
      expect(outProbe.streams!.find((s) => s.codec_type === 'audio')!.codec_name).toBe('aac');
      expect(outProbe.streams!.find((s) => s.codec_type === 'subtitle')!.codec_name).toBe('mov_text');
      expect((outProbe.format as any).tags?.title).toBe('Thử nghiệm');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
