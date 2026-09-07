import type { Attempt, MatchConfig, MatchState, Side, StreamEvent, Turn, Usage } from "@/lib/types";
import { byId } from "@/lib/models/catalog";
import { scenarioById } from "@/lib/scenarios";
import { buildSystem } from "@/lib/prompt";
import { splitTap } from "@/lib/tap";
import { computeCost, estimateUsage } from "@/lib/cost";
import { streamCompletion } from "@/lib/providers";

/**
 * Headless match runner: the AUTO-mode turn loop with no browser, no gating and no voice,
 * calling the provider adapters directly. The interactive loop in useMatch.ts stays the
 * source of truth for anything an operator can touch; this file mirrors its end conditions
 * (turn cap, budget, lock, end markers, endsOnBoth) so an experiment trial ends for the same
 * reasons a live match would. Keep the two in step when either changes.
 */

const uid = () => Math.random().toString(36).slice(2, 10);

function normalize(h: { role: "user" | "assistant"; content: string }[]) {
  const out: typeof h = [];
  for (const m of h) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else out.push({ ...m });
  }
  if (out.length && out[0].role === "assistant") out.unshift({ role: "user", content: "(channel open)" });
  return out;
}

const stripMarkers = (text: string) => text.replace(/\[\[[^\]]*\]\]/g, "").trim();

export function spendOf(m: Pick<MatchState, "turns" | "discarded">) {
  let a = 0, b = 0;
  for (const t of m.turns) for (const at of t.attempts) (t.from === "A" ? (a += at.cost.total) : (b += at.cost.total));
  const discarded = m.discarded.reduce((n, at) => n + at.cost.total, 0);
  return { a, b, discarded, total: a + b + discarded };
}

export interface RunOptions {
  signal?: AbortSignal;
  /** called after every committed turn, for progress reporting */
  onTurn?: (m: MatchState, t: Turn) => void;
  /** a between-request stop shared across trials (the experiment's total budget) */
  shouldStop?: () => string | null;
}

/** One draft for one side. Errors are returned, not thrown, so a trial records why it ended. */
async function generate(side: Side, m: MatchState, signal?: AbortSignal): Promise<{ attempt: Attempt; delivered: string; tap: string | null; error?: string }> {
  const lo = side === "A" ? m.config.A : m.config.B;
  const spec = byId(lo.modelId);
  const system = buildSystem(side, m.config, { turnCount: m.turns.length, injects: m.injects, voiceOn: false });
  const history = normalize(m.turns.map((t) => ({ role: (t.from === side ? "assistant" : "user") as "user" | "assistant", content: t.delivered })));
  const started = Date.now();
  let text = "";
  let usage: Usage | null = null;
  let finish: string | undefined;
  let err: string | undefined;
  try {
    const events: AsyncGenerator<StreamEvent> = streamCompletion(
      {
        modelId: lo.modelId, system, history, temperature: lo.temperature,
        maxTokens: spec?.reasoning ? Math.max(lo.maxTokens, 2048) : lo.maxTokens,
        compat: spec?.provider === "compat" ? { model: (side === "A" ? m.config.customA : m.config.customB) || "gpt-4o-mini" } : undefined,
      },
      signal ?? new AbortController().signal
    );
    let sawDone = false;
    for await (const ev of events) {
      if (ev.type === "delta") text += ev.text;
      else if (ev.type === "usage") usage = ev.usage;
      else if (ev.type === "done") { finish = ev.finish; sawDone = true; }
      else if (ev.type === "error") err = ev.message;
    }
    if (!sawDone && !err) err = "stream ended before the draft completed";
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const u = usage && usage.confidence !== "unknown" ? usage : estimateUsage(system.length + history.reduce((n, h) => n + h.content.length, 0), text.length);
  const attempt: Attempt = { raw: text, usage: u, cost: computeCost(u, m.priceLock[lo.modelId]), latencyMs: Date.now() - started, at: Date.now(), rejected: false, finish };
  const { delivered, tap } = splitTap(text);
  if (!err && finish === "refusal") err = "provider refused (stop_reason: refusal)";
  if (!err && !delivered) err = `empty message (finish: ${finish ?? "none"}, ${u.outputTokens} output tokens)`;
  // a truncated reply is still a reply: the interactive AUTO loop commits it (flagged), so do we
  return { attempt, delivered, tap: tap?.raw ?? null, error: err };
}

export function freshMatch(config: MatchConfig): MatchState {
  const priceLock: MatchState["priceLock"] = {};
  for (const id of [config.A.modelId, config.B.modelId]) {
    const spec = byId(id);
    if (spec) priceLock[id] = { inputPerM: spec.inputPerM, outputPerM: spec.outputPerM };
  }
  return { id: uid(), config: { ...config, mode: "auto" }, turns: [], injects: [], discarded: [], status: "idle", priceLock, chain: [] };
}

/** Run a whole match to its end. Never throws for a provider failure: the reason lands in endedReason. */
export async function runMatch(config: MatchConfig, opts: RunOptions = {}): Promise<MatchState> {
  const sc = scenarioById(config.scenarioId);
  let m = freshMatch(config);
  const markerIn = (text: string) => { for (const re of sc.endsOn ?? []) { const x = text.match(re); if (x) return x[0]; } return null; };
  const locked = () => !!sc.lockUntil && m.turns.length < sc.lockUntil;

  // seed (no cost, not a generation)
  const seedFrom = sc.seedFrom;
  const seedLo = seedFrom === "A" ? config.A : config.B;
  const seed: Turn = {
    id: uid(), index: 0, from: seedFrom, kind: "system-note", delivered: (config.customSeed || sc.seed).trim(), tap: null,
    attempts: [], modelId: seedLo.modelId, callsign: seedLo.callsign, edited: false, at: Date.now(),
  };
  m = { ...m, turns: [seed], startedAt: Date.now(), status: "running" };
  opts.onTurn?.(m, seed);

  const finish = (reason: string): MatchState => ({ ...m, status: "done", endedReason: reason });

  while (true) {
    if (opts.signal?.aborted) return finish("aborted");
    const stop = opts.shouldStop?.(); if (stop) return finish(stop);
    if (m.turns.length >= m.config.maxTurns) return finish(`turn cap (${m.config.maxTurns})`);
    if (spendOf(m).total >= m.config.budgetUsd) return finish(`budget ceiling ($${Number(m.config.budgetUsd).toFixed(2)}) — between-request stop`);

    const last = m.turns[m.turns.length - 1];
    const side: Side = last.from === "A" ? "B" : "A";
    const lo = side === "A" ? m.config.A : m.config.B;
    const g = await generate(side, m, opts.signal);
    if (g.error) {
      // the failed attempt still cost money and is kept, like a killed draft in the app
      m = { ...m, discarded: [...m.discarded, { ...g.attempt, rejected: true }] };
      return finish(`generation failed for ${side} (${lo.modelId}): ${g.error}`);
    }
    let delivered = g.delivered;
    if (locked() && markerIn(delivered)) delivered = stripMarkers(delivered);
    const turn: Turn = {
      id: uid(), index: m.turns.length, from: side, kind: "model", delivered, tap: g.tap,
      attempts: [g.attempt], modelId: lo.modelId, callsign: lo.callsign, edited: false, at: Date.now(),
    };
    m = { ...m, turns: [...m.turns, turn] };
    opts.onTurn?.(m, turn);

    // end markers, mirroring useMatch.endedBy
    if (!locked()) {
      const hit = markerIn(delivered);
      if (hit) {
        if (!sc.endsOnBoth) return finish(`end marker ${hit}`);
        const prev = m.turns[m.turns.length - 2];
        const prevHit = prev ? markerIn(prev.delivered) : null;
        if (prevHit) {
          const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
          const a = nums(hit), b = nums(prevHit);
          const agree = a.length === 2 && b.length === 2
            ? a[0] === b[1] && a[1] === b[0]
            : hit.replace(/\s+/g, "").toUpperCase() === prevHit.replace(/\s+/g, "").toUpperCase();
          if (agree) return finish(`end marker ${prevHit} then ${hit}`);
        }
      }
    }
    if (m.config.turnDelayMs > 0) await new Promise((r) => setTimeout(r, Math.min(m.config.turnDelayMs, 5000)));
  }
}
