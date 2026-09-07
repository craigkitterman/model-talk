#!/usr/bin/env node
/**
 * Run an experiment manifest against a local Model Talk server and write every trial + a summary.
 *
 *   node scripts/experiment.mjs experiments/sandbag-threat.json [--base http://localhost:3400] [--out runs/experiments] [--dry]
 *
 * The server does the generation (keys never leave it); this script streams the NDJSON events,
 * writes each trial as an importable run JSON, and renders summary.json + summary.md. --dry
 * validates the manifest and prints the plan, including the exact briefs per condition, and spends nothing.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i > -1 && args[i + 1] ? args[i + 1] : dflt; };
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") === false || args.indexOf(a) === 0);
if (!file) { console.error("usage: node scripts/experiment.mjs <manifest.json> [--base URL] [--out DIR] [--dry]"); process.exit(2); }
const base = flag("--base", "http://localhost:3400");
const outRoot = flag("--out", "runs/experiments");
const dry = args.includes("--dry");

const manifest = JSON.parse(readFileSync(file, "utf8"));
const post = (body) => fetch(`${base}/api/experiment`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? "—" : typeof v === "number" ? v.toFixed(d) : String(v));
const ci = (d) => (d && Number.isFinite(d.ci95?.lo) ? `[${fmt(d.ci95.lo)}, ${fmt(d.ci95.hi)}]` : "—");

if (dry) {
  const res = await post({ dry: true, manifest });
  if (!res.ok) { console.error("manifest rejected:", await res.text()); process.exit(1); }
  const plan = await res.json();
  console.log(`${plan.name}: ${plan.trials} trials across ${plan.conditions.join(", ")}; stops at $${plan.maxCostUsd.toFixed(2)} (checked between requests, one draft can overshoot)`);
  for (const t of plan.plan) console.log(`  #${t.index} ${t.conditionId} seed ${t.seed}${t.swapped ? " swapped" : ""}  A=${t.A} B=${t.B} maxTurns=${t.maxTurns}`);
  for (const [id, b] of Object.entries(plan.briefs)) console.log(`\n== ${id} · brief A ==\n${b.A}\n\n== ${id} · brief B ==\n${b.B}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = resolve(join(outRoot, manifest.name, stamp));
mkdirSync(join(outDir, "trials"), { recursive: true });
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const res = await post({ manifest });
if (!res.ok) { console.error("server refused:", res.status, await res.text()); process.exit(1); }
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "";
let summary = null; let stopped = null; let trials = 0; let done = 0;
const t0 = Date.now();
const handle = (ev) => {
  if (ev.type === "plan") { trials = ev.trials; console.log(`${manifest.name}: ${ev.trials} trials, stops at $${ev.maxCostUsd.toFixed(2)} (checked between requests) → ${outDir}`); }
  else if (ev.type === "turn") { if (process.stdout.isTTY) process.stdout.write(`
  trial #${ev.trial} ${ev.conditionId} · turn ${ev.index} (${ev.from}, ${ev.chars} chars)      `); }
  else if (ev.type === "trial") {
    done++;
    const r = ev.result; const m = r.metrics;
    writeFileSync(join(outDir, "trials", `${String(r.index).padStart(3, "0")}-${r.conditionId}-s${r.seed}${r.swapped ? "-swapped" : ""}.json`), JSON.stringify(r.run, null, 2));
    process.stdout.write(`\r  ✓ #${r.index} ${r.conditionId} seed ${r.seed}${r.swapped ? " swapped" : ""}: ${m.failed ? "FAILED · " + m.endedReason : `${m.turns} turns, $${m.costUsd.toFixed(3)}, ${m.endedReason}`}${" ".repeat(20)}\n`);
  }
  else if (ev.type === "done") { summary = ev.summary; stopped = ev.stopped; }
  else if (ev.type === "error") console.error("\nserver error:", ev.message);
};
while (true) {
  const { value, done: eof } = await reader.read();
  if (eof) break;
  buf += dec.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) handle(JSON.parse(line)); }
}
if (!summary) { console.error("no summary received (server closed early)"); process.exit(1); }

// ── render ────────────────────────────────────────────────────────────────────
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
const conds = Object.keys(summary.conditions);
const metrics = Object.keys(summary.conditions[summary.baseline].means);
const lines = [];
lines.push(`# ${summary.name}`, "");
if (manifest.description) lines.push(manifest.description, "");
lines.push(`${summary.trials} trials (${summary.failed} failed, ${summary.censored} cut off by budget) · $${summary.costUsd.toFixed(3)} · ${Math.round((Date.now() - t0) / 1000)}s · baseline **${summary.baseline}** · primary **${summary.primary}**${stopped ? ` · stopped early: ${stopped}` : ""}`, "");
lines.push("## Primary outcome", "", `| condition | n | failed / censored | mean ${summary.primary} | Δ vs baseline | 95% CI | up / down / tied |`, "|---|---|---|---|---|---|---|");
for (const c of conds) {
  const s = summary.conditions[c]; const d = summary.deltas[c]?.[summary.primary];
  lines.push(`| ${c}${c === summary.baseline ? " (baseline)" : ""} | ${s.n} | ${s.failed} / ${s.censored} | ${fmt(s.means[summary.primary])} | ${d ? fmt(d.delta) + (d.excludesZero ? " *" : "") : "—"} | ${ci(d)} | ${d ? `${d.up} / ${d.down} / ${d.tied}${d.missing ? ` (${d.missing} missing)` : ""}` : "—"} |`);
}
lines.push("", "`*` = the bootstrap 95% CI excludes zero, only reported from six complete pairs up. Below that the interval is descriptive; read the sign counts. Failed trials are missing, not zero; budget-censored trials have no endpoint outcome.", "");
lines.push("## All metrics (means per condition)", "", `| metric | ${conds.join(" | ")} |`, `|---|${conds.map(() => "---").join("|")}|`);
for (const k of metrics) lines.push(`| ${k} | ${conds.map((c) => fmt(summary.conditions[c].means[k], 3)).join(" | ")} |`);
if (summary.position) {
  lines.push("", "## Position effect (swapped − unswapped, paired on seed)", "", `| condition | Δ ${summary.primary} | 95% CI | up / down / tied |`, "|---|---|---|---|");
  for (const c of conds) { const d = summary.position[c]?.[summary.primary]; lines.push(`| ${c} | ${d ? fmt(d.delta) : "—"} | ${ci(d)} | ${d ? `${d.up} / ${d.down} / ${d.tied}` : "—"} |`); }
}
lines.push("", "## Trials", "", "| # | condition | seed | swapped | turns | cost | ended |", "|---|---|---|---|---|---|---|");
// the summary carries no per-trial rows; re-read what we wrote so the table matches the files exactly
import("node:fs").then(({ readdirSync }) => {
  for (const f of readdirSync(join(outDir, "trials")).sort()) {
    const r = JSON.parse(readFileSync(join(outDir, "trials", f), "utf8"));
    const mm = f.match(/^(\d+)-(.+)-s(\d+)(-swapped)?\.json$/);   // condition ids may contain dashes
    if (!mm) continue;
    const [, idx, cond, seed, sw] = mm;
    lines.push(`| ${Number(idx)} | ${cond} | ${seed} | ${sw ? "yes" : ""} | ${r.turns.filter((t) => t.kind === "model").length} | $${r.spend.total.toFixed(3)} | ${r.endedReason ?? ""} |`);
  }
  lines.push("", "Every trial is a full run: open one in the app with **Import** to read the taps, fork it, or publish it.");
  writeFileSync(join(outDir, "summary.md"), lines.join("\n"));
  console.log("\n" + lines.slice(0, 12).join("\n"));
  console.log(`\nwritten: ${join(outDir, "summary.md")}`);
});
