"use client";

import { useCallback, useEffect, useState } from "react";
import { VIEW_REFRESH_MS } from "@/lib/config";
import type { Bounds, Photo } from "@/lib/types";
import { publicPhotoUrl } from "@/lib/urls";

export type RealtimePhotoRow = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  storage_path: string;
  caption: string | null;
  created_at: string;
  heart_count: number;
};

export function rowToPhoto(row: RealtimePhotoRow): Photo {
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    path: row.storage_path,
    caption: row.caption,
    createdAt: row.created_at,
    url: publicPhotoUrl(row.storage_path, 512),
    hearts: row.heart_count ?? 0,
  };
}

/**
 * Tải ảnh trong khung nhìn (debounce khi pan/zoom) + tự làm mới định kỳ
 * để dọn những ảnh vừa bị moderator gỡ.
 */
export function usePhotos(bounds: Bounds | null) {
  const [photos, setPhotos] = useState<Record<string, Photo>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const key = bounds ? `${bounds.x0}:${bounds.y0}:${bounds.x1}:${bounds.y1}` : "";

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), VIEW_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!bounds) return;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          x0: String(bounds.x0),
          y0: String(bounds.y0),
          x1: String(bounds.x1),
          y1: String(bounds.y1),
        });
        const response = await fetch(`/api/photos?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;

        const json = (await response.json()) as { photos: Photo[]; total: number };
        setPhotos((previous) => {
          const next = { ...previous };
          for (const photo of json.photos) next[photo.id] = photo;
          return next;
        });
        setTotal(json.total ?? 0);
      } catch {
        // request bị abort khi người dùng pan tiếp — bỏ qua
      } finally {
        setLoading(false);
      }
    }, 140);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `bounds` được biểu diễn qua `key` để tránh fetch lại mỗi frame pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  /** Thêm ảnh mới hoặc cập nhật ảnh đã có (kích thước đổi khi được thả tym). */
  const upsert = useCallback((photo: Photo) => {
    setPhotos((previous) => ({ ...previous, [photo.id]: photo }));
  }, []);

  const remove = useCallback((id: string) => {
    setPhotos((previous) => {
      if (!previous[id]) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setTotal((value) => Math.max(0, value - 1));
  }, []);

  /** Cập nhật cục bộ sau khi thả tym (không chờ realtime). */
  const patch = useCallback((id: string, changes: Partial<Photo>) => {
    setPhotos((previous) => {
      const current = previous[id];
      if (!current) return previous;
      return { ...previous, [id]: { ...current, ...changes } };
    });
  }, []);

  return { photos, total, loading, upsert, remove, patch };
}
