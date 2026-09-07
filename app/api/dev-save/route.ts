import { NextRequest } from "next/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rejectCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development-only: save a run export to docs/runs/<name>.json on the machine running
 * the dev server. Refused outright in any other environment.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") return new Response("not found", { status: 404 });
  const refused = rejectCrossSite(req);
  if (refused) return refused;
  const { name, run } = (await req.json().catch(() => ({}))) as { name?: string; run?: unknown };
  if (!name || !/^[A-Za-z0-9._-]{1,80}$/.test(name) || !run) return new Response("bad request", { status: 400 });
  const dir = join(process.cwd(), "docs", "runs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(run, null, 1));
  return Response.json({ ok: true, path: `docs/runs/${name}.json` });
}
