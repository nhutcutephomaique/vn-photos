import { requireUser } from "@/lib/auth";
import { BUCKET_PENDING, BUCKET_PUBLIC } from "@/lib/config";
import { ApiError, errorResponse } from "@/lib/errors";
import { removeObject } from "@/lib/photos";
import { broadcastPhotoDeleted } from "@/lib/realtime";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/photos/:id
 *
 * Người dùng xoá ảnh của mình → coi như làm lại từ đầu:
 *   • row + tym bị xoá (FK cascade), file trong storage bị xoá
 *   • "1 ảnh/tài khoản" được giải phóng → đăng được ảnh mới
 *   • các client khác gỡ ảnh ngay qua realtime broadcast
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const supabase = adminClient();

    const { data: row, error: readError } = await supabase
      .from("photos")
      .select("id,author_id,status,storage_path")
      .eq("id", id)
      .maybeSingle();

    if (readError) throw readError;
    if (!row) throw new ApiError(404, "Ảnh không tồn tại hoặc đã bị gỡ.", "not_found");
    if (row.author_id !== user.id) {
      throw new ApiError(403, "Bạn chỉ xoá được ảnh của chính mình.", "forbidden");
    }

    const bucket = row.status === "approved" ? BUCKET_PUBLIC : BUCKET_PENDING;
    await removeObject(bucket, row.storage_path);

    const { error: deleteError } = await supabase.from("photos").delete().eq("id", id);
    if (deleteError) throw deleteError;

    await broadcastPhotoDeleted(id);

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
