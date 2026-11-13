import { isAdmin } from "@/lib/admin-auth";
import { BUCKET_PENDING, BUCKET_PUBLIC } from "@/lib/config";
import { ApiError, errorResponse } from "@/lib/errors";
import { grownSize } from "@/lib/display";
import { publishFromPending, removeObject, toBaseSize } from "@/lib/photos";
import { broadcastPhotoDeleted } from "@/lib/realtime";
import { adminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Action = "approve" | "reject" | "delete";

/**
 * POST /api/admin/moderate  { id, action, note? }
 *  - approve : chuyển ảnh từ bucket private sang public và publish.
 *  - reject  : gỡ ảnh, đưa hash vào blocklist để chặn up lại.
 *  - delete  : xoá vĩnh viễn (dùng cho takedown bản quyền / CSAM).
 */
export async function POST(req: Request) {
  try {
    if (!(await isAdmin())) {
      throw new ApiError(401, "Cần đăng nhập admin.", "unauthorized");
    }

    const body = (await req.json().catch(() => ({}))) as {
      id?: unknown;
      action?: unknown;
      note?: unknown;
    };

    const id = typeof body.id === "string" ? body.id : "";
    const action = body.action as Action;
    if (!id || !["approve", "reject", "delete"].includes(action)) {
      throw new ApiError(400, "Tham số không hợp lệ.", "bad_request");
    }

    const note = typeof body.note === "string" ? body.note.slice(0, 300) : null;
    const supabase = adminClient();

    const { data: row, error } = await supabase
      .from("photos")
      .select("id,author_id,storage_path,status,dhash,color,moderation,caption,created_at,x,y,w,h,base_w,base_h,heart_count")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!row) throw new ApiError(404, "Ảnh không tồn tại.", "not_found");

    const adminLog = {
      action,
      note,
      at: new Date().toISOString(),
    };

    if (action === "delete") {
      await removeObject(BUCKET_PENDING, row.storage_path);
      if (row.status === "approved") await removeObject(BUCKET_PUBLIC, row.storage_path);
      await supabase.from("photos").delete().eq("id", id);
      await broadcastPhotoDeleted(id);
      return Response.json({ ok: true });
    }

    if (action === "reject") {
      if (row.status === "approved") {
        await removeObject(BUCKET_PUBLIC, row.storage_path);
      } else {
        await removeObject(BUCKET_PENDING, row.storage_path);
      }

      await supabase
        .from("photos")
        .update({
          status: "rejected",
          reject_reason: note ?? "admin_rejected",
          moderation: { ...(row.moderation ?? {}), admin: adminLog },
        })
        .eq("id", id);

      if (row.dhash) {
        await supabase.from("blocked_hashes").upsert(
          {
            hash: row.dhash,
            color: row.color ?? 0,
            reason: note ?? "admin_rejected",
          },
          { onConflict: "hash", ignoreDuplicates: true },
        );
      }

      await broadcastPhotoDeleted(id);
      return Response.json({ ok: true });
    }

    // approve
    if (row.status === "approved") {
      return Response.json({ ok: true, alreadyApproved: true });
    }

    const { path, image } = await publishFromPending({
      id: row.id,
      author_id: row.author_id,
      storage_path: row.storage_path,
    });
    const base = toBaseSize(image);
    const grown = grownSize(base.w, base.h, row.heart_count ?? 0);

    const { error: updateError } = await supabase
      .from("photos")
      .update({
        status: "approved",
        storage_path: path,
        base_w: base.w,
        base_h: base.h,
        w: grown.w,
        h: grown.h,
        img_w: image.width,
        img_h: image.height,
        dhash: image.dhash,
        color: image.color,
        reject_reason: null,
        approved_at: new Date().toISOString(),
        moderation: { ...(row.moderation ?? {}), admin: adminLog },
      })
      .eq("id", id);

    if (updateError) {
      await removeObject(BUCKET_PUBLIC, path);
      throw updateError;
    }

    await removeObject(BUCKET_PENDING, row.storage_path);

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
