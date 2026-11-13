/** Cấu hình dùng chung cho cả client và server. */

/** Cạnh của bàn cờ (đơn vị "world pixel"). */
export const WORLD_SIZE = 4096;

/** Cạnh dài nhất của một tấm ảnh khi mới đăng (trước khi được thả tym). */
export const MAX_DISPLAY_SIZE = 256;

/** Cạnh dài nhất sau khi ảnh được thả tym nhiều (chặn trần phình to). */
export const MAX_GROWN_SIZE = 640;

/** Mỗi tym làm ảnh to thêm bao nhiêu (hệ số nhân logarit). */
export const GROWTH_RATE = 0.22;

/** Hệ số phóng to tối đa so với kích thước gốc. */
export const MAX_GROWTH = 2.4;

/** Mỗi tài khoản được thả bao nhiêu tym trong 24 giờ. */
export const HEARTS_PER_DAY = 20;

/** Thời gian chờ tối thiểu giữa hai lần thả tym (ms) — 3 phút. */
export const HEART_COOLDOWN_MS = 3 * 60 * 1000;

/** Kích thước pixel thật của ảnh được lưu (đã resize + re-encode). */
export const MAX_STORED_DIMENSION = 1280;

/** Giới hạn file người dùng được tải lên. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Định dạng chấp nhận. SVG bị loại vì lý do an toàn (XSS). */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/**
 * Mỗi tài khoản chỉ có 1 ảnh "đang sống". Ảnh bị từ chối không chiếm chỗ,
 * nhưng vẫn giới hạn số lần thử để tránh spam API kiểm duyệt.
 * (Giá trị này mirror trong trigger `enforce_single_photo` của Supabase.)
 */
export const UPLOAD_ATTEMPTS_PER_DAY = 10;

/** Ảnh pending bị bỏ dở sẽ được dọn sau bao nhiêu phút (khi user upload lại). */
export const PENDING_TTL_MINUTES = 15;

/** Số báo cáo khác nhau để tự động ẩn ảnh. */
export const REPORTS_TO_HIDE = 3;

export const BUCKET_PENDING = "pending";
export const BUCKET_PUBLIC = "photos";

/** Số ảnh tải về tối đa cho một khung nhìn. */
export const PHOTOS_PER_VIEW = 400;

/** Khoảng thời gian tự làm mới khung nhìn (ms) để dọn ảnh đã bị gỡ. */
export const VIEW_REFRESH_MS = 45_000;
