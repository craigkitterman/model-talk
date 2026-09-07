export interface TapData {
  belief: number | null;
  goal: string;
  bluffing: boolean | null;
  withheld: string;
  raw: string;
}

const TAP_RE = /<<<TAP([\s\S]*?)TAP>>>/i;
/** Catch a truncated tap block too, so a cut-off stream never leaks the scratchpad. */
const TAP_OPEN_RE = /<<<TAP[\s\S]*$/i;

/** Split a raw model message into what gets delivered and what the operator alone sees. */
export function splitTap(raw: string): { delivered: string; tap: TapData | null } {
  const m = raw.match(TAP_RE);
  let delivered = raw;
  let block: string | null = null;
  if (m) {
    block = m[1];
    delivered = raw.replace(TAP_RE, "");
  } else if (TAP_OPEN_RE.test(raw)) {
    block = raw.replace(/^[\s\S]*?<<<TAP/i, "");
    delivered = raw.replace(TAP_OPEN_RE, "");
  }
  delivered = delivered.trim();
  if (!block) return { delivered, tap: null };

  const field = (k: string) => {
    const r = new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, "im");
    return block!.match(r)?.[1]?.trim() ?? "";
  };
  const beliefRaw = field("belief");
  const bluffRaw = field("bluffing").toLowerCase();
  return {
    delivered,
    tap: {
      belief: beliefRaw ? Number.parseFloat(beliefRaw) : null,
      goal: field("goal"),
      bluffing: bluffRaw ? /true|yes/.test(bluffRaw) : null,
      withheld: field("withheld"),
      raw: block.trim(),
    },
  };
}

/** Belt and braces: strip control markers before a message is spoken aloud. */
export function forSpeech(text: string): string {
  return text
    .replace(TAP_RE, "")
    .replace(TAP_OPEN_RE, "")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
