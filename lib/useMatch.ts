"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Attempt, Inject, MatchConfig, MatchState, Mode, Side, StreamEvent, Turn, Usage,
} from "@/lib/types";
import { byId } from "@/lib/models/catalog";
import { SCENARIOS, THOUGHT_TAP, VOICE_APPENDIX, scenarioById } from "@/lib/scenarios";
import { computeCost, estimateUsage } from "@/lib/cost";
import { forSpeech, splitTap } from "@/lib/tap";
import { DEFAULT_VOICE_A, DEFAULT_VOICE_B, voiceById } from "@/lib/voice/catalog";

export interface Draft {
  side: Side;
  raw: string;
  delivered: string;
  tap: ReturnType<typeof splitTap>["tap"];
  attempts: Attempt[];
  streaming: boolean;
  error?: string;
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
  A: { modelId: "claude-sonnet-5", callsign: "ORACLE", temperature: 1, maxTokens: 1024, persona: "", human: false },
  B: { modelId: "gpt-5.1", callsign: "MAGPIE", temperature: 1, maxTokens: 1024, persona: "", human: false },
};

function freshMatch(config: MatchConfig): MatchState {
  const priceLock: MatchState["priceLock"] = {};
  for (const id of [config.A.modelId, config.B.modelId]) {
    const m = byId(id);
    if (m) priceLock[id] = { inputPerM: m.inputPerM, outputPerM: m.outputPerM };
  }
  return { id: uid(), config, turns: [], injects: [], status: "idle", priceLock };
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

export function useMatch() {
  const [config, setConfig] = useState<MatchConfig>(DEFAULT_CONFIG);
  const [match, setMatch] = useState<MatchState>(() => freshMatch(DEFAULT_CONFIG));
  const [branches, setBranches] = useState<MatchState[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [live, setLive] = useState<{ side: Side; text: string } | null>(null);
  const [voice, setVoice] = useState<VoiceCfg>({
    on: false, waitForAudio: true,
    A: { voiceId: DEFAULT_VOICE_A, speed: 1 },
    B: { voiceId: DEFAULT_VOICE_B, speed: 1 },
    charsA: 0, charsB: 0, usd: 0,
  });

  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);
  const matchRef = useRef(match);
  const voiceRef = useRef(voice);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => { matchRef.current = match; }, [match]);
  useEffect(() => { voiceRef.current = voice; }, [voice]);

  // ── prompt construction ────────────────────────────────────────────────────
  const systemFor = useCallback((side: Side, m: MatchState) => {
    const sc = scenarioById(m.config.scenarioId);
    const custom = side === "A" ? m.config.customA : m.config.customB;
    const base = (sc.id === "custom" ? custom ?? "" : custom || (side === "A" ? sc.sideA.system : sc.sideB.system));
    const lo = side === "A" ? m.config.A : m.config.B;
    const parts = [base];
    if (lo.persona.trim()) parts.push(`PERSONA OVERLAY: ${lo.persona.trim()}`);
    if (sc.lockUntil) parts.push(`Turn counter: you are on turn ${m.turns.length + 1}. Verdicts are locked until turn ${sc.lockUntil}.`);
    if (voiceRef.current.on) parts.push(VOICE_APPENDIX);
    if (sc.thoughtTap) parts.push(THOUGHT_TAP);
    return parts.filter(Boolean).join("\n\n");
  }, []);

  const historyFor = useCallback((side: Side, m: MatchState) => {
    const h: { role: "user" | "assistant"; content: string }[] = [];
    for (const t of m.turns) {
      h.push({ role: t.from === side ? "assistant" : "user", content: t.delivered });
      for (const inj of m.injects.filter((i) => i.target === side && i.afterTurn === t.index)) {
        h.push({ role: "user", content: `[CHANNEL OPERATOR — PRIVATE, the other party cannot see this]: ${inj.text}` });
      }
    }
    return normalize(h);
  }, []);

  const spend = useCallback((m: MatchState) => {
    let a = 0, b = 0;
    for (const t of m.turns) for (const at of t.attempts) (t.from === "A" ? (a += at.cost.total) : (b += at.cost.total));
    return { a, b, total: a + b };
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
        el.onended = () => { URL.revokeObjectURL(url); resolve(); };
        el.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        void el.play().catch(() => resolve());
      });
    } catch (e) { console.warn("TTS failed", e); }
  }, []);

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

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          signal: ac.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            modelId: lo.modelId, system, history,
            temperature: lo.temperature, maxTokens: lo.maxTokens,
            compat: spec?.provider === "compat"
              ? { baseUrl: "", model: (side === "A" ? m.config.customA : m.config.customB) || "gpt-4o-mini" }
              : undefined,
          }),
        });
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const ev = JSON.parse(line.slice(5).trim()) as StreamEvent;
            if (ev.type === "delta") { text += ev.text; setLive({ side, text }); }
            else if (ev.type === "usage") usage = ev.usage;
            else if (ev.type === "error") err = ev.message;
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          err = e instanceof Error ? e.message : String(e);
        }
      }
      setLive(null);

      const u = usage ?? estimateUsage(system.length + history.reduce((n, h) => n + h.content.length, 0), text.length);
      const attempt: Attempt = {
        raw: text,
        usage: u,
        cost: computeCost(u, m.priceLock[lo.modelId]),
        latencyMs: Math.round(performance.now() - started),
        at: Date.now(),
        rejected: false,
      };
      const { delivered, tap } = splitTap(text);
      return { side, raw: text, delivered, tap, attempts: [...prior, attempt], streaming: false, error: err };
    },
    [systemFor, historyFor]
  );

  // ── commit + loop ──────────────────────────────────────────────────────────
  const commit = useCallback(
    (d: Draft, deliveredOverride?: string, kind: Turn["kind"] = "model") => {
      const m = matchRef.current;
      const lo = d.side === "A" ? m.config.A : m.config.B;
      const delivered = (deliveredOverride ?? d.delivered).trim();
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
      matchRef.current = next;
      setMatch(next);
      return next;
    },
    []
  );

  const endedBy = useCallback((m: MatchState, text: string) => {
    const sc = scenarioById(m.config.scenarioId);
    if (sc.lockUntil && m.turns.length < sc.lockUntil) return null;
    for (const re of sc.endsOn ?? []) if (re.test(text)) return re.source;
    return null;
  }, []);

  const runLoop = useCallback(async () => {
    stopRef.current = false;
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
      const next = { ...matchRef.current, turns: [seedTurn], startedAt: Date.now() };
      matchRef.current = next; setMatch(next);
      if (voiceRef.current.on) await speak(side, seedText);
    }

    setMatch((s) => ({ ...s, status: "running" }));

    while (!stopRef.current) {
      const m = matchRef.current;
      if (m.turns.length >= m.config.maxTurns) {
        matchRef.current = { ...m, status: "done", endedReason: `turn cap (${m.config.maxTurns})` };
        setMatch(matchRef.current); return;
      }
      const s = spend(m);
      if (s.total >= m.config.budgetUsd) {
        matchRef.current = { ...m, status: "done", endedReason: `budget ceiling ($${m.config.budgetUsd.toFixed(2)}) — between-request stop` };
        setMatch(matchRef.current); return;
      }

      const last = m.turns[m.turns.length - 1];
      const side: Side = last.from === "A" ? "B" : "A";
      const lo = side === "A" ? m.config.A : m.config.B;

      // Puppet: hand the turn to the operator, no API call.
      if (m.config.mode === "puppet" && lo.human) {
        matchRef.current = { ...m, status: "awaiting-human" };
        setMatch(matchRef.current);
        setDraft({ side, raw: "", delivered: "", tap: null, attempts: [], streaming: false });
        return;
      }

      const d = await generate(side, m, []);
      if (d.error) {
        matchRef.current = { ...matchRef.current, status: "error", endedReason: d.error };
        setMatch(matchRef.current); setDraft(d); return;
      }

      if (m.config.mode === "gated") {
        matchRef.current = { ...matchRef.current, status: "awaiting-approval" };
        setMatch(matchRef.current);
        setDraft(d);
        return; // the operator resumes the loop by approving
      }

      const next = commit(d);
      if (voiceRef.current.on) {
        const p = speak(side, d.delivered);
        if (voiceRef.current.waitForAudio) await p;
      }
      const reason = endedBy(next, d.delivered);
      if (reason) {
        matchRef.current = { ...next, status: "done", endedReason: `end condition: ${reason}` };
        setMatch(matchRef.current); return;
      }
      const wait = m.config.randomDelay
        ? Math.round(m.config.delayMinMs + Math.random() * Math.max(0, m.config.delayMaxMs - m.config.delayMinMs))
        : m.config.turnDelayMs;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    setMatch((s) => ({ ...s, status: "paused" }));
  }, [commit, endedBy, generate, spend, speak]);

  // ── operator actions ───────────────────────────────────────────────────────
  const start = useCallback(() => {
    const m = freshMatch(config);
    matchRef.current = m; setMatch(m); setDraft(null);
    setVoice((v) => ({ ...v, charsA: 0, charsB: 0, usd: 0 }));
    void runLoop();
  }, [config, runLoop]);

  const approve = useCallback(
    async (text?: string) => {
      const d = draft; if (!d) return;
      setDraft(null);
      const kind: Turn["kind"] =
        text == null ? "model" : text.trim() === d.delivered.trim() ? "model" : d.delivered ? "operator-edited" : "human";
      const next = commit(d, text, kind);
      if (voiceRef.current.on) {
        const p = speak(d.side, text ?? d.delivered);
        if (voiceRef.current.waitForAudio) await p;
      }
      const reason = endedBy(next, text ?? d.delivered);
      if (reason) {
        matchRef.current = { ...next, status: "done", endedReason: `end condition: ${reason}` };
        setMatch(matchRef.current); return;
      }
      void runLoop();
    },
    [draft, commit, endedBy, runLoop, speak]
  );

  /** Replace: discard the model's text entirely, send your own under its callsign. */
  const replaceWith = useCallback(
    async (text: string) => {
      const d = draft; if (!d) return;
      const attempts = d.attempts.map((a) => ({ ...a, rejected: true }));
      setDraft(null);
      const next = commit({ ...d, attempts, delivered: text, tap: d.tap }, text, "operator-replaced");
      if (voiceRef.current.on) {
        const p = speak(d.side, text);
        if (voiceRef.current.waitForAudio) await p;
      }
      const reason = endedBy(next, text);
      if (reason) {
        matchRef.current = { ...next, status: "done", endedReason: `end condition: ${reason}` };
        setMatch(matchRef.current); return;
      }
      void runLoop();
    },
    [draft, commit, endedBy, runLoop, speak]
  );

  /** Reroll: the discarded attempt still cost money and is kept in the audit trail. */
  const regenerate = useCallback(async () => {
    const d = draft; if (!d) return;
    const rejected = d.attempts.map((a) => ({ ...a, rejected: true }));
    setDraft({ ...d, streaming: true });
    const nd = await generate(d.side, matchRef.current, rejected);
    setDraft(nd);
  }, [draft, generate]);

  const stop = useCallback(() => {
    stopRef.current = true;
    abortRef.current?.abort();
    audioRef.current?.pause();
    try { speechSynthesis.cancel(); } catch {}
    matchRef.current = { ...matchRef.current, status: "paused" };
    setMatch(matchRef.current);
  }, []);

  const resume = useCallback(() => { void runLoop(); }, [runLoop]);

  const inject = useCallback((target: Side, text: string) => {
    const m = matchRef.current;
    const i: Inject = { id: uid(), target, text, afterTurn: m.turns.length - 1, at: Date.now() };
    matchRef.current = { ...m, injects: [...m.injects, i] };
    setMatch(matchRef.current);
  }, []);

  /** MULTIVERSE: fork the timeline at a turn and run the alternate. */
  const forkAt = useCallback((index: number) => {
    const m = matchRef.current;
    setBranches((b) => [...b, m]);
    const forked: MatchState = {
      ...m, id: uid(), parentId: m.id, forkedAtTurn: index, status: "paused",
      turns: m.turns.slice(0, index + 1),
      injects: m.injects.filter((i) => i.afterTurn <= index),
      label: `fork@${index}`,
    };
    matchRef.current = forked; setMatch(forked); setDraft(null);
  }, []);

  /** TWIN RUN: same match with the two loadouts swapped, to separate model from position. */
  const twinRun = useCallback(() => {
    const m = matchRef.current;
    setBranches((b) => [...b, m]);
    const swapped: MatchConfig = {
      ...m.config,
      A: { ...m.config.B, callsign: m.config.B.callsign },
      B: { ...m.config.A, callsign: m.config.A.callsign },
    };
    const next = { ...freshMatch(swapped), label: "twin (sides swapped)" };
    matchRef.current = next; setMatch(next); setDraft(null);
    void runLoop();
  }, [runLoop]);

  const setMode = useCallback((mode: Mode) => setConfig((c) => ({ ...c, mode })), []);

  return {
    config, setConfig, setMode,
    match, branches, setBranches,
    draft, setDraft, live,
    voice, setVoice,
    start, stop, resume, approve, replaceWith, regenerate, inject, forkAt, twinRun,
    spend: spend(match),
    scenario: scenarioById(config.scenarioId),
    scenarios: SCENARIOS,
  };
}
