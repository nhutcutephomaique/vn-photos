import { POLICY } from "@/lib/moderation/policy";
import { num, record, type ProviderResult } from "@/lib/moderation/types";

/**
 * Lớp 2 — Sightengine (chuyên dụng cho ảnh).
 *
 * Các model dùng:
 *  - nudity-2.1 : sexual_activity, sexual_display, erotica, very_suggestive, minor
 *  - gore-2.0   : máu me, xác chết, thương tích
 *  - offensive  : phát ngôn thù địch dạng ảnh (symbol, chữ)
 *  - text       : OCR để bắt số điện thoại / email trong ảnh (chống doxxing)
 *
 * Đây là lớp "trọng tài" vì điểm nudity của Sightengine chính xác hơn
 * moderation tổng quát của OpenAI.
 */
export function sightengineConfigured(): boolean {
  return Boolean(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);
}

export async function screenWithSightengine(input: {
  image: Buffer;
  mime: string;
}): Promise<ProviderResult> {
  const user = process.env.SIGHTENGINE_API_USER;
  const secret = process.env.SIGHTENGINE_API_SECRET;
  if (!user || !secret) return { provider: "sightengine", ok: false, error: "not_configured" };

  try {
    const form = new FormData();
    form.append("media", new Blob([new Uint8Array(input.image)], { type: input.mime }), "image.webp");
    form.append("models", "nudity-2.1,gore-2.0,offensive,text");
    form.append("api_user", user);
    form.append("api_secret", secret);

    const response = await fetch("https://api.sightengine.com/1.0/check.json", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(POLICY.providerTimeoutMs),
    });

    if (!response.ok) {
      return { provider: "sightengine", ok: false, error: `http_${response.status}` };
    }

    const json = record(await response.json());
    if (json.status !== "success") {
      return {
        provider: "sightengine",
        ok: false,
        error: String(json.error ?? json.status ?? "provider_error").slice(0, 200),
      };
    }

    const nudity = record(json.nudity);
    const gore = record(json.gore);
    const offensive = record(json.offensive);
    const text = record(json.text);

    const sexual = Math.max(
      num(nudity.sexual_activity),
      num(nudity.sexual_display),
      num(nudity.erotica),
    );

    return {
      provider: "sightengine",
      ok: true,
      text: typeof text.text === "string" ? text.text : "",
      scores: {
        sexual,
        // `minor` xuất hiện ở nudity-2.1; nếu model không trả về thì = 0.
        sexualMinors: num(nudity.minor),
        // Đồ bơi / nội y / tư thế gợi cảm: KHÔNG từ chối tự động,
        // chỉ đẩy vào hàng chờ để tránh chặn nhầm ảnh du lịch, thể thao.
        suggestive: num(nudity.very_suggestive),
        gore: num(gore.prob),
        hate: num(offensive.prob),
        offensive: num(offensive.prob),
      },
    };
  } catch (error) {
    return {
      provider: "sightengine",
      ok: false,
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}
