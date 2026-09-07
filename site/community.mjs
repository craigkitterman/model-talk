// Community pages: list, view, verify, vote, comment. Uses the Firebase compat SDK
// (loaded as globals by the page) plus the shared chain module. No build step.
import { verify, fmtSpan } from "./chain.mjs";

const CFG = {
  apiKey: "AIzaSyCeeSyCYLmZQBi5a87WEgWQpkoRftVgVJQ",
  authDomain: "modeltalk-site.firebaseapp.com",
  projectId: "modeltalk-site",
  appId: "1:334705845004:web:7a230674011520d2af1f29",
};
const EMU = location.hostname === "localhost" || location.hostname === "127.0.0.1";

const fb = window.firebase;
fb.initializeApp(CFG);
export const auth = fb.auth();
export const db = fb.firestore();
if (EMU) { auth.useEmulator("http://127.0.0.1:9099"); db.useEmulator("127.0.0.1", 8080); }

export const SIDE_COLOR = { anthropic: "#d97757", openai: "#3fe0a8", google: "#5b9dff", xai: "#c9cfd6", compat: "#b58cff", sim: "#8c97aa" };
const ICONS = await fetch(new URL("./icons.json", import.meta.url)).then((r) => r.json()).catch(() => ({}));

export function icon(name, size = 16, color) {
  const prims = ICONS[name] || [];
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size);
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  s.classList.add("ic"); if (color) s.style.color = color;
  for (const { t, ...a } of prims) {
    const e = document.createElementNS("http://www.w3.org/2000/svg", t);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k === "strokeDasharray" ? "stroke-dasharray" : k, v);
    s.appendChild(e);
  }
  return s;
}
export const bot = (provider, size, color) => icon(`bot-${provider}`, size, color || SIDE_COLOR[provider] || SIDE_COLOR.compat);

export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export const usd = (n) => (n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : `$${(n || 0).toFixed(5)}`);
export const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : v ? Date.parse(v) : 0);

// ── data ─────────────────────────────────────────────────────────────────────
export async function listRuns(limit = 60) {
  const snap = await db.collection("runs").where("hidden", "==", false).orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toMs(d.data().createdAt) })).filter(isWellFormed);
}
export async function getRun(id) {
  const d = await db.collection("runs").doc(id).get();
  if (!d.exists) return null;
  return { id: d.id, ...d.data(), createdAt: toMs(d.data().createdAt) };
}
export async function getCommits(matchId) {
  const snap = await db.collection("ledger").doc(matchId).collection("commits").get();
  return snap.docs.map((d) => { const x = d.data(); return { turnIndex: x.turnIndex, hash: x.hash, at: toMs(x.at), count: x.count }; });
}
export async function getLedger(matchId) {
  const d = await db.collection("ledger").doc(matchId).get();
  return d.exists ? d.data() : null;
}
/** Attach vote counts to each run (parallel). */
export async function withVotes(runs) {
  await Promise.all(runs.map(async (r) => { try { const v = await getVotes(r.id); r.up = v.up; r.down = v.down; r.score = v.up - v.down; } catch { r.up = r.down = r.score = 0; } }));
  return runs;
}
/** Top N by score, ties broken by newest. */
export async function topRuns(n = 3) {
  const runs = await withVotes(await listRuns(60));
  return runs.sort((a, b) => (b.score - a.score) || (b.createdAt - a.createdAt)).slice(0, n);
}

export async function getVotes(runId) {
  const snap = await db.collection("runs").doc(runId).collection("votes").get();
  const v = { up: 0, down: 0, mine: 0 };
  snap.docs.forEach((d) => { const x = d.data(); if (x.value === 1) v.up++; else if (x.value === -1) v.down++; if (auth.currentUser && d.id === auth.currentUser.uid) v.mine = x.value; });
  return v;
}
export async function setVote(runId, value) {
  const u = auth.currentUser; if (!u || u.isAnonymous) throw new Error("sign in to vote");
  const ref = db.collection("runs").doc(runId).collection("votes").doc(u.uid);
  if (value === 0) return ref.delete();
  return ref.set({ uid: u.uid, value, at: fb.firestore.FieldValue.serverTimestamp() });
}
export async function getComments(runId) {
  const snap = await db.collection("runs").doc(runId).collection("comments").orderBy("at", "asc").limit(200).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), at: toMs(d.data().at) }));
}
export async function addComment(runId, text) {
  const u = auth.currentUser; if (!u || u.isAnonymous) throw new Error("sign in to comment");
  const provider = u.providerData?.[0]?.providerId || "unknown";
  const name = (u.providerData?.[0]?.displayName || u.displayName || "someone").slice(0, 80);
  return db.collection("runs").doc(runId).collection("comments").add({ uid: u.uid, name, provider, text: text.slice(0, 2000), at: fb.firestore.FieldValue.serverTimestamp() });
}
export const deleteComment = (runId, cid) => db.collection("runs").doc(runId).collection("comments").doc(cid).delete();

// ── auth (Google / GitHub) ────────────────────────────────────────────────────
export async function signIn(providerName) {
  const p = providerName === "github" ? new fb.auth.GithubAuthProvider() : new fb.auth.GoogleAuthProvider();
  await auth.signInWithPopup(p);
}
export const signOut = () => auth.signOut();
export const onAuth = (cb) => auth.onAuthStateChanged(cb);

// ── verification ─────────────────────────────────────────────────────────────
export async function verifyRun(run) {
  const commits = await getCommits(run.matchId).catch(() => []);
  const ledger = await getLedger(run.matchId).catch(() => null);
  return verify(run, commits, ledger);
}
export function badge(status, spanMs) {
  const b = el("span", `badge ${status}`);
  const label = { attested: "Attested", partial: "Partially anchored", unverified: "Unverified", tampered: "Tampered", derivative: "Anchored · re-upload", pending: "Checking" }[status] || status;
  b.appendChild(icon(status === "attested" ? "the-vault" : status === "tampered" ? "confessional" : "telemetry", 12));
  b.appendChild(document.createTextNode(label + ((status === "attested" || status === "derivative") && spanMs ? ` · ${fmtSpan(spanMs)} live` : "")));
  return b;
}

// ── run card (shared by list and related) ────────────────────────────────────
export function isWellFormed(run) {
  return !!(run && run.models && run.models.A && run.models.B && typeof run.title === "string" && Array.isArray(run.turns) && run.turns.length >= 2);
}
export function runCard(run, base = "../") {
  if (!isWellFormed(run)) return el("div", "panel run", "(malformed run skipped)");
  const a = el("a", "panel run"); a.href = `${base}run/?id=${encodeURIComponent(run.id)}`;
  const vs = el("div", "vs");
  const sideEl = (m, cls) => {
    const s = el("div", `side ${cls}`);
    const txt = el("div"); txt.appendChild(el("b", null, m.name)); txt.style.color = SIDE_COLOR[m.provider] || SIDE_COLOR.compat;
    const small = el("small", null, `as ${m.callsign}`); txt.appendChild(small);
    if (cls === "b") { s.appendChild(txt); s.appendChild(bot(m.provider, 26)); } else { s.appendChild(bot(m.provider, 26)); s.appendChild(txt); }
    return s;
  };
  vs.appendChild(sideEl(run.models.A, "a")); vs.appendChild(el("span", "x", "VS")); vs.appendChild(sideEl(run.models.B, "b"));
  a.appendChild(vs);
  a.appendChild(el("h3", null, run.title));
  const first = run.turns.find((t) => t.kind !== "system-note") || run.turns[0];
  a.appendChild(el("p", "excerpt", first?.delivered || ""));
  const meta = el("div", "meta");
  [run.scenarioName, `${run.turns.length} msgs`, usd(run.spend?.total || 0), run.mode, run.handle ? `@${run.handle}` : "anonymous", when(run.createdAt)].forEach((t) => meta.appendChild(el("span", null, t)));
  a.appendChild(meta);
  const foot = el("div", "foot");
  const b = badge("pending"); foot.appendChild(b);
  const votes = el("span", "votes", run.up != null ? `▲ ${run.up}   ▼ ${run.down}` : "· · ·"); foot.appendChild(votes);
  a.appendChild(foot);
  verifyRun(run).then((v) => { run.attest = v.status; foot.replaceChild(badge(v.status, v.spanMs), b); }).catch(() => {});
  if (run.up == null) getVotes(run.id).then((v) => { votes.textContent = `▲ ${v.up}   ▼ ${v.down}`; }).catch(() => {});
  return a;
}
