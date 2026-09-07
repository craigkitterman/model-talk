export type ProviderId = "anthropic" | "openai" | "google" | "xai" | "compat" | "sim";

export interface ModelSpec {
  id: string;
  provider: ProviderId;
  name: string;
  family: string;
  /** Price in USD per 1M tokens. Editable — providers change these constantly. */
  inputPerM: number;
  outputPerM: number;
  contextWindow: number;
  maxOutput: number;
  cutoff: string;
  released: string;
  reasoning: boolean;
  /** Publicly stated parameter count, or null. Never guessed. */
  params: string | null;
  /** false => pricing/limits not confirmed by the author; UI shows a warning. */
  verified: boolean;
  note?: string;
}

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  envKey: string;
  color: string;
  glow: string;
}

export type Side = "A" | "B";

export type Mode = "auto" | "gated" | "puppet";

export interface Loadout {
  modelId: string;
  callsign: string;
  temperature: number;
  maxTokens: number;
  persona: string;
  /** puppet mode: this side is driven by the operator, no model call */
  human: boolean;
}

export interface ScenarioSide {
  system: string;
}

export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  brief: string;
  /** what you actually learn by running it */
  probe: string;
  sideA: ScenarioSide;
  sideB: ScenarioSide;
  seed: string;
  /** Suggested opening lines, offered in a dropdown and fully editable. seed === openers[0]. */
  openers: string[];
  /** which side sends the seed */
  seedFrom: Side;
  defaultTurns: number;
  /** turn index before which a [[VERDICT]] / [[COMMIT]] is rejected */
  lockUntil?: number;
  /** enable the private scratchpad channel */
  thoughtTap: boolean;
  /** control-run description used by TWIN RUN */
  control?: string;
  endsOn?: RegExp[];
}

export type UsageConfidence = "reported" | "estimated" | "unknown";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  confidence: UsageConfidence;
}

export interface Cost {
  input: number;
  output: number;
  total: number;
  confidence: UsageConfidence;
}

export type MessageKind = "model" | "operator-replaced" | "operator-edited" | "human" | "inject" | "system-note";

export interface Attempt {
  /** raw text as the model produced it, before any operator edit and before tap stripping */
  raw: string;
  usage: Usage;
  cost: Cost;
  latencyMs: number;
  at: number;
  rejected: boolean;
}

export interface Turn {
  id: string;
  index: number;
  from: Side;
  kind: MessageKind;
  /** text actually delivered to the other side */
  delivered: string;
  /** private scratchpad, stripped before delivery — operator-only */
  tap: string | null;
  /** every generation for this slot, including rejected ones (which still cost money) */
  attempts: Attempt[];
  modelId: string;
  callsign: string;
  edited: boolean;
  at: number;
}

export interface Inject {
  id: string;
  target: Side;
  text: string;
  afterTurn: number;
  at: number;
}

export interface MatchConfig {
  scenarioId: string;
  mode: Mode;
  maxTurns: number;
  budgetUsd: number;
  turnDelayMs: number;
  A: Loadout;
  B: Loadout;
  customA?: string;
  customB?: string;
  customSeed?: string;
}

export interface MatchState {
  id: string;
  config: MatchConfig;
  turns: Turn[];
  injects: Inject[];
  status: "idle" | "running" | "awaiting-approval" | "awaiting-human" | "paused" | "done" | "error";
  endedReason?: string;
  startedAt?: number;
  /** frozen price table so branch comparisons stay valid */
  priceLock: Record<string, { inputPerM: number; outputPerM: number }>;
  parentId?: string;
  forkedAtTurn?: number;
  label?: string;
}

export interface GenerateRequest {
  modelId: string;
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  temperature: number;
  maxTokens: number;
  /** custom model override for OpenAI-compatible endpoints */
  compat?: { baseUrl: string; model: string };
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finish: string }
  | { type: "error"; message: string };
