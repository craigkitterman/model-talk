"use client";

import { useEffect, useMemo, useState } from "react";
import type { MatchState } from "@/lib/types";
import { buildRun, publishRun, type PublishedRun } from "@/lib/community";
import { COMMUNITY } from "@/lib/community/config";
import { Icon } from "./Icons";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — untyped shared module
import { scanForSecrets } from "@/shared/chain.mjs";

/**
 * One-click share to the community. Shows exactly what will be published, refuses if
 * anything key- or PII-shaped is in the transcript, and never sends anything the
 * preview doesn't list.
 */
export default function Share({
  m, spend, voiceOn, onClose,
}: { m: MatchState; spend: { a: number; b: number; discarded: number; total: number }; voiceOn: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string } | null>(null);

  const run: PublishedRun = useMemo(() => buildRun(m, spend, title, handle || null, voiceOn), [m, spend, title, handle, voiceOn]);
  const findings = useMemo(() => scanForSecrets(run) as { where: string; what: string }[], [run]);
  const anchored = (m.chain?.length ?? 0) === m.turns.length && !!m.ledgerOpen;

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const publish = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await publishRun(run);
      setDone({ url: r.url });
      try { await navigator.clipboard.writeText(r.url); } catch {}
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const bytes = new Blob([JSON.stringify(run)]).size;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Share to community">
      <div className="absolute inset-0 bg-void/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute inset-0 grid place-items-center p-6 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[720px] plate hair clip-bevel max-h-[90vh] flex flex-col" style={{ boxShadow: "var(--mt-glow-accent), var(--mt-shadow-lift)" }}>
          <header className="flex items-center justify-between px-5 py-4 border-b border-edge">
            <div className="flex items-center gap-3">
              <Icon name="export" size={18} className="text-amber" />
              <div>
                <div className="uiFont text-[13px] font-extrabold tracking-[.14em] text-ink/90">SHARE TO THE COMMUNITY</div>
                <div className="label mt-0.5">public · anonymous unless you add a handle</div>
              </div>
            </div>
            <button onClick={onClose} className="clip-tab hair plate px-3 py-2 uiFont text-[12px] font-bold tracking-[.14em] text-dim hover:text-ink" aria-label="Close">ESC</button>
          </header>

          {done ? (
            <div className="p-6 space-y-4">
              <div className="uiFont text-[15px] font-bold text-good">Published. Link copied to your clipboard.</div>
              <a href={done.url} target="_blank" rel="noreferrer" className="num text-[13px] text-amber underline break-all">{done.url}</a>
              <p className="text-[13px] text-dim">It appears on the community page immediately. Readers verify the transcript against the live ledger in their own browser.</p>
              <button onClick={onClose} className="clip-tab uiFont text-[12px] font-extrabold tracking-[.14em] px-6 py-3 bg-amber text-void">DONE</button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div className="grid grid-cols-[1fr_220px] gap-3">
                  <label className="block">
                    <span className="label">title</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140}
                      placeholder={run.title}
                      className="w-full mt-1 bg-deck hair px-3 py-2 text-[14px] outline-none placeholder:text-faint focus:border-amber/60" />
                  </label>
                  <label className="block">
                    <span className="label">github handle · optional</span>
                    <div className="flex items-center mt-1 bg-deck hair focus-within:border-amber/60">
                      <span className="pl-3 text-faint">@</span>
                      <input value={handle} onChange={(e) => setHandle(e.target.value.replace(/[^A-Za-z0-9-]/g, "").slice(0, 39))}
                        placeholder="anonymous" className="w-full bg-transparent px-2 py-2 text-[14px] outline-none placeholder:text-faint" />
                    </div>
                  </label>
                </div>

                <div className="hair bg-deck/60 p-4">
                  <div className="label mb-2">exactly what gets published</div>
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] text-ink/85">
                    <li>· {run.turns.length} messages, every operator edit flagged</li>
                    <li>· {run.turns.filter((t) => t.tap).length} private thought taps</li>
                    <li>· both exact briefs (system prompts)</li>
                    <li>· model ids, temperatures, max tokens, personas</li>
                    <li>· tokens, latency and cost per message</li>
                    <li>· {run.injects.length} operator whispers</li>
                    <li>· scenario, mode, budget, end reason</li>
                    <li>· the provenance chain ({run.chain.length} hashes)</li>
                  </ul>
                  <div className="label mt-3 text-good">not published: api keys, your name, email, machine, ip, the original text of any message you edited or rerolled, or anything outside this match · {(bytes / 1024).toFixed(0)} kb</div>
                </div>

                <div className={`hair p-3 text-[13px] ${anchored ? "border-good/40 bg-good/[.04] text-good" : "border-amber/40 bg-amber/[.04] text-amber"}`}>
                  {anchored
                    ? "Every turn of this run was anchored in the live ledger as it happened. It will show as ATTESTED."
                    : m.imported
                      ? "This is an imported run. If you originally ran it, its ledger is yours and it will verify normally; if someone else did, it will show as RE-UPLOAD."
                      : "The live ledger was not reachable for this run (offline, or community disabled). It will show as UNVERIFIED: internally consistent, but not anchored while it happened."}
                </div>

                {findings.length > 0 && (
                  <div className="hair border-hazard/50 bg-hazard/[.06] p-3 text-[13px] text-hazard">
                    <b>Blocked.</b> Looks like personal data or a key is in the transcript: {findings.map((f) => `${f.what} in ${f.where}`).join("; ")}. Edit or kill those messages, then share.
                  </div>
                )}

                <label className="flex items-start gap-2 cursor-pointer text-[13px] text-dim">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="accent-amber mt-1" />
                  <span>I understand this publishes the full transcript and briefs above to a public page under the MIT-licensed community, and that it cannot be edited afterward (only removed by the site owner).</span>
                </label>

                {err && <div className="hair border-hazard/50 bg-hazard/[.06] p-3 text-[13px] text-hazard">{err}</div>}
              </div>

              <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-edge">
                <span className="label">{COMMUNITY.siteUrl.replace(/^https?:\/\//, "")}/community</span>
                <div className="flex gap-2">
                  <button onClick={onClose} className="clip-tab hair plate px-4 py-3 uiFont text-[12px] font-bold tracking-[.14em] text-dim hover:text-ink">CANCEL</button>
                  <button onClick={publish} disabled={!agree || busy || findings.length > 0 || m.turns.length < 2}
                    className="clip-tab uiFont text-[12px] font-extrabold tracking-[.14em] px-7 py-3 bg-amber text-void disabled:opacity-40"
                    style={{ boxShadow: "var(--mt-glow-accent)" }}>
                    {busy ? "PUBLISHING…" : "PUBLISH"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
