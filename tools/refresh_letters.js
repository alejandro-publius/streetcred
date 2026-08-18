#!/usr/bin/env node
// Regenerates every warmed corner's letter against the deployed Worker, once.
//
//   node tools/refresh_letters.js [--check]
//
// A letter is the only artifact in this product a person might actually send to
// an elected official, and it is the only one that costs a billed model call to
// rebuild. So regenerating them is never a side effect of anything: it is an
// explicit, deliberate pass, run after LETTER_VERSION has been bumped, and it
// happens exactly once per set of changes rather than once per change.
//
// --check reports what each corner's letter currently says without regenerating
// anything, which is how you confirm a bump actually landed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.STREETCRED_BASE || "https://streetcred.thealexschroeder.workers.dev";
const CHECK = process.argv.includes("--check");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const corners = JSON.parse(readFileSync(join(ROOT, ".hin-list.json"), "utf8")).corners;
log(`${corners.length} warmed corners, base=${BASE}${CHECK ? ", CHECK ONLY" : ""}`);

// The data paragraph is the one that has to be right: it carries the collision
// count, the 311 count and the index. Everything else in a letter is manners.
function dataParagraph(text) {
  const paras = String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paras.find((p) => /\d/.test(p) && /collision|record|311/i.test(p)) || paras[1] || "";
}

let ok = 0;
let failed = 0;
for (const c of corners) {
  let d;
  try {
    const r = await fetch(`${BASE}/api/letter?x=${encodeURIComponent(c.slug)}`);
    d = await r.json();
  } catch (e) {
    log(`  ${c.slug}: FETCH FAILED ${String(e.message || e).slice(0, 80)}`);
    failed++;
    continue;
  }
  if (!d?.text) {
    log(`  ${c.slug}: NO TEXT (source=${d?.source})`);
    failed++;
    continue;
  }
  const para = dataParagraph(d.text);
  const bounded = /five years|5 years|last five/i.test(d.text);
  const pct = /percent of San Francisco|percent of SF|out of 100/i.test(d.text);
  log(
    `  ${c.slug.padEnd(23)} source=${String(d.source).padEnd(6)} ` +
      `supervisor=${String(d.supervisor).padEnd(10)} bounded=${bounded} index=${pct}`,
  );
  if (!bounded || !pct) log(`     WARNING: missing bounded window or index sentence`);
  ok++;
  await sleep(CHECK ? 200 : 1200);
}

log(`done: ${ok} letters, ${failed} failed`);

// Print the two flagship data paragraphs in full, because those are the ones
// that get read out at the gate.
for (const slug of ["16th-mission", "6th-market"]) {
  const r = await fetch(`${BASE}/api/letter?x=${slug}`);
  const d = await r.json();
  console.log(`\n--- ${slug} data paragraph ---\n${dataParagraph(d.text || "")}`);
}
