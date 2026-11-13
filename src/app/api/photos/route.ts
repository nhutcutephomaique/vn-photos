import { MAX_GROWN_SIZE, PHOTOS_PER_VIEW, WORLD_SIZE } from "@/lib/config";
import { errorResponse } from "@/lib/errors";
import { photoFromRow } from "@/lib/photos";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function intParam(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

/**
 * GET /api/photos?x0&y0&x1&y1
 * Trả về ảnh đã duyệt giao với khung nhìn.
 *
 * x, y là TÂM ảnh → nới biên thêm nửa cạnh tối đa (ảnh có thể đã phình to
 * vì tym), nếu không sẽ bị hụt ảnh ở rìa khung nhìn.
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const inflate = Math.ceil(MAX_GROWN_SIZE / 2) + 8;

    const x0 = Math.max(0, intParam(params.get("x0"), 0) - inflate);
    const y0 = Math.max(0, intParam(params.get("y0"), 0) - inflate);
    const x1 = Math.min(WORLD_SIZE, intParam(params.get("x1"), WORLD_SIZE) + inflate);
    const y1 = Math.min(WORLD_SIZE, intParam(params.get("y1"), WORLD_SIZE) + inflate);

    const supabase = adminClient();
    const { data, error } = await supabase
      .from("photos")
      .select("id,x,y,w,h,storage_path,caption,created_at,heart_count")
      .eq("status", "approved")
      .gte("x", x0)
      .lte("x", x1)
      .gte("y", y0)
      .lte("y", y1)
      .order("created_at", { ascending: true })
      .limit(PHOTOS_PER_VIEW);

    if (error) throw error;

    const { count } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved");

    return Response.json({
      photos: (data ?? []).map((row) => photoFromRow(row as never)),
      total: count ?? 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
