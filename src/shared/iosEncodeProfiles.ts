import { IosEncodeOptions, IosEncodeProfileId } from './types';

export interface IosEncodeProfile {
  id: Exclude<IosEncodeProfileId, 'custom'>;
  icon: string;
  title: string;
  /** Một dòng ngắn hiện trên thẻ */
  tagline: string;
  /** Giải thích đầy đủ khi chọn thẻ */
  details: string;
  recommended?: boolean;
  /** Cần GPU encoder để phát huy (thẻ hiện cảnh báo nếu máy không có) */
  wantsGpu?: boolean;
  settings: Pick<
    IosEncodeOptions,
    'preset' | 'encoder' | 'qualityMode' | 'capToSourceBitrate' | 'maxResolution'
  >;
}

/**
 * Các hồ sơ "chọn là chạy" cho người dùng không muốn chỉnh sâu.
 * Mỗi hồ sơ chỉ đặt phần mã hoá; nơi lưu / xử lý file gốc vẫn do người dùng chọn.
 */
export const IOS_ENCODE_PROFILES: IosEncodeProfile[] = [
  {
    id: 'balanced',
    icon: '⚖️',
    title: 'Cân bằng',
    tagline: 'Đẹp, nhỏ gọn, tự dùng GPU nếu có',
    details:
      'HEVC chất lượng "Cân bằng": khó thấy khác bản gốc trên màn hình điện thoại, file nhỏ hơn rõ. ' +
      'Tự dùng card đồ hoạ nếu máy có, không thì dùng CPU. Hợp với đa số nhu cầu xem trên iPhone/iPad.',
    recommended: true,
    settings: { preset: 'hevc', encoder: 'auto', qualityMode: 'balanced', capToSourceBitrate: true, maxResolution: 0 },
  },
  {
    id: 'fast-gpu',
    icon: '⚡',
    title: 'Nhanh – giữ gần như gốc',
    tagline: 'Dùng GPU, nhanh gấp ~5–10 lần CPU',
    details:
      'HEVC mức "Gần như gốc" bằng card đồ hoạ (NVENC/Quick Sync/AMF): hình gần như không khác bản gốc, ' +
      'tốc độ rất nhanh. File thường lớn hơn bản x265 khoảng 20–40% nên bật sẵn giới hạn "không vượt bitrate gốc".',
    wantsGpu: true,
    settings: { preset: 'hevc', encoder: 'auto', qualityMode: 'near-source', capToSourceBitrate: true, maxResolution: 0 },
  },
  {
    id: 'best',
    icon: '⭐',
    title: 'Đẹp nhất – lưu trữ',
    tagline: 'x265 trên CPU, chậm nhưng nén tốt nhất',
    details:
      'HEVC mức "Gần như gốc" bằng x265 (CPU), không giới hạn bitrate: chất lượng cao nhất có thể khi phải encode lại, ' +
      'nén hiệu quả nhất. Chậm (khoảng 1–2× thời gian thực ở 1080p) – nên dùng khi muốn giữ lâu dài và xoá bản gốc.',
    settings: { preset: 'hevc', encoder: 'libx265', qualityMode: 'near-source', capToSourceBitrate: false, maxResolution: 0 },
  },
  {
    id: 'compact',
    icon: '📦',
    title: 'Tiết kiệm dung lượng',
    tagline: 'File nhỏ nhất, hơi mờ ở cảnh khó',
    details:
      'HEVC mức "Tiết kiệm" bằng x265 (CPU) – x265 giữ chi tiết tốt hơn GPU khi nén mạnh. ' +
      'Hợp để chép nhiều phim vào iPhone dung lượng thấp. Có thể hơi nhoè ở cảnh tối / chuyển động nhanh.',
    settings: { preset: 'hevc', encoder: 'libx265', qualityMode: 'compact', capToSourceBitrate: true, maxResolution: 0 },
  },
  {
    id: 'legacy',
    icon: '📱',
    title: 'Máy đời cũ (H.264)',
    tagline: 'Phát trên mọi iPhone/iPad, kể cả trước 6s',
    details:
      'H.264 8-bit – mọi thiết bị Apple đều giải mã phần cứng, kể cả máy trước iPhone 6s (2015). ' +
      'File lớn hơn HEVC khoảng 40% và không giữ HDR. Chỉ chọn khi thiết bị xem quá cũ.',
    settings: { preset: 'h264', encoder: 'auto', qualityMode: 'balanced', capToSourceBitrate: true, maxResolution: 0 },
  },
];

export function getProfile(id: IosEncodeProfileId): IosEncodeProfile | undefined {
  return IOS_ENCODE_PROFILES.find((p) => p.id === id);
}

/** Áp hồ sơ vào tuỳ chọn hiện tại (giữ nguyên nơi lưu, hậu tố, xử lý file gốc) */
export function applyProfile(options: IosEncodeOptions, id: Exclude<IosEncodeProfileId, 'custom'>): IosEncodeOptions {
  const p = getProfile(id);
  if (!p) return options;
  return { ...options, ...p.settings, skipCompatible: true, profile: id };
}

/** Hướng dẫn cho từng mục ở chế độ Nâng cao */
export const IOS_ENCODE_HELP = {
  preset:
    'HEVC (H.265): chuẩn khuyên dùng – iPhone 6s trở lên giải mã phần cứng, file nhỏ hơn H.264 ~40%, giữ được 10-bit/HDR.\n' +
    'H.264: phát trên mọi thiết bị Apple nhưng file lớn hơn và chỉ 8-bit SDR (video HDR sẽ nhạt màu).\n' +
    'Chỉ remux: không encode lại hình, chỉ đổi container/audio – nhanh, giữ 100% chất lượng nhưng bỏ qua các file bắt buộc phải encode.',
  encoder:
    'GPU (NVENC / Quick Sync / AMF): mạch encode chuyên dụng, nhanh gấp 5–10 lần nhưng thuật toán bị giới hạn để chạy thời gian thực ' +
    '→ cùng chất lượng thì file lớn hơn 20–40%. GPU đời cũ (vd GTX 10xx) không có B-frame cho HEVC nên chênh lệch rõ hơn.\n' +
    'CPU (x265 / x264): thử nhiều phương án nén hơn và có thuật toán "theo mắt người" → đẹp nhất ở cùng dung lượng, nhưng chậm.\n' +
    'Tự động: dùng GPU nếu máy có, không thì CPU.',
  quality:
    'CRF (CPU) / CQ (GPU): số càng thấp hình càng đẹp và file càng lớn. Mỗi bậc ±6 thường làm dung lượng thay đổi khoảng gấp đôi / một nửa.\n' +
    'Gần như gốc: mắt thường không phân biệt được với bản gốc. Cân bằng: khó thấy khác trên điện thoại. Tiết kiệm: file nhỏ, hơi mờ ở cảnh khó.\n' +
    'App tự quy đổi mức chọn sang con số phù hợp từng encoder. Chọn "Tuỳ chỉnh" để tự đặt số.\n' +
    'Lưu ý: encode lại luôn mất một chút so với gốc – chỉ remux mới giữ được 100%. Đặt số rất thấp (dưới 16) chỉ làm file phình to mà không đẹp hơn thấy được.',
  cap:
    'Đặt giới hạn bitrate (-maxrate) bằng bitrate hình của file gốc. Ở mức chất lượng cao, file đích sẽ xấp xỉ hoặc nhỏ hơn bản gốc ' +
    'thay vì phình to (có thể chênh vài % ở video ngắn). Áp dụng cho x265, x264 và NVENC.',
  resolution:
    'Thu nhỏ video quá lớn. Màn hình iPhone hiển thị tốt ở 1080p; giữ 4K nếu xem qua AirPlay lên TV. ' +
    'Chọn mức nhỏ hơn video gốc sẽ buộc encode lại cả những file vốn chỉ cần remux.',
  output:
    'File mới luôn là .mp4, đặt tên "<tên gốc><hậu tố>.mp4". Trùng tên thì tự thêm (2), (3)... ' +
    'File được ghi tạm .part.mp4 và chỉ đổi tên khi đã kiểm tra đạt chuẩn.',
  other:
    'Bỏ qua file đã tương thích: không encode lại file iPhone vốn phát tốt (tránh mất chất lượng vô ích).\n' +
    'Chuyển file gốc vào Thùng rác: chỉ thực hiện sau khi file mới đã được ffprobe kiểm tra đạt chuẩn; có thể khôi phục từ Thùng rác.',
} as const;
