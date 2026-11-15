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
  ffmpegSource?: 'custom' | 'project-bin' | 'ffmpeg-static' | 'system-path' | 'none';
  ffmpegVersion?: string;
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
  /** filePath → thời lượng video (ms) đã đọc được */
  videoDurations: Record<string, number>;
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
}

declare global {
  interface Window {
    mediaApi: ElectronMediaApi;
  }
}
