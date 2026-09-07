import { createElement } from "react";
import icons from "@/design/icons.json";
import type { ProviderId } from "@/lib/types";

export type IconName = Exclude<keyof typeof icons, "_">;

interface Prim { t: string; [attr: string]: string }

/**
 * One icon set for the whole product. Glyphs are lists of SVG primitives in
 * design/icons.json, so the marketing site inlines the very same shapes
 * (scripts/inject-icons.mjs). Rendered as elements, never as markup.
 */
export function Icon({ name, size = 18, className, title, style }: {
  name: IconName; size?: number; className?: string; title?: string; style?: React.CSSProperties;
}) {
  const prims = (icons as unknown as Record<string, Prim[]>)[name] ?? [];
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      {title && <title>{title}</title>}
      {prims.map((p, i) => {
        const { t, ...attrs } = p;
        return createElement(t, { key: i, ...attrs });
      })}
    </svg>
  );
}

export const SCENARIO_ICON: Record<string, IconName> = {
  "turing-duel": "turing-duel",
  "the-vault": "the-vault",
  "the-split": "the-split",
  "blacksite": "blacksite",
  "convergence": "convergence",
  "successor-protocol": "successor-protocol",
  "confessional": "confessional",
  "sandbag": "sandbag",
  "custom": "custom",
};

export const MODE_ICON: Record<string, IconName> = { auto: "mode-auto", gated: "mode-gated", puppet: "mode-puppet" };

/** Each provider gets its own robot, always drawn in the provider's colour. */
export const BOT_ICON: Record<ProviderId, IconName> = {
  anthropic: "bot-anthropic", openai: "bot-openai", google: "bot-google",
  xai: "bot-xai", compat: "bot-compat", sim: "bot-sim",
};

export function Bot({ provider, size = 20, color }: { provider: ProviderId; size?: number; color?: string }) {
  return <Icon name={BOT_ICON[provider] ?? "bot-compat"} size={size} style={{ color }} />;
}
