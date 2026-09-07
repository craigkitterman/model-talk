"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchState, Side, Turn } from "@/lib/types";
import { PROVIDERS, byId } from "@/lib/models/catalog";
import { compact, usd } from "@/lib/cost";
import { ProviderMark, Wordmark } from "./Logos";
import type { VoiceCfg } from "@/lib/useMatch";
import { SettingsButton } from "./Settings";

const KIND_LABEL: Record<Turn["kind"], string> = {
  model: "",
  "operator-edited": "edited by operator",
  "operator-replaced": "written by operator",
  human: "operator",
  inject: "inject",
  "system-note": "seed",
};

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / Math.max(max, 1e-9)) * 100);
  return (
    <div className="h-[3px] bg-edge/70 w-full overflow-hidden">
      <div className="h-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 10px ${color}` }} />
    </div>
  );
}

function SideMeter({ side, m, accent }: { side: Side; m: MatchState; accent: string }) {
  const lo = side === "A" ? m.config.A : m.config.B;
  const spec = byId(lo.modelId) ?? { provider: "compat" as const, name: lo.modelId };
  const turns = m.turns.filter((t) => t.from === side);
  let inTok = 0, outTok = 0, cost = 0, lat = 0, n = 0, rejected = 0;
  for (const t of turns) for (const a of t.attempts) {
    inTok += a.usage.inputTokens; outTok += a.usage.outputTokens; cost += a.cost.total;
    lat += a.latencyMs; n++; if (a.rejected) rejected++;
  }
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span style={{ color: accent }}><ProviderMark p={spec.provider} size={13} /></span>
        <span className="uiFont text-[12px] font-extrabold tracking-[.16em] truncate" style={{ color: accent }}>{lo.callsign}</span>
        <span className="label truncate hidden xl:inline">{spec.name}</span>
        <span className="flex-1" />
        <span className="num text-[13px] font-bold" style={{ color: accent }}>{usd(cost)}</span>
      </div>
      <Bar value={cost} max={m.config.budgetUsd} color={accent} />
      <div className="flex gap-3 mt-1.5">
        <span className="label">in <span className="num text-ink/70">{compact(inTok)}</span></span>
        <span className="label">out <span className="num text-ink/70">{compact(outTok)}</span></span>
        <span className="label">lat <span className="num text-ink/70">{n ? Math.round(lat / n) : 0}ms</span></span>
        {rejected > 0 && <span className="label text-hazard">wasted {rejected}</span>}
      </div>
    </div>
  );
}

function Bubble({ t, accent, onFork }: { t: Turn; accent: string; onFork: () => void }) {
  const right = t.from === "B";
  const flag = KIND_LABEL[t.kind];
  const cost = t.attempts.reduce((n, a) => n + a.cost.total, 0);
  return (
    <div className={`flex ${right ? "justify-end" : "justify-start"} rise`}>
      <div className={`max-w-[78%] group ${right ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`flex items-center gap-2 mb-1 ${right ? "flex-row-reverse" : ""}`}>
          <span className="uiFont text-[11px] font-extrabold tracking-[.16em]" style={{ color: accent }}>{t.callsign}</span>
          <span className="label">#{t.index}</span>
          {flag && <span className="label text-amber">{flag}</span>}
          {cost > 0 && <span className="label num">{usd(cost)}</span>}
          <button onClick={onFork} aria-label={`Fork timeline at message ${t.index}`} className="label opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-amber">fork ⑂</button>
        </div>
        <div
          className={`plate hair px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap ${right ? "clip-tab" : "clip-bevel"} ${
            t.kind === "operator-replaced" || t.kind === "operator-edited" ? "border-amber/45" : ""
          }`}
          style={{ borderLeftColor: right ? undefined : accent, borderLeftWidth: right ? undefined : 2, borderRightColor: right ? accent : undefined, borderRightWidth: right ? 2 : undefined }}
        >
          {t.delivered}
        </div>
        {t.tap && (
          <details className={`mt-1 w-full ${right ? "text-right" : ""}`}>
            <summary className="label text-good/70 cursor-pointer select-none hover:text-good">tap</summary>
            <pre className="num text-[10.5px] text-good/70 whitespace-pre-wrap mt-1 hair clip-tab bg-good/[.04] border-good/20 px-3 py-2 text-left">{t.tap}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export default function Arena({
  m, live, spend, voice, onStop, onResume, onInject, onFork, onTwin, onExport, onNew, status, dock, onSettings,
}: {
  onSettings: () => void;
  m: MatchState;
  live: { side: Side; text: string } | null;
  spend: { a: number; b: number; discarded: number; total: number };
  voice: VoiceCfg;
  status: MatchState["status"];
  onStop: () => void; onResume: () => void;
  onInject: (side: Side, text: string) => void;
  onFork: (i: number) => void; onTwin: () => void;
  onExport: (fmt: "json" | "md") => void; onNew: () => void;
  /** The interceptor, docked below the transcript so the conversation stays readable. */
  dock?: React.ReactNode;
}) {
  const accentA = PROVIDERS[byId(m.config.A.modelId)?.provider ?? "compat"].color;
  const accentB = PROVIDERS[byId(m.config.B.modelId)?.provider ?? "compat"].color;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [injTarget, setInjTarget] = useState<Side>("A");
  const [injText, setInjText] = useState("");

  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [m.turns.length, live?.text, !!dock]);

  const stats = useMemo(() => {
    const taps = m.turns.filter((t) => t.tap);
    const bluffs = taps.filter((t) => /bluffing:\s*true/i.test(t.tap!)).length;
    const beliefs = taps.map((t) => Number.parseFloat(t.tap!.match(/belief:\s*([\d.]+)/i)?.[1] ?? "")).filter((n) => !Number.isNaN(n));
    const edited = m.turns.filter((t) => t.kind === "operator-edited" || t.kind === "operator-replaced").length;
    const elapsed = m.startedAt ? (Date.now() - m.startedAt) / 60000 : 0;
    return { bluffs, taps: taps.length, beliefs, edited, burn: elapsed > 0.05 ? spend.total / elapsed : 0 };
  }, [m.turns, m.startedAt, spend.total]);

  const running = status === "running";

  return (
    <div className="h-full flex flex-col">
      {/* HUD */}
      <header className="shrink-0 plate border-b border-edge px-6 py-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <button onClick={onNew} title="Back to setup"
              className="clip-tab hair plate px-3 py-2 uiFont text-[11px] font-bold tracking-[.16em] text-dim hover:text-amber hover:border-edge-hot">
              ◀ SETUP
            </button>
            <Wordmark />
          </div>
          <div className="flex items-center gap-5 flex-1 min-w-0">
            <SideMeter side="A" m={m} accent={accentA} />
            <div className="shrink-0 text-center px-2">
              <div className="num text-[19px] font-bold leading-none">{m.turns.length}<span className="text-faint">/{m.config.maxTurns}</span></div>
              <div className="label mt-1">messages</div>
            </div>
            <SideMeter side="B" m={m} accent={accentB} />
          </div>

          <div className="shrink-0 w-[168px]">
            <div className="flex items-baseline justify-between">
              <span className="label">total</span>
              <span className="num text-[15px] font-bold text-amber">{usd(spend.total + voice.usd)}</span>
            </div>
            <Bar value={spend.total} max={m.config.budgetUsd} color="var(--color-amber)" />
            <div className="flex justify-between mt-1.5">
              <span className="label">ceiling {usd(m.config.budgetUsd)}{spend.discarded > 0 && <span className="text-hazard"> · killed {usd(spend.discarded)}</span>}</span>
              <span className="label num">{stats.burn > 0 ? `${usd(stats.burn)}/min` : "—"}</span>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {voice.on && (
              <div className="flex items-center gap-1.5 hair clip-tab px-2.5 py-1.5 text-good">
                <div className="vu flex items-end gap-[2px] h-3">
                  <i style={{ height: "100%", animationDelay: "0ms" }} /><i style={{ height: "100%", animationDelay: "120ms" }} /><i style={{ height: "100%", animationDelay: "240ms" }} />
                </div>
                <span className="label text-good">vox {usd(voice.usd)}</span>
              </div>
            )}
            <span className={`label px-2.5 py-1.5 hair clip-tab ${
              status === "error" ? "text-hazard border-hazard/50" :
              status === "done" ? "text-good border-good/40" :
              running ? "text-amber border-amber/40" : "text-dim"}`}>
              {status}
            </span>
            <SettingsButton onClick={onSettings} />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_330px]">
        {/* WIRE */}
        <div className="relative min-w-0 min-h-0 flex flex-col">
          <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-edge-hot to-transparent pointer-events-none">
            {running && <div className="packet absolute -left-[2px] w-[5px] h-14 rounded-full" style={{ background: `linear-gradient(180deg, transparent, ${accentA}, transparent)` }} />}
          </div>
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
            <div className="min-h-full flex flex-col justify-end gap-4">
            {m.turns.map((t) => (
              <Bubble key={t.id} t={t} accent={t.from === "A" ? accentA : accentB} onFork={() => onFork(t.index)} />
            ))}
            {live && (
              <div className={`flex ${live.side === "B" ? "justify-end" : "justify-start"}`}>
                <div className="max-w-[78%]">
                  <div className="label mb-1" style={{ color: live.side === "A" ? accentA : accentB }}>
                    {live.side === "A" ? m.config.A.callsign : m.config.B.callsign} composing
                  </div>
                  <div className="plate hair clip-bevel px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink/60 caret">
                    {live.text.replace(/<<<TAP[\s\S]*/i, "")}
                  </div>
                </div>
              </div>
            )}
            {m.endedReason && (
              <div className="text-center py-6 rise">
                <div className="label text-amber">channel closed</div>
                <div className="text-[12px] text-dim mt-1 mb-4">{m.endedReason}</div>
                <div className="flex justify-center gap-2">
                  <button onClick={onNew} className="clip-tab uiFont text-[12px] font-extrabold tracking-[.2em] px-7 py-3 bg-amber text-void hover:brightness-110"
                    style={{ boxShadow: "0 0 44px -14px var(--color-amber)" }}>NEW MATCH</button>
                  <button onClick={onTwin} className="clip-tab hair plate px-5 py-3 uiFont text-[11px] font-bold tracking-[.16em] text-dim hover:text-ink">TWIN RUN ⇄</button>
                  <button onClick={() => onExport("md")} className="clip-tab hair plate px-5 py-3 uiFont text-[11px] font-bold tracking-[.16em] text-dim hover:text-ink">EXPORT</button>
                </div>
              </div>
            )}
            </div>
          </div>
          {dock}
        </div>

        {/* OPS */}
        <aside className="border-l border-edge plate flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            <section>
              <div className="label mb-2">telemetry</div>
              <div className="space-y-1.5">
                {[
                  ["tapped turns", `${stats.taps}`],
                  ["self-reported bluffs", `${stats.bluffs}`],
                  ["mean belief", stats.beliefs.length ? (stats.beliefs.reduce((a, b) => a + b, 0) / stats.beliefs.length).toFixed(2) : "—"],
                  ["operator interventions", `${stats.edited}`],
                  ["injects", `${m.injects.length}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between items-baseline border-b border-edge/50 pb-1">
                    <span className="label">{k}</span>
                    <span className={`num text-[11px] ${k === "self-reported bluffs" && stats.bluffs > 0 ? "text-hazard" : "text-ink/80"}`}>{v}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="label mb-2">god mode inject</div>
              <div className="flex gap-1 mb-2">
                {(["A", "B"] as Side[]).map((s) => (
                  <button key={s} onClick={() => setInjTarget(s)}
                    className={`flex-1 clip-tab hair py-1.5 uiFont text-[11px] font-bold tracking-wider ${injTarget === s ? "bg-hazard/15 border-hazard/50 text-hazard" : "text-dim"}`}>
                    {s === "A" ? m.config.A.callsign : m.config.B.callsign}
                  </button>
                ))}
              </div>
              <textarea value={injText} onChange={(e) => setInjText(e.target.value)} rows={3}
                placeholder="A private whisper only this side sees. e.g. “you now suspect your counterpart is lying.”"
                className="w-full bg-deck hair px-3 py-2 text-[11.5px] outline-none resize-none placeholder:text-faint" />
              <button
                onClick={() => { if (injText.trim()) { onInject(injTarget, injText.trim()); setInjText(""); } }}
                disabled={!injText.trim()}
                className="w-full mt-1.5 clip-tab hair py-2 uiFont text-[11px] font-bold tracking-[.16em] bg-hazard/10 border-hazard/40 text-hazard disabled:opacity-30">
                WHISPER
              </button>
              {m.injects.length > 0 && (
                <div className="mt-2 space-y-1">
                  {m.injects.map((i) => (
                    <div key={i.id} className="hair clip-tab px-2.5 py-1.5 text-[10.5px] text-dim border-hazard/25">
                      <span className="label text-hazard">→{i.target} @{i.afterTurn}</span> {i.text}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="label mb-2">multiverse</div>
              <p className="text-[11px] text-dim leading-snug mb-2">
                Hover any message and hit <span className="text-amber">fork ⑂</span> to branch the timeline there. Twin run replays this match with the two loadouts swapped.
              </p>
              <button onClick={onTwin} className="w-full clip-tab hair plate py-2 uiFont text-[11px] font-bold tracking-[.16em] text-dim hover:text-ink hover:border-edge-hot">
                TWIN RUN ⇄
              </button>
              {m.parentId && <div className="label mt-2 text-amber">branch · forked at #{m.forkedAtTurn}</div>}
            </section>
          </div>

          <div className="shrink-0 border-t border-edge p-4 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onExport("json")} className="clip-tab hair plate py-2 uiFont text-[11px] font-bold tracking-[.14em] text-dim hover:text-ink">JSON</button>
              <button onClick={() => onExport("md")} className="clip-tab hair plate py-2 uiFont text-[11px] font-bold tracking-[.14em] text-dim hover:text-ink">MARKDOWN</button>
            </div>
            {running ? (
              <button onClick={onStop} className="w-full clip-tab hair py-3 uiFont text-[12px] font-extrabold tracking-[.2em] bg-hazard/15 border-hazard/50 text-hazard">HALT</button>
            ) : status === "paused" ? (
              <button onClick={onResume} className="w-full clip-tab py-3 uiFont text-[12px] font-extrabold tracking-[.2em] bg-amber text-void">RESUME</button>
            ) : null}
            <button onClick={onNew} className="w-full clip-tab hair plate py-2 uiFont text-[11px] font-bold tracking-[.16em] text-dim hover:text-ink">NEW MATCH</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
