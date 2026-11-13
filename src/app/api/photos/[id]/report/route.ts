import { requireUser } from "@/lib/auth";
import { ApiError, errorResponse } from "@/lib/errors";
import { adminClient } from "@/lib/supabase/admin";
import { REPORT_REASONS, type ReportReason } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_REASONS = new Set<string>(REPORT_REASONS.map((item) => item.value));

/**
 * POST /api/photos/:id/report
 * Mỗi người chỉ báo cáo một ảnh một lần. Đủ 3 báo cáo khác nhau thì ảnh
 * tự động bị ẩn (trigger `on_photo_reported`) và vào hàng chờ admin.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      reason?: unknown;
      note?: unknown;
    };

    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!VALID_REASONS.has(reason)) {
      throw new ApiError(400, "Lý do báo cáo không hợp lệ.", "bad_reason");
    }

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
    const supabase = adminClient();

    const { data: photo } = await supabase
      .from("photos")
      .select("id,status")
      .eq("id", id)
      .maybeSingle();

    if (!photo) throw new ApiError(404, "Ảnh không tồn tại.", "not_found");
    if (photo.status !== "approved") {
      return Response.json({ ok: true, message: "Ảnh đã được xử lý." });
    }

    const { error } = await supabase.from("photo_reports").insert({
      photo_id: id,
      reporter_id: user.id,
      reason: reason as ReportReason,
      note: note || null,
    });

    if (error) {
      if (error.code === "23505") {
        return Response.json(
          { ok: true, message: "Bạn đã báo cáo ảnh này rồi. Cảm ơn!" },
          { status: 200 },
        );
      }
      throw error;
    }

    return Response.json({ ok: true, message: "Đã gửi báo cáo. Đội ngũ sẽ xem xét." });
  } catch (error) {
    return errorResponse(error);
  }
}
