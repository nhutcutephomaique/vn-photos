/**
 * Ngưỡng kiểm duyệt — chỉnh ở đây, không rải rác trong code.
 *
 * Triết lý: thà đưa vào hàng chờ người duyệt còn hơn tự động publish
 * một ảnh nhạy cảm. Ngưỡng reject phải đủ chắc chắn để không chặn nhầm
 * ảnh nghệ thuật / ảnh bikini / meme.
 */
export const POLICY = {
  /** Điểm "sexual" đủ cao để từ chối ngay. */
  rejectSexual: 0.32,
  /** Điểm "sexual" đáng ngờ → chuyển người duyệt. */
  reviewSexual: 0.12,
  /** "very suggestive" (đồ bơi, nội y, tư thế gợi cảm) → chỉ review. */
  reviewSuggestive: 0.5,
  /** Dấu hiệu nội dung liên quan trẻ vị thành niên → từ chối tuyệt đối. */
  rejectMinor: 0.15,
  reviewMinor: 0.04,
  reviewGore: 0.55,
  reviewHate: 0.55,
  /** Khoảng cách Hamming tối đa khi so với hash ảnh bị cấm (trên 256 bit). */
  hashDistance: 24,
  /** Timeout mỗi provider (ms). */
  providerTimeoutMs: 12_000,
} as const;

/** Mẫu thông tin cá nhân trong text trên ảnh (chống doxxing). */
export const PII_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "phone", pattern: /(?:\+?84|0)(?:\d[\s.-]?){8,10}\b/ },
  { name: "email", pattern: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i },
  { name: "cccd", pattern: /\b\d{9}|\b\d{12}\b/ },
];
