import type { PhotoStatus } from "@/lib/types";

/** Lỗi có HTTP status, dùng chung cho mọi API route. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, code: error.code ?? null },
      { status: error.status },
    );
  }

  // Lỗi từ trigger Postgres.
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UPLOAD_REQUIRES_IDENTITY")) {
    return Response.json(
      { error: "Cần đăng nhập ẩn danh trước khi đăng ảnh.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  if (message.includes("PHOTO_ALREADY_EXISTS")) {
    return Response.json(
      {
        error: "Mỗi tài khoản chỉ được 1 ảnh. Xoá ảnh hiện tại rồi đăng ảnh mới nhé.",
        code: "photo_exists",
      },
      { status: 409 },
    );
  }

  if (message.includes("UPLOAD_ATTEMPTS_EXCEEDED")) {
    return Response.json(
      { error: "Bạn đã thử đăng quá nhiều lần hôm nay. Mai thử lại nhé.", code: "attempts" },
      { status: 429 },
    );
  }

  if (message.includes("PHOTO_NOT_FOUND")) {
    return Response.json({ error: "Ảnh không tồn tại hoặc đã bị gỡ.", code: "not_found" }, { status: 404 });
  }

  if (message.includes("PHOTO_NOT_APPROVED")) {
    return Response.json(
      { error: "Chỉ thả tym được cho ảnh đã được duyệt.", code: "not_approved" },
      { status: 409 },
    );
  }

  if (message.includes("CANNOT_HEART_OWN_PHOTO")) {
    return Response.json(
      { error: "Không tự thả tym cho ảnh của mình được đâu 😄", code: "own_photo" },
      { status: 400 },
    );
  }

  if (message.includes("HEART_COOLDOWN")) {
    return Response.json(
      { error: "Từ từ thôi — 3 phút mới được thả tym tiếp.", code: "cooldown" },
      { status: 429 },
    );
  }

  if (message.includes("HEART_QUOTA_EXCEEDED")) {
    return Response.json(
      { error: "Bạn đã dùng hết 20 tym hôm nay. Mai quay lại nhé.", code: "heart_quota" },
      { status: 429 },
    );
  }

  if (message.includes("Thiếu biến môi trường") || message.includes("Thiếu NEXT_PUBLIC_SUPABASE")) {
    console.error("[api] missing env", message);
    return Response.json(
      { error: `${message}. Xem .env.example rồi khởi động lại.`, code: "missing_env" },
      { status: 503 },
    );
  }

  console.error("[api] unexpected error", error);
  return Response.json(
    { error: "Có lỗi phía server. Thử lại sau ít phút.", code: "internal" },
    { status: 500 },
  );
}

export const STATUS_LABEL: Record<PhotoStatus, string> = {
  pending: "Đang chờ",
  approved: "Đã duyệt",
  review: "Chờ người duyệt",
  rejected: "Bị từ chối",
};
