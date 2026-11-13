import { GROWTH_RATE, MAX_GROWTH } from "@/lib/config";

/** Kích thước hiển thị trên bàn cờ, giữ đúng tỉ lệ ảnh gốc. Hàm thuần (dùng được ở client). */
export function displaySize(
  width: number,
  height: number,
  maxSide: number,
): { w: number; h: number } {
  const ratio = width / height;
  if (ratio >= 1) {
    return { w: Math.round(maxSide), h: Math.max(24, Math.round(maxSide / ratio)) };
  }
  return { w: Math.max(24, Math.round(maxSide * ratio)), h: Math.round(maxSide) };
}

/**
 * Càng nhiều tym ảnh càng to — nhưng theo logarit để ảnh không chiếm cả bàn cờ.
 *
 *  0 tym  → 1.00×
 *  1 tym  → 1.15×
 *  10 tym → 1.53×
 *  100    → 2.06× (bắt đầu chạm trần)
 *
 * Công thức này được mirror trong `public.register_heart()` (SQL) — sửa một
 * bên thì phải sửa cả bên kia.
 */
export function growthFactor(hearts: number): number {
  const safe = Math.max(0, hearts);
  return Math.min(1 + GROWTH_RATE * Math.log1p(safe), MAX_GROWTH);
}

export function grownSize(
  baseW: number,
  baseH: number,
  hearts: number,
): { w: number; h: number } {
  const factor = growthFactor(hearts);
  return { w: Math.max(1, Math.round(baseW * factor)), h: Math.max(1, Math.round(baseH * factor)) };
}

/** Tâm ảnh → toạ độ góc trên-trái để render. */
export function topLeft(centerX: number, centerY: number, w: number, h: number) {
  return { left: centerX - w / 2, top: centerY - h / 2 };
}
