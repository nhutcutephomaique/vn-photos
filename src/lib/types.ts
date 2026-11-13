export type PhotoStatus = "pending" | "approved" | "review" | "rejected";

/** Ảnh đã được duyệt, dạng client dùng để vẽ bàn cờ. */
export type Photo = {
  id: string;
  /** Toạ độ TÂM ảnh trong hệ toạ độ bàn cờ. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Đường dẫn object trong bucket `photos`. */
  path: string;
  url: string;
  caption: string | null;
  createdAt: string;
  hearts: number;
};

/** Hàng trong bảng `photos` (chỉ các cột cần thiết). */
export type PhotoRow = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  storage_path: string;
  caption: string | null;
  status: PhotoStatus;
  created_at: string;
};

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

export type UploadResult =
  | { status: "approved"; photo: Photo }
  | { status: "review"; message: string }
  | { status: "rejected"; message: string };

export type ReportReason =
  | "sexual"
  | "violence"
  | "hate"
  | "spam"
  | "copyright"
  | "other";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "sexual", label: "Nội dung khiêu dâm / 18+" },
  { value: "violence", label: "Bạo lực / gore" },
  { value: "hate", label: "Thù địch / quấy rối" },
  { value: "spam", label: "Spam / quảng cáo" },
  { value: "copyright", label: "Vi phạm bản quyền" },
  { value: "other", label: "Khác" },
];

/** Một ảnh trong hàng chờ kiểm duyệt. */
export type QueueItem = {
  id: string;
  status: PhotoStatus;
  x: number;
  y: number;
  w: number;
  h: number;
  caption: string | null;
  createdAt: string;
  reportCount: number;
  url: string | null;
  rejectReason: string | null;
  authorId: string | null;
  moderation: Record<string, unknown> | null;
};

