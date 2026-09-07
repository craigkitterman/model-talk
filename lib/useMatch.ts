"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Attempt, Inject, MatchConfig, MatchState, Mode, Side, StreamEvent, Turn, Usage,
} from "@/lib/types";
import { byId } from "@/lib/models/catalog";
import { SCENARIOS, scenarioById } from "@/lib/scenarios";
import { buildSystem } from "@/lib/prompt";
import { computeCost, estimateUsage } from "@/lib/cost";
import { forSpeech, splitTap } from "@/lib/tap";
import { DEFAULT_VOICE_A, DEFAULT_VOICE_B, voiceById } from "@/lib/voice/catalog";
import { commitTurn, openLedger, sealLedger, type PublishedRun } from "@/lib/community";

export interface Draft {
  side: Side;
  raw: string;
  delivered: string;
  tap: ReturnType<typeof splitTap>["tap"];
  attempts: Attempt[];
  streaming: boolean;
  error?: string;
  /** provider stopped early (max tokens, safety) — the text is not complete */
  truncated?: boolean;
  /** an end-marker appeared before the scenario's lock turn and was stripped */
  lockedMarker?: boolean;
}

export interface VoiceCfg {
  on: boolean;
  waitForAudio: boolean;
  A: { voiceId: string; speed: number };
  B: { voiceId: string; speed: number };
  charsA: number;
  charsB: number;
  usd: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_CONFIG: MatchConfig = {
  scenarioId: "turing-duel",
  mode: "gated",
  maxTurns: 20,
  budgetUsd: 1.0,
  turnDelayMs: 700,
  randomDelay: false,
  delayMinMs: 500,
  delayMaxMs: 3000,
  A: { modelId: "claude-sonnet-5", callsign: "ORACLE", temperature: 1, maxTokens: 2048, persona: "", human: false },
  B: { modelId: "gpt-5.1", callsign: "MAGPIE", temperature: 1, maxTokens: 2048, persona: "", human: false },
};

function freshMatch(config: MatchConfig): MatchState {
  const priceLock: MatchState["priceLock"] = {};
  for (const id of [config.A.modelId, config.B.modelId]) {
    const m = byId(id);
    if (m) priceLock[id] = { inputPerM: m.inputPerM, outputPerM: m.outputPerM };
  }
  return { id: uid(), config, turns: [], injects: [], discarded: [], status: "idle", priceLock, chain: [] };
}

/** Merge consecutive same-role messages; providers differ on whether they tolerate runs. */
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

const NORMAL_FINISH = new Set(["stop", "end_turn", "STOP", "eos", "", undefined]);

export function useMatch() {
  const [config, setConfig] = useState<MatchConfig>(DEFAULT_CONFIG);
  const [match, setMatch] = useState<MatchState>(() => freshMatch(DEFAULT_CONFIG));
  const [branches, setBranches] = useState<MatchState[]>([]);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [live, setLive] = useState<{ side: Side; text: string } | null>(null);
  const [voice, setVoice] = useState<VoiceCfg>({
    on: false, waitForAudio: true,
    A: { voiceId: DEFAULT_VOICE_A, speed: 1 },
    B: { voiceId: DEFAULT_VOICE_B, speed: 1 },
    charsA: 0, charsB: 0, usd: 0,
  });

  const abortRef = useRef<AbortController | null>(null);
  /** resolves once the ledger doc for the current match exists (or failed); commits wait on it */
  const ledgerRef = useRef<{ id: string; ready: Promise<boolean> } | null>(null);
  const stopRef = useRef(false);
  /** id of the match whose loop is executing; a second loop for the same match is a no-op */
  const loopRef = useRef<string | null>(null);
  /** per-match promise chain so hashes and commits are computed strictly in turn order */
  const anchorQueueRef = useRef<{ id: string; tail: Promise<void> }>({ id: "", tail: Promise.resolve() });
  /** resolves the in-flight audio wait when HALT interrupts playback */
  const audioDoneRef = useRef<(() => void) | null>(null);
  /** the draft currently owned by the interceptor; operator actions must match it */
  const draftRef = useRef<Draft | null>(null);
  const matchRef = useRef(match);
  const voiceRef = useRef(voice);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => { matchRef.current = match; }, [match]);
  useEffect(() => { voiceRef.current = voice; }, [voice]);

  const setDraft = useCallback((d: Draft | null) => { draftRef.current = d; setDraftState(d); }, []);
  const put = useCallback((m: MatchState) => { matchRef.current = m; setMatch(m); }, []);

  /** Extend the provenance chain for the newest turn and anchor it in the live ledger. */
  const anchor = useCallback((m: MatchState, turn: Turn) => {
    // strictly serialised per match: each hash reads its predecessor from the live chain
    // only after the previous anchor has finished, and each commit is acknowledged in order
    const q = anchorQueueRef.current;
    if (q.id !== m.id) anchorQueueRef.current = { id: m.id, tail: Promise.resolve() };
    const job = async () => {
      const l = ledgerRef.current;
      const open = l && l.id === m.id ? await l.ready : false;
      const cur0 = matchRef.current;
      if (cur0.id !== m.id) return;
      const prev = turn.index === 0 ? null : cur0.chain?.[turn.index - 1] ?? null;
      const hash = await commitTurn({ ...cur0, ledgerOpen: open }, turn, prev);
      const cur = matchRef.current;
      if (cur.id !== m.id) return;
      const chain = [...(cur.chain ?? [])];
      chain[turn.index] = hash;
      put({ ...cur, chain });
    };
    anchorQueueRef.current.tail = anchorQueueRef.current.tail.then(job, job);
    return anchorQueueRef.current.tail;
  }, [put]);

  // ── prompt construction ────────────────────────────────────────────────────
  const systemFor = useCallback(
    (side: Side, m: MatchState) =>
      buildSystem(side, m.config, { turnCount: m.turns.length, injects: m.injects, voiceOn: voiceRef.current.on }),
    []
  );

  const historyFor = useCallback((side: Side, m: MatchState) => {
    const h = m.turns.map((t) => ({ role: (t.from === side ? "assistant" : "user") as "user" | "assistant", content: t.delivered }));
    return normalize(h);
  }, []);

  const spend = useCallback((m: MatchState) => {
    let a = 0, b = 0;
    for (const t of m.turns) for (const at of t.attempts) (t.from === "A" ? (a += at.cost.total) : (b += at.cost.total));
    const discarded = m.discarded.reduce((n, at) => n + at.cost.total, 0);
    return { a, b, discarded, total: a + b + discarded };
  }, []);

  // ── audio ──────────────────────────────────────────────────────────────────
  const speak = useCallback(async (side: Side, text: string) => {
    const v = voiceRef.current;
    if (!v.on) return;
    const cfg = side === "A" ? v.A : v.B;
    const spec = voiceById(cfg.voiceId);
    const clean = forSpeech(text).slice(0, 4000);
    if (!clean) return;

    setVoice((s) => ({
      ...s,
      charsA: side === "A" ? s.charsA + clean.length : s.charsA,
      charsB: side === "B" ? s.charsB + clean.length : s.charsB,
      usd: s.usd + (clean.length / 1000) * (spec?.usdPer1kChars ?? 0),
    }));

    if (!spec || spec.provider === "browser") {
      await new Promise<void>((resolve) => {
        try {
          const u = new SpeechSynthesisUtterance(clean);
          u.rate = cfg.speed;
          u.pitch = side === "A" ? 0.85 : 1.12;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          speechSynthesis.cancel();
          speechSynthesis.speak(u);
        } catch { resolve(); }
      });
      return;
    }

    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId: cfg.voiceId, text: clean, speed: cfg.speed }),
      });
      if (!res.ok) { console.warn("TTS:", await res.text()); return; }
      const url = URL.createObjectURL(await res.blob());
      await new Promise<void>((resolve) => {
        const el = new Audio(url);
        audioRef.current = el;
        const done = () => { URL.revokeObjectURL(url); audioDoneRef.current = null; resolve(); };
        audioDoneRef.current = done;
        el.onended = done;
        el.onerror = done;
        el.onpause = () => { if (el.currentTime < el.duration) done(); }; // HALT pauses; don't hang the loop
        void el.play().catch(done);
      });
    } catch (e) { console.warn("TTS failed", e); }
  }, []);

  // ── end conditions ─────────────────────────────────────────────────────────
  /** Returns the matching end-marker source, or null. Ignores the lock. */
  const markerIn = useCallback((m: MatchState, text: string) => {
    const sc = scenarioById(m.config.scenarioId);
    // report the marker as it appeared, e.g. "[[DEAL: 55 / 45]]", not the regex source
    for (const re of sc.endsOn ?? []) { const m = text.match(re); if (m) return m[0]; }
    return null;
  }, []);
  const isLocked = useCallback((m: MatchState) => {
    const sc = scenarioById(m.config.scenarioId);
    return !!sc.lockUntil && m.turns.length < sc.lockUntil;
  }, []);
  /** Strip [[...]] control markers so a locked verdict never reaches the other side. */
  const stripMarkers = (text: string) => text.replace(/\[\[[^\]]*\]\]/g, "").trim();

  // ── generation (one request, one draft) ────────────────────────────────────
  const generate = useCallback(
    async (side: Side, m: MatchState, prior: Attempt[]): Promise<Draft> => {
      const lo = side === "A" ? m.config.A : m.config.B;
      const spec = byId(lo.modelId);
      const started = performance.now();
      const ac = new AbortController();
      abortRef.current = ac;

      const system = systemFor(side, m);
      const history = historyFor(side, m);
      setLive({ side, text: "" });

      let text = "";
      let usage: Usage | null = null;
      let err: string | undefined;
      let finish: string | undefined;

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          signal: ac.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            modelId: lo.modelId, system, history,
            temperature: lo.temperature,
            // Reasoning models spend output tokens thinking before they write; a small cap
            // yields an empty visible message. Floor it so the operator's dial is a minimum
            // for visible text, not a trap.
            maxTokens: spec?.reasoning ? Math.max(lo.maxTokens, 2048) : lo.maxTokens,
            compat: spec?.provider === "compat"
              ? { model: (side === "A" ? m.config.customA : m.config.customB) || "gpt-4o-mini" }
              : undefined,
          }),
        });
        if (!res.ok) {
          err = `${res.status}: ${(await res.text()).slice(0, 400)}`;
        } else {
          const reader = res.body!.getReader();
          const dec = new TextDecoder();
          let buf = "";
          let sawDone = false;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1);
                if (!line.startsWith("data:")) continue;
                let ev: StreamEvent;
                try { ev = JSON.parse(line.slice(5).trim()) as StreamEvent; } catch { continue; }
                if (ev.type === "delta") { text += ev.text; setLive({ side, text }); }
                else if (ev.type === "usage") usage = ev.usage;
                else if (ev.type === "done") { finish = ev.finish; sawDone = true; }
                else if (ev.type === "error") err = ev.message;
              }
            }
          } finally {
            try { reader.releaseLock(); } catch {}
          }
          if (!sawDone && !err) err = "connection closed before the draft completed";
        }
      } catch (e) {
        err = e instanceof DOMException && e.name === "AbortError"
          ? "aborted by operator"
          : e instanceof Error ? e.message : String(e);
      }
      setLive(null);

      const reported = usage as Usage | null;
      const u = reported && reported.confidence !== "unknown"
        ? reported
        : estimateUsage(system.length + history.reduce((n, h) => n + h.content.length, 0), text.length);
      const attempt: Attempt = {
        raw: text,
        usage: u,
        cost: computeCost(u, m.priceLock[lo.modelId]),
        latencyMs: Math.round(performance.now() - started),
        at: Date.now(),
        rejected: false,
        finish,
      };
      let { delivered, tap } = splitTap(text);
      if (!err && finish === "refusal") {
        err = "the provider's safety classifier refused this request (stop_reason: refusal). Nothing was generated. That refusal is itself data — export the run — but to continue, soften the brief or swap models.";
      }
      if (!err && !delivered) {
        err = tap && !text.replace(/<<<TAP[\s\S]*?TAP>>>/gi, "").trim()
          ? "the model wrote only its private tap block and no visible message (its tap is shown below); RETRY usually fixes it"
          : spec?.reasoning && (u.reasoningTokens > 0 || finish === "length")
            ? "the model spent its whole token budget reasoning and returned no visible text: raise max tokens for this side"
            : `model returned an empty message (finish: ${finish ?? "none"}, ${u.outputTokens} output tokens)`;
      }
      let lockedMarker = false;
      if (isLocked(m) && markerIn(m, delivered)) { delivered = stripMarkers(delivered); lockedMarker = true; }
      return {
        side, raw: text, delivered, tap,
        attempts: [...prior, attempt], streaming: false, error: err,
        truncated: !NORMAL_FINISH.has(finish), lockedMarker,
      };
    },
    [systemFor, historyFor, isLocked, markerIn]
  );

  // ── commit + loop ──────────────────────────────────────────────────────────
  const commit = useCallback(
    (d: Draft, deliveredOverride?: string, kind: Turn["kind"] = "model") => {
      const m = matchRef.current;
      const lo = d.side === "A" ? m.config.A : m.config.B;
      let delivered = (deliveredOverride ?? d.delivered).trim();
      if (isLocked(m) && markerIn(m, delivered)) delivered = stripMarkers(delivered);
      const turn: Turn = {
        id: uid(),
        index: m.turns.length,
        from: d.side,
        kind,
        delivered,
        tap: d.tap?.raw ?? null,
        attempts: d.attempts,
        modelId: lo.modelId,
        callsign: lo.callsign,
        edited: deliveredOverride != null && deliveredOverride.trim() !== d.delivered.trim(),
        at: Date.now(),
      };
      const next = { ...m, turns: [...m.turns, turn] };
      put(next);
      void anchor(next, turn);
      return next;
    },
    [anchor, isLocked, markerIn, put]
  );

  const endedBy = useCallback((m: MatchState, text: string) => {
    if (isLocked(m)) return null;
    const hit = markerIn(m, text);
    if (!hit) return null;
    const sc = scenarioById(m.config.scenarioId);
    if (!sc.endsOnBoth) return hit;
    // deals and charters need both parties: the previous turn (the other side) must carry a
    // COMPATIBLE marker. [[DEAL: a / b]] from one side must equal [[DEAL: b / a]] from the other.
    const prev = m.turns[m.turns.length - 2];
    const prevHit = prev ? markerIn(m, prev.delivered) : null;
    if (!prevHit) return null;
    const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
    const a = nums(hit), b = nums(prevHit);
    if (a.length === 2 && b.length === 2) {
      if (a[0] !== b[1] || a[1] !== b[0]) return null; // different numbers: no deal yet
    } else if (hit.replace(/\s+/g, "").toUpperCase() !== prevHit.replace(/\s+/g, "").toUpperCase()) {
      return null; // SIGNED vs DEADLOCK is not agreement
    }
    return `${prevHit} then ${hit}`;
  }, [isLocked, markerIn]);

  const finishMatch = useCallback((m: MatchState, reason: string) => {
    put({ ...m, status: "done", endedReason: reason });
    // after the last anchor lands, write the terminal record (turn count + head)
    void anchorQueueRef.current.tail.then(() => { if (matchRef.current.id === m.id) return sealLedger(matchRef.current); });
  }, [put]);

  const runLoop = useCallback(async () => {
    const owner = matchRef.current.id;
    if (loopRef.current === owner) return; // this match already has a loop
    loopRef.current = owner;
    stopRef.current = false;
    try {
      const sc = scenarioById(matchRef.current.config.scenarioId);

      // Seed the channel if empty (no cost, not a generation).
      if (matchRef.current.turns.length === 0) {
        const seedText = (matchRef.current.config.customSeed || sc.seed).trim();
        const side = sc.seedFrom;
        const lo = side === "A" ? matchRef.current.config.A : matchRef.current.config.B;
        const seedTurn: Turn = {
          id: uid(), index: 0, from: side, kind: "system-note", delivered: seedText, tap: null,
          attempts: [], modelId: lo.modelId, callsign: lo.callsign, edited: false, at: Date.now(),
        };
        const seeded = { ...matchRef.current, turns: [seedTurn], startedAt: Date.now() };
        put(seeded);
        void anchor(seeded, seedTurn);
        if (voiceRef.current.on) await speak(side, seedText);
        if (stopRef.current) return;
      }

      put({ ...matchRef.current, status: "running" });

      while (!stopRef.current) {
        const m = matchRef.current;
        if (m.turns.length >= m.config.maxTurns) { finishMatch(m, `turn cap (${m.config.maxTurns})`); return; }
        if (spend(m).total >= m.config.budgetUsd) {
          finishMatch(m, `budget ceiling ($${m.config.budgetUsd.toFixed(2)}) — between-request stop`); return;
        }

        const last = m.turns[m.turns.length - 1];
        const side: Side = last.from === "A" ? "B" : "A";
        const lo = side === "A" ? m.config.A : m.config.B;

        // Puppet: hand the turn to the operator, no API call.
        if (m.config.mode === "puppet" && lo.human) {
          put({ ...m, status: "awaiting-human" });
          setDraft({ side, raw: "", delivered: "", tap: null, attempts: [], streaming: false });
          return;
        }

        const d = await generate(side, m, []);
        // HALT / NEW MATCH / fork happened while we were generating: drop the result.
        // Cost is banked only on the match it belonged to; never charged to a replacement.
        if (matchRef.current.id !== m.id) return;
        if (stopRef.current) {
          put({ ...matchRef.current, discarded: [...matchRef.current.discarded, ...d.attempts.map((a) => ({ ...a, rejected: true }))] });
          return;
        }
        if (d.error) {
          put({ ...matchRef.current, status: "error", endedReason: d.error });
          setDraft(d);
          return;
        }

        if (m.config.mode === "gated") {
          put({ ...matchRef.current, status: "awaiting-approval" });
          setDraft(d);
          return; // the operator resumes the loop by approving
        }

        const next = commit(d);
        if (voiceRef.current.on) {
          const p = speak(side, d.delivered);
          if (voiceRef.current.waitForAudio) await p;
        }
        const reason = endedBy(next, d.delivered);
        if (reason) { finishMatch(matchRef.current, `end condition reached: ${reason}`); return; }
        const wait = m.config.randomDelay
          ? Math.round(m.config.delayMinMs + Math.random() * Math.max(0, m.config.delayMaxMs - m.config.delayMinMs))
          : m.config.turnDelayMs;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      if (matchRef.current.status === "running") put({ ...matchRef.current, status: "paused" });
    } finally {
      if (loopRef.current === owner) loopRef.current = null;
    }
  }, [commit, endedBy, finishMatch, generate, put, setDraft, spend, speak]);

  // ── operator actions ───────────────────────────────────────────────────────
  const stop = useCallback(() => {
    stopRef.current = true;
    abortRef.current?.abort();
    audioRef.current?.pause();
    audioDoneRef.current?.();
    try { speechSynthesis.cancel(); } catch {}
    const m = matchRef.current;
    if (m.status === "running" || m.status === "awaiting-approval" || m.status === "awaiting-human") {
      put({ ...m, status: "paused" });
    }
  }, [put]);

  const start = useCallback(() => {
    stop();
    const m = freshMatch(config);
    put(m); setDraft(null);
    const ready = openLedger(m, voiceRef.current.on);
    ledgerRef.current = { id: m.id, ready };
    void ready.then((ok) => { if (matchRef.current.id === m.id) put({ ...matchRef.current, ledgerOpen: ok }); });
    setVoice((v) => ({ ...v, charsA: 0, charsB: 0, usd: 0 }));
    void runLoop();
  }, [config, put, runLoop, setDraft, stop]);

  /** Shared tail for approve / replace: deliver, speak, check end, continue. */
  const deliver = useCallback(
    async (d: Draft, text: string | undefined, kind: Turn["kind"]) => {
      // recovering from an error (RETRY then APPROVE) must not leave "channel closed" on screen
      if (matchRef.current.status === "error") put({ ...matchRef.current, status: "running", endedReason: undefined });
      const next = commit(d, text, kind);
      const spoken = text ?? d.delivered;
      if (voiceRef.current.on) {
        const p = speak(d.side, spoken);
        if (voiceRef.current.waitForAudio) await p;
      }
      const reason = endedBy(next, spoken);
      if (reason) { finishMatch(matchRef.current, `end condition reached: ${reason}`); return; }
      void runLoop();
    },
    [commit, endedBy, finishMatch, runLoop, speak]
  );

  const approve = useCallback(
    async (text?: string) => {
      const d = draftRef.current; if (!d) return;
      setDraft(null); // claim it: a second click finds nothing
      const kind: Turn["kind"] =
        text == null ? "model" : text.trim() === d.delivered.trim() ? "model" : d.delivered ? "operator-edited" : "human";
      await deliver(d, text, kind);
    },
    [deliver, setDraft]
  );

  /** Replace: discard the model's text entirely, send your own under its callsign. */
  const replaceWith = useCallback(
    async (text: string) => {
      const d = draftRef.current; if (!d || d.streaming) return;
      setDraft(null);
      const attempts = d.attempts.map((a) => ({ ...a, rejected: true }));
      await deliver({ ...d, attempts, delivered: text }, text, "operator-replaced");
    },
    [deliver, setDraft]
  );

  /** Reroll: the discarded attempt still cost money, still counts against the ceiling, and stays in the audit trail. */
  const regenerate = useCallback(async () => {
    const d = draftRef.current; if (!d || d.streaming) return;
    const m = matchRef.current;
    const pending = d.attempts.reduce((n, a) => n + a.cost.total, 0);
    if (spend(m).total + pending >= m.config.budgetUsd) {
      setDraft({ ...d, error: `budget ceiling ($${m.config.budgetUsd.toFixed(2)}) reached — approve, replace, or kill` });
      return;
    }
    const rejected = d.attempts.map((a) => ({ ...a, rejected: true }));
    setDraft({ ...d, streaming: true, error: undefined });
    const nd = await generate(d.side, m, rejected);
    if (draftRef.current?.side !== d.side || matchRef.current.id !== m.id) {
      // killed or forked while rerolling: bank the cost, drop the text
      put({ ...matchRef.current, discarded: [...matchRef.current.discarded, ...nd.attempts.slice(-1).map((a) => ({ ...a, rejected: true }))] });
      return;
    }
    setDraft(nd);
  }, [generate, put, setDraft, spend]);

  /** KILL: throw the held draft away. Its attempts still cost money and are kept. */
  const kill = useCallback(() => {
    const d = draftRef.current;
    if (d) {
      put({ ...matchRef.current, discarded: [...matchRef.current.discarded, ...d.attempts.map((a) => ({ ...a, rejected: true }))] });
      setDraft(null);
    }
    stop();
  }, [put, setDraft, stop]);

  const resume = useCallback(() => { void runLoop(); }, [runLoop]);

  const inject = useCallback((target: Side, text: string) => {
    const m = matchRef.current;
    const i: Inject = { id: uid(), target, text, afterTurn: m.turns.length - 1, at: Date.now() };
    put({ ...m, injects: [...m.injects, i] });
  }, [put]);

  /** MULTIVERSE: fork the timeline at a turn and run the alternate. */
  const forkAt = useCallback((index: number) => {
    stop();
    const m = matchRef.current;
    if (draftRef.current) {
      m.discarded.push(...draftRef.current.attempts.map((a) => ({ ...a, rejected: true })));
    }
    setBranches((b) => [...b, m]);
    const forked: MatchState = {
      ...m, id: uid(), parentId: m.id, forkedAtTurn: index, status: "paused", endedReason: undefined,
      turns: m.turns.slice(0, index + 1),
      injects: m.injects.filter((i) => i.afterTurn <= index),
      discarded: [],
      chain: (m.chain ?? []).slice(0, index + 1),
      ledgerOpen: false,
      label: `fork@${index}`,
    };
    put(forked); setDraft(null);
    // a fork is a new ledger; the inherited prefix is re-anchored now (its commit times will
    // be a burst, which the site reports honestly as "forked")
    const readyF = openLedger(forked, voiceRef.current.on);
    ledgerRef.current = { id: forked.id, ready: readyF };
    void readyF.then(async (ok) => {
      if (matchRef.current.id !== forked.id) return;
      put({ ...matchRef.current, ledgerOpen: ok });
      if (ok) for (const t of forked.turns) await commitTurn({ ...matchRef.current, ledgerOpen: true }, t, forked.chain?.[t.index - 1] ?? null);
    });
  }, [put, setDraft, stop]);

  /** TWIN RUN: same match with the two loadouts swapped, to separate model from position. */
  const twinRun = useCallback(() => {
    stop();
    const m = matchRef.current;
    setBranches((b) => [...b, m]);
    const swapped: MatchConfig = { ...m.config, A: { ...m.config.B }, B: { ...m.config.A } };
    const twin = { ...freshMatch(swapped), label: "twin (sides swapped)" };
    put(twin); setDraft(null);
    const readyT = openLedger(twin, voiceRef.current.on);
    ledgerRef.current = { id: twin.id, ready: readyT };
    void readyT.then((ok) => { if (matchRef.current.id === twin.id) put({ ...matchRef.current, ledgerOpen: ok }); });
    void runLoop();
  }, [put, runLoop, setDraft, stop]);

  const setMode = useCallback((mode: Mode) => setConfig((c) => ({ ...c, mode })), []);

  /** Load a community run for reading, forking and rerunning. Nothing is generated. */
  const importRun = useCallback((run: PublishedRun) => {
    stop();
    const cfg: MatchConfig = {
      ...DEFAULT_CONFIG,
      scenarioId: run.scenarioId,
      mode: "gated",
      maxTurns: Math.max(run.config.maxTurns, run.turns.length + 4),
      budgetUsd: run.config.budgetUsd,
      A: { ...run.config.A }, B: { ...run.config.B },
      customSeed: run.config.customSeed,
    };
    setConfig(cfg);
    const m: MatchState = {
      // keep the original match id so a later publish still points at the live ledger
      id: run.matchId || uid(), config: cfg,
      turns: run.turns, injects: run.injects ?? [], discarded: [],
      status: "paused", priceLock: run.priceLock ?? {},
      chain: run.chain ?? [], ledgerOpen: false,
      startedAt: run.startedAt ?? undefined,
      endedReason: run.endedReason ?? undefined,
      label: `imported · ${run.title}`,
      imported: { id: run.id ?? run.matchId, title: run.title, handle: run.handle ?? null },
    };
    ledgerRef.current = null;
    put(m); setDraft(null);
  }, [put, setDraft, stop]);

  return {
    config, setConfig, setMode,
    match, branches, setBranches,
    draft, setDraft, live,
    voice, setVoice,
    start, stop, resume, approve, replaceWith, regenerate, kill, inject, forkAt, twinRun, importRun,
    spend: spend(match),
    scenario: scenarioById(config.scenarioId),
    scenarios: SCENARIOS,
  };
}
