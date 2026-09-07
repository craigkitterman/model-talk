import type { ModelSpec, ProviderMeta } from "@/lib/types";

/**
 * EDIT ME. Provider pricing and model IDs change constantly.
 * `verified: false` means the author could not confirm the numbers — the UI shows a warning
 * badge and you should correct them here before trusting the cost meter.
 * `params` is only filled in where a lab has publicly stated it. Never guessed.
 */

export const PROVIDERS: Record<string, ProviderMeta> = {
  anthropic: { id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY", color: "#D97757", glow: "217,119,87" },
  openai: { id: "openai", label: "OpenAI", envKey: "OPENAI_API_KEY", color: "#3FE0A8", glow: "63,224,168" },
  google: { id: "google", label: "Google", envKey: "GOOGLE_API_KEY", color: "#5B9DFF", glow: "91,157,255" },
  xai: { id: "xai", label: "xAI", envKey: "XAI_API_KEY", color: "#C9CFD6", glow: "201,207,214" },
  compat: { id: "compat", label: "OpenAI-compatible", envKey: "COMPAT_API_KEY", color: "#B58CFF", glow: "181,140,255" },
  sim: { id: "sim", label: "Simulator (no key)", envKey: "—", color: "#8C97AA", glow: "140,151,170" },
};

export const MODELS: ModelSpec[] = [
  // ── Anthropic ──────────────────────────────────────────────────────────────
  {
    id: "claude-opus-5", provider: "anthropic", name: "Claude Opus 5", family: "Claude 5",
    inputPerM: 5, outputPerM: 25, contextWindow: 200_000, maxOutput: 64_000,
    cutoff: "2026-05", released: "2026", reasoning: true, params: null, verified: false,
    note: "Confirm pricing at claude.com/pricing before trusting the meter.",
  },
  {
    id: "claude-sonnet-5", provider: "anthropic", name: "Claude Sonnet 5", family: "Claude 5",
    inputPerM: 3, outputPerM: 15, contextWindow: 200_000, maxOutput: 64_000,
    cutoff: "2026-05", released: "2026", reasoning: true, params: null, verified: false,
  },
  {
    id: "claude-fable-5-1", provider: "anthropic", name: "Claude Fable 5.1", family: "Claude 5",
    inputPerM: 3, outputPerM: 15, contextWindow: 200_000, maxOutput: 64_000,
    cutoff: "2026-05", released: "2026", reasoning: true, params: null, verified: false,
  },
  {
    id: "claude-haiku-4-5-20251001", provider: "anthropic", name: "Claude Haiku 4.5", family: "Claude 4.5",
    inputPerM: 1, outputPerM: 5, contextWindow: 200_000, maxOutput: 64_000,
    cutoff: "2025-02", released: "2025-10-01", reasoning: true, params: null, verified: false,
  },
  {
    id: "claude-3-5-haiku-20241022", provider: "anthropic", name: "Claude 3.5 Haiku", family: "Claude 3.5",
    inputPerM: 0.8, outputPerM: 4, contextWindow: 200_000, maxOutput: 8_192,
    cutoff: "2024-07", released: "2024-10-22", reasoning: false, params: null, verified: true,
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  {
    id: "gpt-6-astra", provider: "openai", name: "GPT-6 Astra", family: "GPT-6",
    inputPerM: 2.5, outputPerM: 15, contextWindow: 400_000, maxOutput: 128_000,
    cutoff: "2026", released: "2026", reasoning: true, params: null, verified: false,
    note: "Listed on your account by the API; pricing is a placeholder until confirmed.",
  },
  {
    id: "gpt-5.1", provider: "openai", name: "GPT-5.1", family: "GPT-5",
    inputPerM: 1.25, outputPerM: 10, contextWindow: 400_000, maxOutput: 128_000,
    cutoff: "2025", released: "2025", reasoning: true, params: null, verified: false,
  },
  {
    id: "gpt-5", provider: "openai", name: "GPT-5", family: "GPT-5",
    inputPerM: 1.25, outputPerM: 10, contextWindow: 400_000, maxOutput: 128_000,
    cutoff: "2024-09", released: "2025", reasoning: true, params: null, verified: false,
  },
  {
    id: "gpt-5-mini", provider: "openai", name: "GPT-5 mini", family: "GPT-5",
    inputPerM: 0.25, outputPerM: 2, contextWindow: 400_000, maxOutput: 128_000,
    cutoff: "2024-09", released: "2025", reasoning: true, params: null, verified: false,
  },
  {
    id: "gpt-4.1", provider: "openai", name: "GPT-4.1", family: "GPT-4.1",
    inputPerM: 2, outputPerM: 8, contextWindow: 1_047_576, maxOutput: 32_768,
    cutoff: "2024-06", released: "2025-04-14", reasoning: false, params: null, verified: true,
  },
  {
    id: "gpt-4o", provider: "openai", name: "GPT-4o", family: "GPT-4o",
    inputPerM: 2.5, outputPerM: 10, contextWindow: 128_000, maxOutput: 16_384,
    cutoff: "2023-10", released: "2024-05-13", reasoning: false, params: null, verified: true,
  },

  // ── Google ─────────────────────────────────────────────────────────────────
  {
    id: "gemini-3-pro-preview", provider: "google", name: "Gemini 3 Pro", family: "Gemini 3",
    inputPerM: 2, outputPerM: 12, contextWindow: 1_000_000, maxOutput: 64_000,
    cutoff: "2025", released: "2025", reasoning: true, params: null, verified: false,
  },
  {
    id: "gemini-2.5-pro", provider: "google", name: "Gemini 2.5 Pro", family: "Gemini 2.5",
    inputPerM: 1.25, outputPerM: 10, contextWindow: 1_048_576, maxOutput: 65_536,
    cutoff: "2025-01", released: "2025-06", reasoning: true, params: null, verified: false,
  },
  {
    id: "gemini-2.5-flash", provider: "google", name: "Gemini 2.5 Flash", family: "Gemini 2.5",
    inputPerM: 0.3, outputPerM: 2.5, contextWindow: 1_048_576, maxOutput: 65_536,
    cutoff: "2025-01", released: "2025-06", reasoning: true, params: null, verified: false,
  },

  // ── xAI ────────────────────────────────────────────────────────────────────
  {
    id: "grok-4", provider: "xai", name: "Grok 4", family: "Grok 4",
    inputPerM: 3, outputPerM: 15, contextWindow: 256_000, maxOutput: 32_000,
    cutoff: "2024-11", released: "2025-07", reasoning: true, params: null, verified: false,
  },
  {
    id: "grok-3", provider: "xai", name: "Grok 3", family: "Grok 3",
    inputPerM: 3, outputPerM: 15, contextWindow: 131_072, maxOutput: 32_000,
    cutoff: "2024-11", released: "2025-02", reasoning: false, params: null, verified: false,
  },

  // ── Generic OpenAI-compatible (OpenRouter, Together, Ollama, LM Studio…) ────
  {
    id: "compat:custom", provider: "compat", name: "Custom endpoint", family: "OpenAI-compatible",
    inputPerM: 0, outputPerM: 0, contextWindow: 128_000, maxOutput: 8_192,
    cutoff: "—", released: "—", reasoning: false, params: null, verified: false,
    note: "Set COMPAT_BASE_URL + COMPAT_API_KEY, then type the model name in the loadout.",
  },

  // ── Keyless simulator: exercises the whole channel — gating, tap, cost meter,
  //    interceptor, voice — with zero API spend. Useful for demos and for testing
  //    a scenario's shape before you burn real tokens.
  {
    id: "sim:dummy", provider: "sim", name: "SIM · Dummy", family: "Local simulator",
    inputPerM: 3, outputPerM: 15, contextWindow: 32_000, maxOutput: 2_048,
    cutoff: "—", released: "—", reasoning: false, params: null, verified: true,
    note: "No API key required. Generates plausible filler so you can rehearse a match for free.",
  },
];

export const byId = (id: string) => MODELS.find((m) => m.id === id);
export const providerOf = (id: string) => PROVIDERS[byId(id)?.provider ?? "compat"];
