import { BUCKET_PUBLIC } from "@/lib/config";

const TRANSFORMS = process.env.NEXT_PUBLIC_IMAGE_TRANSFORMS === "1";

/**
 * URL công khai của ảnh đã duyệt.
 * Nếu project Supabase có Image Transformation, trả thumbnail nhẹ hơn
 * (tiết kiệm băng thông đáng kể khi bàn cờ có hàng nghìn ảnh).
 */
export function publicPhotoUrl(storagePath: string, width = 512): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return "";

  if (TRANSFORMS) {
    const params = new URLSearchParams({
      width: String(width),
      quality: "78",
      resize: "contain",
    });
    return `${base}/storage/v1/render/image/public/${BUCKET_PUBLIC}/${storagePath}?${params}`;
  }

  return `${base}/storage/v1/object/public/${BUCKET_PUBLIC}/${storagePath}`;
}
