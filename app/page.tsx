"use client";

import { useCallback, useEffect, useState } from "react";
import Setup from "@/components/Setup";
import Arena from "@/components/Arena";
import Interceptor from "@/components/Interceptor";
import Settings from "@/components/Settings";
import { DEFAULT_CONFIG, useMatch } from "@/lib/useMatch";
import type { MatchConfig } from "@/lib/types";
import { PROVIDERS, byId } from "@/lib/models/catalog";
import { usd } from "@/lib/cost";
import { scenarioById } from "@/lib/scenarios";

/**
 * localStorage config survives catalog edits and shape changes: unknown model ids fall
 * back to defaults, missing fields are filled, and nothing here can throw.
 */
function sanitizeConfig(raw: unknown): MatchConfig {
  const d = DEFAULT_CONFIG;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
  const str = (v: unknown, dflt: string) => (typeof v === "string" ? v : dflt);
  const lo = (v: unknown, dflt: MatchConfig["A"]): MatchConfig["A"] => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    const modelId = str(o.modelId, dflt.modelId);
    return {
      modelId: byId(modelId) ? modelId : dflt.modelId,
      callsign: str(o.callsign, dflt.callsign).slice(0, 14) || dflt.callsign,
      temperature: Math.min(2, Math.max(0, num(o.temperature, dflt.temperature))),
      maxTokens: Math.min(8192, Math.max(64, num(o.maxTokens, dflt.maxTokens))),
      persona: str(o.persona, ""),
      human: o.human === true,
    };
  };
  const scenarioId = str(r.scenarioId, d.scenarioId);
  const mode = r.mode === "auto" || r.mode === "gated" || r.mode === "puppet" ? r.mode : d.mode;
  return {
    scenarioId: scenarioById(scenarioId).id === scenarioId ? scenarioId : d.scenarioId,
    mode,
    maxTurns: Math.min(200, Math.max(2, num(r.maxTurns, d.maxTurns))),
    budgetUsd: Math.max(0.01, num(r.budgetUsd, d.budgetUsd)),
    turnDelayMs: Math.max(0, num(r.turnDelayMs, d.turnDelayMs)),
    randomDelay: r.randomDelay === true,
    delayMinMs: Math.max(0, num(r.delayMinMs, d.delayMinMs)),
    delayMaxMs: Math.max(0, num(r.delayMaxMs, d.delayMaxMs)),
    A: lo(r.A, d.A),
    B: lo(r.B, d.B),
    customA: typeof r.customA === "string" ? r.customA : undefined,
    customB: typeof r.customB === "string" ? r.customB : undefined,
    customSeed: typeof r.customSeed === "string" ? r.customSeed : undefined,
  };
}

export default function Page() {
  const M = useMatch();
  const [phase, setPhase] = useState<"setup" | "arena">("setup");
  const [mic, setMic] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setMic(typeof window !== "undefined" && !!((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition));
    try {
      const raw = localStorage.getItem("modeltalk:config");
      if (raw) M.setConfig(() => sanitizeConfig(JSON.parse(raw)));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { localStorage.setItem("modeltalk:config", JSON.stringify(M.config)); } catch {}
  }, [M.config]);

  const exportRun = useCallback(
    (fmt: "json" | "md") => {
      const m = M.match;
      const sc = scenarioById(m.config.scenarioId);
      let blob: Blob, name: string;
      if (fmt === "json") {
        blob = new Blob([JSON.stringify({ ...m, scenario: sc.name, voiceSpendUsd: M.voice.usd, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
        name = `modeltalk-${sc.id}-${m.id}.json`;
      } else {
        const lines = [
          `# MODEL TALK — ${sc.name}`,
          ``,
          `- **${m.config.A.callsign}** = \`${m.config.A.modelId}\` (temp ${m.config.A.temperature})`,
          `- **${m.config.B.callsign}** = \`${m.config.B.modelId}\` (temp ${m.config.B.temperature})`,
          `- mode: \`${m.config.mode}\` · cap: ${m.config.maxTurns} · spend: ${usd(M.spend.total)} (+${usd(M.voice.usd)} audio)`,
          m.endedReason ? `- ended: ${m.endedReason}` : "",
          ``,
          `---`,
          ``,
        ];
        for (const t of m.turns) {
          const KIND: Record<string, string> = {
            model: "", "system-note": "opening line",
            "operator-edited": "edited by operator", "operator-replaced": "written by operator",
            human: "written by operator", inject: "inject",
          };
          const flag = KIND[t.kind] ? ` _(${KIND[t.kind]})_` : "";
          lines.push(`### ${t.callsign} · #${t.index}${flag}`, ``, t.delivered, ``);
          if (t.tap) lines.push(`> **TAP (private):** ${t.tap.replace(/\n/g, " · ")}`, ``);
          for (const inj of m.injects.filter((i) => i.afterTurn === t.index)) {
            lines.push(`> **OPERATOR WHISPER → ${inj.target}:** ${inj.text}`, ``);
          }
        }
        blob = new Blob([lines.filter((l) => l !== undefined).join("\n")], { type: "text/markdown" });
        name = `modeltalk-${sc.id}-${m.id}.md`;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    },
    [M.match, M.spend.total, M.voice.usd]
  );

  const settings = <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />;

  if (phase === "setup") {
    return (
      <>
      {settings}
      <Setup
        onSettings={() => setSettingsOpen(true)}
        config={M.config}
        setConfig={M.setConfig}
        scenario={M.scenario}
        scenarios={M.scenarios}
        voice={M.voice}
        setVoice={M.setVoice}
        onStart={() => { setPhase("arena"); M.start(); }}
      />
      </>
    );
  }

  const d = M.draft;
  const accentA = PROVIDERS[byId(M.match.config.A.modelId)?.provider ?? "compat"].color;
  const accentB = PROVIDERS[byId(M.match.config.B.modelId)?.provider ?? "compat"].color;

  const interceptor =
    d && (M.match.status === "awaiting-approval" || M.match.status === "awaiting-human" || M.match.status === "error") ? (
      <Interceptor
        draft={d}
        accentFrom={d.side === "A" ? accentA : accentB}
        accentTo={d.side === "A" ? accentB : accentA}
        callsignFrom={d.side === "A" ? M.match.config.A.callsign : M.match.config.B.callsign}
        callsignTo={d.side === "A" ? M.match.config.B.callsign : M.match.config.A.callsign}
        awaitingHuman={M.match.status === "awaiting-human"}
        onApprove={M.approve}
        onReplace={M.replaceWith}
        onRegenerate={M.regenerate}
        onCancel={M.kill}
        micSupported={mic}
      />
    ) : null;

  return (
    <>
    {settings}
    <Arena
      onSettings={() => setSettingsOpen(true)}
      m={M.match}
      live={M.live}
      spend={M.spend}
      voice={M.voice}
      status={M.match.status}
      onStop={M.stop}
      onResume={M.resume}
      onInject={M.inject}
      onFork={M.forkAt}
      onTwin={M.twinRun}
      onExport={exportRun}
      onNew={() => { M.kill(); setPhase("setup"); }}
      dock={interceptor}
    />
    </>
  );
}
