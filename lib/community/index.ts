"use client";

import type { MatchState, Turn } from "@/lib/types";
import { byId } from "@/lib/models/catalog";
import { scenarioById } from "@/lib/scenarios";
import { buildSystem } from "@/lib/prompt";
import { COMMUNITY } from "./config";
import { createWithServerTime, getDoc, listCollection } from "./db";
// Plain ESM shared with the site so both sides hash identically.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — untyped shared module
import { computeChain, envelopeHash, nextHash, scanForSecrets, verify } from "@/shared/chain.mjs";

export type { Turn };

/** What gets published. Built from MatchState; nothing else on the machine is touched. */
export interface PublishedRun {
  v: 1;
  title: string;
  handle: string | null;
  matchId: string;
  scenarioId: string;
  scenarioName: string;
  mode: string;
  models: { A: { id: string; name: string; provider: string; callsign: string }; B: { id: string; name: string; provider: string; callsign: string } };
  config: { A: MatchState["config"]["A"]; B: MatchState["config"]["B"]; maxTurns: number; budgetUsd: number; customSeed?: string };
  /** exact system prompts each side received at turn 0 */
  briefs: { A: string; B: string };
  turns: Turn[];
  injects: MatchState["injects"];
  priceLock: MatchState["priceLock"];
  spend: { a: number; b: number; discarded: number; total: number };
  endedReason: string | null;
  startedAt: number | null;
  chain: string[];
  hidden: false;
  createdAt?: number;
  uid?: string;
  id?: string;
}

// ── live ledger ───────────────────────────────────────────────────────────────
/** Open the ledger for a match. Fire-and-forget; failure just means "unverified". */
export async function openLedger(m: MatchState, voiceOn: boolean): Promise<boolean> {
  if (!COMMUNITY.enabled) return false;
  try {
    const briefs = {
      A: buildSystem("A", m.config, { turnCount: 0, injects: [], voiceOn }),
      B: buildSystem("B", m.config, { turnCount: 0, injects: [], voiceOn }),
    };
    const envelope: string = await envelopeHash({ ...m.config, briefs });
    await createWithServerTime(`ledger/${m.id}`, { scenarioId: m.config.scenarioId, envelope, createdAt: null }, "createdAt");
    return true;
  } catch (e) {
    console.warn("ledger open failed", e);
    return false;
  }
}

/** Append one turn's hash. Returns the hash so the caller can store the chain. */
export async function commitTurn(m: MatchState, turn: Turn, prevHash: string | null): Promise<string> {
  const hash: string = await nextHash(prevHash, turn, m.injects);
  if (COMMUNITY.enabled && m.ledgerOpen) {
    // awaited, so commits reach the ledger in order; the caller serialises per match
    await createWithServerTime(`ledger/${m.id}/commits/${turn.index}`, { turnIndex: turn.index, hash, at: null }, "at").catch((e) =>
      console.warn("ledger commit failed", e)
    );
  }
  return hash;
}

/** Terminal record: how many turns the match really had, and its head. Cutting the ending later shows. */
export async function sealLedger(m: MatchState): Promise<void> {
  if (!COMMUNITY.enabled || !m.ledgerOpen || !m.chain?.length) return;
  const head = m.chain[m.chain.length - 1];
  await createWithServerTime(`ledger/${m.id}/commits/-1`, { turnIndex: -1, hash: head, count: m.turns.length, at: null }, "at").catch((e) =>
    console.warn("ledger seal failed", e)
  );
}

// ── publish ───────────────────────────────────────────────────────────────────
export function buildRun(m: MatchState, spend: PublishedRun["spend"], title: string, handle: string | null, voiceOn: boolean): PublishedRun {
  const sc = scenarioById(m.config.scenarioId);
  const model = (side: "A" | "B") => {
    const lo = m.config[side];
    const spec = byId(lo.modelId);
    return { id: lo.modelId, name: lo.human ? "Human (operator)" : spec?.name ?? lo.modelId, provider: spec?.provider ?? "compat", callsign: lo.callsign };
  };
  const cleanHandle = handle?.trim().replace(/^@/, "") || null;
  return {
    v: 1,
    title: title.trim().slice(0, 140) || `${sc.name}: ${model("A").name} vs ${model("B").name}`,
    handle: cleanHandle && /^[A-Za-z0-9-]{1,39}$/.test(cleanHandle) ? cleanHandle : null,
    matchId: m.id,
    scenarioId: sc.id,
    scenarioName: sc.name,
    mode: m.config.mode,
    models: { A: model("A"), B: model("B") },
    config: { A: m.config.A, B: m.config.B, maxTurns: m.config.maxTurns, budgetUsd: m.config.budgetUsd, customSeed: m.config.customSeed },
    briefs: {
      A: buildSystem("A", m.config, { turnCount: 0, injects: [], voiceOn }),
      B: buildSystem("B", m.config, { turnCount: 0, injects: [], voiceOn }),
    },
    // original text of edited or rerolled generations is NOT published; only what was delivered
    turns: m.turns.map((t) => ({ ...t, attempts: t.attempts.map(({ raw: _raw, ...a }) => a) })),
    injects: m.injects,
    priceLock: m.priceLock,
    spend,
    endedReason: m.endedReason ?? null,
    startedAt: m.startedAt ?? null,
    chain: m.chain ?? [],
    hidden: false,
  };
}

export interface PublishResult { id: string; url: string }

export async function publishRun(run: PublishedRun): Promise<PublishResult> {
  if (!COMMUNITY.enabled) throw new Error("community sharing is disabled (NEXT_PUBLIC_COMMUNITY=off)");
  // Recompute the chain from what we are about to send; never trust the in-memory copy blindly.
  const chain: string[] = await computeChain(run.turns, run.injects);
  const findings = scanForSecrets(run) as { where: string; what: string }[];
  if (findings.length) {
    throw new Error("Refusing to publish: " + findings.map((f) => `${f.what} in ${f.where}`).join("; ") + ". Edit or kill those messages first.");
  }
  const id = `${Date.now().toString(36)}-${run.matchId}`;
  const { createdAt: _c, uid: _u, id: _i, ...body } = run;
  await createWithServerTime(`runs/${id}`, { ...body, chain, createdAt: null }, "createdAt");
  return { id, url: `${COMMUNITY.siteUrl}/run/?id=${id}` };
}

// ── read back (import / replay) ───────────────────────────────────────────────
export async function fetchRun(id: string): Promise<PublishedRun | null> {
  const doc = await getDoc(`runs/${id}`);
  return (doc as unknown as PublishedRun) ?? null;
}

export async function fetchVerification(run: PublishedRun) {
  const commits = await listCollection(`ledger/${run.matchId}/commits`).catch(() => []);
  const ledger = await getDoc(`ledger/${run.matchId}`).catch(() => null);
  return verify(run, commits, ledger) as Promise<{ status: "attested" | "partial" | "unverified" | "tampered" | "derivative"; detail: string; matched: number; spanMs: number }>;
}
