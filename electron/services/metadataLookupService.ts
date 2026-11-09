import { MediaType, OnlineMetadataResult } from '../../src/shared/types';
import { getConfig } from './configService';
import { parseSceneFilename } from './sceneReleaseParser';

const USER_AGENT = 'MediaTagUpdater/1.0.0 (Windows; +https://github.com/media-tag-updater)';

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

let lastSearchLogs: OnlineSearchLogEntry[] = [];

export function getLastSearchLogs(): OnlineSearchLogEntry[] {
  return lastSearchLogs;
}

function stripHtml(html?: string): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * Làm sạch tên file nhạc khi dùng làm từ khóa tìm kiếm (bỏ số thứ tự đầu dòng, bitrate, Official Video, v.v.)
 */
function cleanAudioSearchQuery(raw: string): { cleanTrack: string; detectedArtist?: string } {
  let working = raw
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .replace(
      /[\[\(](?:official\s*(?:music\s*)?(?:video|audio|mv|lyric\s*video)|mv|hd|hq|lyrics?|vietsub|320\s*kbps|flac|lossless|\d{4})[\]\)]/gi,
      ' '
    )
    .replace(/\b(?:320kbps|128kbps|flac|mp3)\b/gi, ' ')
    .replace(/^\s*\d{1,3}\s*[.-\s]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const parts = working.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return {
      detectedArtist: parts[0].trim(),
      cleanTrack: parts.slice(1).join(' - ').trim(),
    };
  }
  return { cleanTrack: working || raw.trim() };
}

/**
 * Hàm gọi HTTP kèm ghi Log chi tiết Request / Response ra Terminal khi chạy dev
 */
async function fetchJsonWithLogging(
  provider: string,
  url: string,
  headers: Record<string, string> = {}
): Promise<any> {
  const start = Date.now();
  const safeLogUrl = url.replace(/(api_key|token)=([^&]+)/gi, '$1=***');
  console.log(`\n[OnlineSearch][${provider}] ⇢ REQUEST: GET ${safeLogUrl}`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...headers,
      },
    });
    const durationMs = Date.now() - start;
    const rawText = await res.text();
    const preview = rawText.slice(0, 350).replace(/\s+/g, ' ');

    if (!res.ok) {
      console.warn(
        `[OnlineSearch][${provider}] ⇠ RESPONSE ERROR: HTTP ${res.status} (${durationMs}ms) | Body: ${preview}`
      );
      lastSearchLogs.push({
        timestamp: new Date().toISOString(),
        provider,
        url: safeLogUrl,
        status: res.status,
        durationMs,
        resultCount: 0,
        error: `HTTP ${res.status}: ${ res.statusText }`,
        responsePreview: preview,
      });
      return null;
    }

    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr: any) {
      console.warn(`[OnlineSearch][${provider}] ⇠ JSON PARSE ERROR (${durationMs}ms):`, parseErr?.message);
      lastSearchLogs.push({
        timestamp: new Date().toISOString(),
        provider,
        url: safeLogUrl,
        status: res.status,
        durationMs,
        resultCount: 0,
        error: 'Invalid JSON response',
        responsePreview: preview,
      });
      return null;
    }

    const count =
      Array.isArray(data?.d)
        ? data.d.length
        : Array.isArray(data?.results)
        ? data.results.length
        : Array.isArray(data?.recordings)
        ? data.recordings.length
        : Array.isArray(data)
        ? data.length
        : data?.results?.trackmatches?.track?.length ?? (data ? 1 : 0);

    console.log(
      `[OnlineSearch][${provider}] ⇠ RESPONSE OK: HTTP ${res.status} (${durationMs}ms) | Items: ${count} | Preview: ${preview}`
    );

    lastSearchLogs.push({
      timestamp: new Date().toISOString(),
      provider,
      url: safeLogUrl,
      status: res.status,
      durationMs,
      resultCount: count,
      responsePreview: preview,
    });

    return data;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.error(
      `[OnlineSearch][${provider}] ✖ NETWORK EXCEPTION (${durationMs}ms):`,
      err?.message || err
    );
    lastSearchLogs.push({
      timestamp: new Date().toISOString(),
      provider,
      url: safeLogUrl,
      durationMs,
      resultCount: 0,
      error: err?.message || 'Network error',
    });
    return null;
  }
}

export async function fetchThumbnailAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  const start = Date.now();
  console.log(`[OnlineSearch][Thumbnail] ⇢ Downloading image: ${url}`);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    const durationMs = Date.now() - start;
    if (!res.ok) {
      console.warn(`[OnlineSearch][Thumbnail] ⇠ Failed HTTP ${res.status} (${durationMs}ms): ${url}`);
      return null;
    }
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await res.arrayBuffer();
    console.log(
      `[OnlineSearch][Thumbnail] ⇠ Downloaded OK (${durationMs}ms, ${(
        arrayBuffer.byteLength / 1024
      ).toFixed(1)} KB)`
    );
    const b64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:${contentType.split(';')[0]};base64,${b64}`;
  } catch (err: any) {
    console.warn('[OnlineSearch][Thumbnail] ✖ Exception:', url, err?.message || err);
    return null;
  }
}

export async function searchOnlineMetadata(params: {
  query: string;
  mediaType: MediaType;
  year?: number;
  season?: number;
  episode?: number;
  artist?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  source?: string;
}): Promise<OnlineMetadataResult[]> {
  lastSearchLogs = [];
  const config = getConfig();
  const { mediaType } = params;

  console.log('================================================================================');
  console.log('[OnlineSearch] ▶ BẮT ĐẦU TÌM KIẾM METADATA TRỰC TUYẾN');
  console.log('[OnlineSearch] Tham số đầu vào:', JSON.stringify(params));
  console.log(
    '[OnlineSearch] Cấu hình hiện tại:',
    JSON.stringify({
      language: config.language,
      preferredAudioSource: config.preferredAudioSource,
      preferredVideoSource: config.preferredVideoSource,
      hasTmdbKey: Boolean(config.tmdbApiKey),
      hasDiscogsToken: Boolean(config.discogsToken),
      hasLastfmKey: Boolean(config.lastfmApiKey),
    })
  );

  let results: OnlineMetadataResult[] = [];
  if (mediaType === 'audio') {
    results = await searchAudioMetadata(params, config);
  } else if (mediaType === 'video') {
    results = await searchVideoMetadata(params, config);
  } else if (mediaType === 'image') {
    results = await searchImageMetadata(params, config);
  }

  console.log(
    `[OnlineSearch] ✔ HOÀN TẤT TÌM KIẾM | Tổng số kết quả tìm được: ${results.length}`
  );
  console.log('================================================================================\n');
  return results;
}

async function searchAudioMetadata(
  params: { query: string; artist?: string; year?: number; source?: string },
  config: ReturnType<typeof getConfig>
): Promise<OnlineMetadataResult[]> {
  const results: OnlineMetadataResult[] = [];
  const cleaned = cleanAudioSearchQuery(params.query);
  const effectiveArtist = params.artist?.trim() || cleaned.detectedArtist;
  const effectiveTrack = cleaned.cleanTrack || params.query.trim();
  const combinedQuery = [effectiveArtist, effectiveTrack].filter(Boolean).join(' ').trim();

  console.log(
    `[OnlineSearch][Audio] Sau khi làm sạch query -> Track: "${effectiveTrack}", Artist: "${
      effectiveArtist || ''
    }", Combined: "${combinedQuery}"`
  );

  if (!combinedQuery) return results;

  const hasDiscogs = Boolean(config.discogsToken?.trim());
  const hasLastFm = Boolean(config.lastfmApiKey?.trim());

  let pref = params.source || config.preferredAudioSource || 'auto';
  if (pref === 'discogs' && !hasDiscogs) {
    pref = 'auto';
  }

  const tasks: Promise<OnlineMetadataResult[]>[] = [];

  if (pref === 'auto' || pref === 'itunes') {
    tasks.push(searchItunesMusic(combinedQuery));
  }
  if (pref === 'auto' || pref === 'deezer') {
    tasks.push(searchDeezerMusic(combinedQuery));
  }
  if (pref === 'auto' || pref === 'musicbrainz') {
    tasks.push(searchMusicBrainz(effectiveTrack, effectiveArtist));
  }
  if ((pref === 'auto' || pref === 'discogs') && hasDiscogs) {
    tasks.push(searchDiscogs(combinedQuery, config.discogsToken.trim()));
  }
  if (pref === 'auto' && hasLastFm) {
    tasks.push(searchLastFm(effectiveTrack, effectiveArtist, config.lastfmApiKey.trim()));
  }

  const settled = await Promise.allSettled(tasks);
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(...s.value);
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

async function searchDeezerMusic(term: string): Promise<OnlineMetadataResult[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=10`;
  const data = await fetchJsonWithLogging('Deezer Music', url);
  if (!data || !Array.isArray(data.data)) return [];

  return data.data.map((item: any, idx: number): OnlineMetadataResult => {
    const hiResCover =
      item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || undefined;

    return {
      id: `deezer-${item.id || idx}`,
      source: 'deezer',
      sourceLabel: 'Deezer Music',
      mediaType: 'audio',
      confidence: Math.max(62, 94 - idx * 3),
      thumbnailUrl: hiResCover,
      extraInfo: [
        item.artist?.name,
        item.album?.title,
        item.explicit_lyrics ? '18+ Explicit' : undefined,
      ]
        .filter(Boolean)
        .join(' • '),
      metadata: {
        title: item.title || item.title_short,
        artist: item.artist?.name,
        albumArtist: item.artist?.name,
        album: item.album?.title,
      },
    };
  });
}

async function searchItunesMusic(term: string): Promise<OnlineMetadataResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=10`;
  const data = await fetchJsonWithLogging('iTunes Music', url);
  if (!data || !Array.isArray(data.results)) return [];

  return data.results.map((item: any, idx: number): OnlineMetadataResult => {
    const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined;
    const hiResThumb = item.artworkUrl100
      ? String(item.artworkUrl100).replace('100x100bb', '1000x1000bb')
      : undefined;

    return {
      id: `itunes-music-${item.trackId || idx}`,
      source: 'itunes-music',
      sourceLabel: 'iTunes Music',
      mediaType: 'audio',
      confidence: Math.max(60, 95 - idx * 3),
      thumbnailUrl: hiResThumb,
      extraInfo: [item.collectionName, year, item.primaryGenreName].filter(Boolean).join(' • '),
      metadata: {
        title: item.trackName,
        artist: item.artistName,
        albumArtist: item.collectionArtistName || item.artistName,
        album: item.collectionName,
        year: Number.isNaN(year) ? undefined : year,
        genre: item.primaryGenreName,
        trackNumber: item.trackNumber,
        seasonNumber: item.discNumber,
        copyright: item.copyright,
      },
    };
  });
}

async function searchMusicBrainz(titleQuery: string, artist?: string): Promise<OnlineMetadataResult[]> {
  const luceneQuery = artist
    ? `recording:(${titleQuery}) AND artist:(${artist})`
    : titleQuery;
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(luceneQuery)}&limit=8&fmt=json`;
  const data = await fetchJsonWithLogging('MusicBrainz', url);
  if (!data || !Array.isArray(data.recordings)) return [];

  return data.recordings.map((rec: any, idx: number): OnlineMetadataResult => {
    const release = Array.isArray(rec.releases) && rec.releases.length > 0 ? rec.releases[0] : null;
    const artistCredit = Array.isArray(rec['artist-credit'])
      ? rec['artist-credit'].map((ac: any) => ac.name || ac.artist?.name).filter(Boolean).join(', ')
      : undefined;
    const yearMatch = (rec['first-release-date'] || release?.date || '').match(/^(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : undefined;
    const genre = Array.isArray(rec.tags) && rec.tags.length > 0 ? rec.tags[0].name : undefined;
    const thumbUrl = release?.id
      ? `https://coverartarchive.org/release/${release.id}/front-500`
      : undefined;

    return {
      id: `mb-${rec.id || idx}`,
      source: 'musicbrainz',
      sourceLabel: 'MusicBrainz',
      mediaType: 'audio',
      confidence: rec.score ? Math.min(94, Number(rec.score)) : Math.max(55, 88 - idx * 4),
      thumbnailUrl: thumbUrl,
      extraInfo: [release?.title, year, release?.country].filter(Boolean).join(' • '),
      metadata: {
        title: rec.title,
        artist: artistCredit,
        album: release?.title,
        year,
        genre,
      },
    };
  });
}

async function searchDiscogs(query: string, token: string): Promise<OnlineMetadataResult[]> {
  const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&per_page=6&token=${encodeURIComponent(token)}`;
  const data = await fetchJsonWithLogging('Discogs', url);
  if (!data || !Array.isArray(data.results)) return [];

  return data.results.map((item: any, idx: number): OnlineMetadataResult => {
    const parts = String(item.title || '').split(' - ');
    const artist = parts.length > 1 ? parts[0].trim() : undefined;
    const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : item.title;
    return {
      id: `discogs-${item.id || idx}`,
      source: 'discogs',
      sourceLabel: 'Discogs',
      mediaType: 'audio',
      confidence: Math.max(60, 88 - idx * 4),
      thumbnailUrl: item.cover_image || item.thumb,
      extraInfo: [item.country, item.year, ...(item.genre || [])].filter(Boolean).join(' • '),
      metadata: {
        title,
        artist,
        album: title,
        year: item.year ? parseInt(String(item.year), 10) : undefined,
        genre: Array.isArray(item.genre) ? item.genre[0] : undefined,
      },
    };
  });
}

async function searchLastFm(
  track: string,
  artist: string | undefined,
  apiKey: string
): Promise<OnlineMetadataResult[]> {
  const url = `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(track)}${
    artist ? `&artist=${encodeURIComponent(artist)}` : ''
  }&api_key=${encodeURIComponent(apiKey)}&format=json&limit=5`;
  const data = await fetchJsonWithLogging('Last.fm', url);
  const matches = data?.results?.trackmatches?.track;
  if (!Array.isArray(matches)) return [];

  return matches.map((item: any, idx: number): OnlineMetadataResult => {
    const imgList = Array.isArray(item.image) ? item.image : [];
    const largeImg = imgList[imgList.length - 1]?.['#text'] || undefined;
    return {
      id: `lastfm-${idx}-${item.name}`,
      source: 'lastfm',
      sourceLabel: 'Last.fm',
      mediaType: 'audio',
      confidence: Math.max(50, 80 - idx * 4),
      thumbnailUrl: largeImg && !largeImg.includes('2a96cbd8b46e442fc41c2b86b821562f') ? largeImg : undefined,
      extraInfo: item.artist,
      metadata: {
        title: item.name,
        artist: item.artist,
      },
    };
  });
}

async function searchVideoMetadata(
  params: {
    query: string;
    year?: number;
    season?: number;
    episode?: number;
    source?: string;
  },
  config: ReturnType<typeof getConfig>
): Promise<OnlineMetadataResult[]> {
  const results: OnlineMetadataResult[] = [];
  const parsed = parseSceneFilename(params.query);
  const cleanQuery = parsed.cleanTitle || params.query.trim();
  const year = params.year || parsed.year;
  const season = params.season ?? parsed.season;
  const episode = params.episode ?? parsed.episode;

  const includeAdult = config.includeAdultContent !== false;

  console.log(
    `[OnlineSearch][Video] SceneParser -> cleanTitle: "${cleanQuery}", javCode: "${
      parsed.javCode || ''
    }", siteOrStudio: "${parsed.siteOrStudio || ''}", releaseDate: "${
      parsed.releaseDate || ''
    }", year: ${year || 'none'}, S:${season ?? '-'} E:${episode ?? '-'}`
  );

  if (!cleanQuery) return results;

  const hasTmdb = Boolean(config.tmdbApiKey?.trim());
  const hasThePornDb = Boolean(config.theporndbApiKey?.trim()) && includeAdult;
  const hasStashBox =
    Boolean(config.stashboxEndpoint?.trim() && config.stashboxApiKey?.trim()) && includeAdult;

  let pref = params.source || config.preferredVideoSource || 'auto';
  // Nếu nguồn được chọn yêu cầu API Key nhưng người dùng chưa cấu hình, tự động bỏ qua và chuyển về 'auto'
  if (
    (pref === 'tmdb' && !hasTmdb) ||
    (pref === 'theporndb' && !hasThePornDb) ||
    (pref === 'stashbox' && !hasStashBox)
  ) {
    pref = 'auto';
  }

  const tasks: Promise<OnlineMetadataResult[]>[] = [];

  if (pref === 'auto' || pref === 'imdb') {
    tasks.push(searchImdb(cleanQuery, year, season, episode, config.language));
    if (parsed.originalTitle && parsed.originalTitle !== cleanQuery) {
      tasks.push(searchImdb(parsed.originalTitle, year, season, episode, config.language));
    }
  }

  if (pref === 'auto' || pref === 'anilist') {
    tasks.push(searchAniList(cleanQuery, year, episode, includeAdult));
  }

  if ((pref === 'auto' || pref === 'tmdb') && hasTmdb) {
    const tmdbKey = config.tmdbApiKey.trim();
    tasks.push(
      searchTmdb(cleanQuery, year, season, episode, tmdbKey, config.language, includeAdult)
    );
    if (parsed.originalTitle && parsed.originalTitle !== cleanQuery) {
      tasks.push(
        searchTmdb(
          parsed.originalTitle,
          year,
          season,
          episode,
          tmdbKey,
          config.language,
          includeAdult
        )
      );
    }
  }

  if ((pref === 'auto' || pref === 'theporndb') && hasThePornDb) {
    tasks.push(
      searchThePornDb(
        params.query,
        cleanQuery,
        parsed.javCode,
        parsed.siteOrStudio,
        parsed.releaseDate,
        config.theporndbApiKey.trim()
      )
    );
  }

  if ((pref === 'auto' || pref === 'stashbox') && hasStashBox) {
    const sbQuery = [parsed.siteOrStudio, parsed.releaseDate, cleanQuery]
      .filter(Boolean)
      .join(' ')
      .trim();
    tasks.push(
      searchStashBox(
        sbQuery || cleanQuery,
        config.stashboxEndpoint.trim(),
        config.stashboxApiKey.trim()
      )
    );
  }

  if (pref === 'auto' || pref === 'itunes') {
    tasks.push(searchItunesMovies(cleanQuery, year));
    if (parsed.originalTitle && parsed.originalTitle !== cleanQuery) {
      tasks.push(searchItunesMovies(parsed.originalTitle, year));
    }
  }

  if (pref === 'auto' || pref === 'tvmaze') {
    tasks.push(searchTvMaze(cleanQuery, season, episode));
    if (parsed.originalTitle && parsed.originalTitle !== cleanQuery) {
      tasks.push(searchTvMaze(parsed.originalTitle, season, episode));
    }
  }

  const settled = await Promise.allSettled(tasks);
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(...s.value);
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Cấu trúc dữ liệu chi tiết của 1 bộ phim trên IMDb (lấy từ GraphQL hoặc trang Title)
 */
interface ImdbDetailedInfo {
  title?: string;
  originalTitle?: string;
  director?: string;
  cast?: string;
  genre?: string;
  plot?: string;
  rating?: string;
  image?: string;
}

/**
 * Tra cứu Phim Lẻ & Phim Bộ trực tiếp từ IMDb (Zero-config, không cần API Key)
 * Bước 1: Tìm danh sách phim khớp qua IMDb Suggestion API (v3.sg.media-imdb.com)
 * Bước 2: Lấy hàng loạt Mô tả cốt truyện (Plot), Đạo diễn, Thể loại, Điểm IMDb qua IMDb GraphQL API + JSON-LD
 */
async function searchImdb(
  query: string,
  year: number | undefined,
  season: number | undefined,
  episode: number | undefined,
  language: string
): Promise<OnlineMetadataResult[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  // Hỗ trợ cả tìm theo tên phim hoặc mã IMDb ID (ví dụ: tt15398776)
  const url = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(cleanQ)}.json`;
  const data = await fetchJsonWithLogging('IMDb Search API', url);
  if (!data || !Array.isArray(data.d)) return [];

  // Chỉ giữ lại các mục là Phim / TV Series (có mã bắt đầu bằng 'tt')
  const titleItems = data.d.filter(
    (item: any) =>
      item?.id &&
      String(item.id).startsWith('tt') &&
      item?.qid !== 'videoGame'
  );

  if (titleItems.length === 0) return [];

  const sliced = titleItems.slice(0, 8);

  if (year) {
    sliced.sort((a: any, b: any) => {
      const aMatch = a.y && Math.abs(Number(a.y) - year) <= 1 ? 1 : 0;
      const bMatch = b.y && Math.abs(Number(b.y) - year) <= 1 ? 1 : 0;
      return bMatch - aMatch;
    });
  }

  // Lấy chi tiết Plot (Mô tả phim), Đạo diễn, Thể loại, Điểm IMDb cho TẤT CẢ kết quả trong sliced
  const imdbIds = sliced.map((item: any) => String(item.id));
  const batchDetailsMap = await fetchImdbBatchDetailsGraphQl(imdbIds, language);

  const results: OnlineMetadataResult[] = await Promise.all(
    sliced.map(async (item: any, idx: number): Promise<OnlineMetadataResult> => {
      const imdbId = String(item.id);
      const itemYear = item.y ? Number(item.y) : undefined;
      const isSeries =
        item.qid === 'tvSeries' ||
        item.qid === 'tvMiniSeries' ||
        Boolean(season !== undefined);

      // Tối ưu URL Poster của Amazon/IMDb về kích thước chuẩn 1000px sắc nét
      let posterUrl: string | undefined = item.i?.imageUrl;
      if (posterUrl && posterUrl.includes('._V1_')) {
        posterUrl = posterUrl.replace(/\._V1_.*?\.(jpg|png)$/i, '._V1_SX1000.$1');
      }

      let detail = batchDetailsMap.get(imdbId);
      // Nếu GraphQL chưa trả về plot cho kết quả đầu, thử fallback đọc trực tiếp trang chi tiết IMDb
      if ((!detail || !detail.plot) && idx < 3) {
        const pageDetail = await fetchImdbTitlePageDetail(imdbId, language);
        if (pageDetail) {
          detail = {
            ...detail,
            ...pageDetail,
            plot: pageDetail.plot || detail?.plot,
          };
        }
      }

      const title = detail?.title || String(item.l || cleanQ);
      const originalTitle = detail?.originalTitle || String(item.l || title);
      const artist = detail?.director || (item.s ? String(item.s) : undefined);
      const genre = detail?.genre;
      const plot = detail?.plot; // Chỉ lấy đúng mô tả cốt truyện (Plot) thật trên IMDb, không dùng chuỗi diễn viên giả làm mô tả
      const ratingText = detail?.rating ? `★ ${detail.rating} IMDb` : undefined;
      if (!posterUrl && detail?.image) {
        posterUrl = detail.image;
      }

      const yearBonus = year && itemYear && Math.abs(itemYear - year) <= 1 ? 9 : 0;
      const confidence = Math.min(99, Math.max(64, 91 - idx * 3 + yearBonus));
      const typeBadge = isSeries ? 'TV Series' : item.q || 'Movie';

      return {
        id: `imdb-${imdbId}`,
        source: 'imdb',
        sourceLabel: `IMDb (${imdbId})`,
        mediaType: 'video',
        confidence,
        thumbnailUrl: posterUrl,
        extraInfo: [ratingText, typeBadge, itemYear, genre, item.s]
          .filter(Boolean)
          .join(' • '),
        metadata: {
          title,
          originalTitle,
          artist,
          album: isSeries ? title : undefined,
          year: itemYear,
          genre,
          seasonNumber: season,
          trackNumber: episode,
          comment: plot,
        },
      };
    })
  );

  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Truy vấn hàng loạt thông tin chi tiết (Plot, Director, Genre, Rating) từ IMDb Public GraphQL API
 * Đây chính là API cung cấp dữ liệu hiển thị trên giao diện web hiện đại của IMDb.
 */
async function fetchImdbBatchDetailsGraphQl(
  imdbIds: string[],
  language: string
): Promise<Map<string, ImdbDetailedInfo>> {
  const resultMap = new Map<string, ImdbDetailedInfo>();
  if (imdbIds.length === 0) return resultMap;

  const url = 'https://api.graphql.imdb.com/';
  const start = Date.now();

  // Tạo truy vấn GraphQL gộp cho tất cả các mã tt... trong 1 request
  const subQueries = imdbIds
    .map((id, idx) => {
      const safeId = id.replace(/[^a-zA-Z0-9]/g, '');
      return `
      t${idx}: title(id: "${safeId}") {
        id
        titleText { text }
        originalTitleText { text }
        ratingsSummary { aggregateRating }
        plot {
          plotText {
            plainText
          }
        }
        genres {
          genres {
            text
          }
        }
        principalCredits {
          category {
            id
            text
          }
          credits {
            name {
              nameText {
                text
              }
            }
          }
        }
      }`;
    })
    .join('\n');

  const graphqlQuery = `query GetTitlesMetadata {\n${subQueries}\n}`;

  console.log(
    `\n[OnlineSearch][IMDb GraphQL] ⇢ REQUEST: POST ${url} (Batch ${imdbIds.length} titles: ${imdbIds.join(', ')})`
  );

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language':
          language === 'vi-VN' ? 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' : 'en-US,en;q=0.9',
        'x-imdb-client-name': 'imdb-web-next-localized',
        Origin: 'https://www.imdb.com',
        Referer: 'https://www.imdb.com/',
      },
      body: JSON.stringify({ query: graphqlQuery }),
    });
    clearTimeout(timer);

    const durationMs = Date.now() - start;
    const rawText = await res.text();
    const preview = rawText.slice(0, 350).replace(/\s+/g, ' ');

    if (!res.ok) {
      console.warn(
        `[OnlineSearch][IMDb GraphQL] ⇠ HTTP ${res.status} (${durationMs}ms) | Body: ${preview}`
      );
      lastSearchLogs.push({
        timestamp: new Date().toISOString(),
        provider: 'IMDb GraphQL (Plot/Details)',
        url: `${url} [${imdbIds.join(', ')}]`,
        status: res.status,
        durationMs,
        resultCount: 0,
        error: `HTTP ${res.status}`,
        responsePreview: preview,
      });
      return resultMap;
    }

    const json = JSON.parse(rawText);
    const dataObj = json?.data || {};
    let parsedCount = 0;

    for (const key of Object.keys(dataObj)) {
      const node = dataObj[key];
      if (!node || !node.id) continue;
      parsedCount++;

      const plotText = node.plot?.plotText?.plainText || undefined;
      const genresList = Array.isArray(node.genres?.genres)
        ? node.genres.genres.map((g: any) => g?.text).filter(Boolean)
        : [];
      const rating = node.ratingsSummary?.aggregateRating
        ? String(node.ratingsSummary.aggregateRating)
        : undefined;

      let directors: string | undefined;
      if (Array.isArray(node.principalCredits)) {
        const dirGroup = node.principalCredits.find(
          (g: any) =>
            g?.category?.id === 'director' ||
            String(g?.category?.text || '').toLowerCase().includes('director')
        );
        if (dirGroup && Array.isArray(dirGroup.credits)) {
          directors = dirGroup.credits
            .map((c: any) => c?.name?.nameText?.text)
            .filter(Boolean)
            .join(', ');
        }
      }

      resultMap.set(String(node.id), {
        title: node.titleText?.text || undefined,
        originalTitle: node.originalTitleText?.text || undefined,
        director: directors || undefined,
        genre: genresList.length > 0 ? genresList.join(', ') : undefined,
        plot: plotText,
        rating,
      });
    }

    console.log(
      `[OnlineSearch][IMDb GraphQL] ⇠ RESPONSE OK: HTTP ${res.status} (${durationMs}ms) | Enriched ${parsedCount}/${imdbIds.length} titles with Plot & Credits`
    );

    lastSearchLogs.push({
      timestamp: new Date().toISOString(),
      provider: 'IMDb GraphQL (Plot/Details)',
      url: `${url} [${imdbIds.join(', ')}]`,
      status: res.status,
      durationMs,
      resultCount: parsedCount,
      responsePreview: preview,
    });
  } catch (err: any) {
    const durationMs = Date.now() - start;
    console.warn(
      `[OnlineSearch][IMDb GraphQL] ⇠ Exception (${durationMs}ms):`,
      err?.message || err
    );
  }

  return resultMap;
}

/**
 * Fallback đọc trực tiếp trang chi tiết IMDb (hỗ trợ bóc tách cả __NEXT_DATA__ và JSON-LD)
 */
async function fetchImdbTitlePageDetail(
  imdbId: string,
  language: string
): Promise<ImdbDetailedInfo | null> {
  const url = `https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`;
  const start = Date.now();
  console.log(`[OnlineSearch][IMDb Page] ⇢ REQUEST: GET ${url}`);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language':
          language === 'vi-VN' ? 'en-US,en;q=0.9,vi;q=0.8' : 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timer);

    const durationMs = Date.now() - start;
    if (!res.ok) {
      console.warn(`[OnlineSearch][IMDb Page] ⇠ HTTP ${res.status} (${durationMs}ms)`);
      return null;
    }

    const html = await res.text();
    const decodeHtmlEntities = (s?: string) =>
      s
        ? s
            .replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#x27;/g, "'")
            .replace(/&#39;/g, "'")
        : undefined;

    // 1. Thử trích xuất từ __NEXT_DATA__ (chứa chính xác cấu trúc giao diện IMDb)
    const nextDataMatch = html.match(
      /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (nextDataMatch) {
      try {
        const nextJson = JSON.parse(nextDataMatch[1]);
        const fold = nextJson?.props?.pageProps?.aboveTheFoldData;
        if (fold) {
          const plot = fold.plot?.plotText?.plainText;
          const rating = fold.ratingsSummary?.aggregateRating
            ? String(fold.ratingsSummary.aggregateRating)
            : undefined;
          const genres = Array.isArray(fold.genres?.genres)
            ? fold.genres.genres.map((g: any) => g?.text).filter(Boolean).join(', ')
            : undefined;
          if (plot) {
            return {
              title: fold.titleText?.text,
              originalTitle: fold.originalTitleText?.text,
              genre: genres,
              plot: decodeHtmlEntities(plot),
              rating,
            };
          }
        }
      } catch {
        // tiếp tục thử JSON-LD
      }
    }

    // 2. Trích xuất từ JSON-LD Schema.org
    const ldMatch = html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
    );
    if (!ldMatch) return null;

    const ld = JSON.parse(ldMatch[1]);
    const directors = Array.isArray(ld.director)
      ? ld.director.map((d: any) => d?.name).filter(Boolean).join(', ')
      : ld.director?.name;

    const genres = Array.isArray(ld.genre)
      ? ld.genre.join(', ')
      : typeof ld.genre === 'string'
      ? ld.genre
      : undefined;

    const rating = ld.aggregateRating?.ratingValue
      ? String(ld.aggregateRating.ratingValue)
      : undefined;

    return {
      title: decodeHtmlEntities(ld.name),
      director: directors,
      genre: genres,
      plot: decodeHtmlEntities(ld.description),
      rating,
      image: typeof ld.image === 'string' ? ld.image : undefined,
    };
  } catch (err: any) {
    console.warn(`[OnlineSearch][IMDb Page] ⇠ Skipped (${err?.message || 'timeout'})`);
    return null;
  }
}

async function searchTmdb(
  query: string,
  year: number | undefined,
  season: number | undefined,
  episode: number | undefined,
  apiKeyOrToken: string,
  language: string,
  includeAdult = true
): Promise<OnlineMetadataResult[]> {
  const results: OnlineMetadataResult[] = [];
  const cleanKey = apiKeyOrToken.trim();
  const isBearer = cleanKey.length > 45 || cleanKey.startsWith('eyJ');
  const authQuery = isBearer ? '' : `&api_key=${encodeURIComponent(cleanKey)}`;
  const adultQuery = `&include_adult=${includeAdult ? 'true' : 'false'}`;
  const headers: Record<string, string> = {};
  if (isBearer) {
    headers.Authorization = `Bearer ${cleanKey}`;
  }

  // 1. Tìm Phim Lẻ (Movie)
  const movieUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&language=${language}${
    year && !season ? `&year=${year}` : ''
  }${adultQuery}${authQuery}`;
  const movieData = await fetchJsonWithLogging('TMDB Movie', movieUrl, headers);
  if (movieData && Array.isArray(movieData.results)) {
    for (let i = 0; i < Math.min(6, movieData.results.length); i++) {
      const m = movieData.results[i];
      const mYear = m.release_date ? parseInt(String(m.release_date).slice(0, 4), 10) : undefined;
      const posterUrl = m.poster_path ? `https://image.tmdb.org/t/p/w780${m.poster_path}` : undefined;
      const yearBonus = year && mYear === year ? 8 : 0;

      results.push({
        id: `tmdb-movie-${m.id}`,
        source: 'tmdb-movie',
        sourceLabel: m.adult ? 'TMDB (Phim 18+)' : 'TMDB (Phim Lẻ)',
        mediaType: 'video',
        confidence: Math.min(99, 90 - i * 3 + yearBonus),
        thumbnailUrl: posterUrl,
        extraInfo: [
          m.original_title,
          mYear,
          m.vote_average ? `★ ${m.vote_average.toFixed(1)}` : '',
          m.adult ? '18+' : '',
        ]
          .filter(Boolean)
          .join(' • '),
        metadata: {
          title: m.title || m.original_title,
          originalTitle: m.original_title,
          year: mYear,
          comment: m.overview,
        },
      });
    }
  }

  // 2. Tìm Phim Bộ (TV Series)
  const tvUrl = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}&language=${language}${adultQuery}${authQuery}`;
  const tvData = await fetchJsonWithLogging('TMDB TV', tvUrl, headers);
  if (tvData && Array.isArray(tvData.results)) {
    for (let i = 0; i < Math.min(5, tvData.results.length); i++) {
      const tv = tvData.results[i];
      const tvYear = tv.first_air_date ? parseInt(String(tv.first_air_date).slice(0, 4), 10) : undefined;
      let posterUrl = tv.poster_path ? `https://image.tmdb.org/t/p/w780${tv.poster_path}` : undefined;
      let epTitle = tv.name;
      let epOverview = tv.overview;

      if (season !== undefined && episode !== undefined && i === 0) {
        const epUrl = `https://api.themoviedb.org/3/tv/${tv.id}/season/${season}/episode/${episode}?language=${language}${authQuery}`;
        const epData = await fetchJsonWithLogging('TMDB Episode', epUrl, headers);
        if (epData) {
          if (epData.name) epTitle = epData.name;
          if (epData.overview) epOverview = epData.overview;
          if (epData.still_path && !posterUrl) {
            posterUrl = `https://image.tmdb.org/t/p/w780${epData.still_path}`;
          }
        }
      }

      results.push({
        id: `tmdb-tv-${tv.id}`,
        source: 'tmdb-tv',
        sourceLabel: 'TMDB (Phim Bộ/TV)',
        mediaType: 'video',
        confidence: season !== undefined ? Math.min(99, 95 - i * 3) : Math.max(65, 85 - i * 4),
        thumbnailUrl: posterUrl,
        extraInfo: [
          tv.name,
          season !== undefined && episode !== undefined
            ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
            : undefined,
          tvYear,
        ]
          .filter(Boolean)
          .join(' • '),
        metadata: {
          title: epTitle,
          album: tv.name,
          year: tvYear,
          seasonNumber: season,
          trackNumber: episode,
          comment: epOverview,
        },
      });
    }
  }

  return results;
}

/**
 * Tìm phim trên iTunes Movie API:
 * Lưu ý quan trọng: KHÔNG nối số năm vào tham số `term` của iTunes vì iTunes chỉ khớp `term` với tên phim!
 */
async function searchItunesMovies(query: string, year?: number): Promise<OnlineMetadataResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&entity=movie&limit=10`;
  const data = await fetchJsonWithLogging('iTunes Movies', url);
  if (!data || !Array.isArray(data.results)) return [];

  return data.results.map((item: any, idx: number): OnlineMetadataResult => {
    const mYear = item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined;
    const hiResPoster = item.artworkUrl100
      ? String(item.artworkUrl100).replace('100x100bb', '1000x1000bb')
      : undefined;
    const yearBonus = year && mYear && Math.abs(mYear - year) <= 1 ? 10 : 0;

    return {
      id: `itunes-movie-${item.trackId || idx}`,
      source: 'itunes-movie',
      sourceLabel: 'iTunes Movies',
      mediaType: 'video',
      confidence: Math.min(98, Math.max(60, 88 - idx * 3 + yearBonus)),
      thumbnailUrl: hiResPoster,
      extraInfo: [item.artistName ? `Đạo diễn: ${item.artistName}` : undefined, mYear, item.primaryGenreName]
        .filter(Boolean)
        .join(' • '),
      metadata: {
        title: item.trackName,
        artist: item.artistName,
        album: item.collectionName,
        year: Number.isNaN(mYear) ? undefined : mYear,
        genre: item.primaryGenreName,
        comment: item.longDescription || item.shortDescription,
        copyright: item.copyright,
      },
    };
  });
}

async function searchTvMaze(
  query: string,
  season?: number,
  episode?: number
): Promise<OnlineMetadataResult[]> {
  const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;
  const data = await fetchJsonWithLogging('TVMaze Shows', url);
  if (!data || !Array.isArray(data)) return [];

  const results: OnlineMetadataResult[] = [];
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const entry = data[i];
    const show = entry.show;
    if (!show) continue;

    const sYear = show.premiered ? parseInt(String(show.premiered).slice(0, 4), 10) : undefined;
    let epTitle = show.name;
    let summary = stripHtml(show.summary);
    let posterUrl = show.image?.original || show.image?.medium;

    if (season !== undefined && episode !== undefined && i === 0) {
      const epUrl = `https://api.tvmaze.com/shows/${show.id}/episodebynumber?season=${season}&number=${episode}`;
      const epData = await fetchJsonWithLogging('TVMaze Episode', epUrl);
      if (epData) {
        if (epData.name) epTitle = epData.name;
        if (epData.summary) summary = stripHtml(epData.summary);
        if (!posterUrl && epData.image?.original) {
          posterUrl = epData.image.original;
        }
      }
    }

    results.push({
      id: `tvmaze-${show.id}`,
      source: 'tvmaze',
      sourceLabel: 'TVMaze (Series)',
      mediaType: 'video',
      confidence: season !== undefined ? Math.min(95, 90 - i * 4) : Math.max(58, 82 - i * 5),
      thumbnailUrl: posterUrl,
      extraInfo: [
        show.name,
        season !== undefined && episode !== undefined
          ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
          : undefined,
        sYear,
        Array.isArray(show.genres) ? show.genres.join(', ') : undefined,
      ]
        .filter(Boolean)
        .join(' • '),
      metadata: {
        title: epTitle,
        album: show.name,
        year: sYear,
        seasonNumber: season,
        trackNumber: episode,
        genre: Array.isArray(show.genres) ? show.genres[0] : undefined,
        comment: summary,
      },
    });
  }
  return results;
}

async function searchImageMetadata(
  params: {
    query: string;
    gpsLatitude?: number;
    gpsLongitude?: number;
  },
  config: ReturnType<typeof getConfig>
): Promise<OnlineMetadataResult[]> {
  const results: OnlineMetadataResult[] = [];
  const lang = config.language === 'vi-VN' ? 'vi,en' : 'en';

  // 1. Nếu ảnh có tọa độ GPS, tra cứu địa danh thực tế qua OpenStreetMap Nominatim Reverse Geocoding
  if (typeof params.gpsLatitude === 'number' && typeof params.gpsLongitude === 'number') {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${params.gpsLatitude}&lon=${params.gpsLongitude}&accept-language=${lang}`;
    const data = await fetchJsonWithLogging('OSM Reverse GPS', url);
    if (data && data.display_name) {
      const addr = data.address || {};
      const city = addr.city || addr.town || addr.village || addr.county || addr.state;
      const country = addr.country;
      const poi = data.name || addr.tourism || addr.historic || addr.amenity || addr.suburb;
      const shortLocation = [poi, city, country].filter(Boolean).join(', ');
      const keywords = [poi, city, addr.state, country].filter(Boolean) as string[];

      results.push({
        id: `osm-reverse-${params.gpsLatitude}-${params.gpsLongitude}`,
        source: 'osm-gps',
        sourceLabel: 'OpenStreetMap (Tọa độ GPS)',
        mediaType: 'image',
        confidence: 96,
        extraInfo: data.display_name,
        metadata: {
          title: shortLocation || data.display_name,
          locationName: shortLocation || data.display_name,
          comment: `Địa điểm chụp: ${data.display_name}`,
          gpsLatitude: params.gpsLatitude,
          gpsLongitude: params.gpsLongitude,
          keywords: Array.from(new Set(keywords)),
        },
      });
    }
  }

  // 2. Cho phép tìm kiếm địa điểm theo tên (Forward Geocoding)
  if (params.query && params.query.trim()) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(
      params.query.trim()
    )}&accept-language=${lang}`;
    const list = await fetchJsonWithLogging('OSM Search Location', url);
    if (Array.isArray(list)) {
      list.forEach((item: any, idx: number) => {
        const addr = item.address || {};
        const city = addr.city || addr.town || addr.state;
        const country = addr.country;
        const locTitle = [item.name, city, country].filter(Boolean).join(', ');
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);

        results.push({
          id: `osm-search-${item.place_id || idx}`,
          source: 'osm-gps',
          sourceLabel: 'OpenStreetMap (Địa danh)',
          mediaType: 'image',
          confidence: Math.max(70, 90 - idx * 4),
          extraInfo: `${item.display_name} (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
          metadata: {
            title: locTitle || item.name,
            locationName: locTitle || item.display_name,
            comment: item.display_name,
            gpsLatitude: Number.isNaN(lat) ? undefined : Number(lat.toFixed(6)),
            gpsLongitude: Number.isNaN(lon) ? undefined : Number(lon.toFixed(6)),
            keywords: [item.name, city, country].filter(Boolean),
          },
        });
      });
    }
  }

  return results;
}

/**
 * Tra cứu Anime / Hoạt hình / 18+ Hentai từ AniList GraphQL API (Zero-config, không cần API Key)
 */
async function searchAniList(
  query: string,
  year: number | undefined,
  episode: number | undefined,
  includeAdult: boolean
): Promise<OnlineMetadataResult[]> {
  const endpoint = 'https://graphql.anilist.co';
  const start = Date.now();

  const gqlQuery = includeAdult
    ? `
      query ($search: String) {
        Page(page: 1, perPage: 6) {
          media(search: $search, type: ANIME) {
            id
            title { romaji english native }
            startDate { year }
            episodes
            genres
            description(asHtml: false)
            isAdult
            averageScore
            coverImage { extraLarge large }
            studios(isMain: true) { nodes { name } }
          }
        }
      }
    `
    : `
      query ($search: String) {
        Page(page: 1, perPage: 6) {
          media(search: $search, type: ANIME, isAdult: false) {
            id
            title { romaji english native }
            startDate { year }
            episodes
            genres
            description(asHtml: false)
            isAdult
            averageScore
            coverImage { extraLarge large }
            studios(isMain: true) { nodes { name } }
          }
        }
      }
    `;

  console.log(`\n[OnlineSearch][AniList GraphQL] ⇢ REQUEST: POST ${endpoint} (search="${query}")`);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        query: gqlQuery,
        variables: { search: query },
      }),
    });

    const durationMs = Date.now() - start;
    const rawText = await res.text();
    const preview = rawText.slice(0, 350).replace(/\s+/g, ' ');

    if (!res.ok) {
      lastSearchLogs.push({
        timestamp: new Date().toISOString(),
        provider: 'AniList GraphQL',
        url: endpoint,
        status: res.status,
        durationMs,
        resultCount: 0,
        error: `HTTP ${res.status}`,
        responsePreview: preview,
      });
      return [];
    }

    const parsed = JSON.parse(rawText);
    const mediaList: any[] = parsed?.data?.Page?.media || [];

    console.log(
      `[OnlineSearch][AniList GraphQL] ⇠ RESPONSE OK: HTTP ${res.status} (${durationMs}ms) | Items: ${mediaList.length}`
    );
    lastSearchLogs.push({
      timestamp: new Date().toISOString(),
      provider: 'AniList GraphQL',
      url: `${endpoint} (search="${query}")`,
      status: res.status,
      durationMs,
      resultCount: mediaList.length,
      responsePreview: preview,
    });

    return mediaList.map((m: any, idx: number): OnlineMetadataResult => {
      const mainTitle = m.title?.english || m.title?.romaji || m.title?.native || query;
      const origTitle = m.title?.romaji || m.title?.native;
      const mYear = m.startDate?.year || undefined;
      const studio = m.studios?.nodes?.[0]?.name || undefined;
      const genres = Array.isArray(m.genres) ? m.genres.join(', ') : undefined;
      const cleanDesc = stripHtml(m.description);
      const yearBonus = year && mYear === year ? 8 : 0;

      return {
        id: `anilist-${m.id || idx}`,
        source: 'anilist',
        sourceLabel: m.isAdult ? 'AniList (18+ Hentai/OVA)' : 'AniList (Anime)',
        mediaType: 'video',
        confidence: Math.min(97, Math.max(58, 86 - idx * 4 + yearBonus)),
        thumbnailUrl: m.coverImage?.extraLarge || m.coverImage?.large,
        extraInfo: [
          studio ? `Studio: ${studio}` : undefined,
          mYear,
          m.episodes ? `${m.episodes} tập` : undefined,
          m.averageScore ? `★ ${(m.averageScore / 10).toFixed(1)}` : undefined,
          m.isAdult ? '18+' : undefined,
        ]
          .filter(Boolean)
          .join(' • '),
        metadata: {
          title: episode !== undefined ? `${mainTitle} - Tập ${episode}` : mainTitle,
          originalTitle: origTitle,
          artist: studio,
          album: mainTitle,
          year: mYear,
          trackNumber: episode,
          genre: genres,
          comment: cleanDesc,
        },
      };
    });
  } catch (err: any) {
    console.warn('[OnlineSearch][AniList GraphQL] ⇠ ERROR:', err?.message);
    return [];
  }
}

/**
 * Tra cứu dữ liệu 18+ (Studio Âu Mỹ, OnlyFans/Fansly/ManyVids Creators, JAV & Movies) từ ThePornDB REST API
 */
async function searchThePornDb(
  rawFilenameOrQuery: string,
  cleanQuery: string,
  javCode: string | undefined,
  siteOrStudio: string | undefined,
  releaseDate: string | undefined,
  apiKey: string
): Promise<OnlineMetadataResult[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };

  const results: OnlineMetadataResult[] = [];
  const isJavQuery = Boolean(javCode || /^[A-Za-z]{2,6}-\d{3,5}$/i.test(cleanQuery));

  // Xây dựng chuỗi parse tối ưu cho ThePornDB
  const sceneParseTerm = [siteOrStudio, releaseDate, cleanQuery]
    .filter(Boolean)
    .join(' ')
    .trim() || rawFilenameOrQuery;

  const endpointsToCall: { label: string; url: string; kind: 'JAV' | 'Scene/OF' | 'Movie' }[] = [];

  if (isJavQuery) {
    const code = javCode || cleanQuery;
    endpointsToCall.push({
      label: 'ThePornDB JAV',
      url: `https://api.theporndb.net/jav?parse=${encodeURIComponent(code)}&limit=8`,
      kind: 'JAV',
    });
    endpointsToCall.push({
      label: 'ThePornDB Scenes',
      url: `https://api.theporndb.net/scenes?parse=${encodeURIComponent(code)}&limit=5`,
      kind: 'Scene/OF',
    });
  } else {
    endpointsToCall.push({
      label: 'ThePornDB Scenes/OF',
      url: `https://api.theporndb.net/scenes?parse=${encodeURIComponent(sceneParseTerm)}&limit=8`,
      kind: 'Scene/OF',
    });
    endpointsToCall.push({
      label: 'ThePornDB Movies',
      url: `https://api.theporndb.net/movies?parse=${encodeURIComponent(cleanQuery)}&limit=4`,
      kind: 'Movie',
    });
  }

  for (const ep of endpointsToCall) {
    const data = await fetchJsonWithLogging(ep.label, ep.url, headers);
    const items: any[] = Array.isArray(data?.data) ? data.data : [];

    items.forEach((item: any, idx: number) => {
      const dateStr = item.date || item.release_date || '';
      const ym = String(dateStr).match(/^(\d{4})/);
      const itemYear = ym ? parseInt(ym[1], 10) : undefined;

      const performers = Array.isArray(item.performers)
        ? item.performers
            .map((p: any) => p?.name || p?.parent?.name)
            .filter(Boolean)
            .join(', ')
        : undefined;

      const studioName = item.site?.name || item.studio?.name || siteOrStudio;
      const tags = Array.isArray(item.tags)
        ? item.tags
            .slice(0, 8)
            .map((t: any) => t?.name)
            .filter(Boolean)
            .join(', ')
        : undefined;

      const poster =
        item.posters?.large ||
        item.posters?.full ||
        item.poster ||
        item.image ||
        item.background?.full ||
        item.background?.large ||
        undefined;

      const codePrefix = item.code || (ep.kind === 'JAV' && javCode ? javCode : undefined);
      const displayTitle =
        codePrefix && item.title && !String(item.title).includes(codePrefix)
          ? `[${codePrefix}] ${item.title}`
          : item.title || codePrefix || cleanQuery;

      results.push({
        id: `tpdb-${ep.kind}-${item.id || item.uuid || idx}`,
        source: 'theporndb',
        sourceLabel: `ThePornDB (${ep.kind})`,
        mediaType: 'video',
        confidence: Math.min(99, Math.max(68, 95 - idx * 3)),
        thumbnailUrl: poster,
        extraInfo: [studioName, performers, dateStr || itemYear].filter(Boolean).join(' • '),
        metadata: {
          title: displayTitle,
          originalTitle: codePrefix,
          artist: performers || item.director,
          album: studioName,
          year: itemYear,
          genre: tags,
          comment: stripHtml(item.description || item.synopsis),
          copyright: studioName,
        },
      });
    });
  }

  return results;
}

/**
 * Tra cứu từ hệ sinh thái Stash-Box GraphQL:
 * Hỗ trợ FansDB (fansdb.cc - chuyên OnlyFans/Fansly/ManyVids), StashDB (stashdb.org), JAVStash (javstash.org), ThePornDB GraphQL
 */
async function searchStashBox(
  query: string,
  endpointUrl: string,
  apiKey: string
): Promise<OnlineMetadataResult[]> {
  const start = Date.now();
  let hostLabel = 'Stash-Box';
  try {
    const u = new URL(endpointUrl);
    if (u.hostname.includes('fansdb')) hostLabel = 'FansDB (OF/Creator)';
    else if (u.hostname.includes('stashdb')) hostLabel = 'StashDB (18+)';
    else if (u.hostname.includes('javstash')) hostLabel = 'JAVStash (JAV)';
    else if (u.hostname.includes('theporndb')) hostLabel = 'TPDB Stash-Box';
    else hostLabel = u.hostname;
  } catch {
    // ignore
  }

  const gqlQuery = `
    query SearchScenes($term: String!) {
      searchScene(term: $term, limit: 10) {
        id
        title
        details
        release_date
        date
        code
        studio {
          name
        }
        performers {
          as
          performer {
            name
          }
        }
        tags {
          name
        }
        images {
          url
        }
      }
    }
  `;

  console.log(`\n[OnlineSearch][${hostLabel}] ⇢ REQUEST: POST ${endpointUrl} (term="${query}")`);
  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ApiKey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        query: gqlQuery,
        variables: { term: query },
      }),
    });

    const durationMs = Date.now() - start;
    const rawText = await res.text();
    const preview = rawText.slice(0, 350).replace(/\s+/g, ' ');

    if (!res.ok) {
      lastSearchLogs.push({
        timestamp: new Date().toISOString(),
        provider: hostLabel,
        url: endpointUrl,
        status: res.status,
        durationMs,
        resultCount: 0,
        error: `HTTP ${res.status}`,
        responsePreview: preview,
      });
      return [];
    }

    const parsed = JSON.parse(rawText);
    const scenes: any[] = parsed?.data?.searchScene || [];

    console.log(
      `[OnlineSearch][${hostLabel}] ⇠ RESPONSE OK: HTTP ${res.status} (${durationMs}ms) | Scenes: ${scenes.length}`
    );
    lastSearchLogs.push({
      timestamp: new Date().toISOString(),
      provider: hostLabel,
      url: `${endpointUrl} (term="${query}")`,
      status: res.status,
      durationMs,
      resultCount: scenes.length,
      responsePreview: preview,
    });

    return scenes.map((sc: any, idx: number): OnlineMetadataResult => {
      const dateStr = sc.release_date || sc.date || '';
      const ym = String(dateStr).match(/^(\d{4})/);
      const sYear = ym ? parseInt(ym[1], 10) : undefined;

      const performers = Array.isArray(sc.performers)
        ? sc.performers
            .map((p: any) => p?.as || p?.performer?.name)
            .filter(Boolean)
            .join(', ')
        : undefined;

      const studioName = sc.studio?.name;
      const tags = Array.isArray(sc.tags)
        ? sc.tags
            .slice(0, 8)
            .map((t: any) => t?.name)
            .filter(Boolean)
            .join(', ')
        : undefined;

      const imageUrl = Array.isArray(sc.images) && sc.images.length > 0 ? sc.images[0].url : undefined;

      return {
        id: `stashbox-${sc.id || idx}`,
        source: 'stashbox',
        sourceLabel: hostLabel,
        mediaType: 'video',
        confidence: Math.min(99, Math.max(70, 96 - idx * 3)),
        thumbnailUrl: imageUrl,
        extraInfo: [studioName, performers, dateStr || sYear].filter(Boolean).join(' • '),
        metadata: {
          title: sc.code && sc.title ? `[${sc.code}] ${sc.title}` : sc.title || sc.code || query,
          originalTitle: sc.code || undefined,
          artist: performers,
          album: studioName,
          year: sYear,
          genre: tags,
          comment: sc.details || undefined,
          copyright: studioName,
        },
      };
    });
  } catch (err: any) {
    console.warn(`[OnlineSearch][${hostLabel}] ⇠ ERROR:`, err?.message);
    return [];
  }
}
