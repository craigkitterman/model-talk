export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    providers: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      google: !!process.env.GOOGLE_API_KEY,
      xai: !!process.env.XAI_API_KEY,
      compat: !!process.env.COMPAT_BASE_URL,
    },
    voice: {
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      browser: true,
    },
  });
}
