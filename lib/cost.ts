import type { Cost, Usage } from "@/lib/types";

export interface PriceRow { inputPerM: number; outputPerM: number }

export function computeCost(u: Usage, p: PriceRow | undefined): Cost {
  if (!p) return { input: 0, output: 0, total: 0, confidence: "unknown" };
  const input = (u.inputTokens / 1_000_000) * p.inputPerM;
  const output = (u.outputTokens / 1_000_000) * p.outputPerM;
  return { input, output, total: input + output, confidence: u.confidence };
}

export const usd = (n: number) =>
  n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`;

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : `${n}`;

/** Rough char-count fallback when a provider returns no usage. ~3.8 chars/token. */
export function estimateUsage(promptChars: number, outputChars: number): Usage {
  return {
    inputTokens: Math.round(promptChars / 3.8),
    outputTokens: Math.round(outputChars / 3.8),
    reasoningTokens: 0,
    cachedInputTokens: 0,
    confidence: "estimated",
  };
}
