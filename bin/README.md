# Thư mục `bin/` – Công cụ Binary đi kèm

Thư mục này chứa các file thực thi mà **Media Tag Updater** dùng để đọc/ghi metadata, nhúng Poster và encode video. Nội dung được sinh tự động (đã gitignore, trừ file README này) theo khai báo trong [`scripts/binaries.json`](../scripts/binaries.json):

```text
bin/
├── ffmpeg.exe                 # FFmpeg bản chính (gyan.dev essentials)
├── ffprobe.exe                # FFprobe cùng bản với ffmpeg chính
├── ffmpeg-compat/
│   └── ffmpeg.exe             # FFmpeg bản cũ (NVENC SDK cũ) – dự phòng cho GPU/driver đời cũ
├── exiftool.exe               # ExifTool (bản Windows 64-bit)
├── exiftool_files/            # Perl runtime + thư viện đi kèm ExifTool
├── licenses/                  # License của FFmpeg
└── .versions.json             # Đánh dấu version đã cài (script dùng để biết có cần tải lại không)
```

Khi đóng gói, toàn bộ các file trên được chép vào `resources\bin\` của bản phát hành.

---

## Cài đặt (khuyên dùng)

Tại thư mục gốc của project:

```powershell
npm.cmd run setup:binaries
```

Script sẽ:
1. Tải đúng version khai báo trong `scripts/binaries.json` (FFmpeg từ GitHub `GyanD/codexffmpeg`, ExifTool từ SourceForge).
2. Kiểm tra SHA256 của từng gói, sai thì dừng.
3. Giải nén vào `./bin` và chạy kiểm tra (version, danh sách encoder `libx264/libx265/nvenc/qsv/amf`).
4. Thoát với mã lỗi nếu có bước nào thất bại.

Các lệnh khác:

```powershell
npm.cmd run setup:binaries -- --force   # tải lại toàn bộ
npm.cmd run verify:binaries             # chỉ kiểm tra, không tải
```

Gói nào đã đúng version thì được bỏ qua, nên khi ai đó nâng version trong `binaries.json`, chỉ cần chạy lại lệnh trên.

Trong ứng dụng: **Cài đặt → Công cụ Binary → "Tự động Tải & Cài đặt"** dùng cùng logic này.

## Vì sao có 2 bản FFmpeg?

Encoder GPU (NVENC/QSV/AMF) phụ thuộc vào phiên bản SDK mà FFmpeg được build kèm. FFmpeg mới đòi driver GPU mới; GPU đời cũ (vd GTX 10xx) bị dừng ở driver cũ nên không chạy được NVENC với bản mới. Khi dò encoder, app thử bản chính trước, sau đó tới `ffmpeg-compat`, và nhớ bản nào chạy được. Nếu cả hai đều không dùng được GPU, app dùng `libx265`/`libx264` (CPU).

## Nâng version binary

1. Chọn bản mới, tải file zip và tính SHA256 (`Get-FileHash <file> -Algorithm SHA256`).
2. Sửa `version`, `url`, `sha256`, các đường dẫn `from` và chuỗi `expect` trong `scripts/binaries.json`.
3. Chạy `npm.cmd run setup:binaries`, rồi test encode trên cả máy GPU đời mới và đời cũ.

## Cài thủ công (khi không có mạng)

Tải các gói theo URL trong `scripts/binaries.json`, giải nén và đặt file đúng cấu trúc ở trên (với ExifTool: đổi tên `exiftool(-k).exe` thành `exiftool.exe`, chép kèm thư mục `exiftool_files`). Sau đó chạy `npm.cmd run verify:binaries` để kiểm tra.

Hoặc trỏ tới binary có sẵn trên máy: **Cài đặt → Đường dẫn FFmpeg / ExifTool → Chọn file...**
