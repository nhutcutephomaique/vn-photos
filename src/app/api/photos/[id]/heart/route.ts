import { memoryRateLimit, requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/photos/:id/heart
 *
 * Mỗi tym làm ảnh to thêm (logarit). Toàn bộ kiểm tra + ghi + tính lại kích
 * thước nằm trong một transaction ở `public.register_heart`, nên không thể
 * bắn song song để vượt giới hạn.
 *
 * Kích thước mới được ghi vào row `photos` → Supabase Realtime phát UPDATE
 * cho mọi người, ảnh to lên ngay trên bàn cờ của tất cả client.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;

    // Chặn thêm một lớp ở tầng app (tầng DB vẫn là chốt chặn thật).
    memoryRateLimit(`heart:${user.id}`, 15, 60_000);

    const { data, error } = await adminClient().rpc("register_heart", {
      p_photo_id: id,
      p_user_id: user.id,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return Response.json({ error: "Không thả được tym." }, { status: 409 });
    }

    return Response.json({
      hearts: row.heart_count,
      w: row.w,
      h: row.h,
      heartsLeft: row.hearts_left,
      nextHeartAt: row.next_heart_at,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
