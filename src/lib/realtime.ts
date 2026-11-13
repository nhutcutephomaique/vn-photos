/**
 * Broadcast realtime phía server (dùng service role).
 *
 * Realtime `postgres_changes` không gửi được sự kiện DELETE khi RLS đang bật
 * (Postgres không kiểm tra được quyền trên row đã mất). Vì vậy khi xoá ảnh,
 * server bắn một message broadcast để mọi client gỡ ảnh ngay lập tức.
 * Nếu bước này lỗi thì client vẫn tự dọn sau tối đa 45 giây.
 */
export async function broadcastPhotoDeleted(id: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: "vn-photos-live",
            event: "photo_deleted",
            payload: { id },
          },
        ],
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      console.warn("[realtime] broadcast failed", response.status);
    }
  } catch (error) {
    console.warn("[realtime] broadcast error", error);
  }
}
