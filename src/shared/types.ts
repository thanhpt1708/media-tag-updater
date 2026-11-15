export type MediaType = 'audio' | 'video' | 'image';

export interface ParsedSceneInfo {
  rawFilename: string;
  cleanTitle: string;
  originalTitle?: string;
  year?: number;
  isTvShow: boolean;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  episodeTitle?: string;
  resolution?: string;
  source?: string;
  videoCodec?: string;
  hdrFormat?: string[];
  audioCodec?: string;
  audioChannels?: string;
  edition?: string[];
  releaseGroup?: string;
  languageTags?: string[];
  isProperOrRepack?: boolean;
  crc32?: string;
  // Thông tin mở rộng cho 18+, OnlyFans/Creator & JAV
  javCode?: string;
  releaseDate?: string;
  siteOrStudio?: string;
  isAdult?: boolean;
}

export interface MediaMetadata {
  title?: string;
  originalTitle?: string;
  artist?: string;        // Ca sĩ (Nhạc), Đạo diễn/Diễn viên (Phim), Tác giả (Ảnh)
  albumArtist?: string;
  album?: string;         // Album (Nhạc), Tên Series / Bộ sưu tập (Phim)
  year?: number;
  genre?: string;
  trackNumber?: number;   // Số thứ tự bài (Nhạc) hoặc Tập phim (Video)
  seasonNumber?: number;  // Mùa phim (Video Series)
  comment?: string;       // Lời bình / Tóm tắt nội dung phim (Plot/Overview)
  copyright?: string;
  releaseGroup?: string;  // Nhóm Rip (Video)
  // Thông tin chuyên biệt cho Ảnh (EXIF / IPTC / XMP / GPS)
  cameraModel?: string;
  dateTaken?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  locationName?: string;
  keywords?: string[];
  // Thumbnail / Cover Art / Poster (dạng Base64 data URL)
  thumbnailDataUrl?: string;
}

export interface MediaFileItem {
  id: string;
  filePath: string;
  fileName: string;
  extension: string;
  directory: string;
  fileSize: number;
  modifiedAt: number;
  mediaType: MediaType;
  metadata: MediaMetadata;
  sceneInfo?: ParsedSceneInfo;
  /** Thông tin kỹ thuật đọc từ header file video (thời lượng, độ phân giải thực) */
  videoInfo?: VideoTechInfo;
  hasEmbeddedThumbnail: boolean;
  isModified?: boolean;
}

export interface OnlineSearchLogEntry {
  timestamp: string;
  provider: string;
  url: string;
  status?: number;
  durationMs: number;
  resultCount: number;
  error?: string;
  responsePreview?: string;
}

export interface OnlineMetadataResult {
  id: string;
  source:
    | 'itunes-music'
    | 'deezer'
    | 'musicbrainz'
    | 'discogs'
    | 'lastfm'
    | 'imdb'
    | 'tmdb-movie'
    | 'tmdb-tv'
    | 'tvmaze'
    | 'itunes-movie'
    | 'anilist'
    | 'theporndb'
    | 'stashbox'
    | 'osm-gps';
  sourceLabel: string;
  mediaType: MediaType;
  confidence: number;
  metadata: MediaMetadata;
  thumbnailUrl?: string;
  extraInfo?: string;
}

export interface BinaryStatusInfo {
  ffmpegAvailable: boolean;
  ffmpegPath?: string;
  ffmpegSource?: 'custom' | 'project-bin' | 'project-bin-compat' | 'system-path' | 'none';
  ffmpegVersion?: string;
  /** ffprobe dùng để phân tích codec/profile phục vụ đánh giá tương thích iPhone/iOS */
  ffprobeAvailable: boolean;
  ffprobePath?: string;
  ffprobeSource?: 'custom' | 'next-to-ffmpeg' | 'project-bin' | 'system-path' | 'none';
  ffprobeVersion?: string;
  exiftoolAvailable: boolean;
  exiftoolPath?: string;
  exiftoolSource?: 'custom' | 'project-bin' | 'system-path' | 'none';
  exiftoolVersion?: string;
  projectBinDir: string;
}

export interface AppConfig {
  language: 'vi-VN' | 'en-US';
  tmdbApiKey: string;
  discogsToken: string;
  lastfmApiKey: string;
  theporndbApiKey: string;
  stashboxEndpoint: string;
  stashboxApiKey: string;
  includeAdultContent: boolean;
  customFfmpegPath: string;
  customFfprobePath: string;
  customExiftoolPath: string;
  preferredAudioSource: 'auto' | 'itunes' | 'deezer' | 'musicbrainz' | 'discogs';
  preferredVideoSource:
    | 'auto'
    | 'imdb'
    | 'tmdb'
    | 'tvmaze'
    | 'itunes'
    | 'anilist'
    | 'theporndb'
    | 'stashbox';
  defaultRenamePatterns: {
    audio: string;
    video: string;
    tvShow: string;
    image: string;
  };
  /** Tuỳ chọn Encode cho iPhone dùng lần gần nhất */
  iosEncode: IosEncodeOptions;
}

export interface RenamePreviewItem {
  filePath: string;
  oldName: string;
  newName: string;
  newPath: string;
  hasConflict: boolean;
  willChange: boolean;
}

export interface ExtractTagPreviewItem {
  filePath: string;
  fileName: string;
  extracted: Partial<MediaMetadata>;
  sceneInfo?: ParsedSceneInfo;
}

/**
 * Loại trùng lặp:
 * - identical:     Nội dung byte giống hệt nhau (cùng kích thước + cùng hash), chỉ khác tên/vị trí
 * - similar-image: Ảnh có nội dung hình ảnh gần giống (perceptual hash), vd: bản resize / nén lại / đổi định dạng
 * - similar-video: Video cùng thời lượng VÀ khớp hình ảnh các khung hình mẫu (bản encode lại / khác độ phân giải)
 * - same-title:    Cùng bài hát / cùng phim (theo Tag hoặc phân tích tên Scene) nhưng là file khác nhau
 * - same-duration: (độ tin cậy thấp) Video cùng thời lượng nhưng chưa xác nhận được bằng hình ảnh
 * - same-size:     (độ tin cậy thấp) Video cùng dung lượng chính xác từng byte nhưng nội dung khác
 *                  → thường là cùng bản encode nhưng khác Tag/Poster, hoặc một bản bị hỏng
 */
export type DuplicateKind =
  | 'identical'
  | 'similar-image'
  | 'similar-video'
  | 'same-title'
  | 'same-duration'
  | 'same-size';

export type DuplicateConfidence = 'high' | 'low';

export interface DuplicateGroup {
  id: string;
  kind: DuplicateKind;
  confidence: DuplicateConfidence;
  mediaType: MediaType;
  filePaths: string[];
  reason: string;
  /** Dung lượng có thể giải phóng nếu chỉ giữ lại 1 file lớn nhất trong nhóm */
  reclaimableBytes: number;
  /** Độ giống nhau thấp nhất trong nhóm (0-100), dùng cho similar-image / similar-video */
  similarity?: number;
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[];
  scannedCount: number;
  hashedCount: number;
  durationMs: number;
  /** filePath → thông tin kỹ thuật video (thời lượng, độ phân giải) đã đọc được */
  videoInfo: Record<string, VideoTechInfo>;
}

export interface VideoTechInfo {
  durationMs?: number;
  width?: number;
  height?: number;
}

// ============================================================================
// TƯƠNG THÍCH iPHONE / iOS (giải mã phần cứng qua VideoToolbox) & ENCODE
// ============================================================================

/**
 * - compatible: Giải mã phần cứng được + container MP4/MOV → phát ngay trên iPhone
 * - remux:      Hình đã đạt chuẩn, chỉ cần đổi container / tag hvc1 / chuyển audio (nhanh, giữ nguyên hình)
 * - transcode:  Phải encode lại video (Hi10P, VP9, AV1, MPEG-2, WMV, 4:2:2...)
 * - unknown:    Không phân tích được (thiếu ffprobe / file lỗi)
 */
export type IosCompatLevel = 'compatible' | 'remux' | 'transcode' | 'unknown';

export interface IosCompatInfo {
  level: IosCompatLevel;
  /** Mô tả ngắn, vd: "HEVC Main 10 · 3840×2160 · HDR10 · E-AC3 5.1" */
  summary: string;
  /** Các lý do khiến file chưa đạt chuẩn (rỗng nếu compatible) */
  reasons: string[];
  /** Ghi chú thêm, không ảnh hưởng mức tương thích (vd: phụ đề PGS sẽ bị bỏ) */
  notes: string[];
  container?: string;
  videoCodec?: string;
  videoProfile?: string;
  pixFmt?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Bitrate luồng hình của file gốc (bit/s), nếu đọc/ước lượng được */
  videoBitRate?: number;
  hdr?: 'HDR10' | 'HLG' | 'Dolby Vision';
  audioCodecs: string[];
}

export type IosEncodePreset = 'hevc' | 'h264' | 'remux-only';
export type IosVideoEncoder =
  | 'auto'
  | 'libx265'
  | 'hevc_nvenc'
  | 'hevc_qsv'
  | 'hevc_amf'
  | 'libx264'
  | 'h264_nvenc'
  | 'h264_qsv'
  | 'h264_amf';

/** Một encoder chạy được thật trên máy, kèm bản ffmpeg dùng để chạy nó */
export interface IosEncoderInfo {
  encoder: IosVideoEncoder;
  ffmpegPath: string;
  /** vd "9.0.2" / "6.1.1" */
  ffmpegVersion?: string;
  /** true nếu không phải bản ffmpeg chính (đang dùng bản dự phòng ./bin/ffmpeg-compat) */
  isFallback: boolean;
}

export interface IosEncoderDetection {
  encoders: IosEncoderInfo[];
  /** Lý do GPU encoder không dùng được (vd driver quá cũ) – để hiển thị cho người dùng */
  notes: string[];
}

export type IosQualityMode = 'near-source' | 'balanced' | 'compact' | 'custom';

/** Hồ sơ chọn nhanh ở chế độ Đơn giản ('custom' = người dùng tự chỉnh ở chế độ Nâng cao) */
export type IosEncodeProfileId = 'fast-gpu' | 'best' | 'balanced' | 'compact' | 'legacy' | 'custom';

export interface IosEncodeOptions {
  /** Giao diện đang dùng trong modal */
  uiMode: 'simple' | 'advanced';
  profile: IosEncodeProfileId;
  preset: IosEncodePreset;
  encoder: IosVideoEncoder;
  /**
   * Mức chất lượng. Các mức có sẵn tự quy đổi ra CRF/CQ phù hợp từng encoder;
   * 'custom' dùng đúng giá trị `quality`.
   */
  qualityMode: IosQualityMode;
  /** CRF / CQ khi qualityMode = 'custom' (càng thấp càng đẹp, file càng lớn) */
  quality: number;
  /** Đặt -maxrate = bitrate video gốc để file đích không phình to hơn bản gốc */
  capToSourceBitrate: boolean;
  /** Giới hạn cạnh ngắn của video (0 = giữ nguyên) */
  maxResolution: 0 | 720 | 1080 | 2160;
  /** Bỏ qua file đã tương thích sẵn */
  skipCompatible: boolean;
  outputMode: 'same-folder' | 'custom-folder';
  outputDir: string;
  /** Hậu tố thêm vào tên file đầu ra, vd ".ios" → "Phim.ios.mp4" */
  outputSuffix: string;
  /** Xử lý file gốc sau khi encode & kiểm tra thành công */
  afterSuccess: 'keep' | 'trash';
}

export type IosEncodeJobStatus =
  | 'queued'
  | 'running'
  | 'verifying'
  | 'done'
  | 'skipped'
  | 'failed'
  | 'cancelled';

export interface IosEncodeJobState {
  jobId: string;
  filePath: string;
  fileName: string;
  status: IosEncodeJobStatus;
  /** Hành động thực tế: remux (copy hình) hoặc transcode */
  mode?: 'remux' | 'transcode';
  encoder?: string;
  /** Phiên bản ffmpeg đã chạy job, vd "6.1.1" */
  ffmpegVersion?: string;
  /** Đang giải mã nguồn bằng GPU (NVDEC) */
  gpuDecode?: boolean;
  /** 0..100 */
  percent: number;
  /** Tốc độ so với thời gian thực, vd 3.2 (×) */
  speed?: number;
  etaSeconds?: number;
  outputPath?: string;
  outputSize?: number;
  message?: string;
  warnings: string[];
  sourceTrashed?: boolean;
}

export interface ElectronMediaApi {
  selectFolder: () => Promise<string | null>;
  selectFiles: () => Promise<string[]>;
  selectImageFile: () => Promise<string | null>;
  selectBinaryFile: (title: string) => Promise<string | null>;
  scanPaths: (paths: string[]) => Promise<MediaFileItem[]>;
  saveFileMetadata: (filePath: string, metadata: MediaMetadata) => Promise<MediaFileItem>;
  batchSaveMetadata: (items: { filePath: string; metadata: Partial<MediaMetadata> }[]) => Promise<{
    updated: MediaFileItem[];
    errors: { filePath: string; error: string }[];
  }>;
  parseSceneFilename: (fileName: string) => Promise<ParsedSceneInfo>;
  searchOnlineMetadata: (params: {
    query: string;
    mediaType: MediaType;
    year?: number;
    season?: number;
    episode?: number;
    artist?: string;
    gpsLatitude?: number;
    gpsLongitude?: number;
    source?: string;
  }) => Promise<OnlineMetadataResult[]>;
  getOnlineSearchLogs: () => Promise<OnlineSearchLogEntry[]>;
  fetchThumbnailAsDataUrl: (url: string) => Promise<string | null>;
  previewRenameFiles: (items: MediaFileItem[], pattern: string) => Promise<RenamePreviewItem[]>;
  executeRenameFiles: (renames: { oldPath: string; newPath: string }[]) => Promise<{
    renamed: { oldPath: string; newItem: MediaFileItem }[];
    errors: { oldPath: string; error: string }[];
  }>;
  previewExtractTags: (items: MediaFileItem[], mode: 'smart-scene' | 'pattern', pattern?: string) => Promise<ExtractTagPreviewItem[]>;
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: Partial<AppConfig>) => Promise<AppConfig>;
  getBinaryStatus: () => Promise<BinaryStatusInfo>;
  installBinariesToProject: () => Promise<{ success: boolean; message: string; status: BinaryStatusInfo }>;
  openPathInExplorer: (targetPath: string) => Promise<void>;
  findDuplicates: (items: MediaFileItem[]) => Promise<DuplicateScanResult>;
  moveFilesToTrash: (filePaths: string[]) => Promise<{
    trashed: string[];
    errors: { filePath: string; error: string }[];
  }>;
  /**
   * Trả ngay kết quả đã có trong cache; các file chưa có sẽ được ffprobe chạy nền
   * và gửi dần về qua `onIosCompatUpdated`.
   */
  probeIosCompat: (filePaths: string[]) => Promise<Record<string, IosCompatInfo>>;
  onIosCompatUpdated: (
    cb: (updates: { filePath: string; info: IosCompatInfo }[]) => void
  ) => () => void;
  /** Các encoder video chạy được thực sự trên máy (đã thử encode) */
  getAvailableEncoders: () => Promise<IosEncoderDetection>;
  startIosEncode: (filePaths: string[], options: IosEncodeOptions) => Promise<IosEncodeJobState[]>;
  cancelIosEncode: (jobId?: string) => Promise<void>;
  onIosEncodeProgress: (cb: (job: IosEncodeJobState) => void) => () => void;
}

declare global {
  interface Window {
    mediaApi: ElectronMediaApi;
  }
}
