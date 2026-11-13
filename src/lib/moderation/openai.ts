import { POLICY } from "@/lib/moderation/policy";
import { num, record, type ProviderResult } from "@/lib/moderation/types";

/**
 * Lớp 1 — OpenAI omni-moderation.
 * - Nhận cả ảnh và text trong cùng một request.
 * - Miễn phí, độ trễ thấp, bắt tốt `sexual`, `sexual/minors`, `violence/graphic`.
 * - Dùng làm "cảnh báo sớm": điểm cao ở đây luôn thắng.
 */
export function openAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

type OpenAIResponse = {
  results?: Array<{
    flagged?: boolean;
    category_scores?: Record<string, number>;
  }>;
};

export async function screenWithOpenAI(input: {
  dataUrl: string;
  text?: string | null;
}): Promise<ProviderResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { provider: "openai", ok: false, error: "not_configured" };

  const parts: Array<Record<string, unknown>> = [
    { type: "image_url", image_url: { url: input.dataUrl } },
  ];
  if (input.text) parts.push({ type: "text", text: input.text });

  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input: parts }),
      signal: AbortSignal.timeout(POLICY.providerTimeoutMs),
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      return { provider: "openai", ok: false, error: `http_${response.status}: ${body}` };
    }

    const json = (await response.json()) as OpenAIResponse;
    const scores = record(json.results?.[0]?.category_scores);

    return {
      provider: "openai",
      ok: true,
      text: input.text ?? "",
      scores: {
        sexual: num(scores["sexual"]),
        sexualMinors: num(scores["sexual/minors"]),
        suggestive: 0,
        gore: num(scores["violence/graphic"]),
        hate: Math.max(num(scores["hate"]), num(scores["hate/threatening"])),
        offensive: Math.max(num(scores["harassment"]), num(scores["harassment/threatening"])),
      },
    };
  } catch (error) {
    return {
      provider: "openai",
      ok: false,
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}
