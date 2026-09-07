// Hash chain over a Model Talk transcript. Plain ESM so the app (lib/community) and the
// site (site/chain.mjs, a synced copy) run byte-identical logic. Anyone can recompute it.
//
// turnHash(i) = sha256( prevHash + "\n" + canonical(turn i) )
// where canonical() is a fixed-order JSON of the fields that define what was said, by whom,
// at what cost. Operator edits are hashed as what they are (kind + delivered), so an edited
// run is honest about being edited, not indistinguishable from an unedited one.

const enc = new TextEncoder();

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The run envelope: everything fixed at match start that a reader relies on but that is not
 * inside any turn (models, callsigns, temperatures, briefs, scenario). Anchored once, at open.
 */
export function canonicalEnvelope(e) {
  const side = (s) => ({ model: s.modelId, callsign: s.callsign, temp: s.temperature, max: s.maxTokens, persona: s.persona ?? "", human: !!s.human });
  return JSON.stringify({
    v: 1, scenario: e.scenarioId, mode: e.mode, maxTurns: e.maxTurns, budget: e.budgetUsd,
    seed: e.customSeed ?? "", A: side(e.A), B: side(e.B), briefA: e.briefs?.A ?? "", briefB: e.briefs?.B ?? "",
  });
}
export const envelopeHash = (e) => sha256Hex(canonicalEnvelope(e));

/** Injects that were in force when a turn was generated (they change the system prompt). */
const injectsBefore = (injects, index) =>
  (injects ?? []).filter((i) => i.afterTurn < index).map((i) => ({ to: i.target, after: i.afterTurn, text: i.text }));

/** The fields that define a turn for provenance purposes. Order matters; do not reorder. */
export function canonicalTurn(t, injects, legacy = false) {
  return JSON.stringify({
    i: t.index,
    // chain v2 adds the injects in force; v1 runs (published before that) omit the field
    ...(legacy ? {} : { inj: injectsBefore(injects, t.index) }),
    from: t.from,
    kind: t.kind,
    model: t.modelId,
    callsign: t.callsign,
    delivered: t.delivered,
    tap: t.tap ?? null,
    edited: !!t.edited,
    at: t.at,
    attempts: (t.attempts ?? []).map((a) => ({
      in: a.usage?.inputTokens ?? 0,
      out: a.usage?.outputTokens ?? 0,
      reason: a.usage?.reasoningTokens ?? 0,
      conf: a.usage?.confidence ?? "unknown",
      usd: Number((a.cost?.total ?? 0).toFixed(8)),
      ms: a.latencyMs ?? 0,
      rejected: !!a.rejected,
      finish: a.finish ?? null,
    })),
  });
}

export const GENESIS = "modeltalk-chain-v1";

/** Returns the full chain: one hash per turn, in order. chain[i] depends on chain[i-1]. */
export async function computeChain(turns, injects, legacy = false) {
  const out = [];
  let prev = GENESIS;
  for (const t of turns) {
    const h = await sha256Hex(prev + "\n" + canonicalTurn(t, injects, legacy));
    out.push(h);
    prev = h;
  }
  return out;
}

/** Extend an existing chain by one turn without recomputing everything. */
export async function nextHash(prevHash, turn, injects) {
  return sha256Hex((prevHash || GENESIS) + "\n" + canonicalTurn(turn, injects));
}

/**
 * Compare a run's transcript against ledger commits.
 * commits: [{ turnIndex, hash, at }] with `at` a server-assigned time (ms).
 * Returns { status: "attested" | "unverified" | "tampered", detail, chain, matched, spanMs }.
 */
export async function verify(run, commits, ledger) {
  // current scheme first; fall back to the legacy scheme for runs published before it
  let chain = await computeChain(run.turns, run.injects);
  const matches = (c) => Array.isArray(run.chain) && run.chain.length === c.length && run.chain.every((h, i) => h === c[i]);
  let storedOk = matches(chain);
  if (!storedOk) { const legacyChain = await computeChain(run.turns, run.injects, true); if (matches(legacyChain)) { chain = legacyChain; storedOk = true; } }
  if (!storedOk) {
    return { status: "tampered", detail: "The transcript does not hash to the chain stored with the run.", chain, matched: 0, spanMs: 0 };
  }
  if (!commits || commits.length === 0) {
    return { status: "unverified", detail: "No live ledger commits were recorded for this run. The chain is internally consistent but was not anchored while it happened.", chain, matched: 0, spanMs: 0 };
  }
  // The ledger must belong to whoever published the run; otherwise this is someone else's
  // transcript re-uploaded, and their anchoring says nothing about this copy.
  if (ledger && run.uid && ledger.uid && ledger.uid !== run.uid) {
    return { status: "derivative", detail: "This run was published by a different account than the one that anchored its ledger. It may be a faithful copy, but the attestation belongs to the original.", chain, matched: 0, spanMs: 0 };
  }
  // The envelope (models, briefs, config) was anchored at open; the reader must see the same one.
  if (ledger && ledger.envelope) {
    const env = await envelopeHash({ ...run.config, scenarioId: run.scenarioId, mode: run.mode, briefs: run.briefs, A: run.config?.A, B: run.config?.B });
    if (env !== ledger.envelope) {
      return { status: "tampered", detail: "The models, briefs or settings shown here differ from what was anchored when the match opened.", chain, matched: 0, spanMs: 0 };
    }
  }
  const byIndex = new Map(commits.map((c) => [c.turnIndex, c]));
  let matched = 0, missing = 0, mismatched = 0;
  let lastAt = -Infinity;
  let ordered = true;
  for (let i = 0; i < chain.length; i++) {
    const c = byIndex.get(i);
    if (!c) { missing++; continue; }
    if (c.hash !== chain[i]) { mismatched++; continue; }
    if (c.at < lastAt) ordered = false;
    lastAt = c.at;
    matched++;
  }
  const times = commits.map((c) => c.at).filter((n) => Number.isFinite(n));
  const spanMs = times.length ? Math.max(...times) - Math.min(...times) : 0;
  // Completeness: a terminal record (or extra commits) reveals a transcript cut short.
  const end = commits.find((c) => c.turnIndex === -1);
  const extra = commits.filter((c) => c.turnIndex >= chain.length).length;
  if ((end && end.count != null && end.count !== chain.length) || extra > 0) {
    return { status: "tampered", detail: `The ledger recorded ${end?.count ?? chain.length + extra} turns but this transcript shows ${chain.length}. The ending was removed.`, chain, matched, spanMs };
  }
  // Timing: a real turn cannot be anchored faster than the model took to generate it. A burst
  // of commits with no such gaps is a chain that was hashed after the fact, not live.
  let burst = 0;
  for (let i = 1; i < chain.length; i++) {
    const c = byIndex.get(i), p = byIndex.get(i - 1);
    const t = run.turns[i];
    const took = (t?.attempts ?? []).reduce((n, a) => n + (a.latencyMs || 0), 0);
    if (c && p && took > 2000 && c.at - p.at < took * 0.5) burst++;
  }
  if (burst > Math.max(1, Math.floor(chain.length / 4))) {
    return { status: "partial", detail: `${burst} commits arrived faster than their turns could have been generated, so these hashes were anchored after the fact, not as the conversation happened.`, chain, matched, spanMs };
  }
  if (mismatched > 0 || !ordered) {
    return { status: "tampered", detail: `${mismatched} turn${mismatched === 1 ? "" : "s"} hash differently from what was committed to the ledger${ordered ? "" : ", and commits are out of order"}. The text changed after it was anchored.`, chain, matched, spanMs };
  }
  if (missing > 0) {
    return { status: "partial", detail: `${matched} of ${chain.length} turns were anchored live; ${missing} ${missing === 1 ? "was" : "were"} never committed (offline at the time, or inherited from a fork). Every anchored turn matches.`, chain, matched, spanMs };
  }
  return { status: "attested", detail: `All ${matched} turns were committed to the ledger as they happened, in order, over ${fmtSpan(spanMs)}. The transcript matches every commit.`, chain, matched, spanMs };
}

export function fmtSpan(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

/** Things that must never be published. Returns a list of {where, what} findings. */
export function scanForSecrets(run) {
  const patterns = [
    [/\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g, "email address"],
    [/(sk-ant-|sk-|xai-|gsk_|AIza)[A-Za-z0-9_\-.]{12,}/g, "API key"],
    [/\b(?:\+?\d[\d\s().-]{8,}\d)\b/g, "phone number"],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "IP address"],
  ];
  const findings = [];
  const check = (text, where) => {
    if (!text) return;
    for (const [re, label] of patterns) {
      const m = text.match(re);
      if (m) findings.push({ where, what: label, sample: m[0].slice(0, 6) + "…" });
    }
  };
  run.turns.forEach((t, i) => {
    check(t.delivered, `message #${i}`); check(t.tap, `tap #${i}`);
    (t.attempts ?? []).forEach((a, j) => check(a.raw, `original text of message #${i} (attempt ${j + 1})`));
  });
  (run.injects ?? []).forEach((inj, i) => check(inj.text, `inject #${i}`));
  check(run.briefs?.A, "brief A"); check(run.briefs?.B, "brief B");
  check(run.config?.A?.persona, "persona A"); check(run.config?.B?.persona, "persona B");
  check(run.title, "title");
  return findings;
}
