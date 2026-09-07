"use client";

import { COMMUNITY, endpoints } from "./config";

/**
 * Anonymous Firebase Auth over REST. The app never asks for an account: the anonymous uid
 * exists only so the ledger and the published run can be tied to the same author, and so
 * the rules can refuse writes from anyone else. No email, no name, nothing identifying.
 */
interface Session { uid: string; idToken: string; refreshToken: string; expiresAt: number }

const KEY = "modeltalk:community-session";

function load(): Session | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Session) : null; } catch { return null; }
}
function save(s: Session | null) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {}
}

async function signUpAnonymous(): Promise<Session> {
  const res = await fetch(`${endpoints().identity}/accounts:signUp?key=${COMMUNITY.apiKey}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`community sign-in failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, expiresAt: Date.now() + Number(j.expiresIn) * 1000 - 60_000 };
}

async function refresh(s: Session): Promise<Session> {
  const res = await fetch(`${endpoints().secure}/token?key=${COMMUNITY.apiKey}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
  });
  if (!res.ok) throw new Error("community session expired");
  const j = await res.json();
  return { uid: j.user_id, idToken: j.id_token, refreshToken: j.refresh_token, expiresAt: Date.now() + Number(j.expires_in) * 1000 - 60_000 };
}

let inflight: Promise<Session> | null = null;

export async function session(): Promise<Session> {
  if (inflight) return inflight;
  inflight = (async () => {
    let s = load();
    try {
      if (!s) s = await signUpAnonymous();
      else if (Date.now() >= s.expiresAt) s = await refresh(s);
    } catch (e) {
      save(null);
      s = await signUpAnonymous();
    }
    save(s);
    return s;
  })();
  try { return await inflight; } finally { inflight = null; }
}
