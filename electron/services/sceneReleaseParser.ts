import path from 'node:path';
import { ParsedSceneInfo } from '../../src/shared/types';

const MEDIA_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.m4v', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m2ts',
  '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma'
]);

const RESOLUTION_MAP: Record<string, string> = {
  '2160p': '2160p',
  '4k': '2160p',
  'uhd': '2160p',
  '1080p': '1080p',
  '1080i': '1080i',
  'fhd': '1080p',
  '720p': '720p',
  'hd': '720p',
  '576p': '576p',
  '480p': '480p',
  '360p': '360p',
};

const SOURCE_MAP: Record<string, string> = {
  'bluray': 'BluRay',
  'blu-ray': 'BluRay',
  'bdrip': 'BDRip',
  'brrip': 'BRRip',
  'bdremux': 'BluRay REMUX',
  'remux': 'REMUX',
  'web-dl': 'WEB-DL',
  'webdl': 'WEB-DL',
  'webrip': 'WEBRip',
  'web': 'WEB',
  'hdtv': 'HDTV',
  'pdtv': 'PDTV',
  'dvdrip': 'DVDRip',
  'dvd5': 'DVD5',
  'dvd9': 'DVD9',
  'dvdscr': 'DVDSCR',
  'hdcam': 'HDCAM',
  'cam': 'CAM',
  'hdts': 'HDTS',
  'ts': 'TS',
  'telesync': 'TS',
  'tc': 'TC',
  'bd': 'BluRay',
};

const STREAMING_SERVICES = new Set([
  'nf', 'amzn', 'dsnp', 'atvp', 'hmax', 'max', 'pcok', 'ma', 'cr', 'baha', 'it', 'hulu', 'stan', 'bbc', 'iplayer'
]);

const VIDEO_CODEC_MAP: Record<string, string> = {
  'x264': 'x264',
  'h264': 'H.264',
  'h-264': 'H.264',
  'avc': 'AVC',
  'x265': 'x265',
  'h265': 'H.265',
  'h-265': 'H.265',
  'hevc': 'HEVC',
  'av1': 'AV1',
  'xvid': 'XviD',
  'divx': 'DivX',
  'mpeg2': 'MPEG-2',
  'vc-1': 'VC-1',
  'vc1': 'VC-1',
};

const HDR_MAP: Record<string, string> = {
  'hdr': 'HDR',
  'hdr10': 'HDR10',
  'hdr10+': 'HDR10+',
  'hdr10plus': 'HDR10+',
  'dv': 'Dolby Vision',
  'dovi': 'Dolby Vision',
  'dolby-vision': 'Dolby Vision',
  'hlg': 'HLG',
  'sdr': 'SDR',
  '10bit': '10-bit',
  '10-bit': '10-bit',
  '8bit': '8-bit',
};

const AUDIO_CODEC_MAP: Record<string, string> = {
  'atmos': 'Atmos',
  'truehd': 'TrueHD',
  'ddp': 'DDP (E-AC-3)',
  'dd+': 'DDP (E-AC-3)',
  'eac3': 'E-AC-3',
  'e-ac-3': 'E-AC-3',
  'dd': 'DD (AC-3)',
  'ac3': 'AC-3',
  'ac-3': 'AC-3',
  'dts-hd-ma': 'DTS-HD MA',
  'dts-hd': 'DTS-HD',
  'dts-x': 'DTS:X',
  'dtsx': 'DTS:X',
  'dts': 'DTS',
  'aac': 'AAC',
  'flac': 'FLAC',
  'lpcm': 'LPCM',
  'pcm': 'PCM',
  'opus': 'Opus',
  'mp3': 'MP3',
};

const EDITION_MAP: Record<string, string> = {
  'imax': 'IMAX',
  'extended': 'Extended',
  'directors-cut': "Director's Cut",
  'dc': "Director's Cut",
  'theatrical': 'Theatrical',
  'unrated': 'Unrated',
  'uncut': 'Uncut',
  'remastered': 'Remastered',
  '4k-remaster': '4K Remaster',
  'restored': 'Restored',
  'open-matte': 'Open Matte',
  'criterion': 'Criterion',
  'special-edition': 'Special Edition',
  'anniversary-edition': 'Anniversary Edition',
  'ultimate-edition': 'Ultimate Edition',
  'collector-edition': "Collector's Edition",
  '3d': '3D',
  'hsbs': '3D HSBS',
  'h-ou': '3D H-OU',
};

const REPACK_TOKENS = new Set(['proper', 'repack', 'rerip', 'real', 'internal', 'limited', 'festival']);

const LANGUAGE_MAP: Record<string, string> = {
  'vie': 'Tiếng Việt (ViE)',
  'vietsub': 'VietSub',
  'vsub': 'VietSub',
  'thuyetminh': 'Thuyết Minh',
  'tm': 'Thuyết Minh',
  'longtieng': 'Lồng Tiếng',
  'lt': 'Lồng Tiếng',
  'uslt': 'Lồng Tiếng US',
  'eng': 'English',
  'jpn': 'Japanese',
  'kor': 'Korean',
  'chi': 'Chinese',
  'fre': 'French',
  'ger': 'German',
  'spa': 'Spanish',
  'rus': 'Russian',
  'ita': 'Italian',
  'multi': 'Multi-Audio/Sub',
  'dual': 'Dual-Audio',
  'dual-audio': 'Dual-Audio',
  'subbed': 'Subbed',
  'dubbed': 'Dubbed',
  'hc': 'Hardcoded Sub',
  'korsub': 'KorSub',
};

const CONTAINER_OR_JUNK_TOKENS = new Set([
  'mkv', 'mp4', 'avi', 'sample', 'complete',
  'uhd', 'fhd', 'hdrip', 'bd50', 'bd25', 'xxx'
]);

const NON_JAV_PREFIXES = new Set([
  'WEB', 'BLU', 'DTS', 'HDR', 'AAC', 'AC3', 'DDP', 'EAC', 'AVC', 'HEV',
  'UTF', 'ISO', 'WIN', 'MAC', 'PART', 'DISC', 'EPISODE', 'SEASON', 'VOL'
]);

/**
 * Kiểm tra xem một token (đã chuyển chữ thường) có phải là token kỹ thuật chuẩn Scene/P2P không
 */
function isTechnicalToken(lowerToken: string): boolean {
  if (
    RESOLUTION_MAP[lowerToken] ||
    SOURCE_MAP[lowerToken] ||
    STREAMING_SERVICES.has(lowerToken) ||
    VIDEO_CODEC_MAP[lowerToken] ||
    HDR_MAP[lowerToken] ||
    AUDIO_CODEC_MAP[lowerToken] ||
    EDITION_MAP[lowerToken] ||
    REPACK_TOKENS.has(lowerToken) ||
    LANGUAGE_MAP[lowerToken] ||
    CONTAINER_OR_JUNK_TOKENS.has(lowerToken)
  ) {
    return true;
  }
  // Các mẫu gộp kênh âm thanh như DDP5-1, DD5-1, AAC2-0
  if (/^(ddp|dd|aac|ac3|eac3|dts|flac|truehd|atmos)[0-9]([-.][0-9])?$/i.test(lowerToken)) {
    return true;
  }
  if (/^[257][-.][01]$/i.test(lowerToken)) {
    return true;
  }
  return false;
}

/**
 * Chuẩn hóa chuỗi tổ hợp đa từ (multi-word technical tokens) bằng dấu gạch ngang để không bị cắt khi split theo dấu chấm
 */
function normalizeMultiWordTokens(input: string): string {
  return input
    .replace(/\bDirector'?s[\s._-]+Cut\b/gi, 'DIRECTORS-CUT')
    .replace(/\bOpen[\s._-]+Matte\b/gi, 'OPEN-MATTE')
    .replace(/\bSpecial[\s._-]+Edition\b/gi, 'SPECIAL-EDITION')
    .replace(/\bAnniversary[\s._-]+Edition\b/gi, 'ANNIVERSARY-EDITION')
    .replace(/\bUltimate[\s._-]+Edition\b/gi, 'ULTIMATE-EDITION')
    .replace(/\b4K[\s._-]+Remaster(?:ed)?\b/gi, '4K-REMASTER')
    .replace(/\bDolby[\s._-]+Vision\b/gi, 'DOLBY-VISION')
    .replace(/\bDTS[\s._-]*HD[\s._-]*MA\b/gi, 'DTS-HD-MA')
    .replace(/\bDTS[\s._-]*HD\b/gi, 'DTS-HD')
    .replace(/\bDTS[\s._-]*X\b/gi, 'DTS-X')
    .replace(/\bDual[\s._-]+Audio\b/gi, 'DUAL-AUDIO')
    .replace(/\bBlu[\s._-]+Ray\b/gi, 'Blu-Ray')
    .replace(/\bWEB[\s._-]+DL\b/gi, 'WEB-DL')
    .replace(/\bE[\s._-]*AC[\s._-]*3\b/gi, 'E-AC-3')
    .replace(/\bH[\s._-]+264\b/gi, 'H-264')
    .replace(/\bH[\s._-]+265\b/gi, 'H-265')
    .replace(/\b(DDP|DD|AAC|AC3|EAC3)[\s._-]*([257])\.([01])\b/gi, '$1$2-$3')
    .replace(/\b([257])\.([01])\b/g, '$1-$2');
}

/**
 * Phân tích tên file theo chuẩn các nhóm Rip (Scene, P2P, Anime Fansub, VN Release Groups)
 */
export function parseSceneFilename(fileNameOrPath: string): ParsedSceneInfo {
  const baseNameWithExt = path.basename(fileNameOrPath);
  const ext = path.extname(baseNameWithExt).toLowerCase();
  let working = MEDIA_EXTENSIONS.has(ext)
    ? baseNameWithExt.slice(0, baseNameWithExt.length - ext.length)
    : baseNameWithExt;

  const info: ParsedSceneInfo = {
    rawFilename: baseNameWithExt,
    cleanTitle: working,
    isTvShow: false,
    hdrFormat: [],
    edition: [],
    languageTags: [],
  };

  // 1. Tách mã kiểm tra CRC32 dạng [A1B2C3D4] ở cuối (thường gặp ở Anime / Fansub)
  const crcMatch = working.match(/\[([0-9A-Fa-f]{8})\]\s*$/);
  if (crcMatch) {
    info.crc32 = crcMatch[1].toUpperCase();
    working = working.slice(0, crcMatch.index).trim();
  }

  // 2. Loại bỏ các tiền tố quảng cáo website ở đầu tên file (bao gồm cả dạng domain@ như hhd800.com@):
  working = working.replace(
    /^(?:\[\s*(?:www\.)?[a-z0-9-]+\.(?:com|net|org|vn|me|to|cc|phd|mx|io|tv|info|la|vip|xyz)\s*\]|(?:www\.)?[a-z0-9-]+\.(?:com|net|org|vn|me|to|cc|phd|mx|la|vip|xyz)\s*[-_@]+|\[\s*(?:thuvienhd|hdvietnam|phimmoi|vietsub|blurayvn)[^\]]*\])\s*[-_.@]*\s*/i,
    ''
  );

  // 2b. Nhận diện mã JAV chuẩn (ví dụ: FC2-PPV-1234567, SONE-123, IPZZ-456, SSIS-001, sone00123, SONE-123-C)
  const fc2Match = working.match(/\bFC2[\s._-]*(?:PPV[\s._-]*)?(\d{5,8})\b/i);
  if (fc2Match) {
    info.javCode = `FC2-PPV-${fc2Match[1]}`;
    info.isAdult = true;
    info.siteOrStudio = 'FC2-PPV';
  } else {
    const javStdMatch = working.match(
      /(?:^|[\s._\[\]])([A-Za-z]{2,6})-(\d{3,5})(?:[-_.]?(?:C|U|CH|UC|FHD|HD|4K))?(?=$|[\s._\]-])/i
    );
    if (javStdMatch) {
      const prefix = javStdMatch[1].toUpperCase();
      const num = javStdMatch[2];
      if (!NON_JAV_PREFIXES.has(prefix) && !/^S\d+$/i.test(prefix)) {
        info.javCode = `${prefix}-${num}`;
        info.isAdult = true;
      }
    } else {
      // Dạng viết liền có số 0 đệm của DMM: ví dụ sone00123 hoặc ipzz00456_4k
      const javRawDmm = working.match(
        /(?:^|[\s._\[\]])([A-Za-z]{3,6})00(\d{3})(?:[-_.]?(?:c|ch|uc|u|4k|fhd|hd))?(?=$|[\s._\]-])/i
      );
      if (javRawDmm) {
        const prefix = javRawDmm[1].toUpperCase();
        if (!NON_JAV_PREFIXES.has(prefix)) {
          info.javCode = `${prefix}-${javRawDmm[2]}`;
          info.isAdult = true;
        }
      }
    }
  }

  // 2c. Nhận diện mẫu "[OnlyFans] Creator - 2024-09-15 - Title" hoặc "Creator - 2024-09-15 - Title"
  const creatorIsoDateMatch = working.match(
    /^(?:\[\s*(OnlyFans|Fansly|ManyVids|Patreon|Fantia|LoyalFans)\s*\]\s*)?([A-Za-z0-9_.\s]{2,35}?)\s+-\s+(20[123]\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\s+-\s+(.+)$/i
  );
  if (creatorIsoDateMatch) {
    const platform = creatorIsoDateMatch[1]?.trim();
    const creator = creatorIsoDateMatch[2].trim();
    const yyyy = creatorIsoDateMatch[3];
    const mm = creatorIsoDateMatch[4];
    const dd = creatorIsoDateMatch[5];
    const restTitle = creatorIsoDateMatch[6].trim();

    info.siteOrStudio = platform || creator;
    info.releaseDate = `${yyyy}-${mm}-${dd}`;
    info.year = parseInt(yyyy, 10);
    info.isAdult = true;
    working = `${creator} ${restTitle}`;
  }

  // 3. Kiểm tra chuẩn Anime Fansub: "[GroupName] Title - 12 (1080p)..." hoặc "[GroupName] Title (2020) [BD 1080p...]"
  const animeGroupMatch = working.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (animeGroupMatch) {
    const candidateGroup = animeGroupMatch[1].trim();
    const remainder = animeGroupMatch[2].trim();
    if (!/^(?:1080p|720p|2160p|4k|\d{4})$/i.test(candidateGroup)) {
      info.releaseGroup = candidateGroup;
      working = remainder;
    }
  }

  // 4. Tách các khối thông số đặt trong ngoặc vuông hoặc ngoặc tròn ở phần đuôi
  const bracketBlocks: string[] = [];
  working = working.replace(/[\[\(]([^\]\)]+)[\]\)]/g, (fullMatch, inner: string) => {
    const normalizedInner = normalizeMultiWordTokens(inner.trim());
    const innerTokens = normalizedInner.split(/[\s._,]+/);
    if (/^(19\d{2}|20[0-3]\d)$/.test(inner.trim())) {
      return `.${inner.trim()}.`;
    }
    const techCount = innerTokens.filter((t) => isTechnicalToken(t.toLowerCase())).length;
    if (techCount >= 1) {
      bracketBlocks.push(normalizedInner);
      return ' ';
    }
    if (!info.releaseGroup && innerTokens.length === 1 && /^[A-Za-z0-9.+-]{2,14}$/.test(inner.trim())) {
      info.releaseGroup = inner.trim();
      return ' ';
    }
    return fullMatch;
  });

  working = working.trim();

  // Kiểm tra mẫu tập Anime: "Title - 05" hoặc "Title - 05v2" ở cuối sau khi đã bóc ngoặc kỹ thuật
  const animeEpMatch = working.match(/^(.+?)\s+-\s+(\d{1,4})(?:v\d)?(?:\s+-\s+(.+))?\s*$/);
  if (animeEpMatch && !/\bS\d{1,2}E\d{1,3}\b/i.test(working)) {
    const possibleTitle = animeEpMatch[1].trim();
    const epNum = parseInt(animeEpMatch[2], 10);
    if (epNum < 1900) {
      info.isTvShow = true;
      info.episode = epNum;
      if (info.season === undefined) info.season = 1;
      if (animeEpMatch[3]) {
        info.episodeTitle = animeEpMatch[3].trim();
      }
      working = possibleTitle;
    }
  }

  // 5. Chuẩn hóa các cụm từ kỹ thuật đa từ trước khi tách token
  working = normalizeMultiWordTokens(working);
  const extraNormalized = bracketBlocks.join(' ');

  // 6. Tách Release Group ở cuối theo chuẩn Scene/P2P: "...-GROUP"
  const groupRegex = /-([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)?)$/;
  const groupMatch = working.match(groupRegex);
  if (groupMatch) {
    const candidate = groupMatch[1];
    const beforeDash = working.slice(0, groupMatch.index).split(/[\s._]+/).pop() || '';
    const combinedWithPrev = `${beforeDash}-${candidate}`.toLowerCase();

    const isFalseGroup =
      isTechnicalToken(candidate.toLowerCase()) ||
      isTechnicalToken(combinedWithPrev) ||
      /^e\d{1,3}$/i.test(candidate) ||
      /^\d+$/.test(candidate);

    if (!isFalseGroup && candidate.length >= 2 && candidate.length <= 16) {
      if (!info.releaseGroup) {
        info.releaseGroup = candidate;
      }
      working = working.slice(0, groupMatch.index);
    }
  }

  // 7. Tách chuỗi thành danh sách các token theo dấu chấm, gạch dưới hoặc khoảng trắng
  const rawTokens = working
    .split(/[\s._]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const bracketTokens = extraNormalized
    .split(/[\s._,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // 8. Quét thông số kỹ thuật từ toàn bộ token
  const extractTechFromToken = (token: string) => {
    const lower = token.toLowerCase();

    if (RESOLUTION_MAP[lower] && !info.resolution) {
      info.resolution = RESOLUTION_MAP[lower];
    }
    if (SOURCE_MAP[lower]) {
      if (!info.source) {
        info.source = SOURCE_MAP[lower];
      } else if (lower === 'remux' && !info.source.includes('REMUX')) {
        info.source = `${info.source} REMUX`;
      }
    }
    if (VIDEO_CODEC_MAP[lower] && !info.videoCodec) {
      info.videoCodec = VIDEO_CODEC_MAP[lower];
    }
    if (HDR_MAP[lower] && !info.hdrFormat?.includes(HDR_MAP[lower])) {
      info.hdrFormat?.push(HDR_MAP[lower]);
    }
    if (EDITION_MAP[lower] && !info.edition?.includes(EDITION_MAP[lower])) {
      info.edition?.push(EDITION_MAP[lower]);
    }
    if (REPACK_TOKENS.has(lower)) {
      info.isProperOrRepack = true;
    }
    if (LANGUAGE_MAP[lower] && !info.languageTags?.includes(LANGUAGE_MAP[lower])) {
      info.languageTags?.push(LANGUAGE_MAP[lower]);
    }

    // Xử lý Audio Codec + Kênh gộp (ví dụ: DDP5-1, DD5-1, AAC2-0)
    const combinedAudio = lower.match(/^(ddp|dd|aac|ac3|eac3|dts|flac|truehd|atmos)(?:([257])-([01]))?$/);
    if (combinedAudio) {
      const codecKey = combinedAudio[1];
      const ch = combinedAudio[2] && combinedAudio[3] ? `${combinedAudio[2]}.${combinedAudio[3]}` : undefined;
      if (AUDIO_CODEC_MAP[codecKey]) {
        if (!info.audioCodec || codecKey === 'atmos' || codecKey === 'truehd') {
          info.audioCodec = AUDIO_CODEC_MAP[codecKey];
        }
      }
      if (ch && !info.audioChannels) {
        info.audioChannels = ch;
      }
    } else if (AUDIO_CODEC_MAP[lower]) {
      if (!info.audioCodec || lower === 'atmos' || lower === 'truehd' || lower === 'dts-hd-ma') {
        info.audioCodec = AUDIO_CODEC_MAP[lower];
      }
    } else if (/^[257]-[01]$/.test(lower) && !info.audioChannels) {
      info.audioChannels = lower.replace('-', '.');
    }
  };

  // 9. Xác định vị trí phân tách Tên Phim (Title) / Tập Phim (SxxExx) / Năm phát hành (Year) / Token Kỹ thuật đầu tiên
  let tvMarkerIndex = -1;
  let firstTechIndex = rawTokens.length;

  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i];
    const lower = tok.toLowerCase();

    const sxeMatch = tok.match(/^S(\d{1,2})E(\d{1,3})(?:[-E]+(\d{1,3}))?$/i);
    const xMatch = tok.match(/^(\d{1,2})x(\d{2,3})$/i);
    const seasonOnlyMatch = tok.match(/^S(\d{1,2})$/i);

    if (sxeMatch && tvMarkerIndex === -1) {
      tvMarkerIndex = i;
      info.isTvShow = true;
      info.season = parseInt(sxeMatch[1], 10);
      info.episode = parseInt(sxeMatch[2], 10);
      if (sxeMatch[3]) {
        info.episodeEnd = parseInt(sxeMatch[3], 10);
      }
      continue;
    }

    if (xMatch && tvMarkerIndex === -1 && i > 0) {
      tvMarkerIndex = i;
      info.isTvShow = true;
      info.season = parseInt(xMatch[1], 10);
      info.episode = parseInt(xMatch[2], 10);
      continue;
    }

    if (seasonOnlyMatch && tvMarkerIndex === -1 && i > 0) {
      const nextTok = (rawTokens[i + 1] || '').toLowerCase();
      if (nextTok === 'complete' || isTechnicalToken(nextTok)) {
        tvMarkerIndex = i;
        info.isTvShow = true;
        info.season = parseInt(seasonOnlyMatch[1], 10);
        continue;
      }
    }

    if (isTechnicalToken(lower)) {
      if (lower === 'xxx') {
        info.isAdult = true;
      }
      if (i < firstTechIndex && i > 0) {
        firstTechIndex = i;
      }
      extractTechFromToken(tok);
    }
  }

  for (const bTok of bracketTokens) {
    extractTechFromToken(bTok);
  }

  // 10. Trích xuất Title, Year và Episode Title dựa trên vị trí Pivot
  if (tvMarkerIndex !== -1) {
    let titleTokens = rawTokens.slice(0, tvMarkerIndex);
    if (titleTokens.length > 1) {
      const lastTitleTok = titleTokens[titleTokens.length - 1];
      if (/^(19\d{2}|20[0-3]\d)$/.test(lastTitleTok)) {
        info.year = parseInt(lastTitleTok, 10);
        titleTokens = titleTokens.slice(0, -1);
      }
    }
    info.cleanTitle = titleTokens.join(' ').trim();

    if (firstTechIndex > tvMarkerIndex + 1) {
      const epTitleTokens = rawTokens
        .slice(tvMarkerIndex + 1, firstTechIndex)
        .filter((t) => !isTechnicalToken(t.toLowerCase()));
      if (epTitleTokens.length > 0) {
        info.episodeTitle = epTitleTokens.join(' ').trim();
      }
    }
  } else {
    const preTechTokens = rawTokens.slice(0, firstTechIndex);

    // Kiểm tra chuẩn Scene 18+ / OnlyFans: "SiteOrStudio.YY.MM.DD.Performer.And.Title"
    if (
      preTechTokens.length >= 4 &&
      /^\d{2}$/.test(preTechTokens[1]) &&
      /^(0[1-9]|1[0-2])$/.test(preTechTokens[2]) &&
      /^(0[1-9]|[12]\d|3[01])$/.test(preTechTokens[3])
    ) {
      const yy = parseInt(preTechTokens[1], 10);
      const fullYear = yy >= 70 ? 1900 + yy : 2000 + yy;
      info.siteOrStudio = preTechTokens[0];
      info.releaseDate = `${fullYear}-${preTechTokens[2]}-${preTechTokens[3]}`;
      info.year = fullYear;
      info.isAdult = true;

      const remainderTokens = preTechTokens.slice(4);
      info.cleanTitle =
        remainderTokens.length > 0
          ? remainderTokens.join(' ').trim()
          : preTechTokens[0];
    } else {
      let yearIndex = -1;
      for (let i = preTechTokens.length - 1; i >= 1; i--) {
        if (/^(19\d{2}|20[0-3]\d)$/.test(preTechTokens[i])) {
          yearIndex = i;
          info.year = parseInt(preTechTokens[i], 10);
          break;
        }
      }

      const titleSlice = yearIndex !== -1 ? preTechTokens.slice(0, yearIndex) : preTechTokens;

      const akaIndex = titleSlice.findIndex((t) => t.toLowerCase() === 'aka');
      if (akaIndex > 0 && akaIndex < titleSlice.length - 1) {
        info.cleanTitle = titleSlice.slice(0, akaIndex).join(' ').trim();
        info.originalTitle = titleSlice.slice(akaIndex + 1).join(' ').trim();
      } else {
        info.cleanTitle = titleSlice.join(' ').trim();
      }
    }
  }

  info.cleanTitle = info.cleanTitle
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-_.\s]+|[-_.\s]+$/g, '')
    .trim();

  // Nếu là file JAV mà tên file chỉ là mã viết liền (ví dụ sone00123 hoặc SONE-123-C), chuẩn hóa cleanTitle về mã JAV chuẩn
  if (info.javCode) {
    const compactClean = info.cleanTitle.replace(/[-_\s]/g, '').toLowerCase();
    const compactJav = info.javCode.replace(/-/g, '').toLowerCase();
    if (
      !info.cleanTitle ||
      compactClean === compactJav ||
      compactClean === `${compactJav}c` ||
      compactClean === `${compactJav}ch` ||
      compactClean === `${compactJav}uc` ||
      compactClean === `${compactJav}u` ||
      /^[a-z]{2,6}00\d{3}(?:c|ch|uc|u)?$/.test(compactClean)
    ) {
      info.cleanTitle = info.javCode;
    }
  }

  if (!info.cleanTitle) {
    info.cleanTitle = info.javCode || working.trim() || baseNameWithExt;
  }

  return info;
}
