import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  readMediaFileItem,
  scanMediaPaths,
  writeMediaFileMetadata,
} from './services/mediaTagService';
import { parseSceneFilename } from './services/sceneReleaseParser';
import {
  fetchThumbnailAsDataUrl,
  getLastSearchLogs,
  searchOnlineMetadata,
} from './services/metadataLookupService';
import {
  executeRenameFiles,
  previewExtractTags,
  previewRenameFiles,
} from './services/renamePatternService';
import { getConfig, saveConfig } from './services/configService';
import {
  getBinaryStatus,
  installBinariesToProject,
  invalidateBinaryStatusCache,
} from './services/binaryManagerService';
import {
  createFfmpegVideoTools,
  electronImageHash,
  findDuplicateMedia,
} from './services/duplicateDetectionService';
import { MediaFileItem, MediaMetadata } from '../src/shared/types';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Media Tag Updater - Quản lý & Cập nhật Tag Nhạc, Phim, Ảnh',
    backgroundColor: '#020617',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function setupDevAutoRelaunch() {
  if (!process.env.VITE_DEV_SERVER_URL) return;
  const mainBundlePath = path.join(__dirname, 'main.cjs');
  let relaunchTimer: NodeJS.Timeout | null = null;

  fs.watchFile(mainBundlePath, { interval: 1000 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs && curr.size > 0) {
      if (relaunchTimer) clearTimeout(relaunchTimer);
      relaunchTimer = setTimeout(() => {
        console.log('[Electron Dev] Phát hiện thay đổi ở Backend (electron/), đang tự động khởi động lại...');
        fs.unwatchFile(mainBundlePath);
        app.relaunch();
        app.exit(0);
      }, 400);
    }
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  setupDevAutoRelaunch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpcHandlers() {
  ipcMain.handle('media:selectFolder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục chứa file Nhạc, Phim hoặc Ảnh',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('media:selectFiles', async () => {
    if (!mainWindow) return [];
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn các file Media (Nhạc, Phim, Ảnh)',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Tất cả Media (Nhạc, Phim, Ảnh)',
          extensions: [
            'mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'wma',
            'mp4', 'm4v', 'mkv', 'mov', 'avi', 'webm',
            'jpg', 'jpeg', 'png', 'webp', 'tiff', 'heic',
          ],
        },
        { name: 'File Nhạc (Audio)', extensions: ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'wma'] },
        { name: 'File Phim (Video)', extensions: ['mp4', 'm4v', 'mkv', 'mov', 'avi', 'webm'] },
        { name: 'File Ảnh (Image)', extensions: ['jpg', 'jpeg', 'png', 'webp', 'tiff', 'heic'] },
      ],
    });
    if (res.canceled) return [];
    return res.filePaths;
  });

  ipcMain.handle('media:selectImageFile', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn ảnh làm Thumbnail / Cover Art / Poster',
      properties: ['openFile'],
      filters: [{ name: 'Hình ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const imgPath = res.filePaths[0];
    try {
      let nImg = nativeImage.createFromPath(imgPath);
      if (!nImg.isEmpty()) {
        const size = nImg.getSize();
        if (size.width > 800 || size.height > 800) {
          nImg = nImg.resize({
            width: size.width >= size.height ? 800 : undefined,
            height: size.height > size.width ? 800 : undefined,
            quality: 'good',
          });
        }
        return `data:image/jpeg;base64,${nImg.toJPEG(85).toString('base64')}`;
      }
    } catch {
      // fallback
    }
    const ext = path.extname(imgPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const buf = await fs.promises.readFile(imgPath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  ipcMain.handle('media:selectBinaryFile', async (_event, title: string) => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Chọn file thực thi (.exe)',
      properties: ['openFile'],
      filters: [{ name: 'Windows Executable', extensions: ['exe'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('media:scanPaths', async (_event, paths: string[]) => {
    return scanMediaPaths(paths);
  });

  ipcMain.handle(
    'media:saveFileMetadata',
    async (_event, filePath: string, metadata: MediaMetadata) => {
      return writeMediaFileMetadata(filePath, metadata);
    }
  );

  ipcMain.handle(
    'media:batchSaveMetadata',
    async (_event, items: { filePath: string; metadata: Partial<MediaMetadata> }[]) => {
      const updated: MediaFileItem[] = [];
      const errors: { filePath: string; error: string }[] = [];

      for (const entry of items) {
        try {
          const current = await readMediaFileItem(entry.filePath);
          if (!current) {
            throw new Error('Không tìm thấy file');
          }
          const merged: MediaMetadata = {
            ...current.metadata,
            ...entry.metadata,
          };
          const saved = await writeMediaFileMetadata(entry.filePath, merged);
          updated.push(saved);
        } catch (err: any) {
          errors.push({
            filePath: entry.filePath,
            error: err?.message || 'Lỗi khi lưu metadata',
          });
        }
      }

      return { updated, errors };
    }
  );

  ipcMain.handle('media:parseSceneFilename', async (_event, fileName: string) => {
    return parseSceneFilename(fileName);
  });

  ipcMain.handle('media:searchOnlineMetadata', async (_event, params) => {
    return searchOnlineMetadata(params);
  });

  ipcMain.handle('media:getOnlineSearchLogs', async () => {
    return getLastSearchLogs();
  });

  ipcMain.handle('media:fetchThumbnailAsDataUrl', async (_event, url: string) => {
    return fetchThumbnailAsDataUrl(url);
  });

  ipcMain.handle(
    'media:previewRenameFiles',
    async (_event, items: MediaFileItem[], pattern: string) => {
      return previewRenameFiles(items, pattern);
    }
  );

  ipcMain.handle(
    'media:executeRenameFiles',
    async (_event, renames: { oldPath: string; newPath: string }[]) => {
      return executeRenameFiles(renames);
    }
  );

  ipcMain.handle(
    'media:previewExtractTags',
    async (_event, items: MediaFileItem[], mode: 'smart-scene' | 'pattern', pattern?: string) => {
      return previewExtractTags(items, mode, pattern);
    }
  );

  ipcMain.handle('media:getConfig', async () => {
    return getConfig();
  });

  ipcMain.handle('media:saveConfig', async (_event, partial) => {
    const updated = saveConfig(partial);
    invalidateBinaryStatusCache();
    return updated;
  });

  ipcMain.handle('media:getBinaryStatus', async () => {
    return getBinaryStatus(true);
  });

  ipcMain.handle('media:installBinariesToProject', async () => {
    return installBinariesToProject();
  });

  ipcMain.handle('media:findDuplicates', async (_event, items: MediaFileItem[]) => {
    const bin = getBinaryStatus();
    const videoTools = createFfmpegVideoTools(
      bin.ffmpegAvailable ? bin.ffmpegPath : undefined
    );
    return findDuplicateMedia(items, {
      computeImageHash: electronImageHash,
      ...videoTools,
    });
  });

  ipcMain.handle('media:moveFilesToTrash', async (_event, filePaths: string[]) => {
    const trashed: string[] = [];
    const errors: { filePath: string; error: string }[] = [];
    for (const fp of filePaths) {
      try {
        // Chuyển vào Thùng rác (Recycle Bin) – có thể khôi phục, không xóa vĩnh viễn
        await shell.trashItem(fp);
        trashed.push(fp);
      } catch (err: any) {
        errors.push({ filePath: fp, error: err?.message || 'Không thể chuyển vào Thùng rác' });
      }
    }
    return { trashed, errors };
  });

  ipcMain.handle('media:openPathInExplorer', async (_event, targetPath: string) => {
    if (!targetPath) return;
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        await shell.openPath(targetPath);
      } else {
        shell.showItemInFolder(targetPath);
      }
    }
  });
}
