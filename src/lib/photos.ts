import { MAX_DISPLAY_SIZE, BUCKET_PUBLIC, BUCKET_PENDING } from "@/lib/config";
import { ApiError } from "@/lib/errors";
import { displaySize } from "@/lib/display";
import { sanitizeImage, type SanitizedImage } from "@/lib/imaging";
import { adminClient } from "@/lib/supabase/admin";
import type { Photo } from "@/lib/types";
import { publicPhotoUrl } from "@/lib/urls";

/** Chuyển row DB → object cho client. */
export function photoFromRow(row: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  caption: string | null;
  created_at: string;
  storage_path: string;
  heart_count?: number | null;
}): Photo {
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    path: row.storage_path,
    caption: row.caption,
    createdAt: row.created_at,
    url: publicPhotoUrl(row.storage_path, 512),
    hearts: row.heart_count ?? 0,
  };
}

/** Kích thước gốc (trước khi được thả tym) của một ảnh đã sanitize. */
export function toBaseSize(image: SanitizedImage): { w: number; h: number } {
  return displaySize(image.width, image.height, MAX_DISPLAY_SIZE);
}

/**
 * Đưa ảnh ĐÃ qua sanitize + kiểm duyệt vào bucket public.
 * Trả về đường dẫn mới trong bucket `photos`.
 */
export async function publishSanitized(params: {
  id: string;
  ownerId: string;
  image: SanitizedImage;
}): Promise<string> {
  const path = `${params.ownerId}/${params.id}.webp`;
  const { error } = await adminClient()
    .storage.from(BUCKET_PUBLIC)
    .upload(path, params.image.buffer, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: true,
    });

  if (error) {
    console.error("[publish] upload failed", error);
    throw new ApiError(500, "Không lưu được ảnh đã duyệt.", "publish_failed");
  }
  return path;
}

/** Tải ảnh trong bucket `pending`, sanitize lại rồi publish (dùng cho admin duyệt tay). */
export async function publishFromPending(row: {
  id: string;
  author_id: string | null;
  storage_path: string;
}): Promise<{ path: string; image: SanitizedImage }> {
  const { data: blob, error } = await adminClient()
    .storage.from(BUCKET_PENDING)
    .download(row.storage_path);

  if (error || !blob) {
    throw new ApiError(409, "Ảnh gốc không còn trong kho chờ duyệt (có thể đã hết hạn).", "missing_file");
  }

  const image = await sanitizeImage(Buffer.from(await blob.arrayBuffer()));
  const path = await publishSanitized({
    id: row.id,
    ownerId: row.author_id ?? "anonymous",
    image,
  });
  return { path, image };
}

export async function removeObject(bucket: string, path: string): Promise<void> {
  const { error } = await adminClient().storage.from(bucket).remove([path]);
  if (error) console.error("[storage] remove failed", bucket, path, error);
}
