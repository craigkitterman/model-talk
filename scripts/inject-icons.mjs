// Renders design/icons.json into inline SVG and drops each glyph into site/index.html
// wherever a marker like <!--icon:turing-duel--> appears. Markers survive, so the
// script is idempotent: re-running replaces the previous render.
import { readFileSync, writeFileSync } from "node:fs";

const icons = JSON.parse(readFileSync("design/icons.json", "utf8"));
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const attr = (k) => (k === "strokeDasharray" ? "stroke-dasharray" : k);

function svg(name, size = 18) {
  const prims = icons[name];
  if (!prims) throw new Error(`unknown icon: ${name}`);
  const body = prims
    .map(({ t, ...a }) => `<${t} ${Object.entries(a).map(([k, v]) => `${attr(k)}="${esc(v)}"`).join(" ")}/>`)
    .join("");
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const path = "site/index.html";
let html = readFileSync(path, "utf8");
// strip any previous render (anything between the marker and the closing marker-end comment)
html = html.replace(/<!--icon:([\w-]+)(?::(\d+))?-->(?:[\s\S]*?<!--\/icon-->)?/g, (_, name, size) =>
  `<!--icon:${name}${size ? ":" + size : ""}-->${svg(name, size ? Number(size) : 18)}<!--/icon-->`
);
writeFileSync(path, html);
console.log("icons injected into", path);
