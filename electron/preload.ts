import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import {
  ElectronMediaApi,
  MediaFileItem,
  MediaMetadata,
  AppConfig,
  IosEncodeOptions,
} from '../src/shared/types';

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
  findDuplicates: (items: MediaFileItem[]) => ipcRenderer.invoke('media:findDuplicates', items),
  moveFilesToTrash: (filePaths: string[]) =>
    ipcRenderer.invoke('media:moveFilesToTrash', filePaths),
  probeIosCompat: (filePaths: string[]) => ipcRenderer.invoke('media:probeIosCompat', filePaths),
  onIosCompatUpdated: (cb) => {
    const listener = (_e: IpcRendererEvent, updates: any) => cb(updates);
    ipcRenderer.on('media:iosCompatUpdated', listener);
    return () => ipcRenderer.removeListener('media:iosCompatUpdated', listener);
  },
  getAvailableEncoders: () => ipcRenderer.invoke('media:getAvailableEncoders'),
  startIosEncode: (filePaths: string[], options: IosEncodeOptions) =>
    ipcRenderer.invoke('media:startIosEncode', filePaths, options),
  cancelIosEncode: (jobId?: string) => ipcRenderer.invoke('media:cancelIosEncode', jobId),
  onIosEncodeProgress: (cb) => {
    const listener = (_e: IpcRendererEvent, job: any) => cb(job);
    ipcRenderer.on('media:iosEncodeProgress', listener);
    return () => ipcRenderer.removeListener('media:iosEncodeProgress', listener);
  },
};

contextBridge.exposeInMainWorld('mediaApi', api);
