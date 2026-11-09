import fs from 'node:fs';
import path from 'node:path';
import {
  ExtractTagPreviewItem,
  MediaFileItem,
  MediaMetadata,
  RenamePreviewItem,
} from '../../src/shared/types';
import { parseSceneFilename } from './sceneReleaseParser';
import { readMediaFileItem } from './mediaTagService';

export function sanitizeWindowsFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .trim();
}

export function previewRenameFiles(
  items: MediaFileItem[],
  pattern: string
): RenamePreviewItem[] {
  const usedTargetPaths = new Set<string>();
  const previews: RenamePreviewItem[] = [];

  for (const item of items) {
    const ext = item.extension || path.extname(item.fileName);
    const baseWithoutExt = path.basename(item.fileName, ext);
    const meta = item.metadata || {};
    const scene = item.sceneInfo || parseSceneFilename(item.fileName);

    const trackPadded =
      meta.trackNumber !== undefined
        ? String(meta.trackNumber).padStart(2, '0')
        : scene.episode !== undefined
        ? String(scene.episode).padStart(2, '0')
        : '';

    const seasonPadded =
      meta.seasonNumber !== undefined
        ? String(meta.seasonNumber).padStart(2, '0')
        : scene.season !== undefined
        ? String(scene.season).padStart(2, '0')
        : '';

    const dateShort = meta.dateTaken
      ? meta.dateTaken.slice(0, 10).replace(/:/g, '-')
      : meta.year
      ? String(meta.year)
      : '';

    const replacements: Record<string, string> = {
      '{title}': meta.title || scene.cleanTitle || baseWithoutExt,
      '{artist}': meta.artist || '',
      '{album}': meta.album || (scene.isTvShow ? scene.cleanTitle : ''),
      '{year}': meta.year ? String(meta.year) : scene.year ? String(scene.year) : '',
      '{track}': trackPadded,
      '{episode}': trackPadded,
      '{season}': seasonPadded,
      '{genre}': meta.genre || '',
      '{group}': meta.releaseGroup || scene.releaseGroup || '',
      '{resolution}': scene.resolution || '',
      '{date}': dateShort,
      '{location}': meta.locationName || '',
    };

    let built = pattern;
    for (const [token, val] of Object.entries(replacements)) {
      built = built.split(token).join(val);
    }

    // Dọn dẹp các ngoặc rỗng hoặc dấu gạch thừa khi một trường bị trống (ví dụ " ()", " []", " - - ")
    built = built
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/(?:\s+-\s+){2,}/g, ' - ')
      .replace(/^[\s_-]+|[\s_-]+$/g, '');

    const cleanBase = sanitizeWindowsFilename(built) || baseWithoutExt;
    const newName = `${cleanBase}${ext}`;
    const newPath = path.join(item.directory, newName);
    const lowerTarget = newPath.toLowerCase();

    const isSameFile = item.filePath.toLowerCase() === lowerTarget;
    const existsOnDisk = !isSameFile && fs.existsSync(newPath);
    const duplicateInBatch = usedTargetPaths.has(lowerTarget);

    usedTargetPaths.add(lowerTarget);

    previews.push({
      filePath: item.filePath,
      oldName: item.fileName,
      newName,
      newPath,
      hasConflict: existsOnDisk || duplicateInBatch,
      willChange: !isSameFile && newName !== item.fileName,
    });
  }

  return previews;
}

export async function executeRenameFiles(
  renames: { oldPath: string; newPath: string }[]
): Promise<{
  renamed: { oldPath: string; newItem: MediaFileItem }[];
  errors: { oldPath: string; error: string }[];
}> {
  const renamed: { oldPath: string; newItem: MediaFileItem }[] = [];
  const errors: { oldPath: string; error: string }[] = [];

  for (const r of renames) {
    try {
      if (r.oldPath === r.newPath) continue;
      if (!fs.existsSync(r.oldPath)) {
        throw new Error('File gốc không tồn tại');
      }
      if (fs.existsSync(r.newPath) && r.oldPath.toLowerCase() !== r.newPath.toLowerCase()) {
        throw new Error('Tên file đích đã tồn tại trong thư mục');
      }
      fs.renameSync(r.oldPath, r.newPath);
      const newItem = await readMediaFileItem(r.newPath);
      if (newItem) {
        renamed.push({ oldPath: r.oldPath, newItem });
      }
    } catch (err: any) {
      errors.push({ oldPath: r.oldPath, error: err?.message || 'Lỗi khi đổi tên file' });
    }
  }

  return { renamed, errors };
}

export function previewExtractTags(
  items: MediaFileItem[],
  mode: 'smart-scene' | 'pattern',
  pattern?: string
): ExtractTagPreviewItem[] {
  return items.map((item) => {
    const ext = item.extension || path.extname(item.fileName);
    const baseName = path.basename(item.fileName, ext);

    if (mode === 'pattern' && pattern && pattern.trim()) {
      const extracted = extractByCustomPattern(baseName, pattern.trim());
      return {
        filePath: item.filePath,
        fileName: item.fileName,
        extracted,
      };
    }

    // Chế độ Smart Scene & Media Parser
    if (item.mediaType === 'video') {
      const scene = parseSceneFilename(item.fileName);
      const extracted: Partial<MediaMetadata> = {};

      if (scene.isTvShow) {
        extracted.album = scene.cleanTitle;
        extracted.title =
          scene.episodeTitle ||
          (scene.season !== undefined && scene.episode !== undefined
            ? `${scene.cleanTitle} - S${String(scene.season).padStart(2, '0')}E${String(
                scene.episode
              ).padStart(2, '0')}`
            : scene.cleanTitle);
        if (scene.season !== undefined) extracted.seasonNumber = scene.season;
        if (scene.episode !== undefined) extracted.trackNumber = scene.episode;
      } else {
        extracted.title = scene.cleanTitle;
        if (scene.originalTitle) extracted.originalTitle = scene.originalTitle;
      }

      if (scene.year !== undefined) extracted.year = scene.year;
      if (scene.releaseGroup) extracted.releaseGroup = scene.releaseGroup;

      return {
        filePath: item.filePath,
        fileName: item.fileName,
        extracted,
        sceneInfo: scene,
      };
    }

    if (item.mediaType === 'audio') {
      const extracted = extractSmartAudioFilename(baseName);
      return {
        filePath: item.filePath,
        fileName: item.fileName,
        extracted,
      };
    }

    // Image
    const extracted = extractSmartImageFilename(baseName);
    return {
      filePath: item.filePath,
      fileName: item.fileName,
      extracted,
    };
  });
}

function extractSmartAudioFilename(baseName: string): Partial<MediaMetadata> {
  const result: Partial<MediaMetadata> = {};
  let working = baseName.replace(/_/g, ' ').trim();

  // Tách năm ở cuối nếu có dạng (2022) hoặc [2022]
  const yearMatch = working.match(/[\(\[](19\d{2}|20[0-3]\d)[\)\]]\s*$/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[1], 10);
    working = working.slice(0, yearMatch.index).trim();
  }

  // Tách số thứ tự bài ở đầu: "01. ", "01 - ", "01 "
  const trackMatch = working.match(/^(\d{1,3})(?:\s*[.-]\s*|\s+)(.+)$/);
  if (trackMatch) {
    result.trackNumber = parseInt(trackMatch[1], 10);
    working = trackMatch[2].trim();
  }

  // Tách "Artist - Title" hoặc "Title - Artist"
  const dashParts = working.split(/\s+-\s+/);
  if (dashParts.length >= 2) {
    result.artist = dashParts[0].trim();
    result.title = dashParts.slice(1).join(' - ').trim();
  } else {
    result.title = working;
  }

  return result;
}

function extractSmartImageFilename(baseName: string): Partial<MediaMetadata> {
  const result: Partial<MediaMetadata> = {};
  const dateMatch = baseName.match(/(20\d{2}|19\d{2})[-_]?([01]\d)[-_]?([0-3]\d)/);
  if (dateMatch) {
    result.year = parseInt(dateMatch[1], 10);
    result.dateTaken = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }
  const cleaned = baseName
    .replace(/^(?:IMG|DSC|DCIM|PXL|Screenshot)[-_]*/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  result.title = cleaned || baseName;
  return result;
}

function extractByCustomPattern(baseName: string, pattern: string): Partial<MediaMetadata> {
  const result: Partial<MediaMetadata> = {};
  const tokenOrder: string[] = [];

  const regexStr = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '{' || m === '}' ? m : `\\${m}`))
    .replace(/\{([a-zA-Z]+)\}/g, (_full, tokenName: string) => {
      tokenOrder.push(tokenName.toLowerCase());
      if (tokenName === 'year') return '(\\d{4})';
      if (tokenName === 'track' || tokenName === 'episode' || tokenName === 'season') return '(\\d{1,4})';
      return '(.+?)';
    });

  try {
    const regex = new RegExp(`^${regexStr}$`, 'i');
    const match = baseName.match(regex);
    if (match) {
      tokenOrder.forEach((tok, idx) => {
        const val = match[idx + 1]?.trim();
        if (!val) return;
        if (tok === 'title') result.title = val;
        else if (tok === 'artist') result.artist = val;
        else if (tok === 'album') result.album = val;
        else if (tok === 'year') result.year = parseInt(val, 10);
        else if (tok === 'track' || tok === 'episode') result.trackNumber = parseInt(val, 10);
        else if (tok === 'season') result.seasonNumber = parseInt(val, 10);
        else if (tok === 'genre') result.genre = val;
        else if (tok === 'group') result.releaseGroup = val;
      });
    }
  } catch {
    // ignore invalid regex
  }

  return result;
}
