import { ElectronMediaApi } from '../shared/types';

export function getMediaApi(): ElectronMediaApi {
  if (typeof window !== 'undefined' && window.mediaApi) {
    return window.mediaApi;
  }
  // Fallback an toàn nếu mở trực tiếp trên trình duyệt web thông thường khi dev
  throw new Error('Ứng dụng cần chạy trong môi trường Electron Desktop.');
}
