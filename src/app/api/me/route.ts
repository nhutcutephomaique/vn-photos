import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/errors";
import { photoFromRow } from "@/lib/photos";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/me
 * Cho client biết tài khoản này đã có ảnh chưa (để khoá nút "Đăng ảnh" và
 * hiện nút xoá). Trả kèm dữ liệu ảnh nếu nó đã được duyệt.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const supabase = adminClient();

    const { data, error } = await supabase
      .from("photos")
      .select("id,status,x,y,w,h,storage_path,caption,created_at,heart_count")
      .eq("author_id", user.id)
      .in("status", ["pending", "review", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return Response.json({ status: null, id: null, photo: null });

    return Response.json({
      status: data.status,
      id: data.id,
      photo: data.status === "approved" ? photoFromRow(data as never) : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
