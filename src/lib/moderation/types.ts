/** Điểm số đã chuẩn hoá từ mọi provider (0..1, càng cao càng nhạy cảm). */
export type ProviderScores = {
  sexual: number;
  sexualMinors: number;
  /** Gợi dục ở mức "very suggestive" (đồ bơi, nội y…) — chỉ đủ để review. */
  suggestive: number;
  gore: number;
  hate: number;
  offensive: number;
};

export type ProviderResult =
  | {
      provider: string;
      ok: true;
      scores: ProviderScores;
      /** Text đọc được trong ảnh (OCR) hoặc caption, nếu provider hỗ trợ. */
      text: string;
    }
  | { provider: string; ok: false; error: string };

export const EMPTY_SCORES: ProviderScores = {
  sexual: 0,
  sexualMinors: 0,
  suggestive: 0,
  gore: 0,
  hate: 0,
  offensive: 0,
};

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
