import { NextRequest } from "next/server";
import { streamCompletion } from "@/lib/providers";
import type { GenerateRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ONE REQUEST = ONE DRAFT. The turn loop lives in the browser.
 * The server never waits on a human, so approval can take a minute or a week
 * without holding a connection or a promise open.
 */
export async function POST(req: NextRequest) {
  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!body?.modelId || !Array.isArray(body.history)) {
    return new Response("missing modelId or history", { status: 400 });
  }

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      let clean = false;
      try {
        for await (const ev of streamCompletion(body, ac.signal)) {
          send(ev);
          if (ev.type === "done") clean = true;
        }
        // EOF without a done event means the upstream cut out mid-generation.
        if (!clean) send({ type: "error", message: "stream ended without completion (partial draft)" });
      } catch (e: unknown) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
    cancel() { ac.abort(); },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
