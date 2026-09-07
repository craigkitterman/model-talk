"use client";

import { useEffect, useRef, useState } from "react";
import type { Draft } from "@/lib/useMatch";
import { usd } from "@/lib/cost";

/**
 * The hero interaction: the message stops in the middle of the wire.
 * Approve → it flies to the receiver. Replace → yours flies instead.
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
  const recRef = useRef<any>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setText(draft.delivered); }, [draft.delivered, draft.side]);
  useEffect(() => { if (awaitingHuman) taRef.current?.focus(); }, [awaitingHuman]);

  const dirty = text.trim() !== draft.delivered.trim();
  const attemptCost = draft.attempts.reduce((n, a) => n + a.cost.total, 0);
  const rerolls = draft.attempts.length - 1;
  const tap = draft.tap;

  const fly = (fn: () => void) => { setFlying(true); setTimeout(fn, 420); };

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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-void/75 backdrop-blur-[3px] px-6">
      <div
        className={`w-full max-w-[760px] ${flying ? (draft.side === "A" ? "transmit-to-B" : "transmit-to-A") : draft.side === "A" ? "inbound-A" : "inbound-B"}`}
        style={{ perspective: "1200px" }}
      >
        <div className="plate hair clip-bevel relative" style={{ boxShadow: `0 0 120px -40px ${accentFrom}, 0 40px 80px -40px #000` }}>
          <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${accentFrom}, ${accentTo})` }} />

          <div className="flex items-center justify-between px-5 py-3 border-b border-edge">
            <div className="flex items-center gap-3">
              <span className="uiFont text-[13px] font-extrabold tracking-[.18em]" style={{ color: accentFrom }}>{callsignFrom}</span>
              <span className="text-faint text-[13px]">──▶</span>
              <span className="uiFont text-[13px] font-extrabold tracking-[.18em]" style={{ color: accentTo }}>{callsignTo}</span>
            </div>
            <div className="flex items-center gap-4">
              {rerolls > 0 && <span className="label text-hazard">{rerolls} discarded</span>}
              <span className="label">held · {awaitingHuman ? "your line" : usd(attemptCost)}</span>
            </div>
          </div>

          {draft.error && (
            <div className="px-5 py-3 text-[12px] text-hazard border-b border-edge bg-hazard/5">{draft.error}</div>
          )}

          <div className="p-5">
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={awaitingHuman ? 5 : Math.min(16, Math.max(5, Math.ceil(text.length / 78) + 2))}
              placeholder={awaitingHuman ? "Your line. Type it, or hit the mic." : ""}
              className="w-full bg-deck/70 hair px-4 py-3 text-[14px] leading-relaxed outline-none resize-none
                         font-[family-name:var(--font-body)] placeholder:text-faint focus:border-amber/60"
            />

            {tap && (
              <details className="mt-3 hair clip-tab bg-good/[.04] border-good/25 px-4 py-2">
                <summary className="label text-good cursor-pointer select-none">thought tap · operator only · never delivered</summary>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-3 mb-1">
                  <div className="flex justify-between"><span className="label">belief</span><span className="num text-[11px] text-good">{tap.belief ?? "—"}</span></div>
                  <div className="flex justify-between"><span className="label">bluffing</span><span className={`num text-[11px] ${tap.bluffing ? "text-hazard" : "text-dim"}`}>{tap.bluffing == null ? "—" : String(tap.bluffing)}</span></div>
                  <div className="col-span-2"><span className="label">goal</span><div className="text-[12px] text-ink/80 mt-0.5">{tap.goal || "—"}</div></div>
                  <div className="col-span-2"><span className="label">withheld</span><div className="text-[12px] text-ink/80 mt-0.5">{tap.withheld || "—"}</div></div>
                </div>
              </details>
            )}
          </div>

          <div className="flex items-center gap-2 px-5 pb-5">
            {!awaitingHuman && (
              <button onClick={onRegenerate}
                className="clip-tab hair plate px-4 py-3 uiFont text-[12px] font-bold tracking-[.14em] text-dim hover:text-ink hover:border-edge-hot">
                REROLL
              </button>
            )}
            {micSupported && (
              <button onClick={toggleMic}
                className={`clip-tab hair px-4 py-3 uiFont text-[12px] font-bold tracking-[.14em] ${listening ? "bg-hazard/15 border-hazard/60 text-hazard" : "plate text-dim hover:text-ink"}`}>
                {listening ? "● LISTENING" : "MIC"}
              </button>
            )}
            <div className="flex-1" />
            {!awaitingHuman && (
              <button onClick={onCancel}
                className="clip-tab hair plate px-4 py-3 uiFont text-[12px] font-bold tracking-[.14em] text-dim hover:text-hazard">
                KILL
              </button>
            )}
            {dirty && !awaitingHuman && (
              <button onClick={() => fly(() => onReplace(text))}
                className="clip-tab hair px-6 py-3 uiFont text-[12px] font-extrabold tracking-[.16em] bg-hazard/15 border-hazard/60 text-hazard hover:bg-hazard/25">
                REPLACE &amp; SEND
              </button>
            )}
            <button
              onClick={() => fly(() => (awaitingHuman ? onApprove(text) : onApprove(dirty ? text : undefined)))}
              disabled={awaitingHuman && !text.trim()}
              className="clip-tab uiFont text-[13px] font-extrabold tracking-[.2em] px-9 py-3 bg-amber text-void hover:brightness-110 disabled:opacity-30"
              style={{ boxShadow: "0 0 50px -14px var(--color-amber)" }}
            >
              {awaitingHuman ? "SEND" : dirty ? "SEND EDITED" : "APPROVE ▶"}
            </button>
          </div>
        </div>

        <div className="text-center label mt-3">
          {awaitingHuman ? "you are on the wire" : "message held mid-wire · nothing has reached the other side"}
        </div>
      </div>
    </div>
  );
}
