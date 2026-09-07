import type { NextRequest } from "next/server";

/**
 * A localhost app is still reachable by every web page the operator has open.
 * A cross-site `text/plain` POST needs no CORS preflight, so without this check any
 * site could burn the operator's API credit through /api/generate and /api/speak.
 * Browsers set Sec-Fetch-Site on every request; curl and same-origin pages pass.
 */
export function rejectCrossSite(req: NextRequest): Response | null {
  // The app is a localhost tool. Unless the operator opts in, refuse any request that did not
  // arrive on a loopback host: an exposed tunnel or LAN address would otherwise spend their keys.
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!loopback && process.env.ALLOW_REMOTE !== "1") {
    return new Response("refused: not a loopback host (set ALLOW_REMOTE=1 to expose this server deliberately)", { status: 403 });
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return new Response("cross-site requests are refused", { status: 403 });
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) {
    return new Response("content-type must be application/json", { status: 415 });
  }
  return null;
}

/** Bound the total prompt size so a runaway client can't submit megabytes per turn. */
export const MAX_PROMPT_CHARS = 400_000;
