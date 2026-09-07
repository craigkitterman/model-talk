/**
 * Themes override the CSS custom properties Tailwind's utilities already reference,
 * so switching is a runtime style change — no rebuild, no class churn.
 */
export interface Theme {
  id: string;
  name: string;
  tagline: string;
  /** light themes flip color-scheme so native controls follow */
  scheme: "dark" | "light";
  tokens: {
    void: string; deck: string; panel: string; edge: string; edgeHot: string;
    ink: string; dim: string; faint: string;
    accent: string; hazard: string; good: string;
    /** grid line colour + scanline alpha for the background field */
    grid: string; scan: number;
    /** plate gradient stops */
    plateA: string; plateB: string;
  };
}

export const THEMES: Theme[] = [
  {
    id: "obsidian",
    name: "OBSIDIAN",
    tagline: "Tactical console. Sodium amber on near-black.",
    scheme: "dark",
    tokens: {
      void: "#05070c", deck: "#0a0e16", panel: "#0e1420", edge: "#1b2436", edgeHot: "#2b3a55",
      ink: "#e8eef7", dim: "#7c8ba3", faint: "#47536a",
      accent: "#ffb020", hazard: "#ff4d3d", good: "#3fe0a8",
      grid: "rgba(120,150,200,0.045)", scan: 0.6,
      plateA: "#0d1421", plateB: "#080c14",
    },
  },
  {
    id: "neon-noir",
    name: "NEON NOIR",
    tagline: "Rain-slick city. Hot magenta and cold cyan on violet black.",
    scheme: "dark",
    tokens: {
      void: "#07030f", deck: "#0d0719", panel: "#130b24", edge: "#2a1a48", edgeHot: "#45296f",
      ink: "#f3ecff", dim: "#9a86c2", faint: "#5d4a86",
      accent: "#ff2d95", hazard: "#ff5a3c", good: "#2ee6ff",
      grid: "rgba(255,45,149,0.06)", scan: 0.9,
      plateA: "#160d2c", plateB: "#0a0516",
    },
  },
  {
    id: "phosphor",
    name: "PHOSPHOR",
    tagline: "Green-screen terminal. Reactor glow on carbon.",
    scheme: "dark",
    tokens: {
      void: "#020806", deck: "#04100b", panel: "#061710", edge: "#0f3324", edgeHot: "#1a5238",
      ink: "#d9ffe9", dim: "#5fae86", faint: "#2f6a4d",
      accent: "#39ff88", hazard: "#ff6b4a", good: "#c8ff4a",
      grid: "rgba(57,255,136,0.055)", scan: 1.2,
      plateA: "#071b12", plateB: "#030c08",
    },
  },
  {
    id: "arctic",
    name: "ARCTIC LAB",
    tagline: "Clean-room white. Electric blue on frosted steel.",
    scheme: "light",
    tokens: {
      void: "#eef2f7", deck: "#f7f9fc", panel: "#ffffff", edge: "#cfd8e6", edgeHot: "#9fb2cc",
      ink: "#0c1626", dim: "#4c5c74", faint: "#8595ad",
      accent: "#0057ff", hazard: "#e0341c", good: "#0aa36e",
      grid: "rgba(0,87,255,0.07)", scan: 0.25,
      plateA: "#ffffff", plateB: "#eaf0f8",
    },
  },
];

export const DEFAULT_THEME = THEMES[0].id;
export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

export function cssVars(t: Theme): Record<string, string> {
  const k = t.tokens;
  return {
    "--color-void": k.void, "--color-deck": k.deck, "--color-panel": k.panel,
    "--color-edge": k.edge, "--color-edge-hot": k.edgeHot,
    "--color-ink": k.ink, "--color-dim": k.dim, "--color-faint": k.faint,
    "--color-amber": k.accent, "--color-hazard": k.hazard, "--color-good": k.good,
    "--grid-line": k.grid, "--scan-alpha": String(k.scan),
    "--plate-a": k.plateA, "--plate-b": k.plateB,
  };
}

export const THEME_KEY = "modeltalk:theme";
/** Resolved vars, replayed by public/theme-boot.js before first paint. */
export const THEME_VARS_KEY = "modeltalk:theme-vars";

export function applyTheme(t: Theme) {
  const r = document.documentElement;
  const vars = cssVars(t);
  for (const [n, v] of Object.entries(vars)) r.style.setProperty(n, v);
  r.style.colorScheme = t.scheme;
  r.dataset.theme = t.id;
  try {
    localStorage.setItem(THEME_KEY, t.id);
    localStorage.setItem(THEME_VARS_KEY, JSON.stringify({ id: t.id, scheme: t.scheme, vars }));
  } catch {}
}
