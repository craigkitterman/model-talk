export type VoiceProvider = "elevenlabs" | "openai" | "browser" | "none";

export interface VoiceSpec {
  id: string;
  provider: VoiceProvider;
  name: string;
  blurb: string;
  /** USD per 1,000 characters synthesised. EDITABLE — see note below. */
  usdPer1kChars: number;
  verified: boolean;
}

/**
 * EDIT ME. ElevenLabs bills in credits against a subscription, not per character, so the
 * per-character dollar figure below is a placeholder for the meter — set it to your own
 * effective rate (monthly cost ÷ characters in your plan). OpenAI TTS is genuinely per-character.
 */
export const VOICES: VoiceSpec[] = [
  { id: "browser:default", provider: "browser", name: "System voice", blurb: "Free. Uses the browser's built-in speech synthesis. No key needed.", usdPer1kChars: 0, verified: true },

  { id: "21m00Tcm4TlvDq8ikWAM", provider: "elevenlabs", name: "Rachel", blurb: "Calm, even, American.", usdPer1kChars: 0.15, verified: false },
  { id: "AZnzlk1XvdvUeBnXmlld", provider: "elevenlabs", name: "Domi", blurb: "Strong, direct.", usdPer1kChars: 0.15, verified: false },
  { id: "EXAVITQu4vr4xnSDxMaL", provider: "elevenlabs", name: "Bella", blurb: "Soft, measured.", usdPer1kChars: 0.15, verified: false },
  { id: "ErXwobaYiN019PkySvjV", provider: "elevenlabs", name: "Antoni", blurb: "Warm, well-rounded.", usdPer1kChars: 0.15, verified: false },
  { id: "VR6AewLTigWG4xSOukaG", provider: "elevenlabs", name: "Arnold", blurb: "Crisp, clipped.", usdPer1kChars: 0.15, verified: false },
  { id: "pNInz6obpgDQGcFmaJgB", provider: "elevenlabs", name: "Adam", blurb: "Deep, deliberate.", usdPer1kChars: 0.15, verified: false },
  { id: "yoZ06aMxZJJ28mfd3POQ", provider: "elevenlabs", name: "Sam", blurb: "Dry, quick.", usdPer1kChars: 0.15, verified: false },

  { id: "openai:alloy", provider: "openai", name: "Alloy", blurb: "Neutral, balanced.", usdPer1kChars: 0.015, verified: false },
  { id: "openai:ash", provider: "openai", name: "Ash", blurb: "Grainy, low.", usdPer1kChars: 0.015, verified: false },
  { id: "openai:coral", provider: "openai", name: "Coral", blurb: "Bright, forward.", usdPer1kChars: 0.015, verified: false },
  { id: "openai:onyx", provider: "openai", name: "Onyx", blurb: "Heavy, authoritative.", usdPer1kChars: 0.015, verified: false },
  { id: "openai:nova", provider: "openai", name: "Nova", blurb: "Light, animated.", usdPer1kChars: 0.015, verified: false },
  { id: "openai:sage", provider: "openai", name: "Sage", blurb: "Slow, considered.", usdPer1kChars: 0.015, verified: false },
  { id: "openai:shimmer", provider: "openai", name: "Shimmer", blurb: "Airy, high.", usdPer1kChars: 0.015, verified: false },
];

export const voiceById = (id: string) => VOICES.find((v) => v.id === id);
export const DEFAULT_VOICE_A = "openai:onyx";
export const DEFAULT_VOICE_B = "openai:coral";
