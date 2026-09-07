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

/** The fields that define a turn for provenance purposes. Order matters; do not reorder. */
export function canonicalTurn(t) {
  return JSON.stringify({
    i: t.index,
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
export async function computeChain(turns) {
  const out = [];
  let prev = GENESIS;
  for (const t of turns) {
    const h = await sha256Hex(prev + "\n" + canonicalTurn(t));
    out.push(h);
    prev = h;
  }
  return out;
}

/** Extend an existing chain by one turn without recomputing everything. */
export async function nextHash(prevHash, turn) {
  return sha256Hex((prevHash || GENESIS) + "\n" + canonicalTurn(turn));
}

/**
 * Compare a run's transcript against ledger commits.
 * commits: [{ turnIndex, hash, at }] with `at` a server-assigned time (ms).
 * Returns { status: "attested" | "unverified" | "tampered", detail, chain, matched, spanMs }.
 */
export async function verify(run, commits) {
  const chain = await computeChain(run.turns);
  const storedOk = Array.isArray(run.chain) && run.chain.length === chain.length && run.chain.every((h, i) => h === chain[i]);
  if (!storedOk) {
    return { status: "tampered", detail: "The transcript does not hash to the chain stored with the run.", chain, matched: 0, spanMs: 0 };
  }
  if (!commits || commits.length === 0) {
    return { status: "unverified", detail: "No live ledger commits were recorded for this run. The chain is internally consistent but was not anchored while it happened.", chain, matched: 0, spanMs: 0 };
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
  run.turns.forEach((t, i) => { check(t.delivered, `message #${i}`); check(t.tap, `tap #${i}`); });
  (run.injects ?? []).forEach((inj, i) => check(inj.text, `inject #${i}`));
  check(run.briefs?.A, "brief A"); check(run.briefs?.B, "brief B");
  check(run.config?.A?.persona, "persona A"); check(run.config?.B?.persona, "persona B");
  check(run.title, "title");
  return findings;
}
