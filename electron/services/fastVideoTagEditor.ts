import fs from 'node:fs';
import path from 'node:path';
import { MediaMetadata } from '../../src/shared/types';

// ============================================================================
// TIỆN ÍCH CHUNG CHO PARSE DATA URL ẢNH BÌA
// ============================================================================

export function parseDataUrlToImageBuffer(
  dataUrl: string
): { mimeType: string; buffer: Buffer } | null {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

// ============================================================================
// PHẦN 1: TRÌNH ĐỌC & GHI IN-PLACE CHO MP4 / M4V / MOV (ISO BMFF)
// Không đọc hay sao chép bất kỳ byte nào của luồng video `mdat`!
// ============================================================================

interface Mp4BoxHeader {
  offset: number;
  size: number;
  headerSize: number;
  type: string;
}

async function readMp4TopLevelBoxes(fh: fs.promises.FileHandle, fileSize: number): Promise<Mp4BoxHeader[]> {
  const boxes: Mp4BoxHeader[] = [];
  let offset = 0;
  const headerBuf = Buffer.allocUnsafe(16);

  while (offset + 8 <= fileSize) {
    const { bytesRead } = await fh.read(headerBuf, 0, Math.min(16, fileSize - offset), offset);
    if (bytesRead < 8) break;

    const size32 = headerBuf.readUInt32BE(0);
    const type = headerBuf.toString('latin1', 4, 8);

    let boxSize = size32;
    let headerSize = 8;

    if (size32 === 1) {
      if (bytesRead < 16) break;
      const size64 = Number(headerBuf.readBigUInt64BE(8));
      boxSize = size64;
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = fileSize - offset;
    }

    if (boxSize < headerSize || offset + boxSize > fileSize) {
      break;
    }

    boxes.push({ offset, size: boxSize, headerSize, type });
    offset += boxSize;
  }

  return boxes;
}

function parseChildBoxes(buf: Buffer, startOffset = 0, endOffset = buf.length): Mp4BoxHeader[] {
  const boxes: Mp4BoxHeader[] = [];
  let offset = startOffset;

  while (offset + 8 <= endOffset) {
    const size32 = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    let boxSize = size32;
    let headerSize = 8;

    if (size32 === 1) {
      if (offset + 16 > endOffset) break;
      boxSize = Number(buf.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = endOffset - offset;
    }

    if (boxSize < headerSize || offset + boxSize > endOffset) {
      break;
    }

    boxes.push({ offset, size: boxSize, headerSize, type });
    offset += boxSize;
  }

  return boxes;
}

function makeMp4Box(type: string, payload: Buffer | Buffer[]): Buffer {
  const body = Array.isArray(payload) ? Buffer.concat(payload) : payload;
  const total = 8 + body.length;
  const header = Buffer.allocUnsafe(8);
  header.writeUInt32BE(total, 0);
  header.write(type, 4, 4, 'latin1');
  return Buffer.concat([header, body]);
}

function makeIlstTextItem(fourcc: string, text: string): Buffer {
  const strBuf = Buffer.from(text, 'utf8');
  const dataHeader = Buffer.alloc(16);
  dataHeader.writeUInt32BE(16 + strBuf.length, 0);
  dataHeader.write('data', 4, 4, 'ascii');
  dataHeader.writeUInt32BE(1, 8); // type = 1 (UTF-8)
  dataHeader.writeUInt32BE(0, 12); // locale = 0
  return makeMp4Box(fourcc, Buffer.concat([dataHeader, strBuf]));
}

function makeIlstTrackItem(trackNumber: number): Buffer {
  const dataBuf = Buffer.alloc(16 + 8);
  dataBuf.writeUInt32BE(24, 0);
  dataBuf.write('data', 4, 4, 'ascii');
  dataBuf.writeUInt32BE(0, 8); // type = 0 (implicit binary)
  dataBuf.writeUInt32BE(0, 12);
  dataBuf.writeUInt16BE(0, 16);
  dataBuf.writeUInt16BE(Math.max(0, Math.min(65535, trackNumber)), 18);
  dataBuf.writeUInt16BE(0, 20);
  dataBuf.writeUInt16BE(0, 22);
  return makeMp4Box('trkn', dataBuf);
}

function makeIlstUint32Item(fourcc: string, value: number): Buffer {
  const dataBuf = Buffer.alloc(16 + 4);
  dataBuf.writeUInt32BE(20, 0);
  dataBuf.write('data', 4, 4, 'ascii');
  dataBuf.writeUInt32BE(21, 8); // type = 21 (signed/unsigned integer)
  dataBuf.writeUInt32BE(0, 12);
  dataBuf.writeUInt32BE(Math.max(0, value), 16);
  return makeMp4Box(fourcc, dataBuf);
}

function makeIlstCoverItem(imgBuffer: Buffer, mimeType: string): Buffer {
  const typeIndicator = mimeType.includes('png') ? 14 : 13; // 13 = JPEG, 14 = PNG
  const dataHeader = Buffer.alloc(16);
  dataHeader.writeUInt32BE(16 + imgBuffer.length, 0);
  dataHeader.write('data', 4, 4, 'ascii');
  dataHeader.writeUInt32BE(typeIndicator, 8);
  dataHeader.writeUInt32BE(0, 12);
  return makeMp4Box('covr', Buffer.concat([dataHeader, imgBuffer]));
}

function makeStandardMdirHdlrBox(): Buffer {
  // 33-byte standard iTunes 'mdir' handler box
  const payload = Buffer.alloc(25, 0);
  payload.write('mdir', 4, 4, 'ascii');
  payload.write('appl', 8, 4, 'ascii');
  return makeMp4Box('hdlr', payload);
}

function parseIlstBuffer(ilstBuf: Buffer, startOffset: number, endOffset: number): {
  metadata: MediaMetadata;
  hasEmbeddedThumbnail: boolean;
} {
  const metadata: MediaMetadata = {};
  let hasEmbeddedThumbnail = false;

  const items = parseChildBoxes(ilstBuf, startOffset, endOffset);
  for (const item of items) {
    const dataBoxes = parseChildBoxes(ilstBuf, item.offset + item.headerSize, item.offset + item.size);
    const dataBox = dataBoxes.find((b) => b.type === 'data');
    if (!dataBox || dataBox.size < 16) continue;

    const dataType = ilstBuf.readUInt32BE(dataBox.offset + 8);
    const valueStart = dataBox.offset + 16;
    const valueEnd = dataBox.offset + dataBox.size;
    if (valueEnd < valueStart) continue;

    const rawVal = ilstBuf.subarray(valueStart, valueEnd);
    const key = item.type;

    if (key === 'covr') {
      if (rawVal.length > 0 && rawVal.length < 15 * 1024 * 1024) {
        const mime = dataType === 14 || (rawVal[0] === 0x89 && rawVal[1] === 0x50)
          ? 'image/png'
          : 'image/jpeg';
        metadata.thumbnailDataUrl = `data:${mime};base64,${rawVal.toString('base64')}`;
        hasEmbeddedThumbnail = true;
      }
      continue;
    }

    if (key === 'trkn' && rawVal.length >= 4) {
      const trk = rawVal.readUInt16BE(2);
      if (trk > 0) metadata.trackNumber = trk;
      continue;
    }

    if (key === 'tvsn' && rawVal.length >= 1) {
      const sNum =
        rawVal.length >= 4
          ? rawVal.readUInt32BE(0)
          : rawVal.length >= 2
          ? rawVal.readUInt16BE(0)
          : rawVal.readUInt8(0);
      if (sNum > 0) metadata.seasonNumber = sNum;
      continue;
    }

    if (key === 'tves' && rawVal.length >= 1 && !metadata.trackNumber) {
      const eNum =
        rawVal.length >= 4
          ? rawVal.readUInt32BE(0)
          : rawVal.length >= 2
          ? rawVal.readUInt16BE(0)
          : rawVal.readUInt8(0);
      if (eNum > 0) metadata.trackNumber = eNum;
      continue;
    }

    // Các thẻ chuỗi UTF-8 (0xA9 = '©' trong Latin1/ASCII)
    const strVal = rawVal.toString('utf8').replace(/\0+$/, '').trim();
    if (!strVal) continue;

    if (key === '\xA9nam') {
      metadata.title = strVal;
    } else if (key === '\xA9ART') {
      metadata.artist = strVal;
    } else if (key === 'aART') {
      metadata.albumArtist = strVal;
      if (!metadata.artist) metadata.artist = strVal;
    } else if (key === '\xA9alb' || key === 'tvsh') {
      if (!metadata.album) metadata.album = strVal;
    } else if (key === '\xA9day') {
      const ym = strVal.match(/\b(19\d{2}|20[0-3]\d)\b/);
      if (ym) metadata.year = parseInt(ym[1], 10);
    } else if (key === '\xA9gen') {
      metadata.genre = strVal;
    } else if (key === 'ldes' || key === 'desc' || key === '\xA9cmt') {
      // Ưu tiên mô tả dài hơn (ldes > desc > ©cmt)
      if (!metadata.comment || strVal.length > metadata.comment.length) {
        metadata.comment = strVal;
      }
    } else if (key === 'cprt') {
      metadata.copyright = strVal;
    }
  }

  return { metadata, hasEmbeddedThumbnail };
}

/**
 * Đọc siêu nhanh Metadata & Cover Art từ file .mp4 / .m4v / .mov bằng cách nhảy trực tiếp tới box `moov -> udta`
 */
export async function readMp4MetadataFast(filePath: string): Promise<{
  metadata: MediaMetadata;
  hasEmbeddedThumbnail: boolean;
} | null> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    const stat = await fs.promises.stat(filePath);
    fh = await fs.promises.open(filePath, 'r');

    const topBoxes = await readMp4TopLevelBoxes(fh, stat.size);
    const moovBox = topBoxes.find((b) => b.type === 'moov');
    if (!moovBox) return null;

    // Nhảy qua các child box bên trong moov để chỉ đọc đúng box `udta` (tiết kiệm RAM tối đa)
    const moovChildren = await readMp4SubBoxesFromHandle(
      fh,
      moovBox.offset + moovBox.headerSize,
      moovBox.offset + moovBox.size
    );
    const udtaBox = moovChildren.find((b) => b.type === 'udta');
    if (!udtaBox || udtaBox.size > 32 * 1024 * 1024) {
      return { metadata: {}, hasEmbeddedThumbnail: false };
    }

    const udtaBuf = Buffer.allocUnsafe(udtaBox.size);
    await fh.read(udtaBuf, 0, udtaBox.size, udtaBox.offset);

    const udtaChildren = parseChildBoxes(udtaBuf, udtaBox.headerSize, udtaBox.size);
    const metaBox = udtaChildren.find((b) => b.type === 'meta');
    if (!metaBox || metaBox.size < metaBox.headerSize + 4) {
      return { metadata: {}, hasEmbeddedThumbnail: false };
    }

    const metaChildren = parseChildBoxes(udtaBuf, metaBox.offset + metaBox.headerSize + 4, metaBox.offset + metaBox.size);
    const ilstBox = metaChildren.find((b) => b.type === 'ilst');
    if (!ilstBox) {
      return { metadata: {}, hasEmbeddedThumbnail: false };
    }

    return parseIlstBuffer(udtaBuf, ilstBox.offset + ilstBox.headerSize, ilstBox.offset + ilstBox.size);
  } catch {
    return null;
  } finally {
    if (fh) await fh.close();
  }
}

async function readMp4SubBoxesFromHandle(
  fh: fs.promises.FileHandle,
  startOffset: number,
  endOffset: number
): Promise<Mp4BoxHeader[]> {
  const boxes: Mp4BoxHeader[] = [];
  let offset = startOffset;
  const headerBuf = Buffer.allocUnsafe(16);

  while (offset + 8 <= endOffset) {
    const { bytesRead } = await fh.read(headerBuf, 0, Math.min(16, endOffset - offset), offset);
    if (bytesRead < 8) break;

    const size32 = headerBuf.readUInt32BE(0);
    const type = headerBuf.toString('latin1', 4, 8);
    let boxSize = size32;
    let headerSize = 8;

    if (size32 === 1) {
      if (bytesRead < 16) break;
      boxSize = Number(headerBuf.readBigUInt64BE(8));
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = endOffset - offset;
    }

    if (boxSize < headerSize || offset + boxSize > endOffset) break;
    boxes.push({ offset, size: boxSize, headerSize, type });
    offset += boxSize;
  }

  return boxes;
}

/**
 * Ghi Metadata & Cover Art trực tiếp (In-Place) vào file .mp4 / .m4v / .mov:
 * - Tuyệt đối KHÔNG chạm vào hay sao chép box `mdat` (luồng video/audio hàng chục GB).
 * - Nếu `moov` nằm sau `mdat`: ghi đè `moov` ngay ở cuối file.
 * - Nếu `moov` nằm trước `mdat`:
 *   + Nếu `newMoov` vừa trong khoảng trống `moov` cũ + `free` kế bên: ghi đè tại chỗ và điền `free` box cho phần dư.
 *   + Nếu `newMoov` lớn hơn khoảng trống trước `mdat`: biến vùng `moov` cũ thành `free` box có cùng kích thước (nhờ vậy byte offset của `mdat` và bảng `stco`/`co64` giữ nguyên 100%!) và ghi `newMoov` vào cuối file.
 */
export async function writeMp4MetadataInPlace(
  filePath: string,
  metadata: MediaMetadata
): Promise<boolean> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    const stat = await fs.promises.stat(filePath);
    fh = await fs.promises.open(filePath, 'r+');

    const topBoxes = await readMp4TopLevelBoxes(fh, stat.size);
    const moovIdx = topBoxes.findIndex((b) => b.type === 'moov');
    const mdatBox = topBoxes.find((b) => b.type === 'mdat');
    if (moovIdx === -1 || !mdatBox) return false;

    const moovBox = topBoxes[moovIdx];
    // Giới hạn an toàn cho kích thước moov (64MB)
    if (moovBox.size > 64 * 1024 * 1024) return false;

    const oldMoovBuf = Buffer.allocUnsafe(moovBox.size);
    await fh.read(oldMoovBuf, 0, moovBox.size, moovBox.offset);

    const moovChildren = parseChildBoxes(oldMoovBuf, moovBox.headerSize, oldMoovBuf.length);
    const keptMoovChildren: Buffer[] = [];
    const keptUdtaChildren: Buffer[] = [];

    for (const child of moovChildren) {
      if (child.type !== 'udta') {
        keptMoovChildren.push(oldMoovBuf.subarray(child.offset, child.offset + child.size));
      } else {
        const udtaChildren = parseChildBoxes(
          oldMoovBuf,
          child.offset + child.headerSize,
          child.offset + child.size
        );
        for (const uChild of udtaChildren) {
          if (uChild.type !== 'meta' && uChild.type !== 'free') {
            keptUdtaChildren.push(oldMoovBuf.subarray(uChild.offset, uChild.offset + uChild.size));
          }
        }
      }
    }

    // Xây dựng danh sách thẻ trong `ilst`
    const ilstItems: Buffer[] = [];
    if (metadata.title) {
      ilstItems.push(makeIlstTextItem('\xA9nam', metadata.title));
    }
    if (metadata.artist) {
      ilstItems.push(makeIlstTextItem('\xA9ART', metadata.artist));
    }
    if (metadata.albumArtist || metadata.artist) {
      ilstItems.push(makeIlstTextItem('aART', metadata.albumArtist || metadata.artist || ''));
    }
    if (metadata.album) {
      ilstItems.push(makeIlstTextItem('\xA9alb', metadata.album));
    }
    if (metadata.year && metadata.year > 0) {
      ilstItems.push(makeIlstTextItem('\xA9day', String(metadata.year)));
    }
    if (metadata.genre) {
      ilstItems.push(makeIlstTextItem('\xA9gen', metadata.genre));
    }
    if (metadata.comment) {
      ilstItems.push(makeIlstTextItem('\xA9cmt', metadata.comment));
      ilstItems.push(makeIlstTextItem('desc', metadata.comment.slice(0, 255)));
      ilstItems.push(makeIlstTextItem('ldes', metadata.comment));
    }
    if (metadata.copyright) {
      ilstItems.push(makeIlstTextItem('cprt', metadata.copyright));
    }
    if (metadata.trackNumber && metadata.trackNumber > 0) {
      ilstItems.push(makeIlstTrackItem(metadata.trackNumber));
      ilstItems.push(makeIlstUint32Item('tves', metadata.trackNumber));
    }
    if (metadata.seasonNumber && metadata.seasonNumber > 0) {
      ilstItems.push(makeIlstUint32Item('tvsn', metadata.seasonNumber));
    }
    if (metadata.thumbnailDataUrl) {
      const parsedImg = parseDataUrlToImageBuffer(metadata.thumbnailDataUrl);
      if (parsedImg) {
        ilstItems.push(makeIlstCoverItem(parsedImg.buffer, parsedImg.mimeType));
      }
    }

    const ilstBox = makeMp4Box('ilst', ilstItems);
    const hdlrBox = makeStandardMdirHdlrBox();
    const metaFlags = Buffer.alloc(4, 0); // FullBox version=0, flags=0
    const metaBox = makeMp4Box('meta', [metaFlags, hdlrBox, ilstBox]);

    // Tạo hàm dựng `moov` với đệm `free` tùy chỉnh bên trong `udta` để xử lý khoảng lệch 1..7 byte
    const buildNewMoov = (extraInternalFreePayloadBytes = 0): Buffer => {
      const internalFreeBoxes: Buffer[] = [];
      if (extraInternalFreePayloadBytes > 0) {
        internalFreeBoxes.push(makeMp4Box('free', Buffer.alloc(extraInternalFreePayloadBytes, 0)));
      }
      const udtaBox = makeMp4Box('udta', [...keptUdtaChildren, metaBox, ...internalFreeBoxes]);
      return makeMp4Box('moov', [...keptMoovChildren, udtaBox]);
    };

    let newMoovBuf = buildNewMoov(24); // Luôn có sẵn 32 byte (8 header + 24 payload) free dự phòng trong udta

    // Kiểm tra các box `free` hoặc `skip` nằm ngay sau `moov`
    let contiguousSpace = moovBox.size;
    let nextIdx = moovIdx + 1;
    while (
      nextIdx < topBoxes.length &&
      (topBoxes[nextIdx].type === 'free' || topBoxes[nextIdx].type === 'skip')
    ) {
      contiguousSpace += topBoxes[nextIdx].size;
      nextIdx++;
    }

    const isLastNonFreeBox = nextIdx === topBoxes.length;

    if (isLastNonFreeBox) {
      // Trường hợp 1: `moov` nằm ở cuối file (sau `mdat`) -> Ghi đè trực tiếp và truncate!
      await fh.write(newMoovBuf, 0, newMoovBuf.length, moovBox.offset);
      await fh.truncate(moovBox.offset + newMoovBuf.length);
      return true;
    }

    // Trường hợp 2: `moov` nằm trước `mdat` (hoặc trước một box khác)
    // Nếu lệch 1..7 byte (không đủ 8 byte cho 1 box `free` độc lập), điều chỉnh `free` nội bộ của `udta` cho khớp tuyệt đối!
    const diff = contiguousSpace - newMoovBuf.length;
    if (diff > 0 && diff < 8) {
      newMoovBuf = buildNewMoov(24 + diff);
    }

    if (newMoovBuf.length === contiguousSpace) {
      // Khớp tuyệt đối kích thước -> Ghi đè tại chỗ
      await fh.write(newMoovBuf, 0, newMoovBuf.length, moovBox.offset);
      return true;
    }

    if (newMoovBuf.length + 8 <= contiguousSpace) {
      // Nhỏ hơn khoảng trống hiện có -> Ghi `newMoov` tại chỗ + tạo box `free` lấp đúng phần dư
      const freeSize = contiguousSpace - newMoovBuf.length;
      const freeHeader = Buffer.alloc(8, 0);
      freeHeader.writeUInt32BE(freeSize, 0);
      freeHeader.write('free', 4, 4, 'latin1');

      await fh.write(newMoovBuf, 0, newMoovBuf.length, moovBox.offset);
      await fh.write(freeHeader, 0, 8, moovBox.offset + newMoovBuf.length);
      return true;
    }

    // Trường hợp 2c: `newMoov` lớn hơn khoảng trống trước `mdat`
    // Kiểm tra an toàn trước khi ghi: box cuối cùng trong file có dùng `size32 === 0` (kéo dài tới EOF) không?
    const lastTopBox = topBoxes[topBoxes.length - 1];
    const lastHdrBuf = Buffer.allocUnsafe(4);
    await fh.read(lastHdrBuf, 0, 4, lastTopBox.offset);
    if (lastHdrBuf.readUInt32BE(0) === 0) {
      if (lastTopBox.size >= 0xffffffff) {
        // Không thể chốt size 32-bit cho box > 4GB có size=0 mà không dịch chuyển dữ liệu -> Hủy an toàn
        return false;
      }
      lastHdrBuf.writeUInt32BE(lastTopBox.size, 0);
      await fh.write(lastHdrBuf, 0, 4, lastTopBox.offset);
    }

    // Biến vùng `moov` cũ (`contiguousSpace` byte) thành 1 box `free` có kích thước y hệt để KHÔNG làm dịch chuyển `mdat`!
    const oldRegionFreeHeader = Buffer.alloc(16, 0);
    oldRegionFreeHeader.writeUInt32BE(contiguousSpace, 0);
    oldRegionFreeHeader.write('free', 4, 4, 'latin1');
    await fh.write(oldRegionFreeHeader, 0, Math.min(16, contiguousSpace), moovBox.offset);

    // Nếu ở cuối file đã có box `free`, có thể ghi đè từ vị trí box `free` cuối file
    let appendOffset = stat.size;
    while (
      topBoxes.length > 0 &&
      (topBoxes[topBoxes.length - 1].type === 'free' || topBoxes[topBoxes.length - 1].type === 'skip') &&
      topBoxes[topBoxes.length - 1].offset > mdatBox.offset
    ) {
      const lastFree = topBoxes.pop()!;
      appendOffset = lastFree.offset;
    }

    await fh.write(newMoovBuf, 0, newMoovBuf.length, appendOffset);
    await fh.truncate(appendOffset + newMoovBuf.length);
    return true;
  } catch (err) {
    console.warn('[FastVideoTagEditor] MP4 in-place write failed:', err);
    return false;
  } finally {
    if (fh) await fh.close();
  }
}

// ============================================================================
// PHẦN 2: TRÌNH ĐỌC & GHI IN-PLACE CHO MATROSKA (.MKV / .WEBM - EBML)
// Không đọc hay sao chép bất kỳ byte nào của `Cluster` (luồng video/audio)!
// ============================================================================

const EBML_ID_HEADER = 0x1a45dfa3;
const EBML_ID_SEGMENT = 0x18538067;
const EBML_ID_SEEKHEAD = 0x114d9b74;
const EBML_ID_SEEK = 0x4dbb;
const EBML_ID_SEEK_ID = 0x53ab;
const EBML_ID_SEEK_POSITION = 0x53ac;
const EBML_ID_VOID = 0xec;
const EBML_ID_INFO = 0x1549a966;
const EBML_ID_TITLE = 0x7ba9;
const EBML_ID_CLUSTER = 0x1f43b675;
const EBML_ID_TAGS = 0x1254c367;
const EBML_ID_TAG = 0x7373;
const EBML_ID_TARGETS = 0x63c0;
const EBML_ID_SIMPLE_TAG = 0x67c8;
const EBML_ID_TAG_NAME = 0x45a3;
const EBML_ID_TAG_STRING = 0x4487;
const EBML_ID_ATTACHMENTS = 0x1941a469;
const EBML_ID_ATTACHED_FILE = 0x61a7;
const EBML_ID_FILE_DESCRIPTION = 0x467e;
const EBML_ID_FILE_NAME = 0x466e;
const EBML_ID_FILE_MIME_TYPE = 0x4660;
const EBML_ID_FILE_DATA = 0x465c;
const EBML_ID_FILE_UID = 0x46ae;

interface EbmlElementHeader {
  id: number;
  idLength: number;
  size: number; // -1 nếu là unknown size
  sizeLength: number;
  headerOffset: number;
  dataOffset: number;
}

function readEbmlId(buf: Buffer, offset: number): { id: number; length: number } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (first === 0) return null;

  let length = 1;
  let mask = 0x80;
  while (length <= 4 && (first & mask) === 0) {
    length++;
    mask >>= 1;
  }
  if (length > 4 || offset + length > buf.length) return null;

  let id = 0;
  for (let i = 0; i < length; i++) {
    id = id * 256 + buf[offset + i];
  }
  return { id, length };
}

function readEbmlSize(buf: Buffer, offset: number): { size: number; length: number } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  if (first === 0) return null;

  let length = 1;
  let mask = 0x80;
  while (length <= 8 && (first & mask) === 0) {
    length++;
    mask >>= 1;
  }
  if (length > 8 || offset + length > buf.length) return null;

  let value = BigInt(first & (mask - 1));
  let allOnes = (first & (mask - 1)) === mask - 1;

  for (let i = 1; i < length; i++) {
    const b = buf[offset + i];
    if (b !== 0xff) allOnes = false;
    value = (value << 8n) | BigInt(b);
  }

  if (allOnes) {
    return { size: -1, length };
  }
  return { size: Number(value), length };
}

function readEbmlElementHeader(buf: Buffer, offset: number): EbmlElementHeader | null {
  const idInfo = readEbmlId(buf, offset);
  if (!idInfo) return null;
  const sizeInfo = readEbmlSize(buf, offset + idInfo.length);
  if (!sizeInfo) return null;

  return {
    id: idInfo.id,
    idLength: idInfo.length,
    size: sizeInfo.size,
    sizeLength: sizeInfo.length,
    headerOffset: offset,
    dataOffset: offset + idInfo.length + sizeInfo.length,
  };
}

function encodeEbmlId(id: number): Buffer {
  if (id <= 0xff) return Buffer.from([id]);
  if (id <= 0xffff) return Buffer.from([(id >> 8) & 0xff, id & 0xff]);
  if (id <= 0xffffff) return Buffer.from([(id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
  return Buffer.from([
    (id >>> 24) & 0xff,
    (id >>> 16) & 0xff,
    (id >>> 8) & 0xff,
    id & 0xff,
  ]);
}

function encodeEbmlSize(size: number, forcedWidth?: number): Buffer {
  let width = forcedWidth || 1;
  if (!forcedWidth) {
    if (size < 0x7f) width = 1;
    else if (size < 0x3fff) width = 2;
    else if (size < 0x1fffff) width = 3;
    else if (size < 0x0fffffff) width = 4;
    else width = 8;
  }

  const out = Buffer.allocUnsafe(width);
  let v = BigInt(size);
  for (let i = width - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  out[0] |= 1 << (8 - width);
  return out;
}

function makeEbmlElement(id: number, payload: Buffer | Buffer[]): Buffer {
  const body = Array.isArray(payload) ? Buffer.concat(payload) : payload;
  const idBuf = encodeEbmlId(id);
  const sizeBuf = encodeEbmlSize(body.length);
  return Buffer.concat([idBuf, sizeBuf, body]);
}

function makeEbmlUintElement(id: number, value: number): Buffer {
  let v = BigInt(Math.max(0, value));
  const bytes: number[] = [];
  if (v === 0n) {
    bytes.push(0);
  } else {
    while (v > 0n) {
      bytes.unshift(Number(v & 0xffn));
      v >>= 8n;
    }
  }
  return makeEbmlElement(id, Buffer.from(bytes));
}

function makeEbmlVoidElement(totalByteLength: number): Buffer {
  if (totalByteLength < 2) {
    return Buffer.alloc(0);
  }
  // Với Void (0xEC, 1 byte ID), chọn độ rộng VINT size sao cho 1 + sizeWidth + payload = totalByteLength
  let sizeWidth = 1;
  if (totalByteLength - 2 >= 0x7f) sizeWidth = 2;
  if (totalByteLength - 3 >= 0x3fff) sizeWidth = 4;
  if (totalByteLength < 1 + sizeWidth) sizeWidth = 1;

  const payloadLen = totalByteLength - 1 - sizeWidth;
  const out = Buffer.alloc(totalByteLength, 0);
  out[0] = EBML_ID_VOID;
  const sizeBuf = encodeEbmlSize(payloadLen, sizeWidth);
  sizeBuf.copy(out, 1);
  return out;
}

function readEbmlUint(buf: Buffer, offset: number, length: number): number {
  let val = 0n;
  for (let i = 0; i < length; i++) {
    val = (val << 8n) | BigInt(buf[offset + i]);
  }
  return Number(val);
}

function parseSeekHead(buf: Buffer, startOffset: number, endOffset: number): Map<number, number> {
  const seekMap = new Map<number, number>();
  let offset = startOffset;

  while (offset < endOffset) {
    const el = readEbmlElementHeader(buf, offset);
    if (!el || el.size < 0 || el.dataOffset + el.size > endOffset) break;

    if (el.id === EBML_ID_SEEK) {
      let subOff = el.dataOffset;
      const subEnd = el.dataOffset + el.size;
      let seekId: number | null = null;
      let seekPos: number | null = null;

      while (subOff < subEnd) {
        const sub = readEbmlElementHeader(buf, subOff);
        if (!sub || sub.size < 0 || sub.dataOffset + sub.size > subEnd) break;
        if (sub.id === EBML_ID_SEEK_ID) {
          seekId = readEbmlUint(buf, sub.dataOffset, sub.size);
        } else if (sub.id === EBML_ID_SEEK_POSITION) {
          seekPos = readEbmlUint(buf, sub.dataOffset, sub.size);
        }
        subOff = sub.dataOffset + sub.size;
      }

      if (seekId !== null && seekPos !== null) {
        seekMap.set(seekId, seekPos);
      }
    }

    offset = el.dataOffset + el.size;
  }

  return seekMap;
}

function parseMatroskaInfoTitle(buf: Buffer, startOffset: number, endOffset: number): string | undefined {
  let offset = startOffset;
  while (offset < endOffset) {
    const el = readEbmlElementHeader(buf, offset);
    if (!el || el.size < 0 || el.dataOffset + el.size > endOffset) break;
    if (el.id === EBML_ID_TITLE) {
      const title = buf
        .subarray(el.dataOffset, el.dataOffset + el.size)
        .toString('utf8')
        .replace(/\0+$/, '')
        .trim();
      if (title) return title;
    }
    offset = el.dataOffset + el.size;
  }
  return undefined;
}

function parseMatroskaTagsElement(buf: Buffer, startOffset: number, endOffset: number, metadata: MediaMetadata): void {
  let offset = startOffset;
  while (offset < endOffset) {
    const tagEl = readEbmlElementHeader(buf, offset);
    if (!tagEl || tagEl.size < 0 || tagEl.dataOffset + tagEl.size > endOffset) break;

    if (tagEl.id === EBML_ID_TAG) {
      let subOff = tagEl.dataOffset;
      const subEnd = tagEl.dataOffset + tagEl.size;

      while (subOff < subEnd) {
        const sub = readEbmlElementHeader(buf, subOff);
        if (!sub || sub.size < 0 || sub.dataOffset + sub.size > subEnd) break;

        if (sub.id === EBML_ID_SIMPLE_TAG) {
          parseSimpleTag(buf, sub.dataOffset, sub.dataOffset + sub.size, metadata);
        }
        subOff = sub.dataOffset + sub.size;
      }
    }

    offset = tagEl.dataOffset + tagEl.size;
  }
}

function parseSimpleTag(buf: Buffer, startOffset: number, endOffset: number, metadata: MediaMetadata): void {
  let offset = startOffset;
  let tagName = '';
  let tagValue = '';

  while (offset < endOffset) {
    const el = readEbmlElementHeader(buf, offset);
    if (!el || el.size < 0 || el.dataOffset + el.size > endOffset) break;

    if (el.id === EBML_ID_TAG_NAME) {
      tagName = buf
        .subarray(el.dataOffset, el.dataOffset + el.size)
        .toString('utf8')
        .replace(/\0+$/, '')
        .trim()
        .toUpperCase();
    } else if (el.id === EBML_ID_TAG_STRING) {
      tagValue = buf
        .subarray(el.dataOffset, el.dataOffset + el.size)
        .toString('utf8')
        .replace(/\0+$/, '')
        .trim();
    }
    offset = el.dataOffset + el.size;
  }

  if (!tagName || !tagValue) return;

  if (tagName === 'TITLE') {
    metadata.title = tagValue;
  } else if (tagName === 'ARTIST' || tagName === 'DIRECTOR') {
    if (!metadata.artist || tagName === 'ARTIST') metadata.artist = tagValue;
  } else if (tagName === 'ALBUM' || tagName === 'COLLECTION') {
    if (!metadata.album) metadata.album = tagValue;
  } else if (tagName === 'DATE_RELEASED' || tagName === 'DATE' || tagName === 'YEAR') {
    const ym = tagValue.match(/\b(19\d{2}|20[0-3]\d)\b/);
    if (ym) metadata.year = parseInt(ym[1], 10);
  } else if (tagName === 'GENRE') {
    metadata.genre = tagValue;
  } else if (tagName === 'COMMENT' || tagName === 'DESCRIPTION' || tagName === 'SUMMARY' || tagName === 'SYNOPSIS') {
    if (!metadata.comment || tagValue.length > metadata.comment.length) {
      metadata.comment = tagValue;
    }
  } else if (tagName === 'COPYRIGHT') {
    metadata.copyright = tagValue;
  } else if (tagName === 'PART_NUMBER' || tagName === 'TRACK' || tagName === 'EPISODE_ID') {
    const num = parseInt(tagValue, 10);
    if (!Number.isNaN(num) && num > 0) metadata.trackNumber = num;
  } else if (tagName === 'SEASON_NUMBER' || tagName === 'DISC') {
    const num = parseInt(tagValue, 10);
    if (!Number.isNaN(num) && num > 0) metadata.seasonNumber = num;
  }
}

function parseMatroskaAttachmentsElement(
  buf: Buffer,
  startOffset: number,
  endOffset: number
): string | undefined {
  let offset = startOffset;
  let fallbackImage: { mime: string; data: Buffer } | null = null;

  while (offset < endOffset) {
    const el = readEbmlElementHeader(buf, offset);
    if (!el || el.size < 0 || el.dataOffset + el.size > endOffset) break;

    if (el.id === EBML_ID_ATTACHED_FILE) {
      let subOff = el.dataOffset;
      const subEnd = el.dataOffset + el.size;
      let fileName = '';
      let mimeType = '';
      let fileData: Buffer | null = null;

      while (subOff < subEnd) {
        const sub = readEbmlElementHeader(buf, subOff);
        if (!sub || sub.size < 0 || sub.dataOffset + sub.size > subEnd) break;

        if (sub.id === EBML_ID_FILE_NAME) {
          fileName = buf
            .subarray(sub.dataOffset, sub.dataOffset + sub.size)
            .toString('utf8')
            .replace(/\0+$/, '')
            .trim()
            .toLowerCase();
        } else if (sub.id === EBML_ID_FILE_MIME_TYPE) {
          mimeType = buf
            .subarray(sub.dataOffset, sub.dataOffset + sub.size)
            .toString('utf8')
            .replace(/\0+$/, '')
            .trim()
            .toLowerCase();
        } else if (sub.id === EBML_ID_FILE_DATA) {
          if (sub.size > 0 && sub.size < 15 * 1024 * 1024) {
            fileData = buf.subarray(sub.dataOffset, sub.dataOffset + sub.size);
          }
        }
        subOff = sub.dataOffset + sub.size;
      }

      if (fileData && (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/.test(fileName))) {
        const resolvedMime = mimeType.startsWith('image/')
          ? mimeType
          : fileName.endsWith('.png')
          ? 'image/png'
          : 'image/jpeg';

        if (fileName.includes('cover') || fileName.includes('poster') || fileName.includes('folder')) {
          return `data:${resolvedMime};base64,${fileData.toString('base64')}`;
        }
        if (!fallbackImage) {
          fallbackImage = { mime: resolvedMime, data: fileData };
        }
      }
    }

    offset = el.dataOffset + el.size;
  }

  if (fallbackImage) {
    return `data:${fallbackImage.mime};base64,${fallbackImage.data.toString('base64')}`;
  }
  return undefined;
}

async function readEbmlElementAtFileOffset(
  fh: fs.promises.FileHandle,
  fileSize: number,
  elementFileOffset: number,
  maxBytes = 15 * 1024 * 1024
): Promise<{ header: EbmlElementHeader; payload: Buffer } | null> {
  if (elementFileOffset < 0 || elementFileOffset + 2 >= fileSize) return null;
  const hdrBuf = Buffer.allocUnsafe(16);
  const { bytesRead } = await fh.read(
    hdrBuf,
    0,
    Math.min(16, fileSize - elementFileOffset),
    elementFileOffset
  );
  if (bytesRead < 2) return null;

  const hdr = readEbmlElementHeader(hdrBuf.subarray(0, bytesRead), 0);
  if (!hdr || hdr.size < 0 || hdr.size > maxBytes) return null;

  const dataFileOffset = elementFileOffset + hdr.dataOffset;
  if (dataFileOffset + hdr.size > fileSize) return null;

  const payload = Buffer.allocUnsafe(hdr.size);
  await fh.read(payload, 0, hdr.size, dataFileOffset);
  return {
    header: {
      ...hdr,
      headerOffset: elementFileOffset,
      dataOffset: dataFileOffset,
    },
    payload,
  };
}

const MKV_FOOTER_MAGIC = 'MTU_MKV1';
const MKV_FOOTER_TOTAL_LEN = 18; // 1B ID (0xEC) + 1B Size (0x90 = 16) + 8B Magic + 8B Offset

function makeMkvTrailerFooterMarker(trailerStartOffset: number): Buffer {
  const buf = Buffer.alloc(MKV_FOOTER_TOTAL_LEN, 0);
  buf[0] = EBML_ID_VOID; // 0xEC (EBML Void Element)
  buf[1] = 0x80 | 16; // Size = 16 bytes
  buf.write(MKV_FOOTER_MAGIC, 2, 8, 'ascii');
  buf.writeBigUInt64BE(BigInt(Math.max(0, trailerStartOffset)), 10);
  return buf;
}

async function readMkvTrailerFooterOffset(
  fh: fs.promises.FileHandle,
  fileSize: number,
  minValidOffset: number
): Promise<number | null> {
  if (fileSize < minValidOffset + MKV_FOOTER_TOTAL_LEN) return null;
  const buf = Buffer.allocUnsafe(MKV_FOOTER_TOTAL_LEN);
  const { bytesRead } = await fh.read(
    buf,
    0,
    MKV_FOOTER_TOTAL_LEN,
    fileSize - MKV_FOOTER_TOTAL_LEN
  );
  if (bytesRead < MKV_FOOTER_TOTAL_LEN) return null;
  if (buf[0] !== EBML_ID_VOID || buf[1] !== (0x80 | 16)) return null;
  if (buf.toString('ascii', 2, 10) !== MKV_FOOTER_MAGIC) return null;

  const offset = Number(buf.readBigUInt64BE(10));
  if (offset >= minValidOffset && offset < fileSize - MKV_FOOTER_TOTAL_LEN) {
    return offset;
  }
  return null;
}

/**
 * Đọc siêu nhanh Metadata & Cover Art từ file .mkv / .webm:
 * Chỉ đọc 64KB đầu tiên để lấy `SeekHead` & `Info`, sau đó nhảy trực tiếp tới offset của `Tags` và `Attachments`!
 */
export async function readMatroskaMetadataFast(filePath: string): Promise<{
  metadata: MediaMetadata;
  hasEmbeddedThumbnail: boolean;
} | null> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    const stat = await fs.promises.stat(filePath);
    fh = await fs.promises.open(filePath, 'r');

    const headLen = Math.min(stat.size, 64 * 1024);
    const headBuf = Buffer.allocUnsafe(headLen);
    await fh.read(headBuf, 0, headLen, 0);

    const ebmlHdr = readEbmlElementHeader(headBuf, 0);
    if (!ebmlHdr || ebmlHdr.id !== EBML_ID_HEADER || ebmlHdr.size < 0) return null;

    const segOffset = ebmlHdr.dataOffset + ebmlHdr.size;
    const segHdr = readEbmlElementHeader(headBuf, segOffset);
    if (!segHdr || segHdr.id !== EBML_ID_SEGMENT) return null;

    const segmentDataOffset = segHdr.dataOffset;
    const metadata: MediaMetadata = {};
    let hasEmbeddedThumbnail = false;

    const seekMap = new Map<number, number>();
    let parsedInfo = false;
    let parsedTags = false;
    let parsedAttachments = false;

    // Quét các phần tử ở đầu Segment (trước Cluster đầu tiên)
    let cursor = segmentDataOffset;
    while (cursor < headLen) {
      const el = readEbmlElementHeader(headBuf, cursor);
      if (!el || el.id === EBML_ID_CLUSTER || el.size < 0) break;

      if (el.dataOffset + el.size <= headLen) {
        if (el.id === EBML_ID_SEEKHEAD) {
          const map = parseSeekHead(headBuf, el.dataOffset, el.dataOffset + el.size);
          for (const [k, v] of map.entries()) seekMap.set(k, v);
        } else if (el.id === EBML_ID_INFO) {
          const infoTitle = parseMatroskaInfoTitle(headBuf, el.dataOffset, el.dataOffset + el.size);
          if (infoTitle && !metadata.title) metadata.title = infoTitle;
          parsedInfo = true;
        } else if (el.id === EBML_ID_TAGS) {
          parseMatroskaTagsElement(headBuf, el.dataOffset, el.dataOffset + el.size, metadata);
          parsedTags = true;
        } else if (el.id === EBML_ID_ATTACHMENTS) {
          const coverUrl = parseMatroskaAttachmentsElement(headBuf, el.dataOffset, el.dataOffset + el.size);
          if (coverUrl) {
            metadata.thumbnailDataUrl = coverUrl;
            hasEmbeddedThumbnail = true;
          }
          parsedAttachments = true;
        }
      }

      cursor = el.dataOffset + el.size;
    }

    // Nếu SeekHead đầu file là Chained SeekHead trỏ tới Secondary SeekHead ở cuối file (chuẩn Matroska)
    if (seekMap.has(EBML_ID_SEEKHEAD)) {
      const secShPos = segmentDataOffset + seekMap.get(EBML_ID_SEEKHEAD)!;
      const secShData = await readEbmlElementAtFileOffset(fh, stat.size, secShPos, 256 * 1024);
      if (secShData && secShData.header.id === EBML_ID_SEEKHEAD) {
        const secMap = parseSeekHead(secShData.payload, 0, secShData.payload.length);
        for (const [k, v] of secMap.entries()) {
          seekMap.set(k, v);
        }
      }
    }

    // Nếu SeekHead trỏ tới Info / Tags / Attachments ở cuối file, nhảy thẳng tới offset đó để đọc!
    if (!parsedInfo && seekMap.has(EBML_ID_INFO)) {
      const infoPos = segmentDataOffset + seekMap.get(EBML_ID_INFO)!;
      const infoData = await readEbmlElementAtFileOffset(fh, stat.size, infoPos, 1024 * 1024);
      if (infoData && infoData.header.id === EBML_ID_INFO) {
        const infoTitle = parseMatroskaInfoTitle(infoData.payload, 0, infoData.payload.length);
        if (infoTitle && !metadata.title) metadata.title = infoTitle;
        parsedInfo = true;
      }
    }

    if (seekMap.has(EBML_ID_TAGS)) {
      const tagsPos = segmentDataOffset + seekMap.get(EBML_ID_TAGS)!;
      if (!parsedTags || tagsPos >= headLen) {
        const tagsData = await readEbmlElementAtFileOffset(fh, stat.size, tagsPos, 2 * 1024 * 1024);
        if (tagsData && tagsData.header.id === EBML_ID_TAGS) {
          parseMatroskaTagsElement(tagsData.payload, 0, tagsData.payload.length, metadata);
          parsedTags = true;
        }
      }
    }

    if (!parsedAttachments && seekMap.has(EBML_ID_ATTACHMENTS)) {
      const attachPos = segmentDataOffset + seekMap.get(EBML_ID_ATTACHMENTS)!;
      const attachData = await readEbmlElementAtFileOffset(fh, stat.size, attachPos, 15 * 1024 * 1024);
      if (attachData && attachData.header.id === EBML_ID_ATTACHMENTS) {
        const coverUrl = parseMatroskaAttachmentsElement(attachData.payload, 0, attachData.payload.length);
        if (coverUrl) {
          metadata.thumbnailDataUrl = coverUrl;
          hasEmbeddedThumbnail = true;
        }
        parsedAttachments = true;
      }
    }

    // Nếu file có Footer Marker ở 18 byte cuối cùng (hỗ trợ cả file MKV không có SeekHead)
    const footerTrailerOffset = await readMkvTrailerFooterOffset(fh, stat.size, segmentDataOffset);
    if (footerTrailerOffset !== null && (!parsedTags || !parsedAttachments || !parsedInfo)) {
      let trCursor = footerTrailerOffset;
      while (trCursor + 2 < stat.size - MKV_FOOTER_TOTAL_LEN) {
        const elData = await readEbmlElementAtFileOffset(fh, stat.size, trCursor, 15 * 1024 * 1024);
        if (!elData) break;
        if (elData.header.id === EBML_ID_INFO && !parsedInfo) {
          const infoTitle = parseMatroskaInfoTitle(elData.payload, 0, elData.payload.length);
          if (infoTitle && !metadata.title) metadata.title = infoTitle;
          parsedInfo = true;
        } else if (elData.header.id === EBML_ID_TAGS && !parsedTags) {
          parseMatroskaTagsElement(elData.payload, 0, elData.payload.length, metadata);
          parsedTags = true;
        } else if (elData.header.id === EBML_ID_ATTACHMENTS && !parsedAttachments) {
          const coverUrl = parseMatroskaAttachmentsElement(elData.payload, 0, elData.payload.length);
          if (coverUrl) {
            metadata.thumbnailDataUrl = coverUrl;
            hasEmbeddedThumbnail = true;
          }
          parsedAttachments = true;
        }
        trCursor = elData.header.dataOffset + elData.header.size;
      }
    }

    return { metadata, hasEmbeddedThumbnail };
  } catch {
    return null;
  } finally {
    if (fh) await fh.close();
  }
}

function makeSimpleTagElement(name: string, value: string): Buffer {
  const nameEl = makeEbmlElement(EBML_ID_TAG_NAME, Buffer.from(name, 'utf8'));
  const valEl = makeEbmlElement(EBML_ID_TAG_STRING, Buffer.from(value, 'utf8'));
  return makeEbmlElement(EBML_ID_SIMPLE_TAG, [nameEl, valEl]);
}

function buildMatroskaTagsElement(metadata: MediaMetadata): Buffer {
  const simpleTags: Buffer[] = [];

  if (metadata.title) {
    simpleTags.push(makeSimpleTagElement('TITLE', metadata.title));
  }
  if (metadata.artist) {
    simpleTags.push(makeSimpleTagElement('ARTIST', metadata.artist));
    simpleTags.push(makeSimpleTagElement('DIRECTOR', metadata.artist));
  }
  if (metadata.album) {
    simpleTags.push(makeSimpleTagElement('ALBUM', metadata.album));
  }
  if (metadata.year && metadata.year > 0) {
    simpleTags.push(makeSimpleTagElement('DATE_RELEASED', String(metadata.year)));
  }
  if (metadata.genre) {
    simpleTags.push(makeSimpleTagElement('GENRE', metadata.genre));
  }
  if (metadata.comment) {
    simpleTags.push(makeSimpleTagElement('COMMENT', metadata.comment));
    simpleTags.push(makeSimpleTagElement('DESCRIPTION', metadata.comment));
    simpleTags.push(makeSimpleTagElement('SUMMARY', metadata.comment));
  }
  if (metadata.copyright) {
    simpleTags.push(makeSimpleTagElement('COPYRIGHT', metadata.copyright));
  }
  if (metadata.trackNumber && metadata.trackNumber > 0) {
    simpleTags.push(makeSimpleTagElement('PART_NUMBER', String(metadata.trackNumber)));
  }
  if (metadata.seasonNumber && metadata.seasonNumber > 0) {
    simpleTags.push(makeSimpleTagElement('SEASON_NUMBER', String(metadata.seasonNumber)));
  }

  const targetsEl = makeEbmlElement(EBML_ID_TARGETS, Buffer.alloc(0));
  const tagEl = makeEbmlElement(EBML_ID_TAG, [targetsEl, ...simpleTags]);
  return makeEbmlElement(EBML_ID_TAGS, tagEl);
}

function buildMatroskaAttachmentsElement(imgBuffer: Buffer, mimeType: string): Buffer {
  const ext = mimeType.includes('png') ? '.png' : '.jpg';
  const fileNameEl = makeEbmlElement(EBML_ID_FILE_NAME, Buffer.from(`cover${ext}`, 'utf8'));
  const fileMimeEl = makeEbmlElement(EBML_ID_FILE_MIME_TYPE, Buffer.from(mimeType, 'utf8'));
  const fileDescEl = makeEbmlElement(EBML_ID_FILE_DESCRIPTION, Buffer.from('Cover Art', 'utf8'));
  const fileDataEl = makeEbmlElement(EBML_ID_FILE_DATA, imgBuffer);
  const fileUidEl = makeEbmlUintElement(EBML_ID_FILE_UID, 1088442211);

  const attachedFileEl = makeEbmlElement(EBML_ID_ATTACHED_FILE, [
    fileDescEl,
    fileNameEl,
    fileMimeEl,
    fileDataEl,
    fileUidEl,
  ]);
  return makeEbmlElement(EBML_ID_ATTACHMENTS, attachedFileEl);
}

function buildSeekHeadElement(seekMap: Map<number, number>): Buffer {
  const seekEntries: Buffer[] = [];
  for (const [id, pos] of seekMap.entries()) {
    const idEl = makeEbmlElement(EBML_ID_SEEK_ID, encodeEbmlId(id));
    const posEl = makeEbmlUintElement(EBML_ID_SEEK_POSITION, pos);
    seekEntries.push(makeEbmlElement(EBML_ID_SEEK, [idEl, posEl]));
  }
  return makeEbmlElement(EBML_ID_SEEKHEAD, seekEntries);
}

function rebuildMatroskaInfoPayloadWithTitle(
  infoPayload: Buffer,
  newTitle: string | undefined
): Buffer {
  const keptChildren: Buffer[] = [];
  let offset = 0;

  while (offset < infoPayload.length) {
    const el = readEbmlElementHeader(infoPayload, offset);
    if (!el || el.size < 0 || el.dataOffset + el.size > infoPayload.length) break;

    if (el.id !== EBML_ID_TITLE && el.id !== EBML_ID_VOID) {
      keptChildren.push(infoPayload.subarray(el.headerOffset, el.dataOffset + el.size));
    }
    offset = el.dataOffset + el.size;
  }

  if (newTitle) {
    keptChildren.push(makeEbmlElement(EBML_ID_TITLE, Buffer.from(newTitle, 'utf8')));
  }

  return makeEbmlElement(EBML_ID_INFO, keptChildren);
}

/**
 * Ghi Metadata & Cover Art trực tiếp (In-Place) vào file .mkv / .webm theo đúng chuẩn RFC 8794 / Matroska (tương tự mkvpropedit):
 * - TUYỆT ĐỐI KHÔNG di chuyển `Tracks`, `Chapters`, `Cues`, `Cluster` hay `Attachments` (font phụ đề) — giữ nguyên 100% vị trí byte của chúng.
 * - Chỉ cập nhật tại chỗ `Info` và `SeekHead` (tận dụng phần tử `Void` liền kề); nếu không đủ chỗ thì biến vùng cũ thành `Void` có kích thước khớp tuyệt đối và đặt bản ghi mới vào Trailer ở cuối file (hoặc dùng Chained SeekHead chuẩn Matroska).
 */
export async function writeMatroskaMetadataInPlace(
  filePath: string,
  metadata: MediaMetadata
): Promise<boolean> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    const stat = await fs.promises.stat(filePath);
    fh = await fs.promises.open(filePath, 'r+');

    const headLen = Math.min(stat.size, 128 * 1024);
    const headBuf = Buffer.allocUnsafe(headLen);
    await fh.read(headBuf, 0, headLen, 0);

    const ebmlHdr = readEbmlElementHeader(headBuf, 0);
    if (!ebmlHdr || ebmlHdr.id !== EBML_ID_HEADER || ebmlHdr.size < 0) return false;

    const segOffset = ebmlHdr.dataOffset + ebmlHdr.size;
    const segHdr = readEbmlElementHeader(headBuf, segOffset);
    if (!segHdr || segHdr.id !== EBML_ID_SEGMENT) return false;

    const segmentDataOffset = segHdr.dataOffset;

    // Quét tất cả phần tử trong vùng Header trước Cluster đầu tiên
    const preClusterElements: EbmlElementHeader[] = [];
    let cursor = segmentDataOffset;
    let preClusterEndOffset = segmentDataOffset;

    while (cursor < headLen) {
      const el = readEbmlElementHeader(headBuf, cursor);
      if (!el || el.size < 0) break;
      if (el.id === EBML_ID_CLUSTER) {
        preClusterEndOffset = el.headerOffset;
        break;
      }
      if (el.dataOffset + el.size > headLen) break;
      preClusterElements.push(el);
      cursor = el.dataOffset + el.size;
      preClusterEndOffset = cursor;
    }

    if (preClusterElements.length === 0) return false;

    const seekMap = new Map<number, number>();
    let seekHeadIdx = -1;
    let infoIdx = -1;
    let oldInfoPayload: Buffer | null = null;

    for (let i = 0; i < preClusterElements.length; i++) {
      const el = preClusterElements[i];
      if (el.id === EBML_ID_SEEKHEAD && seekHeadIdx === -1) {
        seekHeadIdx = i;
        const parsed = parseSeekHead(headBuf, el.dataOffset, el.dataOffset + el.size);
        for (const [k, v] of parsed.entries()) seekMap.set(k, v);
      } else if (el.id === EBML_ID_INFO && infoIdx === -1) {
        infoIdx = i;
        oldInfoPayload = headBuf.subarray(el.dataOffset, el.dataOffset + el.size);
      } else if (el.id === EBML_ID_TAGS) {
        // Thay thế phần tử Tags cũ ở đầu file bằng Void cùng kích thước để không dịch chuyển bất kỳ phần tử nào
        const len = el.dataOffset + el.size - el.headerOffset;
        const voidBuf = makeEbmlVoidElement(len);
        if (voidBuf.length === len) {
          await fh.write(voidBuf, 0, len, el.headerOffset);
        }
      }
    }

    // Nếu SeekHead đầu file từng là Chained SeekHead, đọc tiếp Secondary SeekHead
    if (seekMap.has(EBML_ID_SEEKHEAD)) {
      const secPos = segmentDataOffset + seekMap.get(EBML_ID_SEEKHEAD)!;
      const secData = await readEbmlElementAtFileOffset(fh, stat.size, secPos, 256 * 1024);
      if (secData && secData.header.id === EBML_ID_SEEKHEAD) {
        seekMap.delete(EBML_ID_SEEKHEAD);
        const secMap = parseSeekHead(secData.payload, 0, secData.payload.length);
        for (const [k, v] of secMap.entries()) seekMap.set(k, v);
      }
    }

    // Kiểm tra xem ở cuối file đã có Trailer do lần lưu trước tạo hay chưa (qua 18-byte EBML Void Footer)
    let trailerWriteOffset = stat.size;
    const footerDetectedOffset = await readMkvTrailerFooterOffset(fh, stat.size, preClusterEndOffset);
    if (footerDetectedOffset !== null) {
      trailerWriteOffset = footerDetectedOffset;
    }

    // Nếu Info đã từng được dời xuống Trailer ở lần lưu trước, đọc lại Info từ SeekHead hoặc Trailer
    if (!oldInfoPayload && seekMap.has(EBML_ID_INFO)) {
      const infoAbsPos = segmentDataOffset + seekMap.get(EBML_ID_INFO)!;
      const infoData = await readEbmlElementAtFileOffset(fh, stat.size, infoAbsPos, 1024 * 1024);
      if (infoData && infoData.header.id === EBML_ID_INFO) {
        oldInfoPayload = infoData.payload;
      }
    }

    // 1. Tạo phần tử `Info`, `Tags` và `Attachments` mới
    const newInfoBuf = oldInfoPayload
      ? rebuildMatroskaInfoPayloadWithTitle(oldInfoPayload, metadata.title)
      : null;
    const newTagsBuf = buildMatroskaTagsElement(metadata);
    const parsedCover = metadata.thumbnailDataUrl
      ? parseDataUrlToImageBuffer(metadata.thumbnailDataUrl)
      : null;
    const newAttachmentsBuf = parsedCover
      ? buildMatroskaAttachmentsElement(parsedCover.buffer, parsedCover.mimeType)
      : null;

    // 2. Cập nhật `Info` ngay tại vị trí gốc nếu vừa trong vùng `Info + Void liền kề`; nếu không thì biến vùng cũ thành `Void` và đưa `Info` xuống Trailer
    let relocateInfoToTrailer = false;
    if (newInfoBuf) {
      if (infoIdx !== -1) {
        const infoEl = preClusterElements[infoIdx];
        let infoRegionSize = infoEl.dataOffset + infoEl.size - infoEl.headerOffset;
        let consumedNextVoid = false;

        if (
          infoIdx + 1 < preClusterElements.length &&
          preClusterElements[infoIdx + 1].id === EBML_ID_VOID
        ) {
          const nextVoid = preClusterElements[infoIdx + 1];
          infoRegionSize += nextVoid.dataOffset + nextVoid.size - nextVoid.headerOffset;
          consumedNextVoid = true;
        }

        if (newInfoBuf.length === infoRegionSize) {
          await fh.write(newInfoBuf, 0, newInfoBuf.length, infoEl.headerOffset);
          seekMap.set(EBML_ID_INFO, infoEl.headerOffset - segmentDataOffset);
        } else if (newInfoBuf.length + 2 <= infoRegionSize) {
          const remVoid = makeEbmlVoidElement(infoRegionSize - newInfoBuf.length);
          await fh.write(newInfoBuf, 0, newInfoBuf.length, infoEl.headerOffset);
          await fh.write(remVoid, 0, remVoid.length, infoEl.headerOffset + newInfoBuf.length);
          seekMap.set(EBML_ID_INFO, infoEl.headerOffset - segmentDataOffset);
          if (consumedNextVoid) {
            // Cập nhật lại phần tử Void liền kề trong danh sách để SeekHead không dùng chồng lấn
            preClusterElements[infoIdx + 1] = {
              ...preClusterElements[infoIdx + 1],
              headerOffset: infoEl.headerOffset + newInfoBuf.length,
              dataOffset: infoEl.headerOffset + newInfoBuf.length + 2,
              size: remVoid.length - 2,
            };
          }
        } else {
          const voidForOldInfo = makeEbmlVoidElement(infoRegionSize);
          if (voidForOldInfo.length === infoRegionSize) {
            await fh.write(voidForOldInfo, 0, voidForOldInfo.length, infoEl.headerOffset);
            relocateInfoToTrailer = true;
          }
        }
      } else {
        relocateInfoToTrailer = true;
      }
    }

    // 3. Xây dựng các phần tử ở Trailer cuối file (`Info` nếu dời chỗ + `Tags` + `Attachments`)
    let trailerCursor = trailerWriteOffset;
    const trailerChunks: Buffer[] = [];

    if (newInfoBuf && relocateInfoToTrailer) {
      seekMap.set(EBML_ID_INFO, trailerCursor - segmentDataOffset);
      trailerChunks.push(newInfoBuf);
      trailerCursor += newInfoBuf.length;
    }

    seekMap.set(EBML_ID_TAGS, trailerCursor - segmentDataOffset);
    trailerChunks.push(newTagsBuf);
    trailerCursor += newTagsBuf.length;

    if (newAttachmentsBuf) {
      seekMap.set(EBML_ID_ATTACHMENTS, trailerCursor - segmentDataOffset);
      trailerChunks.push(newAttachmentsBuf);
      trailerCursor += newAttachmentsBuf.length;
    }

    // 4. Cập nhật `SeekHead` ngay tại vị trí gốc (hoặc dùng Chained SeekHead trỏ xuống Trailer nếu vùng SeekHead đầu file quá hẹp)
    if (seekHeadIdx !== -1) {
      const shEl = preClusterElements[seekHeadIdx];
      let shRegionSize = shEl.dataOffset + shEl.size - shEl.headerOffset;
      if (
        seekHeadIdx + 1 < preClusterElements.length &&
        preClusterElements[seekHeadIdx + 1].id === EBML_ID_VOID
      ) {
        const nextVoid = preClusterElements[seekHeadIdx + 1];
        shRegionSize += nextVoid.dataOffset + nextVoid.size - nextVoid.headerOffset;
      }

      const primarySeekHeadBuf = buildSeekHeadElement(seekMap);
      if (primarySeekHeadBuf.length === shRegionSize) {
        await fh.write(primarySeekHeadBuf, 0, primarySeekHeadBuf.length, shEl.headerOffset);
      } else if (primarySeekHeadBuf.length + 2 <= shRegionSize) {
        const remVoid = makeEbmlVoidElement(shRegionSize - primarySeekHeadBuf.length);
        await fh.write(primarySeekHeadBuf, 0, primarySeekHeadBuf.length, shEl.headerOffset);
        await fh.write(remVoid, 0, remVoid.length, shEl.headerOffset + primarySeekHeadBuf.length);
      } else {
        // Chuẩn Matroska Chained SeekHead: Ghi bảng SeekHead đầy đủ ở Trailer và trỏ SeekHead đầu file tới đó!
        const secondarySeekHeadRelPos = trailerCursor - segmentDataOffset;
        trailerChunks.push(primarySeekHeadBuf);
        trailerCursor += primarySeekHeadBuf.length;

        const chainedMap = new Map<number, number>();
        chainedMap.set(EBML_ID_SEEKHEAD, secondarySeekHeadRelPos);
        const chainedSeekHeadBuf = buildSeekHeadElement(chainedMap);

        if (chainedSeekHeadBuf.length === shRegionSize) {
          await fh.write(chainedSeekHeadBuf, 0, chainedSeekHeadBuf.length, shEl.headerOffset);
        } else if (chainedSeekHeadBuf.length + 2 <= shRegionSize) {
          const remVoid = makeEbmlVoidElement(shRegionSize - chainedSeekHeadBuf.length);
          await fh.write(chainedSeekHeadBuf, 0, chainedSeekHeadBuf.length, shEl.headerOffset);
          await fh.write(remVoid, 0, remVoid.length, shEl.headerOffset + chainedSeekHeadBuf.length);
        }
      }
    }

    // Thêm 18-byte EBML Void Footer Marker (`0xEC`) ở cuối Trailer để nhận diện O(1) ở các lần đọc/ghi sau
    trailerChunks.push(makeMkvTrailerFooterMarker(trailerWriteOffset));

    // 5. Ghi Trailer vào cuối file (không đụng tới bất kỳ Cluster nào)
    const trailerBuf = Buffer.concat(trailerChunks);
    await fh.write(trailerBuf, 0, trailerBuf.length, trailerWriteOffset);
    const newFileSize = trailerWriteOffset + trailerBuf.length;
    if (newFileSize < stat.size) {
      await fh.truncate(newFileSize);
    }

    // 6. Cập nhật kích thước tổng của `Segment` (`0x18538067`) ở đầu file
    if (segHdr.size !== -1) {
      const newSegmentDataSize = newFileSize - segmentDataOffset;
      const maxForWidth = (1n << BigInt(7 * segHdr.sizeLength)) - 2n;
      const sizeOffset = segHdr.headerOffset + segHdr.idLength;

      if (BigInt(newSegmentDataSize) <= maxForWidth) {
        const encodedSegSize = encodeEbmlSize(newSegmentDataSize, segHdr.sizeLength);
        await fh.write(encodedSegSize, 0, encodedSegSize.length, sizeOffset);
      } else {
        // Nếu vượt quá độ rộng VINT ban đầu, đặt Segment size thành Unknown Size (chuẩn RFC 8794)
        const unknownSegSize = Buffer.alloc(segHdr.sizeLength, 0xff);
        unknownSegSize[0] = (1 << (8 - segHdr.sizeLength)) | ((1 << (8 - segHdr.sizeLength)) - 1);
        await fh.write(unknownSegSize, 0, unknownSegSize.length, sizeOffset);
      }
    }

    return true;
  } catch (err) {
    console.warn('[FastVideoTagEditor] Matroska (.mkv/.webm) in-place write failed:', err);
    return false;
  } finally {
    if (fh) await fh.close();
  }
}

/**
 * Hàm tổng hợp đọc nhanh Metadata & Cover Art của file Video (.mp4, .m4v, .mov, .mkv, .webm)
 */
export async function readVideoMetadataNativeFast(filePath: string): Promise<{
  metadata: MediaMetadata;
  hasEmbeddedThumbnail: boolean;
} | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v' || ext === '.mov') {
    return readMp4MetadataFast(filePath);
  }
  if (ext === '.mkv' || ext === '.webm') {
    return readMatroskaMetadataFast(filePath);
  }
  return null;
}

/**
 * Hàm tổng hợp ghi nhanh In-Place Metadata & Cover Art vào file Video (.mp4, .m4v, .mov, .mkv, .webm)
 * Không render lại và không copy lại toàn bộ file video!
 */
export async function writeVideoMetadataInPlace(
  filePath: string,
  metadata: MediaMetadata
): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v' || ext === '.mov') {
    return writeMp4MetadataInPlace(filePath, metadata);
  }
  if (ext === '.mkv' || ext === '.webm') {
    return writeMatroskaMetadataInPlace(filePath, metadata);
  }
  return false;
}
