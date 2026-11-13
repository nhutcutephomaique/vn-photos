import { BUCKET_PENDING } from "@/lib/config";
import { ApiError, errorResponse } from "@/lib/errors";
import { removeObject } from "@/lib/photos";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/purge
 * Dọn ảnh chờ duyệt / bị từ chối quá 48 giờ: xoá file trong bucket private
 * rồi xoá row. Được gọi bởi Vercel Cron (xem vercel.json).
 *
 * Vercel tự gửi header `Authorization: Bearer $CRON_SECRET` nếu biến này tồn tại.
 */
export async function GET(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const header = req.headers.get("authorization") ?? "";
      if (header !== `Bearer ${secret}`) {
        throw new ApiError(401, "Unauthorized", "unauthorized");
      }
    }

    const supabase = adminClient();
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("photos")
      .select("id,storage_path,status")
      .in("status", ["pending", "rejected"])
      .lt("created_at", cutoff)
      .limit(300);

    if (error) throw error;
    if (!data || data.length === 0) return Response.json({ removed: 0 });

    for (const row of data) {
      // Đường dẫn của ảnh rejected có thể đã bị xoá trước đó — bỏ qua lỗi.
      await removeObject(BUCKET_PENDING, row.storage_path);
    }

    const { error: deleteError } = await supabase
      .from("photos")
      .delete()
      .in("id", data.map((row) => row.id));

    if (deleteError) throw deleteError;

    return Response.json({ removed: data.length });
  } catch (error) {
    return errorResponse(error);
  }
}
