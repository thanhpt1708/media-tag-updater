# Media Tag Updater 🎬 🎵 🖼️

> **Ứng dụng Desktop quản lý, tra cứu trực tuyến tự động và cập nhật Tag / Thumbnail cho file Nhạc, Phim và Ảnh trên Windows.**

[![Electron](https://img.shields.io/badge/Electron-33.2-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## 📌 Giới thiệu

**Media Tag Updater** là phần mềm mã nguồn mở dành cho Windows giúp đơn giản hóa việc dọn dẹp, chuẩn hóa dữ liệu metadata (ID3 tag, EXIF, XMP, IPTC, Matroska tags) và nhúng ảnh bìa (Cover Art / Poster / Thumbnail) độ phân giải cao cho kho media cá nhân:
- 🎵 **Nhạc**: MP3, FLAC, M4A, AAC, OGG, WAV, WMA,...
- 🎬 **Phim & Video**: MP4, MKV, MOV, AVI, M4V, WEBM,...
- 🖼️ **Hình ảnh**: JPG/JPEG, PNG, WEBP, TIFF, HEIC,...

---

## ✨ Tính năng nổi bật

### 1. 🔍 Tra cứu Metadata & Ảnh bìa Trực tuyến Tự động
- **Nhạc (Audio)**: Tích hợp tìm kiếm thông minh từ **iTunes Search API**, **Deezer**, **MusicBrainz**, **Discogs** và **Last.fm**. Tự động tải ảnh bìa Album HD (1000x1000+).
- **Phim & TV Series (Video)**: Tra cứu thông tin từ **The Movie Database (TMDB)** và **TVMaze**: Tên phim, đạo diễn/diễn viên, năm phát hành, thể loại, tóm tắt nội dung (Overview/Plot), số mùa/tập, cùng Poster chất lượng cao.
- **Hình ảnh (Image)**: Tự động trích xuất tọa độ GPS và sử dụng dịch vụ **OpenStreetMap (Nominatim)** để tra cứu địa danh thực tế nơi chụp ảnh.

### 2. ⚡ Fast Video Tag & Poster Embedding (Không cần Re-encode)
- Nhúng Poster và cập nhật Metadata cho các định dạng video nặng (`.mkv`, `.mp4`, `.mov`, `.avi`) siêu nhanh mà **không cần mã hóa lại video (remux-only)**, giữ nguyên 100% chất lượng gốc.
- Đối với định dạng MKV, Poster được nhúng trực tiếp chuẩn **Matroska Attachments** (`cover.jpg` / `cover.png`), hiển thị hoàn hảo trên Windows Explorer, Plex, Jellyfin, Kodi và Infuse.

### 3. 🧠 Bộ phân tích Tên file Scene Release thông minh
- Tự động nhận diện cấu trúc tên file chuẩn Scene Release và trích xuất:
  - Độ phân giải (`4K`, `2160p`, `1080p`, `720p`,...)
  - Chuẩn nén / Codec (`x264`, `x265`, `HEVC`, `AV1`, `ProRes`,...)
  - Định dạng âm thanh (`DTS-HD MA`, `TrueHD`, `Atmos`, `AAC`, `FLAC`,...)
  - Nguồn phim (`BluRay`, `WEBRip`, `WEB-DL`, `HDTV`,...)
  - Mùa / Tập phim (`S01E05`), tên nhóm Rip (`Release Group`), mã JAV / Creator release.

### 4. 🏷️ Công cụ Đổi tên file hàng loạt & Batch Tagging
- **Đổi tên file từ Tag**: Đổi tên hàng trăm file media theo khuôn mẫu định sẵn (vd: `{artist} - {title}`, `{title} ({year}) [{resolution}]`,...).
- **Cập nhật Tag từ tên file**: Tự động bóc tách tên bài hát, ca sĩ, số thứ tự từ tên file để điền vào thẻ metadata.

### 5. 🛠️ Trình quản lý Thẻ Inspector chuyên sâu
- Chỉnh sửa trực tiếp từng trường thông tin: Tiêu đề, Ca sĩ / Nghệ sĩ, Album, Năm, Thể loại, Track No, Lời bài hát / Ghi chú,...
- Thêm, xóa hoặc thay thế ảnh bìa bằng thao tác kéo thả ảnh trực quan.

### 6. 🧬 Phát hiện Media trùng lặp
- Tự động chạy nền mỗi khi mở thư mục / thêm file, không chặn giao diện.
- **Trùng hoàn toàn**: lọc theo kích thước → hash mẫu (đầu/giữa/cuối) → SHA-256 toàn file (file > 512 MB so khớp 32 mẫu dữ liệu).
- **Ảnh giống nhau**: perceptual hash (dHash) phát hiện bản resize, nén lại, đổi định dạng.
- **Video giống nhau**: video lệch thời lượng ≤ 1 giây **và** khớp hình ảnh tại 5 khung hình mẫu (10/30/50/70/90%, trích bằng ffmpeg) → phát hiện bản encode lại, khác độ phân giải / codec.
- **Cùng nội dung theo Tag**: cùng bài hát (Title + Artist), cùng phim (Tên + Năm), cùng tập phim (SxxExx) nhưng khác bản Release.
- **Nhóm "có thể trùng"** (độ tin cậy thấp, mặc định ẩn – bật bằng ô *Hiện nhóm có thể trùng*):
  - *Cùng thời lượng*: video dài từ 60 giây, cùng thời lượng nhưng hình ảnh không khớp hoặc chưa so được (vd: khác viền đen, hoặc clip camera cắt cố định).
  - *Cùng dung lượng*: video cùng dung lượng chính xác từng byte nhưng nội dung khác (thường là cùng bản encode, khác Tag/Poster hoặc bị hỏng).
  - Các nhóm này không được tự động đánh dấu xóa – cần tự kiểm tra.
- Bộ lọc "File Trùng lặp", badge trên danh sách, gợi ý file nên giữ và chuyển các bản thừa vào **Thùng rác** (có thể khôi phục).

---

## 🏗️ Cấu trúc Thư mục

```text
media-tag-updater/
├── bin/                          # Thư mục công cụ binary phụ trợ (ffmpeg.exe, exiftool.exe)
│   └── README.md                 # Hướng dẫn chi tiết tải & cài đặt binary
├── electron/                     # Mã nguồn Electron Backend (Node.js)
│   ├── main.ts                   # Entry point của ứng dụng Electron
│   ├── preload.ts                # Context bridge an toàn giữa Electron & Renderer
│   └── services/                 # Các dịch vụ xử lý logic nền
│       ├── binaryManagerService.ts    # Quản lý & tải ffmpeg/exiftool
│       ├── configService.ts           # Lưu trữ cấu hình ứng dụng
│       ├── fastVideoTagEditor.ts      # Xử lý tag & poster video siêu tốc
│       ├── mediaTagService.ts         # Đọc/ghi metadata cho Nhạc, Phim, Ảnh
│       ├── metadataLookupService.ts   # Tra cứu metadata trực tuyến (TMDB, Deezer,...)
│       ├── renamePatternService.ts    # Mẫu đổi tên file linh hoạt
│       └── sceneReleaseParser.ts      # Phân tích tên file Scene Release
├── scripts/                      # Scripts bổ trợ build / setup
│   └── setup-binaries.mjs        # Script tự động tải & cấu hình ./bin
├── src/                          # Mã nguồn Giao diện (React + Vite + Tailwind)
│   ├── components/               # Các UI components
│   │   ├── FilenameToolModal.tsx # Modal đổi tên file hàng loạt
│   │   ├── MediaFileList.tsx     # Danh sách file & bảng preview
│   │   ├── OnlineSearchModal.tsx # Modal tìm kiếm & áp dụng tag online
│   │   ├── SettingsModal.tsx     # Cài đặt ứng dụng & API keys
│   │   ├── Sidebar.tsx           # Thanh điều hướng và lọc danh mục
│   │   └── TagInspectorPanel.tsx # Bảng chi tiết chỉnh sửa tag
│   ├── shared/                   # Kiểu dữ liệu TypeScript dùng chung
│   │   └── types.ts
│   ├── App.tsx                   # Component gốc của giao diện
│   ├── main.tsx                  # Khởi chạy React DOM
│   └── index.css                 # Tailwind CSS styles
├── tests/                        # Unit tests với Vitest
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🚀 Hướng dẫn Cài đặt & Chạy trong môi trường Phát triển

### Yêu cầu hệ thống
- **Hệ điều hành**: Windows 10 / 11 (64-bit)
- **Node.js**: Phiên bản 18 trở lên (Khuyến nghị Node.js LTS 20+)
- **NPM** hoặc **PNPM**

> **⚠️ Lưu ý khi dùng PowerShell:** Các lệnh trong tài liệu này dùng `npm.cmd` thay vì `npm`.
> Trên Windows, gõ `npm` trong PowerShell sẽ chạy file `npm.ps1`, file này bị chặn nếu
> Execution Policy của máy đang ở mức mặc định `Restricted`
> (lỗi *"running scripts is disabled on this system"*). `npm.cmd` là bản batch tương đương,
> không bị Execution Policy kiểm soát nên chạy được mà không cần đổi cài đặt bảo mật.
> Tương tự, dùng `npx.cmd` thay cho `npx`.
>
> Nếu bạn dùng **Command Prompt (cmd)**, **Git Bash**, hoặc PowerShell đã cho phép chạy script,
> có thể gõ `npm` như bình thường.

### Bước 1: Cài đặt các thư viện phụ thuộc
```bash
npm.cmd install
```

### Bước 2: Cài đặt các công cụ Binary phụ trợ (FFmpeg & ExifTool)
Để mở khóa tính năng nhúng Poster vào video MKV/AVI/MOV và ghi thông tin EXIF Tiếng Việt đầy đủ cho Ảnh, hãy chạy lệnh:
```bash
npm.cmd run setup:binaries
```
*(Bạn cũng có thể mở tab **Cài đặt** trong ứng dụng và bấm nút **"Tự động Tải & Cài đặt"** bất kỳ lúc nào).*

### Bước 3: Khởi chạy môi trường phát triển (Dev Mode)
```bash
npm.cmd run dev
```
Lệnh trên sẽ đồng thời khởi chạy **Vite Dev Server** (Hot Module Replacement) và **Electron** cửa sổ chính.
Sửa code trong `src/` → giao diện cập nhật ngay; sửa code trong `electron/` → app tự khởi động lại.
Nhấn `Ctrl+C` để dừng (nếu hiện câu hỏi `Terminate batch job (Y/N)?` thì gõ `Y`).

---

## 📦 Đóng gói & Phát hành (Production Build)

Để tạo bản cài đặt `.exe` hoàn chỉnh cho Windows:

```bash
# Đóng gói cả bản cài đặt (NSIS Installer) và bản chạy ngay (Portable EXE):
npm.cmd run dist
```

File cài đặt đầu ra sẽ nằm tại thư mục:
```text
release/
├── Media Tag Updater Setup 1.0.0.exe      # Bộ cài đặt NSIS
└── Media Tag Updater 1.0.0.exe            # Bản Portable chạy trực tiếp
```

---

## 🧪 Kiểm thử (Testing)

Dự án sử dụng **Vitest** để kiểm tra logic phân tích tên file, quy tắc đổi tên và phát hiện file trùng lặp:

```bash
# Chạy toàn bộ test suites
npm.cmd run test

# Kiểm tra kiểu dữ liệu TypeScript
npm.cmd run typecheck
```

---

## ⚙️ Cấu hình API Keys (Tùy chọn)

Ứng dụng hoạt động ngay mà không bắt buộc có API key (nhờ nguồn Deezer, iTunes, TVMaze, OpenStreetMap mở miễn phí). Tuy nhiên, bạn có thể bổ sung API key trong phần **Cài đặt (Settings)** để mở rộng kết quả tra cứu:

| Dịch vụ | Mục đích | Cách lấy Key |
| :--- | :--- | :--- |
| **TMDB (The Movie Database)** | Tìm kiếm Phim & TV Series đầy đủ nhất | Đăng ký miễn phí tại [themoviedb.org](https://www.themoviedb.org/settings/api) |
| **Discogs** | Tìm kiếm Album nhạc hiếm, đĩa than | Lấy Personal Access Token tại [discogs.com/settings/developers](https://www.discogs.com/settings/developers) |
| **Last.fm** | Bổ sung tag nhạc, nghệ sĩ & thể loại | Đăng ký API Account tại [last.fm/api](https://www.last.fm/api/account/create) |

---

## 🛡️ Giấy phép

Dự án được phát hành dưới giấy phép [MIT License](LICENSE).
Mọi đóng góp, báo lỗi (Issues) và Pull Requests đều rất được hoan nghênh!
