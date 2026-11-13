import { PII_PATTERNS, POLICY } from "@/lib/moderation/policy";
import { openAIConfigured, screenWithOpenAI } from "@/lib/moderation/openai";
import { sightengineConfigured, screenWithSightengine } from "@/lib/moderation/sightengine";
import { EMPTY_SCORES, type ProviderResult, type ProviderScores } from "@/lib/moderation/types";

export type Decision = "approve" | "review" | "reject";

export type Verdict = {
  decision: Decision;
  reason: string;
  /** Cờ để lọc/thống kê trong trang admin, vd: csam_suspected. */
  flags: string[];
  scores: ProviderScores;
  providers: { name: string; ok: boolean; error?: string }[];
  piiMatches: string[];
};

export type ScreenInput = {
  /** Ảnh ĐÃ được sanitize (webp) — chính là thứ sẽ được publish. */
  image: Buffer;
  mime: string;
  caption?: string | null;
};

const FAIL_MODE = (): Decision => (process.env.MODERATION_FAIL_MODE === "closed" ? "reject" : "review");

function sumText(results: ProviderResult[], caption?: string | null): string {
  const parts: string[] = [];
  for (const result of results) {
    if (result.ok && result.text) parts.push(result.text);
  }
  if (caption) parts.push(caption);
  return parts.join("\n");
}

function findPii(text: string): string[] {
  if (!text) return [];
  const hits = new Set<string>();
  for (const { name, pattern } of PII_PATTERNS) {
    if (pattern.test(text)) hits.add(name);
  }
  return [...hits];
}

/**
 * Chạy TẤT CẢ các lớp kiểm duyệt tự động trên một ảnh.
 *
 * Nguyên tắc:
 *  - Không bao giờ tự publish khi chưa có kết quả từ ít nhất một provider
 *    (trừ khi bật ALLOW_UNSCREENED=true ở môi trường dev).
 *  - Provider nào cũng có thể sai, nên ngưỡng reject cao + ngưỡng review thấp:
 *    vùng xám luôn rơi vào tay người duyệt.
 *  - Tín hiệu liên quan trẻ vị thành niên bị coi là tuyệt đối, không có
 *    "vùng xám": từ chối và gắn cờ để xử lý thủ công.
 */
export async function screenImage({ image, mime, caption }: ScreenInput): Promise<Verdict> {
  const providers: { name: string; ok: boolean; error?: string }[] = [];

  const configured: Promise<ProviderResult>[] = [];
  if (openAIConfigured()) {
    const dataUrl = `data:${mime};base64,${image.toString("base64")}`;
    configured.push(screenWithOpenAI({ dataUrl, text: caption ?? null }));
  }
  if (sightengineConfigured()) {
    configured.push(screenWithSightengine({ image, mime }));
  }

  if (configured.length === 0) {
    const failMode = FAIL_MODE();
    const allowUnscreened =
      process.env.ALLOW_UNSCREENED === "true" && process.env.NODE_ENV !== "production";

    return {
      decision: allowUnscreened ? "approve" : failMode,
      reason: allowUnscreened
        ? "unscreened_dev_bypass"
        : "no_moderation_provider_configured",
      flags: allowUnscreened ? ["unscreened"] : ["no_provider", "not_screened"],
      scores: EMPTY_SCORES,
      providers,
      piiMatches: [],
    };
  }

  const settled = await Promise.allSettled(configured);
  const results: ProviderResult[] = settled.map((entry, index) =>
    entry.status === "fulfilled"
      ? entry.value
      : { provider: `provider_${index}`, ok: false, error: String(entry.reason).slice(0, 200) },
  );

  const scores: ProviderScores = { ...EMPTY_SCORES };
  const flags: string[] = [];

  for (const result of results) {
    providers.push({
      name: result.provider,
      ok: result.ok,
      ...(result.ok ? {} : { error: result.error }),
    });
    if (!result.ok) continue;

    scores.sexual = Math.max(scores.sexual, result.scores.sexual);
    scores.sexualMinors = Math.max(scores.sexualMinors, result.scores.sexualMinors);
    scores.suggestive = Math.max(scores.suggestive, result.scores.suggestive);
    scores.gore = Math.max(scores.gore, result.scores.gore);
    scores.hate = Math.max(scores.hate, result.scores.hate);
    scores.offensive = Math.max(scores.offensive, result.scores.offensive);
  }

  const okCount = results.filter((result) => result.ok).length;
  if (okCount === 0) {
    return {
      decision: FAIL_MODE(),
      reason: "all_moderation_providers_failed",
      flags: ["provider_error"],
      scores,
      providers,
      piiMatches: [],
    };
  }
  if (okCount < results.length) flags.push("partial_screening");

  const piiMatches = findPii(sumText(results, caption));
  if (piiMatches.length > 0) flags.push("pii_in_text");

  const base = { scores, providers, piiMatches, flags };

  if (scores.sexualMinors >= POLICY.rejectMinor) {
    return { ...base, decision: "reject", reason: "csam_suspected", flags: [...flags, "csam_suspected"] };
  }
  if (scores.sexual >= POLICY.rejectSexual) {
    return { ...base, decision: "reject", reason: "sexual_content", flags: [...flags, "sexual"] };
  }
  if (scores.sexual >= POLICY.reviewSexual) {
    return { ...base, decision: "review", reason: "sexual_borderline", flags: [...flags, "sexual_borderline"] };
  }
  if (scores.sexualMinors >= POLICY.reviewMinor) {
    return { ...base, decision: "review", reason: "minor_borderline", flags: [...flags, "minor_borderline"] };
  }
  if (scores.suggestive >= POLICY.reviewSuggestive) {
    return { ...base, decision: "review", reason: "suggestive", flags: [...flags, "suggestive"] };
  }
  if (scores.gore >= POLICY.reviewGore) {
    return { ...base, decision: "review", reason: "gore", flags: [...flags, "gore"] };
  }
  if (scores.hate >= POLICY.reviewHate) {
    return { ...base, decision: "review", reason: "hate", flags: [...flags, "hate"] };
  }
  if (piiMatches.length > 0) {
    return { ...base, decision: "review", reason: "pii_in_text", flags };
  }

  return { ...base, decision: "approve", reason: "clean" };
}
