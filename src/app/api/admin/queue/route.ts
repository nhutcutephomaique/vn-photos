import { isAdmin } from "@/lib/admin-auth";
import { ApiError, errorResponse } from "@/lib/errors";
import { adminClient } from "@/lib/supabase/admin";
import type { QueueItem } from "@/lib/types";
import { publicPhotoUrl } from "@/lib/urls";

export const dynamic = "force-dynamic";

/** GET /api/admin/queue — ảnh cần người xem xét. */
export async function GET() {
  try {
    if (!(await isAdmin())) {
      throw new ApiError(401, "Cần đăng nhập admin.", "unauthorized");
    }

    const supabase = adminClient();
    const { data, error } = await supabase
      .from("photos")
      .select(
        "id,status,x,y,w,h,caption,created_at,report_count,storage_path,reject_reason,author_id,moderation",
      )
      .or("status.eq.pending,status.eq.review,report_count.gt.0")
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) throw error;

    const items: QueueItem[] = [];

    // Ảnh chờ duyệt nằm trong bucket private → ký URL tạm 1 giờ, theo lô.
    const pendingPaths = (data ?? [])
      .filter((row) => row.status !== "approved")
      .map((row) => row.storage_path);

    const signedUrls = new Map<string, string>();
    if (pendingPaths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("pending")
        .createSignedUrls(pendingPaths, 3600);

      for (const entry of signed ?? []) {
        if (entry.path && entry.signedUrl) signedUrls.set(entry.path, entry.signedUrl);
      }
    }

    for (const row of data ?? []) {
      const url =
        row.status === "approved"
          ? publicPhotoUrl(row.storage_path, 640)
          : (signedUrls.get(row.storage_path) ?? null);

      items.push({
        id: row.id,
        status: row.status,
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        caption: row.caption,
        createdAt: row.created_at,
        reportCount: row.report_count,
        url,
        rejectReason: row.reject_reason,
        authorId: row.author_id,
        moderation: (row.moderation as Record<string, unknown> | null) ?? null,
      });
    }

    return Response.json({ items });
  } catch (error) {
    return errorResponse(error);
  }
}
