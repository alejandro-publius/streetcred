// Per-corner outcomes of a full-lane batch, from the staged run logs. Read only.
//
//   node tools/batch_report.mjs [--since=2026-08-22T00:00:00Z] [--md]
//
// Joins scratch/imagery/_results.json (audit, both renders), the staged
// letters log, and the staged hazards records, and prints one line per
// corner: tier outcome, audit verdict counts, render states, letter state,
// spend. The tier column is the label the publish would write, from the same
// statusFor the publish uses, so the report cannot say audited where the
// publish would say promoted.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { statusFor, stagedRenderFiles, stagedHazardFiles, slugOfRender, slugOfHazardRender } from "./promote_corners.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const SINCE = argOf("since", "");
const MD = args.includes("--md");

const rj = (p, d) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return d; } };
const IMG = join(ROOT, "scratch", "imagery");
const rows = rj(join(IMG, "_results.json"), []).filter((r) => !SINCE || String(r.at || "") >= SINCE);
const letters = new Map(rj(join(ROOT, "scratch", "letters", "_results.json"), []).map((r) => [r.slug, r]));
const names = existsSync(IMG) ? readdirSync(IMG) : [];
const fixSlugs = new Set(stagedRenderFiles(names).map(slugOfRender));
const hazSlugs = new Set(stagedHazardFiles(names).map(slugOfHazardRender));
const sweep = rj(join(ROOT, "sweep-results.json"), { corners: [] }).corners;
const pts = {};
for (const r of Array.isArray(sweep) ? sweep : Object.values(sweep)) if (r?.slug) pts[r.slug] = r.points;

const out = [];
for (const r of rows.sort((a, b) => (pts[b.slug] ?? 0) - (pts[a.slug] ?? 0))) {
  const { kind } = statusFor(null, r, { fix: fixSlugs.has(r.slug), hazards: hazSlugs.has(r.slug) }, { at: 0, model: "", via: "" });
  const tier = kind === "audited" ? "AUDITED" : kind === "promoted" ? "promoted-from-enriched" : "held";
  const audit = r.audit ? (r.audit.ok ? `${r.audit.confirmed}c/${r.audit.candidates}k/${r.audit.reported}r` : "failed") : (r.preflight ? "not run" : "n/a");
  const haz = r.hazardsRender ? r.hazardsRender.state : (r.lane === "full" ? "n/a" : "");
  const fix = r.state;
  const L = letters.get(r.slug);
  const letter = L ? (L.state === "passed" ? (L.reverified ? "verified (kept)" : "verified") : L.state) : "none";
  const why = r.state === "held" ? String(r.why || "").replace(/unrenderable: the source frame is unreadable in every checked region.*/, "frame unreadable, re-fetch").slice(0, 70) : (r.hazardsRender?.state === "held" ? `hazards: ${String(r.hazardsRender.why || "").slice(0, 50)}` : "");
  out.push({ slug: r.slug, points: pts[r.slug] ?? "", tier, audit, hazards: haz, fix, letter, usd: (r.usd || 0).toFixed(4), why });
}
if (MD) {
  console.log("| corner | points | outcome | audit (c/k/r) | hazards render | fix render | letter | spend | note |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const o of out) console.log(`| ${o.slug} | ${o.points} | ${o.tier} | ${o.audit} | ${o.hazards} | ${o.fix} | ${o.letter} | $${o.usd} | ${o.why} |`);
} else {
  for (const o of out) console.log(`${o.slug.padEnd(30)} ${String(o.points).padStart(6)}  ${o.tier.padEnd(22)} audit ${o.audit.padEnd(8)} haz ${String(o.hazards).padEnd(7)} fix ${o.fix.padEnd(7)} letter ${o.letter.padEnd(16)} $${o.usd}  ${o.why}`);
}
const n = (k) => out.filter((o) => o.tier === k).length;
console.log(`\n${out.length} corners: ${n("AUDITED")} audited, ${n("promoted-from-enriched")} promoted, ${n("held")} held; spend $${out.reduce((a, o) => a + Number(o.usd), 0).toFixed(4)}`);
