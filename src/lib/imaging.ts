import sharp from "sharp";
import type { Metadata } from "sharp";
import { MAX_STORED_DIMENSION } from "@/lib/config";
import { ApiError } from "@/lib/errors";

export type SanitizedImage = {
  buffer: Buffer;
  width: number;
  height: number;
  /** difference hash 256 bit, dạng chuỗi nhị phân (dùng cho cột bit(256)). */
  dhash: string;
  /** Màu trung bình, đóng gói RGB 24-bit — tránh false positive với ảnh đơn sắc. */
  color: number;
};

const ACCEPTED_FORMATS = new Set([
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "heif",
  "tiff",
]);

const MIN_DIMENSION = 32;

/**
 * Re-encode ảnh để:
 *  1. Xoá toàn bộ EXIF (GPS, tên thiết bị, thời gian chụp…).
 *  2. Loại bỏ payload ẩn nhúng trong file (polyglot, script…).
 *  3. Chuẩn hoá về WebP để tiết kiệm băng thông.
 *  4. Đảm bảo đúng định dạng thật, không tin `Content-Type` của client.
 *
 * Ảnh đã qua hàm này mới được đem đi kiểm duyệt và mới được publish.
 */
export async function sanitizeImage(input: Buffer): Promise<SanitizedImage> {
  let probe: Metadata;
  try {
    probe = await sharp(input, { failOn: "none", limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new ApiError(415, "Không đọc được file ảnh này.", "invalid_image");
  }

  if (!probe.format || !ACCEPTED_FORMATS.has(probe.format)) {
    throw new ApiError(
      415,
      "Chỉ nhận JPG, PNG, WebP, GIF hoặc AVIF. Ảnh SVG không được phép.",
      "unsupported_format",
    );
  }

  if (!probe.width || !probe.height || probe.width < MIN_DIMENSION || probe.height < MIN_DIMENSION) {
    throw new ApiError(415, "Ảnh quá nhỏ (tối thiểu 32×32 px).", "image_too_small");
  }

  let buffer: Buffer;
  try {
    buffer = await sharp(input, { failOn: "none", limitInputPixels: 50_000_000 })
      .rotate() // áp dụng EXIF orientation rồi bỏ EXIF
      .resize({
        width: MAX_STORED_DIMENSION,
        height: MAX_STORED_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
  } catch {
    throw new ApiError(415, "Không xử lý được file ảnh này.", "decode_failed");
  }

  const out = await sharp(buffer).metadata();
  if (!out.width || !out.height) {
    throw new ApiError(415, "Không xác định được kích thước ảnh.", "decode_failed");
  }

  return {
    buffer,
    width: out.width,
    height: out.height,
    dhash: await differenceHash(buffer),
    color: await averageColor(buffer),
  };
}

/** Màu trung bình (RGB 24-bit) — dùng kèm hash để giảm false positive. */
export async function averageColor(input: Buffer): Promise<number> {
  const { data } = await sharp(input)
    .resize(1, 1, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return (data[0]! << 16) | (data[1]! << 8) | data[2]!;
}

/**
 * difference hash 16×16 (256 bit): so sánh cường độ sáng của pixel kề nhau.
 * Bền với việc nén lại / đổi kích thước / thêm viền nhẹ — đủ để chặn
 * việc upload lại một ảnh đã bị cấm.
 *
 * Dùng lưới 17×16 thay vì 9×8 vì 64 bit quá thô: ảnh có hoa văn dày
 * (hoặc bị thu nhỏ mạnh) dễ cho hash suy biến.
 */
export const DHASH_WIDTH = 16;
export const DHASH_HEIGHT = 16;

export async function differenceHash(input: Buffer): Promise<string> {
  const { data } = await sharp(input)
    .greyscale()
    .resize(DHASH_WIDTH + 1, DHASH_HEIGHT, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let y = 0; y < DHASH_HEIGHT; y += 1) {
    for (let x = 0; x < DHASH_WIDTH; x += 1) {
      const index = y * (DHASH_WIDTH + 1) + x;
      bits += data[index]! < data[index + 1]! ? "1" : "0";
    }
  }
  return bits;
}
