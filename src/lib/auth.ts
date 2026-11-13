import type { User } from "@supabase/supabase-js";
import { ApiError } from "@/lib/errors";
import { adminClient } from "@/lib/supabase/admin";

/** Xác thực Bearer token (phiên anonymous của Supabase) và trả về user. */
export async function requireUser(req: Request): Promise<User> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    throw new ApiError(401, "Cần đăng nhập ẩn danh trước khi tiếp tục.", "unauthenticated");
  }

  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) {
    throw new ApiError(401, "Phiên đăng nhập đã hết hạn. Tải lại trang nhé.", "session_expired");
  }
  return data.user;
}

/** Lấy IP thật của client (Vercel đặt x-forwarded-for). */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Rate limit nhẹ trong bộ nhớ — chỉ có tác dụng trong một instance.
 * Chốt chặn thật nằm ở trigger `enforce_upload_limits` trong Postgres.
 * Ở quy mô lớn, thay bằng Upstash Redis (xem README).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function memoryRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return;
  }

  entry.count += 1;
  if (entry.count > limit) {
    throw new ApiError(429, "Bạn thao tác quá nhanh. Thử lại sau một phút.", "rate_limit");
  }
}
