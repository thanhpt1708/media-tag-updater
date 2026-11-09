import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AppConfig } from '../../src/shared/types';

const DEFAULT_CONFIG: AppConfig = {
  language: 'vi-VN',
  tmdbApiKey: '',
  discogsToken: '',
  lastfmApiKey: '',
  theporndbApiKey: '',
  stashboxEndpoint: 'https://fansdb.cc/graphql',
  stashboxApiKey: '',
  includeAdultContent: true,
  customFfmpegPath: '',
  customExiftoolPath: '',
  preferredAudioSource: 'auto',
  preferredVideoSource: 'auto',
  defaultRenamePatterns: {
    audio: '{artist} - {title}',
    video: '{title} ({year})',
    tvShow: '{album} - S{season}E{episode} - {title}',
    image: '{date}_{location}_{title}',
  },
};

function getConfigFilePath(): string {
  try {
    // Kiểm tra nếu đang chạy trong môi trường Electron Main Process
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (electron && electron.app && electron.app.isReady()) {
      return path.join(electron.app.getPath('userData'), 'config.json');
    }
  } catch {
    // Fallback cho môi trường test hoặc CLI
  }
  return path.resolve(process.cwd(), 'config.local.json');
}

export function getConfig(): AppConfig {
  try {
    const filePath = getConfigFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        defaultRenamePatterns: {
          ...DEFAULT_CONFIG.defaultRenamePatterns,
          ...(parsed.defaultRenamePatterns || {}),
        },
      };
    }
  } catch (err) {
    console.warn('Error reading config.json, using default config:', err);
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(partial: Partial<AppConfig>): AppConfig {
  const current = getConfig();
  const updated: AppConfig = {
    ...current,
    ...partial,
    defaultRenamePatterns: {
      ...current.defaultRenamePatterns,
      ...(partial.defaultRenamePatterns || {}),
    },
  };
  try {
    const filePath = getConfigFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save config.json:', err);
  }
  return updated;
}
