import { contextBridge, ipcRenderer } from 'electron';
import { ElectronMediaApi, MediaFileItem, MediaMetadata, AppConfig } from '../src/shared/types';

const api: ElectronMediaApi = {
  selectFolder: () => ipcRenderer.invoke('media:selectFolder'),
  selectFiles: () => ipcRenderer.invoke('media:selectFiles'),
  selectImageFile: () => ipcRenderer.invoke('media:selectImageFile'),
  selectBinaryFile: (title: string) => ipcRenderer.invoke('media:selectBinaryFile', title),
  scanPaths: (paths: string[]) => ipcRenderer.invoke('media:scanPaths', paths),
  saveFileMetadata: (filePath: string, metadata: MediaMetadata) =>
    ipcRenderer.invoke('media:saveFileMetadata', filePath, metadata),
  batchSaveMetadata: (items: { filePath: string; metadata: Partial<MediaMetadata> }[]) =>
    ipcRenderer.invoke('media:batchSaveMetadata', items),
  parseSceneFilename: (fileName: string) =>
    ipcRenderer.invoke('media:parseSceneFilename', fileName),
  searchOnlineMetadata: (params) => ipcRenderer.invoke('media:searchOnlineMetadata', params),
  getOnlineSearchLogs: () => ipcRenderer.invoke('media:getOnlineSearchLogs'),
  fetchThumbnailAsDataUrl: (url: string) =>
    ipcRenderer.invoke('media:fetchThumbnailAsDataUrl', url),
  previewRenameFiles: (items: MediaFileItem[], pattern: string) =>
    ipcRenderer.invoke('media:previewRenameFiles', items, pattern),
  executeRenameFiles: (renames: { oldPath: string; newPath: string }[]) =>
    ipcRenderer.invoke('media:executeRenameFiles', renames),
  previewExtractTags: (items: MediaFileItem[], mode: 'smart-scene' | 'pattern', pattern?: string) =>
    ipcRenderer.invoke('media:previewExtractTags', items, mode, pattern),
  getConfig: () => ipcRenderer.invoke('media:getConfig'),
  saveConfig: (config: Partial<AppConfig>) => ipcRenderer.invoke('media:saveConfig', config),
  getBinaryStatus: () => ipcRenderer.invoke('media:getBinaryStatus'),
  installBinariesToProject: () => ipcRenderer.invoke('media:installBinariesToProject'),
  openPathInExplorer: (targetPath: string) =>
    ipcRenderer.invoke('media:openPathInExplorer', targetPath),
};

contextBridge.exposeInMainWorld('mediaApi', api);
