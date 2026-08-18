#!/usr/bin/env node
// Commission resident voices for a list of corners, under a spend ceiling.
//
//   node tools/commission_batch.mjs --slugs a,b,c --max-usd 4.00 [--dry]
//   node tools/commission_batch.mjs --file top15.json --max-usd 4.00
//
// The ceiling is enforced against what the ledger has actually recorded plus a
// reservation for what is already in flight, not against an estimate of what a
// corner ought to cost. The one corner measured so far cost $0.2961, and its
// actor caps did not bind the way the input suggested they would: 39 places
// were charged where the input asked for 12. So the assumption here is the
// measured number, and the batch stops when the next corner would cross the
// line rather than after it has.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { kvEnv, devVar } from "./lib/kvenv.mjs";
import { commissionVoices } from "../src/voices.js";
import { cityCornerFor } from "../src/city.js";
import { CORNERS } from "../src/data.js";
import { actorRunBudget, getActorCosts } from "../src/store.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const val = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const DRY = args.includes("--dry");
// --max-usd is a ceiling on everything ever spent; --new-usd is a ceiling on
// what THIS batch adds. The second is what an authorization to spend usually
// means, and keeping them separate stops a prior run's cost from being
// quietly folded into a fresh budget, or a fresh budget from being quietly
// spent twice.
const MAX_USD = parseFloat(val("--max-usd") || "0");
const NEW_USD = parseFloat(val("--new-usd") || "0");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

if (!MAX_USD && !NEW_USD) {
  console.log("--max-usd or --new-usd is required: this command spends real credit");
  process.exit(1);
}

let slugs = [];
if (val("--slugs")) slugs = val("--slugs").split(",").map((s) => s.trim()).filter(Boolean);
if (val("--file")) slugs = JSON.parse(readFileSync(val("--file"), "utf8")).map((r) => r.slug || r);
if (!slugs.length) {
  console.log("give me --slugs a,b,c or --file list.json");
  process.exit(1);
}

const env = kvEnv(ROOT, { APIFY_TOKEN: devVar(ROOT, "APIFY_TOKEN") });

// What has been spent, and what a corner has cost when one has been measured.
const costs = await getActorCosts(env);
const settled = costs.filter((c) => c.event === "ingested" && Number.isFinite(c.costUsd));
const spent = costs.reduce((n, c) => n + (Number(c.costUsd) || 0), 0);
const perCorner = settled.length
  ? settled.reduce((n, c) => n + c.costUsd, 0) / settled.length
  : 0.3;
// Corners commissioned but not yet ingested are money already committed.
const inFlight = costs.filter((c) => c.event === "commissioned").length - settled.length;
const committed = spent + Math.max(0, inFlight) * perCorner;

// The effective ceiling, stated in the same terms either way.
const ceiling = NEW_USD ? committed + NEW_USD : MAX_USD;

const budget = await actorRunBudget(env);
log(`ledger: $${spent.toFixed(4)} recorded, ${Math.max(0, inFlight)} corner(s) in flight`);
log(`measured cost per corner: $${perCorner.toFixed(4)} (from ${settled.length} settled)`);
log(`actor runs: ${budget.used} of ${budget.cap} this month`);
log(
  NEW_USD
    ? `ceiling: $${NEW_USD.toFixed(2)} of NEW spend on top of $${committed.toFixed(4)} already committed, so $${ceiling.toFixed(4)} total`
    : `ceiling: $${MAX_USD.toFixed(2)} total, already committed $${committed.toFixed(4)}`,
);

const started = [];
const skipped = [];
let projected = committed;

for (const slug of slugs) {
  if (projected + perCorner > ceiling) {
    skipped.push(slug);
    continue;
  }
  const corner = CORNERS[slug] || (await env.STORE.get(`corner:${slug}`, "json")) || (await cityCornerFor(env, slug));
  if (!corner) {
    log(`  skip ${slug}: no corner record`);
    continue;
  }
  if (DRY) {
    log(`  would commission ${slug} (${corner.name}), projected $${(projected + perCorner).toFixed(4)}`);
    projected += perCorner;
    started.push(slug);
    continue;
  }
  const out = await commissionVoices(env, corner);
  if (!out.ok) {
    log(`  FAILED ${slug}: ${out.failed.map((f) => `${f.actor} ${f.reason}`).join("; ")}`);
    continue;
  }
  projected += perCorner;
  started.push(slug);
  log(`  ${slug.padEnd(24)} ${out.runs.length} runs, projected total $${projected.toFixed(4)}`);
}

log(`${started.length} commissioned, ${skipped.length} left for a later batch under the ceiling`);
if (skipped.length) log(`  not started: ${skipped.join(", ")}`);
if (DRY) log("dry run, nothing started, nothing spent");
