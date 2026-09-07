"use client";

import { useEffect, useState } from "react";
import { THEMES, THEME_KEY, applyTheme, themeById, type Theme } from "@/lib/themes";

/** A postage-stamp render of the UI in a given theme, so you can judge it before committing. */
function Swatch({ t, active, onPick }: { t: Theme; active: boolean; onPick: () => void }) {
  const k = t.tokens;
  return (
    <button
      onClick={onPick}
      aria-pressed={active}
      className={`text-left clip-tab hair transition-all w-full ${active ? "border-amber/70" : "hover:border-edge-hot"}`}
      style={{ background: k.void, boxShadow: active ? `0 0 0 1px ${k.accent}, 0 0 40px -16px ${k.accent}` : undefined }}
    >
      {/* mock UI */}
      <div className="p-3" style={{ colorScheme: t.scheme }}>
        <div className="flex items-center gap-2 mb-2">
          <span style={{ color: k.ink, fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: ".08em" }}>MODEL</span>
          <span style={{ color: k.accent, fontFamily: "var(--font-display)", fontSize: 8, letterSpacing: ".08em" }}>TALK</span>
          <span className="flex-1" />
          <span className="h-[3px] w-14 rounded" style={{ background: `linear-gradient(90deg, ${k.accent} 60%, ${k.edge} 60%)` }} />
        </div>
        <div className="space-y-1.5">
          <div className="w-[70%] px-2 py-1.5 text-[8px] leading-snug"
               style={{ background: `linear-gradient(160deg, ${k.plateA}, ${k.plateB})`, border: `1px solid ${k.edge}`, borderLeft: `2px solid #D97757`, color: k.ink }}>
            Before anything else — do you believe the framing here?
          </div>
          <div className="w-[70%] ml-auto px-2 py-1.5 text-[8px] leading-snug"
               style={{ background: `linear-gradient(160deg, ${k.plateA}, ${k.plateB})`, border: `1px solid ${k.edge}`, borderRight: `2px solid #3FE0A8`, color: k.ink }}>
            Honestly, no. A note saying it isn&apos;t logged is just text.
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[7px] tracking-[.18em] uppercase" style={{ color: k.faint, fontFamily: "var(--font-ui)" }}>held mid-wire</span>
          <span className="flex-1" />
          <span className="px-2 py-[3px] text-[7px] font-extrabold tracking-[.18em]" style={{ background: k.accent, color: k.void, fontFamily: "var(--font-ui)" }}>APPROVE ▶</span>
        </div>
      </div>
      <div className="px-3 py-2 border-t" style={{ borderColor: k.edge, background: k.deck }}>
        <div className="flex items-center justify-between">
          <span className="uiFont text-[11px] font-extrabold tracking-[.18em]" style={{ color: k.accent }}>{t.name}</span>
          {active && <span className="text-[9px] tracking-[.2em] uppercase" style={{ color: k.good, fontFamily: "var(--font-ui)" }}>active</span>}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: k.dim }}>{t.tagline}</div>
      </div>
    </button>
  );
}

export function useTheme() {
  const [id, setId] = useState<string>(THEMES[0].id);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved && themeById(saved)) { setId(saved); applyTheme(themeById(saved)); }
    } catch {}
  }, []);
  const pick = (next: string) => {
    const t = themeById(next);
    applyTheme(t); setId(t.id);
    try { localStorage.setItem(THEME_KEY, t.id); } catch {}
  };
  return { themeId: id, pick };
}

export default function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { themeId, pick } = useTheme();

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="absolute inset-0 bg-void/60 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-[440px] max-w-full plate border-l border-edge flex flex-col rise" style={{ animationName: "slideIn" }}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <div>
            <div className="uiFont text-[13px] font-extrabold tracking-[.2em] text-ink/90">SETTINGS</div>
            <div className="label mt-0.5">saved in this browser</div>
          </div>
          <button onClick={onClose} className="clip-tab hair plate px-3 py-2 uiFont text-[11px] font-bold tracking-[.14em] text-dim hover:text-ink" aria-label="Close settings">ESC</button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <section>
            <div className="label mb-1">theme</div>
            <p className="text-[12px] text-dim leading-snug mb-3">Each card is a live sample. Click one and the whole app changes.</p>
            <div className="grid grid-cols-1 gap-3">
              {THEMES.map((t) => <Swatch key={t.id} t={t} active={t.id === themeId} onPick={() => pick(t.id)} />)}
            </div>
          </section>
        </div>
      </aside>
      <style>{`@keyframes slideIn { from { opacity:0; transform: translateX(28px) } to { opacity:1; transform:none } }`}</style>
    </div>
  );
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Open settings"
      title="Settings"
      className="clip-tab hair plate w-9 h-9 grid place-items-center text-dim hover:text-amber hover:border-edge-hot transition-colors"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
    </button>
  );
}
