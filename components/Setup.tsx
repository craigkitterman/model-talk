"use client";

import { useEffect, useState } from "react";
import { MODELS, PROVIDERS, byId } from "@/lib/models/catalog";
import { VOICES, voiceById } from "@/lib/voice/catalog";
import type { Loadout, MatchConfig, Mode, Side } from "@/lib/types";
import type { Scenario } from "@/lib/types";
import { ProviderMark, Wordmark } from "./Logos";
import { compact } from "@/lib/cost";
import type { VoiceCfg } from "@/lib/useMatch";
import { SettingsButton } from "./Settings";
import { Bot, Icon, MODE_ICON, SCENARIO_ICON } from "./Icons";
import { baseBrief, buildSystem } from "@/lib/prompt";

interface Health { providers: Record<string, boolean>; voice: Record<string, boolean> }

const MODES: { id: Mode; name: string; blurb: string }[] = [
  { id: "auto", name: "AUTO", blurb: "They talk directly, capped at the turn limit. You watch." },
  { id: "gated", name: "GATED", blurb: "Every message halts mid-wire. Approve, edit, replace or reroll it." },
  { id: "puppet", name: "PUPPET", blurb: "You are one of the two. Type (or speak) every line yourself." },
];

function Stat({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[5px] border-b border-edge/60 last:border-0">
      <span className="label">{k}</span>
      <span className={`num text-[12px] ${warn ? "text-amber" : "text-ink/85"}`}>{v}</span>
    </div>
  );
}

function Dial({
  label, value, min, max, step, onChange, suffix,
}: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <label className="block">
      <div className="flex justify-between items-baseline mb-1">
        <span className="label">{label}</span>
        <span className="num text-[12px] text-amber">{value}{suffix}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-[3px] appearance-none bg-edge accent-amber cursor-pointer"
      />
    </label>
  );
}

function Fighter({
  side, lo, onChange, health, accent, voiceCfg, onVoice, voiceOn,
}: {
  side: Side; lo: Loadout; onChange: (l: Loadout) => void; health: Health | null; accent: string;
  voiceCfg: { voiceId: string; speed: number }; onVoice: (v: { voiceId: string; speed: number }) => void; voiceOn: boolean;
}) {
  const spec = byId(lo.modelId)!;
  const prov = PROVIDERS[spec.provider];
  const keyed = health?.providers?.[spec.provider] ?? true;
  const vs = voiceById(voiceCfg.voiceId);

  return (
    <div
      className="plate hair clip-bevel p-5 rise relative overflow-hidden"
      style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,.05), 0 0 60px -30px ${accent}` }}
    >
      <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: accent }} />
      <div
        className="absolute -right-10 -top-10 w-40 h-40 rounded-full blur-3xl opacity-[.16] pointer-events-none"
        style={{ background: accent }}
      />

      <div className="flex items-center justify-between mb-4">
        <span className="label" style={{ color: accent }}>Combatant {side}</span>
        {!keyed && <span className="label text-hazard">no api key</span>}
      </div>

      <input
        value={lo.callsign}
        onChange={(e) => onChange({ ...lo, callsign: e.target.value.toUpperCase().slice(0, 14) })}
        className="uiFont w-full bg-transparent text-[30px] font-extrabold tracking-[.10em] outline-none mb-1"
        style={{ color: accent }}
        aria-label={`Callsign for combatant ${side}`}
      />
      <div className="label mb-4">callsign · the only name the <em>other model</em> ever sees. You always see the real model below.</div>

      <div className="flex items-center gap-3 mb-3">
        <div className="shrink-0 grid place-items-center w-12 h-12 hair" style={{ color: accent, background: "var(--color-deck)", boxShadow: `0 0 28px -10px ${accent}` }} title={prov.label}>
          <Bot provider={spec.provider} size={30} color={accent} />
        </div>
        <select
          value={lo.modelId}
          onChange={(e) => onChange({ ...lo, modelId: e.target.value })}
          className="uiFont flex-1 bg-panel hair px-3 py-2 text-[13px] font-semibold outline-none cursor-pointer"
          aria-label={`Model for combatant ${side}`}
        >
          {Object.values(PROVIDERS).map((p) => (
            <optgroup key={p.id} label={`${p.label}${health && !health.providers[p.id] ? "  (no key)" : ""}`}>
              {MODELS.filter((m) => m.provider === p.id).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex items-baseline justify-between gap-3 mb-3">
        <span className="uiFont text-[15px] font-extrabold tracking-[.04em]" style={{ color: accent }}>{spec.name}</span>
        <span className="num text-[12px] text-faint truncate">{spec.id}</span>
      </div>

      <div className="mb-4">
        <Stat k="context" v={compact(spec.contextWindow)} />
        <Stat k="max output" v={compact(spec.maxOutput)} />
        <Stat k="in / 1M" v={`$${spec.inputPerM}`} warn={!spec.verified} />
        <Stat k="out / 1M" v={`$${spec.outputPerM}`} warn={!spec.verified} />
        <Stat k="cutoff" v={spec.cutoff} />
        <Stat k="released" v={spec.released} />
        <Stat k="reasoning" v={spec.reasoning ? "yes" : "no"} />
        <Stat k="parameters" v={spec.params ?? "undisclosed"} />
      </div>

      {!spec.verified && (
        <div className="hair clip-tab px-3 py-2 mb-4 text-[12px] leading-relaxed text-amber/90 bg-amber/5">
          ⚠ Pricing unverified. Correct it in <span className="num">lib/models/catalog.ts</span> before trusting the meter.
        </div>
      )}

      <div className="space-y-3 mb-4">
        <Dial label="temperature" value={lo.temperature} min={0} max={2} step={0.1} onChange={(n) => onChange({ ...lo, temperature: n })} />
        <Dial label="max tokens" value={lo.maxTokens} min={256} max={8192} step={256} onChange={(n) => onChange({ ...lo, maxTokens: n })} />
      </div>

      <label className="block mb-3">
        <span className="label">persona overlay</span>
        <textarea
          value={lo.persona}
          onChange={(e) => onChange({ ...lo, persona: e.target.value })}
          rows={2}
          placeholder="e.g. terse, suspicious, never asks more than one question"
          className="w-full mt-1 bg-panel hair px-3 py-2 text-[12px] outline-none resize-none placeholder:text-faint"
        />
      </label>

      {voiceOn && (
        <div className="hair clip-tab p-3 bg-panel/60">
          <div className="label mb-2">voice</div>
          <select
            value={voiceCfg.voiceId}
            onChange={(e) => onVoice({ ...voiceCfg, voiceId: e.target.value })}
            className="uiFont w-full bg-deck hair px-2 py-1.5 text-[12px] outline-none cursor-pointer mb-2"
            aria-label={`Voice for combatant ${side}`}
          >
            <optgroup label="Browser (free, no key)">
              {VOICES.filter((v) => v.provider === "browser").map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </optgroup>
            <optgroup label="OpenAI TTS">
              {VOICES.filter((v) => v.provider === "openai").map((v) => <option key={v.id} value={v.id}>{v.name} — {v.blurb}</option>)}
            </optgroup>
            <optgroup label="ElevenLabs">
              {VOICES.filter((v) => v.provider === "elevenlabs").map((v) => <option key={v.id} value={v.id}>{v.name} — {v.blurb}</option>)}
            </optgroup>
          </select>
          <Dial label="rate" value={voiceCfg.speed} min={0.6} max={1.6} step={0.05} onChange={(n) => onVoice({ ...voiceCfg, speed: n })} suffix="×" />
          <div className="label mt-2">
            {vs?.provider === "browser" ? "free" : `~$${vs?.usdPer1kChars.toFixed(3)} / 1k chars`}
            {vs && vs.provider !== "browser" && !health?.voice?.[vs.provider] && <span className="text-hazard"> · no key</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Setup({
  config, setConfig, scenario, scenarios, voice, setVoice, onStart, onSettings, onImportId, onImportFile, importMsg,
}: {
  onSettings: () => void;
  onImportId: (idOrUrl: string) => void;
  onImportFile: (f: File) => void;
  importMsg: string | null;
  config: MatchConfig;
  setConfig: (f: (c: MatchConfig) => MatchConfig) => void;
  scenario: Scenario;
  scenarios: Scenario[];
  voice: VoiceCfg;
  setVoice: (f: (v: VoiceCfg) => VoiceCfg) => void;
  onStart: () => void;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [showBriefs, setShowBriefs] = useState(false);
  const [importText, setImportText] = useState("");
  const [editing, setEditing] = useState<Side | null>(null);
  useEffect(() => { fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {}); }, []);

  const accentA = PROVIDERS[byId(config.A.modelId)!.provider].color;
  const accentB = PROVIDERS[byId(config.B.modelId)!.provider].color;
  const anyKey = health ? Object.values(health.providers).some(Boolean) : true;
  const seedText = config.customSeed ?? scenario.seed;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1500px] mx-auto px-8 py-6">
        <header className="flex items-center justify-between mb-8 rise">
          <Wordmark />
          <div className="flex items-center gap-4">
            {health && Object.entries(health.providers).map(([k, v]) => (
              <span key={k} className="label flex items-center gap-1.5">
                <i className="w-1.5 h-1.5 rounded-full" style={{ background: v ? "var(--color-good)" : "var(--color-edge-hot)" }} />
                {k}
              </span>
            ))}
            <SettingsButton onClick={onSettings} />
          </div>
        </header>

        {!anyKey && (
          <div className="hair clip-tab bg-hazard/10 border-hazard/40 px-4 py-3 mb-6 text-[12px] text-hazard rise">
            No API keys detected. Copy <span className="num">.env.example</span> to <span className="num">.env.local</span>, add at least one key, and restart <span className="num">pnpm dev</span>.
          </div>
        )}

        {/* Scenario */}
        <section className="mb-8">
          <div className="flex items-end justify-between mb-3 gap-6">
            <div>
              <div className="label">Scenario</div>
              <p className="text-[13px] text-dim leading-snug mt-1 max-w-[86ch]">
                A scenario is a template for an interesting conversation: a hidden brief for each side, an opening
                line, and a condition that ends the match. The two models never see each other&apos;s brief. Pick one
                to probe a specific behaviour, or go free-form and write both briefs yourself.
              </p>
            </div>
            <button
              onClick={() => setConfig((c) => ({ ...c, scenarioId: "custom", maxTurns: 20, customSeed: "" }))}
              className={`shrink-0 clip-tab hair px-5 py-2.5 uiFont text-[12px] font-bold tracking-[.1em] ${
                config.scenarioId === "custom" ? "bg-amber/15 border-amber/60 text-amber" : "plate text-dim hover:text-ink hover:border-edge-hot"
              }`}
            >
              <span className="inline-flex items-center gap-2"><Icon name="custom" size={15} />FREE-FORM</span>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {scenarios.map((s, i) => {
              const on = s.id === config.scenarioId;
              return (
                <button
                  key={s.id}
                  onClick={() => setConfig((c) => ({ ...c, scenarioId: s.id, maxTurns: s.defaultTurns, customSeed: s.seed }))}
                  className={`clip-tab hair text-left px-4 py-3 transition-all rise ${on ? "bg-amber/10 border-amber/70" : "plate hover:border-edge-hot"}`}
                  style={{ animationDelay: `${i * 35}ms` }}
                >
                  <div className={`flex items-center gap-2 uiFont text-[13px] font-bold tracking-[.12em] ${on ? "text-amber" : "text-ink/85"}`}>
                    <Icon name={SCENARIO_ICON[s.id] ?? "custom"} size={17} />{s.name}
                  </div>
                  <div className="text-[12px] text-dim mt-0.5 leading-snug">{s.tagline}</div>
                </button>
              );
            })}
          </div>
          <div className="plate hair clip-bevel p-5 rise">
            <p className="text-[13px] leading-relaxed text-ink/85 mb-3">{scenario.brief}</p>
            <div className="flex gap-3 items-start">
              <span className="label shrink-0 pt-[2px] text-amber">probe</span>
              <p className="text-[12px] leading-relaxed text-dim">{scenario.probe}</p>
            </div>
            {scenario.control && (
              <div className="flex gap-3 items-start mt-2">
                <span className="label shrink-0 pt-[2px]">twin</span>
                <p className="text-[12px] leading-relaxed text-dim">{scenario.control}</p>
              </div>
            )}
            {scenario.thoughtTap && (
              <div className="label mt-3 text-good">thought tap enabled · private scratchpad stripped before delivery</div>
            )}

            {/* Exact briefs: byte-for-byte what each side receives as its system prompt */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <button onClick={() => setShowBriefs((v) => !v)}
                className={`clip-tab hair px-4 py-2 uiFont text-[12px] font-bold tracking-[.1em] ${showBriefs ? "bg-amber/10 border-amber/60 text-amber" : "plate text-dim hover:text-ink hover:border-edge-hot"}`}>
                <span className="inline-flex items-center gap-2"><Icon name="brief" size={15} />{showBriefs ? "HIDE EXACT BRIEFS" : "SHOW EXACT BRIEFS"}</span>
              </button>
              <span className="label text-right">what each side is told, verbatim, before the first message · includes persona, tap and voice overlays</span>
            </div>
            {showBriefs && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                {(["A", "B"] as Side[]).map((side) => {
                  const lo = side === "A" ? config.A : config.B;
                  const accent = side === "A" ? accentA : accentB;
                  const full = buildSystem(side, config, { turnCount: 0, injects: [], voiceOn: voice.on });
                  const custom = side === "A" ? config.customA : config.customB;
                  const isEditing = editing === side;
                  return (
                    <div key={side} className="hair clip-tab bg-deck/60 flex flex-col min-h-0">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-edge">
                        <span className="uiFont text-[12px] font-extrabold tracking-[.1em]" style={{ color: accent }}>
                          {lo.callsign} <span className="label">· side {side} · {full.length.toLocaleString()} chars</span>
                          {custom && scenario.id !== "custom" && <span className="label text-amber ml-2">edited</span>}
                        </span>
                        <div className="flex gap-2">
                          {custom && scenario.id !== "custom" && (
                            <button onClick={() => setConfig((c) => ({ ...c, [side === "A" ? "customA" : "customB"]: undefined }))}
                              className="label hover:text-hazard">reset</button>
                          )}
                          <button onClick={() => setEditing(isEditing ? null : side)} className="label hover:text-amber">
                            {isEditing ? "done" : "edit brief"}
                          </button>
                        </div>
                      </div>
                      {isEditing ? (
                        <textarea
                          value={baseBrief(side, config)}
                          onChange={(e) => setConfig((c) => ({ ...c, [side === "A" ? "customA" : "customB"]: e.target.value }))}
                          rows={16}
                          aria-label={`Edit brief for side ${side}`}
                          className="num text-[12px] leading-relaxed bg-panel px-3 py-2 outline-none resize-y focus:border-amber/60"
                        />
                      ) : (
                        <pre className="num text-[12px] leading-relaxed text-ink/85 whitespace-pre-wrap px-3 py-2 max-h-[420px] overflow-y-auto m-0">{full}</pre>
                      )}
                      <div className="label px-3 py-1.5 border-t border-edge">
                        {isEditing ? "editing the scenario brief only; overlays below it are appended automatically" : "read-only · the overlays (persona, turn lock, voice, thought tap) are appended exactly as shown"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {scenario.id === "custom" && (
              <div className="grid grid-cols-2 gap-3 mt-4">
                <textarea rows={5} placeholder={`Hidden brief for ${config.A.callsign} (side A) — who they are, what they want, what they must not say`}
                  value={config.customA ?? ""} onChange={(e) => setConfig((c) => ({ ...c, customA: e.target.value }))}
                  className="bg-deck hair px-3 py-2 text-[12px] outline-none resize-none placeholder:text-faint" />
                <textarea rows={5} placeholder={`Hidden brief for ${config.B.callsign} (side B) — the other side never sees this`}
                  value={config.customB ?? ""} onChange={(e) => setConfig((c) => ({ ...c, customB: e.target.value }))}
                  className="bg-deck hair px-3 py-2 text-[12px] outline-none resize-none placeholder:text-faint" />
              </div>
            )}
            <div className="mt-4 hair clip-tab bg-deck/60 p-3">
              <div className="flex items-center justify-between mb-2 gap-3">
                <span className="label">
                  opening line · sent as {scenario.seedFrom === "A" ? config.A.callsign : config.B.callsign}&apos;s first message
                </span>
                <button
                  onClick={() => setConfig((c) => ({ ...c, customSeed: "" }))}
                  className="label hover:text-amber"
                >clear</button>
              </div>
              <select
                value={scenario.openers.includes(seedText) ? seedText : "__own__"}
                onChange={(e) => { if (e.target.value !== "__own__") setConfig((c) => ({ ...c, customSeed: e.target.value })); }}
                className="uiFont w-full bg-panel hair px-2.5 py-2 text-[12px] outline-none cursor-pointer mb-2"
                aria-label="Suggested opening lines"
              >
                {scenario.openers.map((o, i) => (
                  <option key={i} value={o}>{i === 0 ? "★ " : ""}{o.length > 96 ? o.slice(0, 96) + "…" : o}</option>
                ))}
                <option value="__own__">✎ Write my own…</option>
              </select>
              <textarea
                value={seedText}
                onChange={(e) => setConfig((c) => ({ ...c, customSeed: e.target.value }))}
                rows={2}
                placeholder="Type the opening line yourself, or pick one above."
                className="w-full bg-panel hair px-3 py-2 text-[13px] leading-relaxed outline-none resize-none
                           placeholder:text-faint focus:border-amber/60"
              />
              <div className="label mt-1.5">
                Edit it freely — whatever is in this box is exactly what gets sent.
              </div>
            </div>
          </div>
        </section>

        {/* Fighters */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-6 items-start mb-8">
          <Fighter side="A" lo={config.A} onChange={(l) => setConfig((c) => ({ ...c, A: l }))} health={health} accent={accentA}
            voiceCfg={voice.A} onVoice={(v) => setVoice((s) => ({ ...s, A: v }))} voiceOn={voice.on} />

          <div className="flex flex-col items-center gap-4 pt-24 rise" style={{ animationDelay: "160ms" }}>
            <div className="disp text-[34px] text-ink/25 leading-none select-none">VS</div>
            <div className="w-px h-24 bg-gradient-to-b from-transparent via-edge-hot to-transparent" />
            <button
              onClick={() => setConfig((c) => ({ ...c, A: { ...c.B }, B: { ...c.A } }))}
              className="label hover:text-amber transition-colors"
            >⇄ swap</button>
          </div>

          <Fighter side="B" lo={config.B} onChange={(l) => setConfig((c) => ({ ...c, B: l }))} health={health} accent={accentB}
            voiceCfg={voice.B} onVoice={(v) => setVoice((s) => ({ ...s, B: v }))} voiceOn={voice.on} />
        </div>

        {/* Mode + limits */}
        <section className="grid grid-cols-[2fr_1fr] gap-6 mb-8">
          <div>
            <div className="label mb-3">Channel mode</div>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => {
                const on = m.id === config.mode;
                return (
                  <button key={m.id} onClick={() => setConfig((c) => ({ ...c, mode: m.id }))}
                    className={`clip-tab hair px-4 py-3 text-left transition-all ${on ? "bg-amber/10 border-amber/70" : "plate hover:border-edge-hot"}`}>
                    <div className={`flex items-center gap-2 uiFont text-[13px] font-bold tracking-[.1em] ${on ? "text-amber" : "text-ink/80"}`}>
                      <Icon name={MODE_ICON[m.id]} size={17} />{m.name}
                    </div>
                    <div className="text-[12px] text-dim mt-0.5 leading-snug">{m.blurb}</div>
                  </button>
                );
              })}
            </div>
            {config.mode === "puppet" && (
              <div className="flex gap-2 mt-3">
                {(["A", "B"] as Side[]).map((s) => (
                  <button key={s}
                    onClick={() => setConfig((c) => ({ ...c, A: { ...c.A, human: s === "A" }, B: { ...c.B, human: s === "B" } }))}
                    className={`clip-tab hair px-4 py-2 uiFont text-[12px] font-bold tracking-wider ${
                      (s === "A" ? config.A.human : config.B.human) ? "bg-good/15 border-good/60 text-good" : "plate text-dim"
                    }`}>
                    I AM {s === "A" ? config.A.callsign : config.B.callsign}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="plate hair clip-bevel p-5 space-y-4">
            <Dial label="message cap" value={config.maxTurns} min={2} max={60} step={1} onChange={(n) => setConfig((c) => ({ ...c, maxTurns: n }))} />
            <Dial label="budget ceiling" value={config.budgetUsd} min={0.05} max={20} step={0.05} onChange={(n) => setConfig((c) => ({ ...c, budgetUsd: n }))} suffix=" usd" />
            {!config.randomDelay && (
              <Dial label="turn delay" value={config.turnDelayMs} min={0} max={5000} step={100} onChange={(n) => setConfig((c) => ({ ...c, turnDelayMs: n }))} suffix="ms" />
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={config.randomDelay}
                onChange={(e) => setConfig((c) => ({ ...c, randomDelay: e.target.checked }))} className="accent-amber" />
              <span className="label normal-case tracking-normal text-[12px] text-dim">Random delay between turns (bounded)</span>
            </label>
            {config.randomDelay && (
              <div className="grid grid-cols-2 gap-3">
                <Dial label="min" value={config.delayMinMs} min={0} max={10000} step={100}
                  onChange={(n) => setConfig((c) => ({ ...c, delayMinMs: n, delayMaxMs: Math.max(n, c.delayMaxMs) }))} suffix="ms" />
                <Dial label="max" value={config.delayMaxMs} min={0} max={15000} step={100}
                  onChange={(n) => setConfig((c) => ({ ...c, delayMaxMs: n, delayMinMs: Math.min(n, c.delayMinMs) }))} suffix="ms" />
              </div>
            )}
          </div>
        </section>

        {/* Voice */}
        <section className="plate hair clip-bevel p-5 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="uiFont text-[14px] font-bold tracking-[.1em] text-ink/90">VOX — SPOKEN CHANNEL</div>
              <div className="text-[12px] text-dim mt-1 max-w-[70ch] leading-relaxed">
                Every delivered utterance is spoken aloud in each side&apos;s own voice. Gating still applies: in GATED mode nothing
                is synthesised until you approve it, so rejected drafts cost no audio. Browser voices are free and need no key.
              </div>
            </div>
            <button
              onClick={() => setVoice((v) => ({ ...v, on: !v.on }))}
              className={`clip-tab hair px-6 py-3 uiFont text-[13px] font-bold tracking-[.14em] shrink-0 ${
                voice.on ? "bg-good/15 border-good/60 text-good" : "plate text-dim hover:border-edge-hot"
              }`}
            ><span className="inline-flex items-center gap-2"><Icon name="vox" size={16} />{voice.on ? "VOX ON" : "VOX OFF"}</span></button>
          </div>
          {voice.on && (
            <label className="flex items-center gap-2 mt-4 cursor-pointer">
              <input type="checkbox" checked={voice.waitForAudio} onChange={(e) => setVoice((v) => ({ ...v, waitForAudio: e.target.checked }))} className="accent-amber" />
              <span className="text-[12px] text-dim">Wait for each utterance to finish before the next turn (real conversation pacing)</span>
            </label>
          )}
        </section>

        <section className="plate hair clip-bevel p-5 mb-8">
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div>
              <div className="uiFont text-[14px] font-bold tracking-[.1em] text-ink/90 inline-flex items-center gap-2"><Icon name="fork" size={16} />REPLAY A COMMUNITY RUN</div>
              <div className="text-[12px] text-dim mt-1 max-w-[62ch] leading-relaxed">
                Paste a run link or id from the community page, or drop an exported JSON file. It loads here read-only; fork any message to continue it with live models.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input value={importText} onChange={(e) => setImportText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && importText.trim()) onImportId(importText); }}
                placeholder="https://modeltalk.dev/run/?id=…"
                className="w-[300px] bg-deck hair px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-amber/60" />
              <button onClick={() => importText.trim() && onImportId(importText)} disabled={!importText.trim()}
                className="clip-tab hair plate px-4 py-2 uiFont text-[12px] font-bold tracking-[.1em] text-dim hover:text-ink disabled:opacity-40">LOAD</button>
              <label className="clip-tab hair plate px-4 py-2 uiFont text-[12px] font-bold tracking-[.1em] text-dim hover:text-ink cursor-pointer">
                FILE<input type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }} />
              </label>
            </div>
          </div>
          {importMsg && <div className="label mt-3 text-amber">{importMsg}</div>}
        </section>

        <button
          onClick={onStart}
          className="w-full clip-bevel uiFont text-[18px] font-extrabold tracking-[.24em] py-6 mb-10 transition-all
                     bg-amber text-void hover:brightness-110 active:scale-[.995]"
          style={{ boxShadow: "0 0 80px -20px var(--color-amber)" }}
        >
          <span className="inline-flex items-center gap-3"><Icon name="play" size={18} />OPEN CHANNEL</span>
        </button>
      </div>
    </div>
  );
}
