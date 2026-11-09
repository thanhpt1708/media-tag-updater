# Hướng dẫn Cài đặt Công cụ Binary (`ffmpeg.exe` & `exiftool.exe`)

Thư mục `bin/` này là nơi chứa các file thực thi (`binary`) đi kèm với dự án **Media Tag Updater** để hỗ trợ đọc/ghi Metadata và nhúng Thumbnail (Poster/Cover Art) nâng cao cho mọi định dạng Phim (`.mkv`, `.mp4`, `.mov`, `.avi`) và Ảnh (`.jpg`, `.png`, `.webp`, `.heic`, `.tiff`).

> **Lưu ý**: Ngay cả khi thư mục `bin/` chưa có 2 file này, ứng dụng **vẫn hoạt động bình thường** nhờ các thư viện tích hợp sẵn (`node-taglib-sharp`, `piexifjs`, `exifreader`, và gói `ffmpeg-static` trong `node_modules`). Tuy nhiên, việc đặt `ffmpeg.exe` và `exiftool.exe` vào `./bin/` sẽ mở khóa khả năng tương thích tối đa (đặc biệt với EXIF/XMP/IPTC tiếng Việt trên ảnh PNG/WebP và nhúng Poster chuẩn vào MKV/AVI/MOV).

---

## Cách 1: Cài đặt Tự động bằng Lệnh hoặc Giao diện Ứng dụng (Khuyên dùng)

Bạn có thể chạy lệnh sau tại thư mục gốc của project:

```powershell
npm run setup:binaries
```

Hoặc mở ứng dụng -> nhấn vào mục **Cài đặt (Settings)** -> chọn tab **Công cụ Binary (./bin)** -> nhấn nút **"Tự động Tải & Cài đặt ffmpeg.exe + exiftool.exe vào ./bin"**.

Script sẽ tự động:
1. Sao chép `ffmpeg.exe` từ gói `ffmpeg-static` vào `./bin/ffmpeg.exe`.
2. Tải bản `exiftool` chính thức cho Windows và giải nén `exiftool.exe` (kèm thư mục `exiftool_files` nếu có) vào `./bin/exiftool.exe`.

---

## Cách 2: Cài đặt Thủ công (Tự tải và chép vào thư mục `./bin/`)

Nếu máy của bạn hạn chế kết nối mạng khi chạy script, bạn có thể tự tải và đặt file theo cấu trúc tương đối của dự án như sau:

```text
<thư-mục-project>/
└── bin/
    ├── ffmpeg.exe
    ├── exiftool.exe
    └── exiftool_files/   (thư mục phụ thuộc đi kèm bản ExifTool mới)
```

### 1. Tải và đặt `ffmpeg.exe`
1. Truy cập trang tải chính thức cho Windows:
   - [https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip](https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip)
   - Hoặc bản build từ GitHub: [https://github.com/BtbN/FFmpeg-Builds/releases](https://github.com/BtbN/FFmpeg-Builds/releases)
2. Giải nén file `.zip` vừa tải về, mở thư mục `bin/` bên trong file giải nén.
3. Sao chép file **`ffmpeg.exe`** vào thư mục **`./bin/ffmpeg.exe`** của project.

### 2. Tải và đặt `exiftool.exe`
1. Truy cập trang chủ ExifTool của Phil Harvey:
   - [https://exiftool.org/](https://exiftool.org/) (Chọn bản **Windows Executable 64-bit** `exiftool-xx.xx_64.zip`).
2. Giải nén file `.zip` vừa tải về.
3. Bên trong thư mục giải nén sẽ có file `exiftool(-k).exe` và thư mục `exiftool_files`:
   - Đổi tên **`exiftool(-k).exe`** thành **`exiftool.exe`**.
   - Sao chép cả file **`exiftool.exe`** và thư mục **`exiftool_files`** vào trong thư mục **`./bin/`** của project.

---

## Cách 3: Trỏ đường dẫn tới Binary đã có sẵn trên máy

Nếu bạn đã lưu `ffmpeg.exe` hoặc `exiftool.exe` ở một thư mục khác trên ổ cứng Windows:
1. Mở ứng dụng **Media Tag Updater** -> vào **Cài đặt (Settings)**.
2. Tại mục **Đường dẫn FFmpeg** / **Đường dẫn ExifTool**, nhấn nút **Chọn file...** và trỏ tới file `.exe` tương ứng.
3. Nhấn **Kiểm tra lại** để xác nhận phiên bản.
