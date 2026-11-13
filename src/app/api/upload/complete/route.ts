import { clientIp, memoryRateLimit, requireUser } from "@/lib/auth";
import { BUCKET_PENDING, MAX_UPLOAD_BYTES } from "@/lib/config";
import { ApiError, errorResponse } from "@/lib/errors";
import { sanitizeImage, type SanitizedImage } from "@/lib/imaging";
import { screenImage, type Verdict } from "@/lib/moderation";
import { POLICY } from "@/lib/moderation/policy";
import { photoFromRow, publishSanitized, removeObject, toBaseSize } from "@/lib/photos";
import { grownSize } from "@/lib/display";
import { adminClient } from "@/lib/supabase/admin";

/** Kiểm duyệt ảnh có thể mất vài giây (2 provider) → cho phép tới 60s. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type CompleteBody = { id?: unknown };

function moderationPayload(verdict: Verdict) {
  return {
    decision: verdict.decision,
    reason: verdict.reason,
    flags: verdict.flags,
    scores: verdict.scores,
    providers: verdict.providers,
    piiMatches: verdict.piiMatches,
    screenedAt: new Date().toISOString(),
  };
}

/**
 * POST /api/upload/complete
 *
 * Bước 2: server tải file từ bucket private, rồi:
 *   1. Re-encode (xoá EXIF/GPS, chặn payload ẩn, chuẩn hoá WebP).
 *   2. So hash với danh sách ảnh đã bị cấm → chặn up lại.
 *   3. Chạy kiểm duyệt tự động (OpenAI + Sightengine).
 *   4. approve → copy sang bucket public; review → hàng chờ admin; reject → xoá.
 *
 * Client không bao giờ quyết định status. Nó chỉ gửi id.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    memoryRateLimit(`complete:${clientIp(req)}`, 20, 60_000);

    const body = (await req.json().catch(() => ({}))) as CompleteBody;
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) throw new ApiError(400, "Thiếu id ảnh.", "bad_request");

    const supabase = adminClient();
    const { data: row, error: rowError } = await supabase
      .from("photos")
      .select("id,author_id,storage_path,status,x,y,w,h,caption,created_at,heart_count")
      .eq("id", id)
      .eq("author_id", user.id)
      .maybeSingle();

    if (rowError) throw rowError;
    if (!row) throw new ApiError(404, "Không tìm thấy ảnh này.", "not_found");

    if (row.status === "approved") {
      return Response.json({ status: "approved", photo: photoFromRow(row as never) });
    }
    if (row.status === "rejected") {
      return Response.json({
        status: "rejected",
        message: "Ảnh không vượt qua kiểm duyệt nên không được đăng.",
      });
    }
    if (row.status === "review") {
      return Response.json({
        status: "review",
        message: "Ảnh đang chờ người duyệt thủ công. Thường mất dưới 24 giờ.",
      });
    }

    const { data: blob, error: downloadError } = await supabase.storage
      .from(BUCKET_PENDING)
      .download(row.storage_path);

    if (downloadError || !blob) {
      await supabase
        .from("photos")
        .update({ status: "rejected", reject_reason: "upload_missing" })
        .eq("id", id);
      throw new ApiError(409, "Không tìm thấy file vừa tải lên. Thử lại nhé.", "missing_file");
    }

    if (blob.size > MAX_UPLOAD_BYTES) {
      await removeObject(BUCKET_PENDING, row.storage_path);
      await supabase
        .from("photos")
        .update({ status: "rejected", reject_reason: "file_too_large" })
        .eq("id", id);
      throw new ApiError(413, "Ảnh quá lớn (tối đa 12 MB).", "file_too_large");
    }

    let image: SanitizedImage;
    try {
      image = await sanitizeImage(Buffer.from(await blob.arrayBuffer()));
    } catch (error) {
      await removeObject(BUCKET_PENDING, row.storage_path);
      await supabase
        .from("photos")
        .update({ status: "rejected", reject_reason: "invalid_image" })
        .eq("id", id);
      throw error;
    }

    // --- Chặn up lại ảnh đã bị cấm ---------------------------------------
    const { data: blocked } = await supabase.rpc("find_blocked_hash", {
      p_hash: image.dhash,
      p_max_distance: POLICY.hashDistance,
      p_color: image.color,
    });

    if (blocked && blocked.length > 0) {
      await removeObject(BUCKET_PENDING, row.storage_path);
      await supabase
        .from("photos")
        .update({
          status: "rejected",
          reject_reason: "blocked_hash",
          dhash: image.dhash,
          color: image.color,
        })
        .eq("id", id);

      return Response.json({
        status: "rejected",
        message: "Ảnh này trùng với nội dung đã bị gỡ trước đó.",
      });
    }

    // --- Kiểm duyệt tự động ----------------------------------------------
    const verdict = await screenImage({
      image: image.buffer,
      mime: "image/webp",
      caption: row.caption,
    });

    const payload = moderationPayload(verdict);

    if (verdict.decision === "reject") {
      await removeObject(BUCKET_PENDING, row.storage_path);
      await supabase
        .from("photos")
        .update({
          status: "rejected",
          dhash: image.dhash,
          color: image.color,
          sexual_score: verdict.scores.sexual,
          moderation: payload,
          reject_reason: verdict.reason,
        })
        .eq("id", id);

      // Ảnh khiêu dâm / nghi liên quan trẻ vị thành niên → đưa vào blocklist
      // để lần sau có up lại (kể cả đã crop/nén) cũng bị chặn.
      if (
        verdict.flags.includes("sexual") ||
        verdict.flags.includes("csam_suspected") ||
        verdict.flags.includes("minor_borderline")
      ) {
        await supabase.from("blocked_hashes").upsert(
          {
            hash: image.dhash,
            color: image.color,
            reason: verdict.flags.includes("csam_suspected") ? "csam_suspected" : "sexual",
          },
          { onConflict: "hash", ignoreDuplicates: true },
        );
      }

      console.warn("[moderation] rejected", { id, reason: verdict.reason, scores: verdict.scores });
      return Response.json({
        status: "rejected",
        message: "Ảnh không vượt qua kiểm duyệt nên không được đăng.",
      });
    }

    if (verdict.decision === "review") {
      await supabase
        .from("photos")
        .update({
          status: "review",
          dhash: image.dhash,
          color: image.color,
          sexual_score: verdict.scores.sexual,
          moderation: payload,
          reject_reason: verdict.reason,
        })
        .eq("id", id);

      return Response.json({
        status: "review",
        message: "Ảnh đang chờ người duyệt thủ công. Thường mất dưới 24 giờ.",
      });
    }

    // --- Approve ----------------------------------------------------------
    const publicPath = await publishSanitized({ id, ownerId: user.id, image });
    const base = toBaseSize(image);
    const grown = grownSize(base.w, base.h, row.heart_count ?? 0);

    const { data: updated, error: updateError } = await supabase
      .from("photos")
      .update({
        status: "approved",
        storage_path: publicPath,
        base_w: base.w,
        base_h: base.h,
        w: grown.w,
        h: grown.h,
        img_w: image.width,
        img_h: image.height,
        dhash: image.dhash,
        color: image.color,
        sexual_score: verdict.scores.sexual,
        moderation: payload,
        reject_reason: null,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id,x,y,w,h,storage_path,caption,created_at,heart_count")
      .single();

    if (updateError) {
      await removeObject("photos", publicPath);
      throw updateError;
    }

    await removeObject(BUCKET_PENDING, row.storage_path);

    return Response.json({ status: "approved", photo: photoFromRow(updated as never) });
  } catch (error) {
    return errorResponse(error);
  }
}
