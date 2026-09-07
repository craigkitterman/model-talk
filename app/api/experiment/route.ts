import { NextRequest } from "next/server";
import { maxCost, planExperiment, runExperiment } from "@/lib/experiment";
import { redact } from "@/lib/providers";
import { rejectCrossSite } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Headless experiments. POST a manifest, get NDJSON back: one line per event (plan, turn,
 * trial, done). `{ "dry": true, "manifest": … }` validates and returns the plan only, spending
 * nothing. Same loopback + same-origin guard as /api/generate: a web page cannot start this.
 * One experiment at a time per server; the budget in the manifest is a hard between-request stop.
 */
let running: symbol | null = null;

export async function POST(req: NextRequest) {
  const refused = rejectCrossSite(req);
  if (refused) return refused;
  let body: { dry?: boolean; manifest?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return new Response("bad json", { status: 400 }); }
  const manifest = body?.manifest ?? body;

  if (body?.dry) {
    try {
      const { trials, briefs, manifest: m } = planExperiment(manifest);
      return Response.json({
        ok: true, name: m.name, trials: trials.length, conditions: m.conditions.map((c) => c.id), briefs,
        maxCostUsd: maxCost(m, trials),
        plan: trials.map((t) => ({ index: t.index, conditionId: t.conditionId, seed: t.seed, swapped: t.swapped, A: t.config.A.modelId, B: t.config.B.modelId, maxTurns: t.config.maxTurns })),
      });
    } catch (e) {
      return new Response(e instanceof Error ? e.message : String(e), { status: 400 });
    }
  }

  if (running) return new Response("an experiment is already running on this server", { status: 429 });
  try { planExperiment(manifest); } catch (e) { return new Response(e instanceof Error ? e.message : String(e), { status: 400 }); }

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());
  const enc = new TextEncoder();
  // the lock is owned by this request; only its own completion releases it, so a cancelled run
  // that is still settling cannot free the slot for a second experiment
  const owner = Symbol("experiment");
  running = owner;
  const events = runExperiment(manifest, ac.signal);
  const release = () => { if (running === owner) running = null; };
  const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");
  const stream = new ReadableStream({
    // pull-based: one event per read, so a slow client throttles what is buffered
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) { release(); controller.close(); return; }
        controller.enqueue(line(value));
      } catch (e) {
        try { controller.enqueue(line({ type: "error", message: redact(e instanceof Error ? e.message : String(e)) })); } catch {}
        release(); controller.close();
      }
    },
    async cancel() { ac.abort(); try { await events.return(undefined); } catch {} release(); },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
