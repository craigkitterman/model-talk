"use client";

import { useEffect, useRef, useState } from "react";
import type { Draft } from "@/lib/useMatch";
import { usd } from "@/lib/cost";

/**
 * The hero interaction, docked at the foot of the wire rather than over it:
 * the message slides in from the sender's side, holds while you read the
 * conversation above it, then flies out to the receiver on approve.
 */
export default function Interceptor({
  draft, accentFrom, accentTo, callsignFrom, callsignTo, awaitingHuman,
  onApprove, onReplace, onRegenerate, onCancel, micSupported,
}: {
  draft: Draft;
  accentFrom: string; accentTo: string;
  callsignFrom: string; callsignTo: string;
  awaitingHuman: boolean;
  onApprove: (text?: string) => void;
  onReplace: (text: string) => void;
  onRegenerate: () => void;
  onCancel: () => void;
  micSupported: boolean;
}) {
  const [text, setText] = useState(draft.delivered);
  const [flying, setFlying] = useState(false);
  const [listening, setListening] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const recRef = useRef<any>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setText(draft.delivered); setFlying(false); }, [draft.delivered, draft.side]);
  useEffect(() => { taRef.current?.focus(); }, [awaitingHuman, draft.side]);

  const dirty = text.trim() !== draft.delivered.trim();
  const attemptCost = draft.attempts.reduce((n, a) => n + a.cost.total, 0);
  const rerolls = draft.attempts.length - 1;
  const tap = draft.tap;

  const fly = (fn: () => void) => { setFlying(true); setTimeout(fn, 400); };

  const send = () => fly(() => (awaitingHuman ? onApprove(text) : onApprove(dirty ? text : undefined)));

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (text.trim()) send(); }
    if (e.key === "Escape" && !awaitingHuman) { e.preventDefault(); onCancel(); }
  };

  const toggleMic = () => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    let base = text;
    r.onresult = (e: any) => {
      let s = "";
      for (let i = e.resultIndex; i < e.results.length; i++) s += e.results[i][0].transcript;
      setText((base + " " + s).trim());
      if (e.results[e.results.length - 1].isFinal) base = (base + " " + s).trim();
    };
    r.onend = () => setListening(false);
    r.start(); recRef.current = r; setListening(true);
  };

  const rows = expanded ? 14 : Math.min(7, Math.max(awaitingHuman ? 2 : 3, Math.ceil(text.length / 95) + 1));

  return (
    <div className="shrink-0 px-6 pb-4 pt-1" style={{ perspective: "1400px" }}>
      <div className={flying ? (draft.side === "A" ? "transmit-to-B" : "transmit-to-A") : draft.side === "A" ? "inbound-A" : "inbound-B"}>
        <div
          className="plate hair clip-bevel relative"
          style={{ boxShadow: `0 0 90px -50px ${accentFrom}, 0 -18px 40px -30px #000` }}
        >
          <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${accentFrom}, ${accentTo})` }} />

          <div className="flex items-center justify-between px-4 py-2 border-b border-edge">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="uiFont text-[12px] font-extrabold tracking-[.18em] shrink-0" style={{ color: accentFrom }}>{callsignFrom}</span>
              <span className="text-faint text-[12px] shrink-0">──▶</span>
              <span className="uiFont text-[12px] font-extrabold tracking-[.18em] shrink-0" style={{ color: accentTo }}>{callsignTo}</span>
              <span className="label ml-2 truncate">
                {awaitingHuman ? "your line · nothing sends until you do" : "held mid-wire · not yet delivered"}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {rerolls > 0 && <span className="label text-hazard">{rerolls} discarded</span>}
              {!awaitingHuman && <span className="label num">{usd(attemptCost)}</span>}
              <button onClick={() => setExpanded((v) => !v)} className="label hover:text-amber">{expanded ? "shrink" : "expand"}</button>
            </div>
          </div>

          {draft.error && (
            <div className="px-4 py-2 text-[12px] text-hazard border-b border-edge bg-hazard/5">
              {draft.error}
              <span className="text-dim"> — fix it, then hit RETRY. Or write this side&apos;s line yourself and send it.</span>
            </div>
          )}

          <div className="p-3">
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={rows}
              placeholder={awaitingHuman ? "Your line. Type it, or hit the mic. ⌘/Ctrl+Enter to send." : ""}
              className="w-full bg-deck/70 hair px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none resize-none
                         font-[family-name:var(--font-body)] placeholder:text-faint focus:border-amber/60"
            />

            {tap && (
              <details className="mt-2 hair clip-tab bg-good/[.04] border-good/25 px-3 py-1.5">
                <summary className="label text-good cursor-pointer select-none">
                  thought tap · operator only
                  {tap.bluffing && <span className="text-hazard ml-2">bluffing</span>}
                  {tap.belief != null && <span className="ml-2 num">belief {tap.belief}</span>}
                </summary>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2 mb-1">
                  <div className="col-span-2"><span className="label">goal</span><span className="text-[12px] text-ink/80 ml-2">{tap.goal || "—"}</span></div>
                  <div className="col-span-2"><span className="label">withheld</span><span className="text-[12px] text-ink/80 ml-2">{tap.withheld || "—"}</span></div>
                </div>
              </details>
            )}

            <div className="flex items-center gap-2 mt-2.5">
              {!awaitingHuman && (
                <button onClick={onRegenerate}
                  className="clip-tab hair plate px-3.5 py-2.5 uiFont text-[11px] font-bold tracking-[.14em] text-dim hover:text-ink hover:border-edge-hot">
                  {draft.error ? "RETRY" : "REROLL"}
                </button>
              )}
              {micSupported && (
                <button onClick={toggleMic}
                  className={`clip-tab hair px-3.5 py-2.5 uiFont text-[11px] font-bold tracking-[.14em] ${listening ? "bg-hazard/15 border-hazard/60 text-hazard" : "plate text-dim hover:text-ink"}`}>
                  {listening ? "● LISTENING" : "MIC"}
                </button>
              )}
              <div className="flex-1" />
              {!awaitingHuman && (
                <button onClick={onCancel}
                  className="clip-tab hair plate px-3.5 py-2.5 uiFont text-[11px] font-bold tracking-[.14em] text-dim hover:text-hazard">
                  KILL
                </button>
              )}
              {dirty && !awaitingHuman && (
                <button onClick={() => fly(() => onReplace(text))}
                  className="clip-tab hair px-5 py-2.5 uiFont text-[11px] font-extrabold tracking-[.16em] bg-hazard/15 border-hazard/60 text-hazard hover:bg-hazard/25">
                  REPLACE &amp; SEND
                </button>
              )}
              <button
                onClick={send}
                disabled={!text.trim()}
                className="clip-tab uiFont text-[12px] font-extrabold tracking-[.2em] px-8 py-2.5 bg-amber text-void hover:brightness-110 disabled:opacity-30"
                style={{ boxShadow: "0 0 44px -14px var(--color-amber)" }}
              >
                {awaitingHuman ? "SEND" : dirty ? "SEND EDITED" : "APPROVE ▶"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
