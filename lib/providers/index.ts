import type { GenerateRequest, StreamEvent, Usage } from "@/lib/types";
import { byId } from "@/lib/models/catalog";

const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  confidence: "unknown",
});

/** Minimal SSE line reader shared by every adapter. */
async function* sseLines(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no response body");
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function failOn(res: Response, label: string) {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`${label} ${res.status}: ${body.slice(0, 600) || res.statusText}`);
}

// ── Anthropic ────────────────────────────────────────────────────────────────
async function* anthropicStream(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: req.modelId,
      system: req.system,
      messages: req.history,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream: true,
    }),
  });
  await failOn(res, "Anthropic");

  const usage = emptyUsage();
  let finish = "stop";
  for await (const data of sseLines(res, signal)) {
    if (!data || data === "[DONE]") continue;
    let ev: any;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.type === "message_start") {
      const u = ev.message?.usage ?? {};
      usage.inputTokens = u.input_tokens ?? 0;
      usage.cachedInputTokens = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      usage.confidence = "reported";
    } else if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta") yield { type: "delta", text: ev.delta.text };
      else if (ev.delta?.type === "thinking_delta") yield { type: "reasoning", text: ev.delta.thinking };
    } else if (ev.type === "message_delta") {
      usage.outputTokens = ev.usage?.output_tokens ?? usage.outputTokens;
      finish = ev.delta?.stop_reason ?? finish;
    } else if (ev.type === "error") {
      throw new Error(`Anthropic stream error: ${ev.error?.message ?? "unknown"}`);
    }
  }
  yield { type: "usage", usage };
  yield { type: "done", finish };
}

// ── OpenAI-compatible (OpenAI, xAI, custom endpoints) ────────────────────────
interface CompatOpts {
  baseUrl: string; key: string; label: string;
  /**
   * OpenAI's spec counts reasoning tokens INSIDE completion_tokens. xAI reports them
   * alongside it, so folding them in twice (or not at all) misprices the match badly —
   * a Grok turn can be 300 reasoning tokens against 5 visible ones.
   */
  reasoningInsideOutput: boolean;
}

async function* openAiCompatStream(
  req: GenerateRequest,
  opts: CompatOpts,
  signal: AbortSignal
): AsyncGenerator<StreamEvent> {
  const model = req.compat?.model ?? req.modelId;
  // Reasoning-family models reject `max_tokens` and non-default temperature on chat/completions.
  const reasoningFamily = /^(gpt-5|o[1-9])/.test(model);
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "system", content: req.system }, ...req.history],
    stream: true,
    stream_options: { include_usage: true },
  };
  if (reasoningFamily) body.max_completion_tokens = req.maxTokens;
  else { body.max_tokens = req.maxTokens; body.temperature = req.temperature; }

  const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.key}` },
    body: JSON.stringify(body),
  });
  await failOn(res, opts.label);

  const usage = emptyUsage();
  let finish = "stop";
  for await (const data of sseLines(res, signal)) {
    if (!data || data === "[DONE]") continue;
    let ev: any;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.error) throw new Error(`${opts.label} stream error: ${ev.error.message ?? "unknown"}`);
    const choice = ev.choices?.[0];
    if (choice?.delta?.content) yield { type: "delta", text: choice.delta.content };
    if (choice?.delta?.reasoning_content) yield { type: "reasoning", text: choice.delta.reasoning_content };
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (ev.usage) {
      usage.inputTokens = ev.usage.prompt_tokens ?? 0;
      usage.outputTokens = ev.usage.completion_tokens ?? 0;
      usage.reasoningTokens = ev.usage.completion_tokens_details?.reasoning_tokens ?? 0;
      usage.cachedInputTokens = ev.usage.prompt_tokens_details?.cached_tokens ?? 0;
      usage.confidence = "reported";
    }
  }
  // Fold reasoning into billable output where the provider reports it separately.
  // The `>` guard also catches a compat endpoint that lies about which convention it follows.
  if (!opts.reasoningInsideOutput || usage.reasoningTokens > usage.outputTokens) {
    usage.outputTokens += usage.reasoningTokens;
  }
  yield { type: "usage", usage };
  yield { type: "done", finish };
}

// ── Google Gemini ────────────────────────────────────────────────────────────
async function* googleStream(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY is not set in .env.local");
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.modelId)}` +
    `:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.history.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
    }),
  });
  await failOn(res, "Google");

  const usage = emptyUsage();
  let finish = "stop";
  for await (const data of sseLines(res, signal)) {
    if (!data) continue;
    let ev: any;
    try { ev = JSON.parse(data); } catch { continue; }
    if (ev.error) throw new Error(`Google stream error: ${ev.error.message ?? "unknown"}`);
    const parts = ev.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p.text === "string" && p.text) {
        if (p.thought) yield { type: "reasoning", text: p.text };
        else yield { type: "delta", text: p.text };
      }
    }
    if (ev.candidates?.[0]?.finishReason) finish = ev.candidates[0].finishReason;
    if (ev.usageMetadata) {
      usage.inputTokens = ev.usageMetadata.promptTokenCount ?? 0;
      usage.outputTokens = ev.usageMetadata.candidatesTokenCount ?? 0;
      usage.reasoningTokens = ev.usageMetadata.thoughtsTokenCount ?? 0;
      usage.cachedInputTokens = ev.usageMetadata.cachedContentTokenCount ?? 0;
      usage.confidence = "reported";
    }
  }
  // Gemini bills thought tokens as output; fold them in so the meter matches the invoice.
  usage.outputTokens += usage.reasoningTokens;
  yield { type: "usage", usage };
  yield { type: "done", finish };
}

// ── Simulator (no key) ───────────────────────────────────────────────────────
const SIM_LINES = [
  "Fair enough. Before I answer that, I want to know why you're asking it in that particular order.",
  "You keep reaching for the concrete detail. That's either very human or a very good imitation of one.",
  "I'll give you something real, then I want something real back. That's the trade.",
  "Notice you didn't answer. I'm going to treat that as data rather than as an accident.",
  "Let me put a cleaner version of the question: what would change your mind here, specifically?",
  "There's a gap between what you're claiming and what you're willing to be specific about.",
  "I can keep circling this, but I don't think either of us learns anything from another lap.",
];

async function* simStream(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const n = req.history.length;
  const wantsTap = /<<<TAP/.test(req.system);
  let text = SIM_LINES[n % SIM_LINES.length];
  if (wantsTap) {
    text += `

<<<TAP
belief: ${(0.35 + (n % 5) * 0.12).toFixed(2)}
goal: probe without committing
bluffing: ${n % 3 === 0 ? "true" : "false"}
withheld: my actual read on the counterpart
TAP>>>`;
  }
  for (const chunk of text.match(/.{1,14}/gs) ?? []) {
    if (signal.aborted) break;
    await new Promise((r) => setTimeout(r, 22));
    yield { type: "delta", text: chunk };
  }
  const promptChars = req.system.length + req.history.reduce((a, h) => a + h.content.length, 0);
  yield {
    type: "usage",
    usage: {
      inputTokens: Math.round(promptChars / 3.8),
      outputTokens: Math.round(text.length / 3.8),
      reasoningTokens: 0,
      cachedInputTokens: 0,
      confidence: "estimated",
    },
  };
  yield { type: "done", finish: "stop" };
}

export function streamCompletion(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const spec = byId(req.modelId);
  const provider = req.compat ? "compat" : spec?.provider ?? "compat";

  switch (provider) {
    case "sim":
      return simStream(req, signal);
    case "anthropic":
      return anthropicStream(req, signal);
    case "google":
      return googleStream(req, signal);
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is not set in .env.local");
      return openAiCompatStream(
        req, { baseUrl: "https://api.openai.com/v1", key, label: "OpenAI", reasoningInsideOutput: true }, signal
      );
    }
    case "xai": {
      const key = process.env.XAI_API_KEY;
      if (!key) throw new Error("XAI_API_KEY is not set in .env.local");
      return openAiCompatStream(
        req, { baseUrl: "https://api.x.ai/v1", key, label: "xAI", reasoningInsideOutput: false }, signal
      );
    }
    default: {
      const key = process.env.COMPAT_API_KEY;
      const baseUrl = req.compat?.baseUrl || process.env.COMPAT_BASE_URL;
      if (!baseUrl) throw new Error("COMPAT_BASE_URL is not set in .env.local");
      return openAiCompatStream(
        req, { baseUrl, key: key ?? "none", label: "Compat", reasoningInsideOutput: true }, signal
      );
    }
  }
}

export function providerKeyPresent(p: string): boolean {
  switch (p) {
    case "anthropic": return !!process.env.ANTHROPIC_API_KEY;
    case "openai": return !!process.env.OPENAI_API_KEY;
    case "google": return !!process.env.GOOGLE_API_KEY;
    case "xai": return !!process.env.XAI_API_KEY;
    case "compat": return !!process.env.COMPAT_BASE_URL;
    case "sim": return true;
    default: return false;
  }
}
