import type { NextRequest } from "next/server";

/**
 * A localhost app is still reachable by every web page the operator has open.
 * A cross-site `text/plain` POST needs no CORS preflight, so without this check any
 * site could burn the operator's API credit through /api/generate and /api/speak.
 * Browsers set Sec-Fetch-Site on every request; curl and same-origin pages pass.
 */
export function rejectCrossSite(req: NextRequest): Response | null {
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
