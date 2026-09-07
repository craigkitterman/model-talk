import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Synthesise one utterance. Returns audio/mpeg bytes, or 4xx with a readable reason. */
export async function POST(req: NextRequest) {
  const { voiceId, text, speed = 1 } = (await req.json().catch(() => ({}))) as {
    voiceId?: string; text?: string; speed?: number;
  };
  if (!voiceId || !text?.trim()) return new Response("missing voiceId or text", { status: 400 });

  try {
    if (voiceId.startsWith("openai:")) {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return new Response("OPENAI_API_KEY is not set in .env.local", { status: 428 });
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
          voice: voiceId.slice(7),
          input: text.slice(0, 4000),
          response_format: "mp3",
          speed,
        }),
      });
      if (!res.ok) return new Response(`OpenAI TTS ${res.status}: ${await res.text()}`, { status: 502 });
      return new Response(await res.arrayBuffer(), { headers: { "content-type": "audio/mpeg" } });
    }

    // ElevenLabs
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return new Response("ELEVENLABS_API_KEY is not set in .env.local", { status: 428 });
    const modelId = process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5";
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "xi-api-key": key },
        body: JSON.stringify({
          text: text.slice(0, 4000),
          model_id: modelId,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, speed },
        }),
      }
    );
    if (!res.ok) return new Response(`ElevenLabs ${res.status}: ${await res.text()}`, { status: 502 });
    return new Response(await res.arrayBuffer(), { headers: { "content-type": "audio/mpeg" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : String(e), { status: 500 });
  }
}
