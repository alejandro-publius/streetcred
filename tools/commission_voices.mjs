#!/usr/bin/env node
// Commission resident voices for one corner, and ingest what comes back.
//
//   node tools/commission_voices.mjs "24th and Valencia" --dry     print the inputs, spend nothing
//   node tools/commission_voices.mjs "24th and Valencia"           start both actors, SPENDS CREDIT
//   node tools/commission_voices.mjs --ingest                      pick up whatever has finished
//
// The 06:10 cron does exactly this, unattended, for the corner it audits. This
// tool exists for two reasons: so the first paid run is a deliberate human
// action rather than something a deploy started, and so the actor inputs can
// be read before any money is spent on them.
//
// Cost, stated plainly because it is billed: both actors are pay per event at
// $0.004 on the free tier. The inputs below cap at 12 places and 25 Reddit
// results, so a corner is roughly $0.15, and the monthly run ceiling in
// src/store.js is what stops a loop from finding the rest of the credit.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { kvEnv, devVar } from "./lib/kvenv.mjs";
import { commissionVoices, ingestVoices, gmapsInput, redditInput } from "../src/voices.js";
import { cityCornerFor } from "../src/city.js";
import { parseQuery } from "../src/resolve.js";
import { canonicalSlug, CORNERS } from "../src/data.js";
import { actorRunBudget, getVoicePending } from "../src/store.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const INGEST = args.includes("--ingest");
const query = args.filter((a) => !a.startsWith("--")).join(" ");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const env = kvEnv(ROOT, { APIFY_TOKEN: devVar(ROOT, "APIFY_TOKEN") });

const budget = await actorRunBudget(env);
log(`actor runs this month: ${budget.used} of ${budget.cap} (${budget.month})`);

if (INGEST) {
  const pending = await getVoicePending(env);
  log(`${pending.length} corner${pending.length === 1 ? "" : "s"} pending: ${pending.join(", ") || "none"}`);
  const out = await ingestVoices(env, async (slug) => {
    if (CORNERS[slug]) return CORNERS[slug];
    const stored = await env.STORE.get(`corner:${slug}`, "json");
    return stored || (await cityCornerFor(env, slug));
  });
  log(`checked ${out.checked}, ingested ${out.ingested.length}, still pending ${out.stillPending.length}`);
  for (const i of out.ingested) log(`  ${i.slug}: ${i.kept} kept from ${i.candidates} candidates, $${(i.costUsd || 0).toFixed(4)}`);
  for (const p of out.problems || []) log(`  problem: ${JSON.stringify(p)}`);
  process.exit(0);
}

if (!query) {
  console.log("usage: node tools/commission_voices.mjs \"24th and Valencia\" [--dry]");
  console.log("       node tools/commission_voices.mjs --ingest");
  process.exit(1);
}

const parsed = parseQuery(query);
if (!parsed.ok) {
  console.log(`could not parse "${query}": ${parsed.reason}`);
  process.exit(1);
}
const slug = canonicalSlug(parsed.slug);
const corner =
  CORNERS[slug] || (await env.STORE.get(`corner:${slug}`, "json")) || (await cityCornerFor(env, slug));
if (!corner) {
  console.log(`no corner for ${slug}`);
  process.exit(1);
}
log(`corner: ${corner.name} (${slug}) at ${corner.lat}, ${corner.lon}`);

if (DRY) {
  log("google maps actor input (compass~crawler-google-places):");
  const gm = gmapsInput(corner);
  console.log(JSON.stringify({ ...gm, customGeolocation: { type: "Polygon", coordinates: [["...16 points, 350m circle..."]] } }, null, 2));
  console.log("  first three polygon points:", JSON.stringify(gm.customGeolocation.coordinates[0].slice(0, 3)));
  log("reddit actor input (trudax~reddit-scraper-lite):");
  console.log(JSON.stringify(redditInput(corner), null, 2));
  log("dry run: nothing started, nothing spent");
  process.exit(0);
}

const out = await commissionVoices(env, corner);
if (!out.ok) {
  log("nothing started:");
  for (const f of out.failed) log(`  ${f.actor}: ${f.reason}`);
  process.exit(1);
}
log(`commissioned ${out.runs.length} run(s):`);
for (const r of out.runs) log(`  ${r.actor}: run ${r.id}, dataset ${r.datasetId}`);
for (const f of out.failed) log(`  ${f.actor} did not start: ${f.reason}`);
log("runs take minutes. Come back with --ingest, or let tomorrow's cron pick them up.");
