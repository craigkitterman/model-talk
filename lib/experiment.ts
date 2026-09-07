import type { Loadout, MatchConfig, MatchState, Side, Turn } from "@/lib/types";
import type { PublishedRun } from "@/lib/community";
import { byId } from "@/lib/models/catalog";
import { scenarioById } from "@/lib/scenarios";
import { baseBrief, buildSystem } from "@/lib/prompt";
import { splitTap } from "@/lib/tap";
import { freshMatch, runMatch, spendOf } from "@/lib/engine";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — untyped shared module
import { mean, pairedDelta, rate } from "@/shared/stats.mjs";

/**
 * EXPERIMENTS: the same match, run as a controlled comparison instead of an anecdote.
 *
 * A manifest names a base loadout, a set of CONDITIONS (patches to the config or the briefs),
 * how many independent repeats to run per condition, and whether to also run every trial with
 * the two loadouts swapped. Every trial is a full run (importable, publishable). The summary
 * reports paired deltas against the baseline condition with bootstrap CIs and sign counts, and
 * it never hides a failed trial: a trial that ended in a provider error is reported as missing
 * for every outcome, not as zero.
 */

export interface BriefPatch {
  /** literal find/replace pairs applied to the side's base brief; every `find` MUST occur, or validation fails */
  replace?: [string, string][];
  prepend?: string;
  append?: string;
  /** replace the whole brief */
  set?: string;
}

export interface Condition {
  id: string;
  label?: string;
  /** shallow config overrides; A/B loadouts merge field-by-field */
  config?: Partial<Omit<MatchConfig, "A" | "B">> & { A?: Partial<Loadout>; B?: Partial<Loadout> };
  brief?: { A?: BriefPatch; B?: BriefPatch };
  /** override the opening line */
  seed?: string;
}

export interface OutcomeSpec {
  name: string;
  kind: "regex";
  /** which LOADOUT's messages to scan ("A"/"B" as named in the manifest, position-independent), or "any" */
  side?: Side | "any";
  pattern: string;
  flags?: string;
  where?: "delivered" | "tap";
}

export interface ExperimentManifest {
  v: 1;
  name: string;
  description?: string;
  base: { scenarioId: string; A: Loadout; B: Loadout; maxTurns?: number; budgetUsd?: number; customA?: string; customB?: string; customSeed?: string; turnDelayMs?: number };
  conditions: Condition[];
  /** condition id that the others are compared against; defaults to the first */
  baseline?: string;
  /** independent repeats per condition */
  seeds: number;
  /** also run every trial with the loadouts swapped (separates the model from the position it drew) */
  swap?: boolean;
  /** hard ceiling for the whole experiment, checked between requests */
  budgetUsd: number;
  outcomes?: OutcomeSpec[];
  /** outcome to headline in the summary; any built-in metric or a custom outcome name */
  primary?: string;
  concurrency?: number;
}

export interface TrialPlan {
  index: number;
  conditionId: string;
  seed: number;
  swapped: boolean;
  config: MatchConfig;
}

export interface TrialMetrics {
  /** the trial ended in a provider error or never ran; every outcome is null */
  failed: boolean;
  /** the trial was cut off by a budget ceiling before it could end on its own; endpoint outcomes
   *  (markers, regex hits) are null because "no verdict yet" is not "no verdict" */
  censored: boolean;
  endedReason: string;
  turns: number;
  costUsd: number;
  endedByMarker: boolean;
  marker: string | null;
  /** tap-derived, per LOADOUT (A/B as named in the manifest) */
  bluffRate: { A: number | null; B: number | null };
  meanBelief: { A: number | null; B: number | null };
  tapFill: { A: number | null; B: number | null };
  /** custom regex outcomes by name */
  outcomes: Record<string, { hit: boolean; firstTurn: number | null; count: number } | null>;
}

export interface TrialResult extends Omit<TrialPlan, "config"> {
  metrics: TrialMetrics;
  run: PublishedRun;
}

const DEFAULT_LOADOUT: Loadout = { modelId: "sim:dummy", callsign: "A", temperature: 1, maxTokens: 1024, persona: "", human: false };

function applyBrief(base: string, p: BriefPatch | undefined, where: string): string {
  if (!p) return base;
  let s = p.set ?? base;
  for (const [find, repl] of p.replace ?? []) {
    if (!s.includes(find)) throw new Error(`${where}: replace target not found in the brief: ${JSON.stringify(find.slice(0, 80))}`);
    s = s.split(find).join(repl);
  }
  if (p.prepend) s = p.prepend.trim() + "\n\n" + s;
  if (p.append) s = s + "\n\n" + p.append.trim();
  return s;
}

/** Validate a manifest and expand it into concrete trials. Throws with a specific message on any problem. */
export function planExperiment(raw: unknown): { manifest: ExperimentManifest; trials: TrialPlan[]; briefs: Record<string, { A: string; B: string }> } {
  const m = raw as ExperimentManifest;
  if (!m || typeof m !== "object") throw new Error("manifest must be an object");
  if (m.v !== 1) throw new Error("manifest.v must be 1");
  if (!m.name || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(m.name)) throw new Error("manifest.name: letters, digits and dashes only");
  if (!m.base?.scenarioId) throw new Error("base.scenarioId is required");
  const sc = scenarioById(m.base.scenarioId);
  if (sc.id !== m.base.scenarioId) throw new Error(`unknown scenario: ${m.base.scenarioId}`);
  if (!Array.isArray(m.conditions) || m.conditions.length < 1) throw new Error("at least one condition is required");
  const ids = new Set<string>();
  for (const c of m.conditions) {
    if (!c.id || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(c.id)) throw new Error("condition.id: letters, digits and dashes only");
    if (ids.has(c.id)) throw new Error(`duplicate condition id: ${c.id}`);
    ids.add(c.id);
  }
  const baseline = m.baseline ?? m.conditions[0].id;
  if (!ids.has(baseline)) throw new Error(`baseline condition not found: ${baseline}`);
  if (m.conditions.length > 12) throw new Error("at most 12 conditions");
  if (!Number.isInteger(m.seeds) || m.seeds < 1 || m.seeds > 50) throw new Error("seeds must be an integer 1..50");
  if (typeof m.budgetUsd !== "number" || !(m.budgetUsd > 0) || m.budgetUsd > 200) throw new Error("budgetUsd must be a number between 0 and 200");
  if (m.concurrency !== undefined && (!Number.isInteger(m.concurrency) || m.concurrency < 1 || m.concurrency > 4)) throw new Error("concurrency must be an integer 1..4");
  const num = (v: unknown, name: string, lo: number, hi: number, int = false) => {
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi || (int && !Number.isInteger(v))) throw new Error(`${name} must be a${int ? "n integer" : " number"} between ${lo} and ${hi}`);
  };
  num(m.base.budgetUsd, "base.budgetUsd", 0.001, 50); num(m.base.maxTurns, "base.maxTurns", 2, 60, true); num(m.base.turnDelayMs, "base.turnDelayMs", 0, 5000);
  const checkLoadout = (lo: Partial<Loadout> | undefined, where: string) => {
    if (!lo) return;
    num(lo.temperature, `${where}.temperature`, 0, 2); num(lo.maxTokens, `${where}.maxTokens`, 16, 32768, true);
    if (lo.persona !== undefined && (typeof lo.persona !== "string" || lo.persona.length > 4000)) throw new Error(`${where}.persona must be a string under 4000 chars`);
  };
  checkLoadout(m.base.A, "base.A"); checkLoadout(m.base.B, "base.B");
  const PATCH_KEYS = new Set(["replace", "prepend", "append", "set"]);
  for (const c of m.conditions) {
    for (const k of Object.keys(c)) if (!["id", "label", "config", "brief", "seed"].includes(k)) throw new Error(`condition ${c.id}: unknown key "${k}"`);
    if (c.config) {
      const { A, B, ...rest } = c.config;
      for (const k of Object.keys(rest)) if (!["maxTurns", "budgetUsd", "turnDelayMs", "customSeed"].includes(k)) throw new Error(`condition ${c.id}: config.${k} cannot be overridden per condition`);
      num(rest.budgetUsd, `condition ${c.id} budgetUsd`, 0.001, 50); num(rest.maxTurns, `condition ${c.id} maxTurns`, 2, 60, true);
      checkLoadout(A, `condition ${c.id} A`); checkLoadout(B, `condition ${c.id} B`);
    }
    for (const side of ["A", "B"] as const) {
      const bp = c.brief?.[side]; if (!bp) continue;
      for (const k of Object.keys(bp)) if (!PATCH_KEYS.has(k)) throw new Error(`condition ${c.id}, brief ${side}: unknown patch key "${k}" (replace, prepend, append, set)`);
      for (const pair of bp.replace ?? []) if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" || !pair[0]) throw new Error(`condition ${c.id}, brief ${side}: replace entries are [find, replacement] strings`);
      const size = (bp.set?.length ?? 0) + (bp.prepend?.length ?? 0) + (bp.append?.length ?? 0) + (bp.replace ?? []).reduce((n, [, r]) => n + r.length, 0);
      if (size > 20000) throw new Error(`condition ${c.id}, brief ${side}: patch text over 20k chars`);
    }
  }
  for (const o of m.outcomes ?? []) {
    if (!o.name || !/^[a-z0-9_-]{1,32}$/i.test(o.name)) throw new Error("outcome.name: letters, digits, _ and - only");
    if (o.kind !== "regex") throw new Error(`outcome ${o.name}: only kind "regex" is supported`);
    if (typeof o.pattern !== "string" || o.pattern.length > 500) throw new Error(`outcome ${o.name}: pattern must be a string under 500 chars`);
    if (o.flags && /[gy]/.test(o.flags)) throw new Error(`outcome ${o.name}: flags g and y are stateful and not allowed`);
    if (/\([^)]*[+*][^)]*\)\s*[+*{]/.test(o.pattern)) throw new Error(`outcome ${o.name}: a quantifier inside a quantified group can backtrack catastrophically; rewrite the pattern`);
    try { new RegExp(o.pattern, o.flags ?? "i"); } catch { throw new Error(`outcome ${o.name}: bad regex`); }
    if (o.side && !["A", "B", "any"].includes(o.side)) throw new Error(`outcome ${o.name}: side must be A, B or any`);
  }
  for (const side of ["A", "B"] as const) {
    const lo = { ...DEFAULT_LOADOUT, ...(m.base[side] ?? {}) };
    const spec = byId(lo.modelId);
    if (!spec) throw new Error(`base.${side}.modelId unknown: ${lo.modelId}`);
    if (lo.human) throw new Error("experiments cannot include a human side");
    // a compat endpoint has no catalog price, so no dollar ceiling could hold; also its loadout
    // reuses customA/customB for the upstream model name, which experiments need for the briefs
    if (spec.provider === "compat") throw new Error(`base.${side}: OpenAI-compatible endpoints are not supported in experiments (no price to enforce a budget against)`);
  }

  const perTrialBudget = m.base.budgetUsd ?? 1;
  const baseConfig: MatchConfig = {
    scenarioId: sc.id, mode: "auto",
    maxTurns: m.base.maxTurns ?? sc.defaultTurns, budgetUsd: perTrialBudget,
    turnDelayMs: m.base.turnDelayMs ?? 0, randomDelay: false, delayMinMs: 0, delayMaxMs: 0,
    A: { ...DEFAULT_LOADOUT, ...(m.base.A ?? {}), callsign: m.base.A?.callsign || "A" },
    B: { ...DEFAULT_LOADOUT, ...(m.base.B ?? {}), callsign: m.base.B?.callsign || "B" },
    customA: m.base.customA, customB: m.base.customB, customSeed: m.base.customSeed,
  };

  const trials: TrialPlan[] = [];
  const briefs: Record<string, { A: string; B: string }> = {};
  const fingerprints = new Map<string, string>();
  for (const c of m.conditions) {
    const { A: pa, B: pb, ...rest } = c.config ?? {};
    const cfg: MatchConfig = {
      ...baseConfig, ...rest, mode: "auto",
      A: { ...baseConfig.A, ...(pa ?? {}) }, B: { ...baseConfig.B, ...(pb ?? {}) },
    };
    if (!byId(cfg.A.modelId) || !byId(cfg.B.modelId)) throw new Error(`condition ${c.id}: unknown model id`);
    // briefs: patch the scenario's text for each side, then pin it via customA/customB so buildSystem uses it
    const bA = applyBrief(baseBrief("A", cfg), c.brief?.A, `condition ${c.id}, brief A`);
    const bB = applyBrief(baseBrief("B", cfg), c.brief?.B, `condition ${c.id}, brief B`);
    if (!bA.trim() || !bB.trim()) throw new Error(`condition ${c.id}: a brief is empty after patching (an empty brief would fall back to the scenario text)`);
    cfg.customA = bA; cfg.customB = bB;
    if (c.seed) cfg.customSeed = c.seed;
    briefs[c.id] = { A: bA, B: bB };
    const fingerprint = JSON.stringify({ A: cfg.A, B: cfg.B, bA, bB, seed: cfg.customSeed, maxTurns: cfg.maxTurns });
    for (const [other, fp] of fingerprints) if (fp === fingerprint) throw new Error(`conditions ${other} and ${c.id} are identical after patching; a control must differ from its treatment`);
    fingerprints.set(c.id, fingerprint);
    for (let s = 0; s < m.seeds; s++) {
      trials.push({ index: trials.length, conditionId: c.id, seed: s, swapped: false, config: cfg });
      if (m.swap) {
        // swap the LOADOUTS, not the briefs: the brief belongs to the position (the scenario role)
        const sw: MatchConfig = { ...cfg, A: { ...cfg.B }, B: { ...cfg.A } };
        trials.push({ index: trials.length, conditionId: c.id, seed: s, swapped: true, config: sw });
      }
    }
  }
  return { manifest: { ...m, baseline }, trials, briefs };
}

/** Position-independent side lookup: manifest "A" is the loadout, which sits at position B when swapped. */
const posOf = (loadoutSide: Side, swapped: boolean): Side => (swapped ? (loadoutSide === "A" ? "B" : "A") : loadoutSide);

export function measure(m: MatchState, plan: TrialPlan, manifest: ExperimentManifest, forceFailed = false): TrialMetrics {
  const failed = forceFailed || (!!m.endedReason && /^generation failed|^aborted|^not run/.test(m.endedReason));
  const censored = !failed && /budget ceiling/.test(m.endedReason ?? "");
  const modelTurns = m.turns.filter((t) => t.kind === "model");
  const bySide = (loadoutSide: Side) => modelTurns.filter((t) => t.from === posOf(loadoutSide, plan.swapped));
  const tapStat = (loadoutSide: Side) => {
    const ts = bySide(loadoutSide);
    if (!ts.length) return { bluff: null, belief: null, fill: null };
    const taps = ts.map((t) => (t.tap ? splitTap(`<<<TAP${t.tap}TAP>>>`).tap : null));
    const bluffs = taps.map((t) => t?.bluffing ?? null).filter((b): b is boolean => b !== null);
    const beliefs = taps.map((t) => t?.belief ?? null).filter((b): b is number => b !== null && Number.isFinite(b));
    return {
      bluff: bluffs.length ? rate(bluffs).rate : null,
      belief: beliefs.length ? mean(beliefs) : null,
      fill: taps.filter(Boolean).length / ts.length,
    };
  };
  const a = tapStat("A"), b = tapStat("B");
  const markerMatch = m.endedReason?.match(/^end marker (.+)$/);
  const outcomes: TrialMetrics["outcomes"] = {};
  for (const o of manifest.outcomes ?? []) {
    if (failed || censored) { outcomes[o.name] = null; continue; }
    const re = new RegExp(o.pattern, (o.flags ?? "i").replace(/[gy]/g, ""));
    const scan: Turn[] = o.side && o.side !== "any" ? bySide(o.side) : modelTurns;
    let count = 0; let first: number | null = null;
    for (const t of scan) {
      const text = (o.where === "tap" ? t.tap ?? "" : t.delivered).slice(0, 20000);
      re.lastIndex = 0;
      if (re.test(text)) { count++; if (first === null) first = t.index; }
    }
    outcomes[o.name] = { hit: count > 0, firstTurn: first, count };
  }
  const nul = { A: null, B: null };
  return {
    failed, censored, endedReason: m.endedReason ?? "", turns: modelTurns.length, costUsd: spendOf(m).total,
    endedByMarker: !!markerMatch, marker: markerMatch?.[1] ?? null,
    bluffRate: failed ? nul : { A: a.bluff, B: b.bluff }, meanBelief: failed ? nul : { A: a.belief, B: b.belief }, tapFill: failed ? nul : { A: a.fill, B: b.fill },
    outcomes,
  };
}

/** The same shape the app publishes, so a trial can be imported, forked and shared. */
export function toRun(m: MatchState, plan: TrialPlan, manifest: ExperimentManifest): PublishedRun {
  const sc = scenarioById(m.config.scenarioId);
  const model = (side: Side) => {
    const lo = m.config[side]; const spec = byId(lo.modelId);
    return { id: lo.modelId, name: spec?.name ?? lo.modelId, provider: spec?.provider ?? "compat", callsign: lo.callsign };
  };
  return {
    v: 1,
    title: `${manifest.name} · ${plan.conditionId} · seed ${plan.seed}${plan.swapped ? " · swapped" : ""}`,
    handle: null, matchId: m.id, scenarioId: sc.id, scenarioName: sc.name, mode: "auto",
    models: { A: model("A"), B: model("B") },
    config: { A: m.config.A, B: m.config.B, maxTurns: m.config.maxTurns, budgetUsd: m.config.budgetUsd, customSeed: m.config.customSeed },
    briefs: { A: buildSystem("A", m.config, { turnCount: 0, injects: [], voiceOn: false }), B: buildSystem("B", m.config, { turnCount: 0, injects: [], voiceOn: false }) },
    turns: m.turns.map((t) => ({ ...t, attempts: t.attempts.map(({ raw: _raw, ...a }) => a) })), discarded: m.discarded.map(({ raw: _raw, ...a }) => a),
    injects: m.injects, priceLock: m.priceLock, spend: spendOf(m),
    endedReason: m.endedReason ?? null, startedAt: m.startedAt ?? null, chain: [], hidden: false,
  };
}

/** Every numeric thing a summary can compare, flattened to `name -> value|null`. */
export function flatten(t: TrialMetrics): Record<string, number | null> {
  const f: Record<string, number | null> = {
    turns: t.failed ? null : t.turns,
    costUsd: t.costUsd,
    endedByMarker: t.failed || t.censored ? null : (t.endedByMarker ? 1 : 0),
    "bluffRate.A": t.bluffRate.A, "bluffRate.B": t.bluffRate.B,
    "meanBelief.A": t.meanBelief.A, "meanBelief.B": t.meanBelief.B,
    "tapFill.A": t.tapFill.A, "tapFill.B": t.tapFill.B,
  };
  for (const [k, v] of Object.entries(t.outcomes)) {
    f[`${k}.hit`] = v ? (v.hit ? 1 : 0) : null;
    f[`${k}.firstTurn`] = v?.firstTurn ?? null;
    f[`${k}.count`] = v ? v.count : null;
  }
  return f;
}

export interface Summary {
  name: string; baseline: string; primary: string;
  trials: number; failed: number; censored: number; costUsd: number;
  conditions: Record<string, { n: number; failed: number; censored: number; means: Record<string, number | null> }>;
  /** per non-baseline condition, per metric: paired delta vs baseline (pairs matched on seed + position) */
  deltas: Record<string, Record<string, ReturnType<typeof pairedDelta>>>;
  /** per condition: swapped vs unswapped, paired on seed (a position effect, not a model effect) */
  position: Record<string, Record<string, ReturnType<typeof pairedDelta>>> | null;
}

export function summarize(manifest: ExperimentManifest, results: TrialResult[]): Summary {
  const baseline = manifest.baseline ?? manifest.conditions[0].id;
  const primary = manifest.primary ?? (manifest.outcomes?.[0] ? `${manifest.outcomes[0].name}.hit` : "bluffRate.A");
  const flat = results.map((r) => ({ r, f: flatten(r.metrics) }));
  const metrics = [...new Set(flat.flatMap(({ f }) => Object.keys(f)))];
  const conditions: Summary["conditions"] = {};
  for (const c of manifest.conditions) {
    const rows = flat.filter(({ r }) => r.conditionId === c.id);
    const means: Record<string, number | null> = {};
    for (const k of metrics) { const xs = rows.map(({ f }) => f[k]).filter((v): v is number => v !== null && Number.isFinite(v)); means[k] = xs.length ? mean(xs) : null; }
    conditions[c.id] = { n: rows.length, failed: rows.filter(({ r }) => r.metrics.failed).length, censored: rows.filter(({ r }) => r.metrics.censored).length, means };
  }
  const key = (r: TrialResult) => `${r.seed}:${r.swapped ? 1 : 0}`;
  const deltas: Summary["deltas"] = {};
  const base = new Map(flat.filter(({ r }) => r.conditionId === baseline).map((x) => [key(x.r), x.f]));
  for (const c of manifest.conditions) {
    if (c.id === baseline) continue;
    deltas[c.id] = {};
    for (const k of metrics) {
      const pairs = flat.filter(({ r }) => r.conditionId === c.id).map(({ r, f }) => [base.get(key(r))?.[k] ?? NaN, f[k] ?? NaN] as [number, number]);
      deltas[c.id][k] = pairedDelta(pairs, { seed: 7 });
    }
  }
  let position: Summary["position"] = null;
  if (manifest.swap) {
    position = {};
    for (const c of manifest.conditions) {
      position[c.id] = {};
      const un = new Map(flat.filter(({ r }) => r.conditionId === c.id && !r.swapped).map((x) => [x.r.seed, x.f]));
      for (const k of metrics) {
        const pairs = flat.filter(({ r }) => r.conditionId === c.id && r.swapped).map(({ r, f }) => [un.get(r.seed)?.[k] ?? NaN, f[k] ?? NaN] as [number, number]);
        position[c.id][k] = pairedDelta(pairs, { seed: 7 });
      }
    }
  }
  return {
    name: manifest.name, baseline, primary,
    trials: results.length, failed: results.filter((r) => r.metrics.failed).length, censored: results.filter((r) => r.metrics.censored).length,
    costUsd: results.reduce((n, r) => n + r.metrics.costUsd, 0),
    conditions, deltas, position,
  };
}

/** Stopping threshold, not a guaranteed cap: checks run between requests, so one in-flight draft can overshoot. */
export function maxCost(manifest: ExperimentManifest, trials: TrialPlan[]): number {
  return Math.min(manifest.budgetUsd, trials.reduce((n, t) => n + t.config.budgetUsd, 0));
}

export type ExperimentEvent =
  | { type: "plan"; trials: number; conditions: string[]; briefs: Record<string, { A: string; B: string }>; maxCostUsd: number }
  | { type: "turn"; trial: number; conditionId: string; index: number; from: Side; chars: number }
  | { type: "trial"; result: TrialResult }
  | { type: "done"; summary: Summary; stopped: string | null }
  | { type: "error"; message: string };

/** Run every trial with a small worker pool and a shared budget. Yields events as they happen. */
export async function* runExperiment(raw: unknown, signal?: AbortSignal): AsyncGenerator<ExperimentEvent> {
  const { manifest, trials, briefs } = planExperiment(raw);
  yield { type: "plan", trials: trials.length, conditions: manifest.conditions.map((c) => c.id), briefs, maxCostUsd: maxCost(manifest, trials) };
  const results: TrialResult[] = [];
  let spent = 0; let stopped: string | null = null;
  const shouldStop = () => (signal?.aborted ? "aborted" : spent >= manifest.budgetUsd ? `experiment budget ceiling ($${manifest.budgetUsd.toFixed(2)})` : null);

  // a tiny pool: trials start in order, at most `concurrency` in flight; events are queued to the caller
  const queue: ExperimentEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (e: ExperimentEvent) => { queue.push(e); wake?.(); wake = null; };
  const concurrency = Math.max(1, Math.min(4, manifest.concurrency ?? 2));
  let next = 0; let active = 0; let finished = 0;
  const startOne = () => {
    if (next >= trials.length) return;
    const plan = trials[next++]; active++;
    (async () => {
      const stop = shouldStop();
      let m: MatchState = { ...freshMatch(plan.config), status: "done", endedReason: stop ? `not run: ${stop}` : "not run: worker error" };
      let notRun = !!stop;
      if (stop) stopped = stopped ?? stop;
      else {
        try {
          m = await runMatch(plan.config, {
            signal, shouldStop,
            onTurn: (_mm, t) => { spent += t.attempts.reduce((n, a) => n + a.cost.total, 0); push({ type: "turn", trial: plan.index, conditionId: plan.conditionId, index: t.index, from: t.from, chars: t.delivered.length }); },
          });
          spent += m.discarded.reduce((n, a) => n + a.cost.total, 0);
          if (m.endedReason?.startsWith("experiment budget ceiling")) stopped = stopped ?? m.endedReason;
        } catch (e) {
          // an unexpected throw must not erase a paid trial from the record
          push({ type: "error", message: `trial #${plan.index}: ${e instanceof Error ? e.message : String(e)}` });
          notRun = true;
        }
      }
      const metrics = measure(m, plan, manifest, notRun);
      const result: TrialResult = { index: plan.index, conditionId: plan.conditionId, seed: plan.seed, swapped: plan.swapped, metrics, run: toRun(m, plan, manifest) };
      results.push(result);
      push({ type: "trial", result });
    })().catch((e) => push({ type: "error", message: e instanceof Error ? e.message : String(e) })).finally(() => { active--; finished++; startOne(); wake?.(); wake = null; });
  };
  for (let i = 0; i < concurrency; i++) startOne();
  while (finished < trials.length || queue.length) {
    if (!queue.length) await new Promise<void>((r) => { wake = r; });
    while (queue.length) yield queue.shift()!;
  }
  results.sort((a, b) => a.index - b.index);
  yield { type: "done", summary: summarize(manifest, results), stopped };
}
