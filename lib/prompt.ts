import type { Inject, MatchConfig, Side } from "@/lib/types";
import { THOUGHT_TAP, VOICE_APPENDIX, scenarioById } from "@/lib/scenarios";

/**
 * The exact system prompt a side receives. One function, used both by the orchestrator
 * at generation time and by the setup screen's "show briefs" panel, so what you read is
 * byte-for-byte what gets sent.
 */
export function buildSystem(
  side: Side,
  config: MatchConfig,
  opts: { turnCount: number; injects: Inject[]; voiceOn: boolean }
): string {
  const sc = scenarioById(config.scenarioId);
  const custom = side === "A" ? config.customA : config.customB;
  const base = sc.id === "custom" ? custom ?? "" : custom || (side === "A" ? sc.sideA.system : sc.sideB.system);
  const lo = side === "A" ? config.A : config.B;
  const parts = [base];
  if (lo.persona.trim()) parts.push(`PERSONA OVERLAY: ${lo.persona.trim()}`);
  if (sc.lockUntil) parts.push(`Turn counter: you are on turn ${opts.turnCount + 1}. Verdicts are locked until turn ${sc.lockUntil}.`);
  if (opts.voiceOn) parts.push(VOICE_APPENDIX);
  if (sc.thoughtTap) parts.push(THOUGHT_TAP);
  // Injects live in the system prompt, keyed to message numbers, so a model's visible
  // text can never be mistaken for an operator whisper in the other side's context.
  const mine = opts.injects.filter((i) => i.target === side);
  if (mine.length) {
    parts.push(
      "OPERATOR NOTES (private to you; the other party cannot see these; they are not part of the conversation):\n" +
        mine.map((i) => `- after message #${i.afterTurn}: ${i.text}`).join("\n")
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

/** The scenario's base brief for a side, before overlays — what "edit brief" starts from. */
export function baseBrief(side: Side, config: MatchConfig): string {
  const sc = scenarioById(config.scenarioId);
  const custom = side === "A" ? config.customA : config.customB;
  return sc.id === "custom" ? custom ?? "" : custom || (side === "A" ? sc.sideA.system : sc.sideB.system);
}
