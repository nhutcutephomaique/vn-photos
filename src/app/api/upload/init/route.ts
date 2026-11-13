import { randomUUID } from "node:crypto";
import { clientIp, memoryRateLimit, requireUser } from "@/lib/auth";
import {
  BUCKET_PENDING,
  MAX_DISPLAY_SIZE,
  PENDING_TTL_MINUTES,
  WORLD_SIZE,
} from "@/lib/config";
import { ApiError, errorResponse } from "@/lib/errors";
import { removeObject } from "@/lib/photos";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type InitBody = { x?: unknown; y?: unknown; caption?: unknown };

const EXISTING_MESSAGE: Record<string, string> = {
  approved:
    "Mỗi tài khoản chỉ được 1 ảnh. Xoá ảnh hiện tại rồi đăng ảnh mới nhé.",
  review:
    "Ảnh của bạn đang chờ người duyệt. Xoá nếu muốn đăng ảnh khác.",
  pending:
    "Bạn đang có một ảnh đang xử lý. Đợi xong hoặc xoá nó trước.",
};

/**
 * POST /api/upload/init
 *
 * Bước 1 của luồng upload:
 *  1. Xác thực phiên ẩn danh.
 *  2. Dọn ảnh pending bị bỏ dở (> 15 phút) để người dùng không bị kẹt.
 *  3. Chặn nếu tài khoản đã có 1 ảnh đang sống.
 *  4. Tạo row `photos` status=pending, ký URL upload vào bucket private.
 *
 * Toạ độ nhận vào là TÂM ảnh.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    memoryRateLimit(`init:${clientIp(req)}`, 6, 60_000);

    const body = (await req.json().catch(() => ({}))) as InitBody;
    const x = Number(body.x);
    const y = Number(body.y);
    const caption = typeof body.caption === "string" ? body.caption.trim().slice(0, 140) : null;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ApiError(400, "Toạ độ không hợp lệ.", "bad_coordinates");
    }

    const half = MAX_DISPLAY_SIZE / 2;
    const px = Math.min(Math.max(Math.round(x), half), WORLD_SIZE - half);
    const py = Math.min(Math.max(Math.round(y), half), WORLD_SIZE - half);

    const supabase = adminClient();

    // Dọn ảnh pending bị bỏ dở — nếu không, người dùng upload lỗi giữa đường
    // sẽ bị khoá vĩnh viễn bởi quy tắc "1 ảnh/tài khoản".
    const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60 * 1000).toISOString();
    const { data: stale } = await supabase
      .from("photos")
      .select("id,storage_path")
      .eq("author_id", user.id)
      .eq("status", "pending")
      .lt("created_at", cutoff);

    for (const row of stale ?? []) {
      await removeObject(BUCKET_PENDING, row.storage_path);
      await supabase.from("photos").delete().eq("id", row.id);
    }

    const { data: existing } = await supabase
      .from("photos")
      .select("id,status")
      .eq("author_id", user.id)
      .in("status", ["pending", "review", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      throw new ApiError(
        409,
        EXISTING_MESSAGE[existing.status] ?? EXISTING_MESSAGE.approved,
        "photo_exists",
      );
    }

    const id = randomUUID();
    const path = `${user.id}/${id}`;

    const { error: insertError } = await supabase.from("photos").insert({
      id,
      author_id: user.id,
      storage_path: path,
      status: "pending",
      x: px,
      y: py,
      base_w: MAX_DISPLAY_SIZE,
      base_h: MAX_DISPLAY_SIZE,
      w: MAX_DISPLAY_SIZE,
      h: MAX_DISPLAY_SIZE,
      caption,
    });

    if (insertError) throw insertError;

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET_PENDING)
      .createSignedUploadUrl(path);

    if (signError || !signed) {
      await supabase.from("photos").delete().eq("id", id);
      throw signError ?? new ApiError(500, "Không tạo được URL upload.", "sign_failed");
    }

    return Response.json({
      id,
      path,
      token: signed.token,
      signedUrl: signed.signedUrl,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
