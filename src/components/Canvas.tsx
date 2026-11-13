"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WORLD_SIZE } from "@/lib/config";
import type { Bounds, Photo } from "@/lib/types";

/** Mức zoom tối đa (so với 1px world = 1px màn hình). */
export const MAX_SCALE = 4;

export type PlacingImage = { url: string; w: number; h: number };

type View = { x: number; y: number; scale: number };

type Props = {
  photos: Record<string, Photo>;
  placing: PlacingImage | null;
  myPhotoId: string | null;
  onPlace: (x: number, y: number) => void;
  onSelect: (photo: Photo) => void;
  onBoundsChange: (bounds: Bounds) => void;
  onCancelPlacing: () => void;
};

/** Zoom nhỏ nhất = vừa khít cả bàn cờ trong màn hình (giống r/place). */
function fitScale(width: number, height: number): number {
  if (!width || !height) return 0.2;
  return Math.min(width / WORLD_SIZE, height / WORLD_SIZE);
}

/**
 * Giữ khung nhìn bên trong bàn cờ:
 *  - không cho zoom ra ngoài "vừa khít bàn cờ"
 *  - không cho kéo bàn cờ ra khỏi màn hình
 *  - trục nào bàn cờ nhỏ hơn màn hình thì tự căn giữa
 */
function clampView(view: View, width: number, height: number): View {
  const min = fitScale(width, height);
  const scale = Math.min(Math.max(view.scale, min), MAX_SCALE);
  const spanX = width / scale;
  const spanY = height / scale;

  return {
    scale,
    x:
      spanX >= WORLD_SIZE
        ? (WORLD_SIZE - spanX) / 2
        : Math.min(Math.max(view.x, 0), WORLD_SIZE - spanX),
    y:
      spanY >= WORLD_SIZE
        ? (WORLD_SIZE - spanY) / 2
        : Math.min(Math.max(view.y, 0), WORLD_SIZE - spanY),
  };
}

/** Đã animate rồi thì thôi — tránh nhấp nháy khi pan qua lại. */
const ANIMATED = new Set<string>();

const PhotoCard = memo(function PhotoCard({ photo, mine }: { photo: Photo; mine: boolean }) {
  const z = useMemo(() => {
    const time = Date.parse(photo.createdAt);
    const base = Number.isFinite(time) ? Math.floor(time / 1000) % 1_000_000 : 1;
    // Ảnh nhiều tym nằm trên ảnh ít tym (tối đa +900 để không phá thứ tự thời gian).
    return base + Math.min(photo.hearts, 900);
  }, [photo.createdAt, photo.hearts]);

  // Chỉ chạy animation "pop" cho ảnh mới thực sự, không phát lại mỗi lần
  // ảnh được render lại khi pan (culling). Initializer phải thuần (React có
  // thể gọi 2 lần) nên việc đánh dấu nằm trong effect.
  const [animate] = useState(() => !ANIMATED.has(photo.id));
  useEffect(() => {
    ANIMATED.add(photo.id);
  }, [photo.id]);

  return (
    <div
      className={`photo${animate ? " is-new" : ""}${mine ? " is-mine" : ""}`}
      data-photo-id={photo.id}
      style={{
        // x, y là tâm ảnh → đổi sang toạ độ góc trên-trái để render.
        left: photo.x - photo.w / 2,
        top: photo.y - photo.h / 2,
        width: photo.w,
        height: photo.h,
        zIndex: z,
      }}
    >
      <img
        src={photo.url}
        alt={photo.caption ?? "Ảnh do cộng đồng đăng"}
        loading="lazy"
        decoding="async"
        draggable={false}
        width={photo.w}
        height={photo.h}
      />
    </div>
  );
});

export default function Canvas({
  photos,
  placing,
  myPhotoId,
  onPlace,
  onSelect,
  onBoundsChange,
  onCancelPlacing,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: number;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null>(null);
  const draggedAt = useRef(0);
  const lastBoundsKey = useRef("");
  const initialized = useRef(false);

  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 0.2 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  // ---- Đo kích thước + đặt camera lần đầu (vừa khít bàn cờ) -------------
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;

      setSize({ w: rect.width, h: rect.height });

      // Lần đầu: đặt zoom vừa khít bàn cờ. Phải tính NGOÀI hàm setView,
      // vì React có thể gọi updater 2 lần (StrictMode) → ref sẽ bị "tiêu thụ"
      // ngay trong lần gọi bị bỏ đi.
      if (!initialized.current) {
        initialized.current = true;
        setView(
          clampView(
            { x: 0, y: 0, scale: fitScale(rect.width, rect.height) },
            rect.width,
            rect.height,
          ),
        );
        return;
      }

      setView((previous) => clampView(previous, rect.width, rect.height));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const zoomAt = useCallback((factor: number, anchorX: number, anchorY: number) => {
    const element = surfaceRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();

    setView((previous) => {
      const min = fitScale(rect.width, rect.height);
      const scale = Math.min(Math.max(previous.scale * factor, min), MAX_SCALE);
      const worldX = previous.x + anchorX / previous.scale;
      const worldY = previous.y + anchorY / previous.scale;
      return clampView(
        { scale, x: worldX - anchorX / scale, y: worldY - anchorY / scale },
        rect.width,
        rect.height,
      );
    });
  }, []);

  // ---- Zoom bằng con lăn (listener native để preventDefault được) --------
  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0016);
      zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ---- Kéo để di chuyển + thả để đặt ảnh --------------------------------
  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.id) return;

      const dx = event.clientX - drag.sx;
      const dy = event.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
      if (!drag.moved) return;

      const element = surfaceRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();

      setView((previous) =>
        clampView(
          { ...previous, x: drag.ox - dx / previous.scale, y: drag.oy - dy / previous.scale },
          rect.width,
          rect.height,
        ),
      );
    }

    function handleUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.id) return;
      dragRef.current = null;

      if (drag.moved) {
        draggedAt.current = Date.now();
        return;
      }

      if (placing) {
        const element = surfaceRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        draggedAt.current = Date.now();
        const current = viewRef.current;
        const worldX = (event.clientX - rect.left) / current.scale + current.x;
        const worldY = (event.clientY - rect.top) / current.scale + current.y;

        // Toạ độ gửi lên server là TÂM ảnh, snap về lưới 8px,
        // và luôn nằm trọn trong bàn cờ.
        const halfW = placing.w / 2;
        const halfH = placing.h / 2;
        const x = Math.min(Math.max(Math.round(worldX / 8) * 8, halfW), WORLD_SIZE - halfW);
        const y = Math.min(Math.max(Math.round(worldY / 8) * 8, halfH), WORLD_SIZE - halfH);
        onPlace(x, y);
      }
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [onPlace, placing]);

  // ---- Esc để huỷ đặt ảnh ------------------------------------------------
  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelPlacing();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancelPlacing, placing]);

  // ---- Báo khung nhìn hiện tại lên trên (đã làm tròn để giảm fetch) -----
  useEffect(() => {
    if (!size.w || !size.h) return;
    const quantize = (value: number) => Math.round(value / 160) * 160;
    const bounds: Bounds = {
      x0: Math.max(0, Math.min(WORLD_SIZE, quantize(view.x))),
      y0: Math.max(0, Math.min(WORLD_SIZE, quantize(view.y))),
      x1: Math.max(0, Math.min(WORLD_SIZE, quantize(view.x + size.w / view.scale))),
      y1: Math.max(0, Math.min(WORLD_SIZE, quantize(view.y + size.h / view.scale))),
    };
    const key = `${bounds.x0}:${bounds.y0}:${bounds.x1}:${bounds.y1}`;
    if (key === lastBoundsKey.current) return;
    lastBoundsKey.current = key;
    onBoundsChange(bounds);
  }, [onBoundsChange, size.h, size.w, view.x, view.y, view.scale]);

  const visible = useMemo(() => {
    const pad = 340;
    const left = view.x - pad;
    const top = view.y - pad;
    const right = view.x + size.w / view.scale + pad;
    const bottom = view.y + size.h / view.scale + pad;
    return Object.values(photos).filter(
      (photo) =>
        photo.x + photo.w / 2 > left &&
        photo.x - photo.w / 2 < right &&
        photo.y + photo.h / 2 > top &&
        photo.y - photo.h / 2 < bottom,
    );
  }, [photos, size.h, size.w, view.scale, view.x, view.y]);

  const handleSurfacePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      id: event.pointerId,
      sx: event.clientX,
      sy: event.clientY,
      ox: view.x,
      oy: view.y,
      moved: false,
    };
  };

  const handleSurfacePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const world = {
      x: Math.round((event.clientX - rect.left) / view.scale + view.x),
      y: Math.round((event.clientY - rect.top) / view.scale + view.y),
    };
    setHover(world);
    if (placing && !dragRef.current?.moved) setCursor(world);
  };

  const handleSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - draggedAt.current < 250) return;
    const target = (event.target as HTMLElement).closest("[data-photo-id]");
    const id = target?.getAttribute("data-photo-id");
    if (!id) return;
    const photo = photos[id];
    if (photo) onSelect(photo);
  };

  const minScale = size.w ? fitScale(size.w, size.h) : 0.2;
  const shown = hover ?? {
    x: Math.round(view.x + size.w / view.scale / 2),
    y: Math.round(view.y + size.h / view.scale / 2),
  };

  return (
    <div
      ref={surfaceRef}
      className={`canvas${placing ? " is-placing" : ""}`}
      onPointerDown={handleSurfacePointerDown}
      onPointerMove={handleSurfacePointerMove}
      onPointerLeave={() => setHover(null)}
      onClick={handleSurfaceClick}
    >
      <div
        className="world"
        style={{
          width: WORLD_SIZE,
          height: WORLD_SIZE,
          transform: `translate3d(${-view.x * view.scale}px, ${-view.y * view.scale}px, 0) scale(${view.scale})`,
        }}
      >
        <div className="world-grid" />
        {visible.map((photo) => (
          <PhotoCard key={photo.id} photo={photo} mine={photo.id === myPhotoId} />
        ))}

        {placing && cursor && (
          <div
            className="placing-ghost"
            style={{
              left: Math.round((cursor.x - placing.w / 2) / 8) * 8,
              top: Math.round((cursor.y - placing.h / 2) / 8) * 8,
              width: placing.w,
              height: placing.h,
            }}
          >
            <img src={placing.url} alt="" draggable={false} />
          </div>
        )}
      </div>

      {/* Toạ độ + mức zoom, giống thanh ở đầu r/place */}
      <div className="canvas-hud">
        <span className="hud-coords">
          ({Math.min(WORLD_SIZE, Math.max(0, shown.x))},{" "}
          {Math.min(WORLD_SIZE, Math.max(0, shown.y))})
        </span>
        <span className="hud-sep">·</span>
        <span className="hud-zoom">{view.scale.toFixed(2)}×</span>
      </div>

      <div className="canvas-controls">
        <button
          type="button"
          className="icon-btn"
          aria-label="Thu nhỏ"
          disabled={view.scale <= minScale + 0.001}
          onClick={() => zoomAt(1 / 1.4, size.w / 2, size.h / 2)}
        >
          −
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Phóng to"
          disabled={view.scale >= MAX_SCALE - 0.001}
          onClick={() => zoomAt(1.4, size.w / 2, size.h / 2)}
        >
          +
        </button>
        <button
          type="button"
          className="icon-btn wide"
          onClick={() => {
            const element = surfaceRef.current;
            if (!element) return;
            const rect = element.getBoundingClientRect();
            setView(
              clampView(
                { x: 0, y: 0, scale: fitScale(rect.width, rect.height) },
                rect.width,
                rect.height,
              ),
            );
          }}
        >
          Toàn bàn cờ
        </button>
      </div>

      <div className="canvas-hint">
        {placing ? "Nhấp vào bàn cờ để đặt ảnh · Esc để huỷ" : "Kéo để xem · Cuộn để phóng to"}
      </div>
    </div>
  );
}
