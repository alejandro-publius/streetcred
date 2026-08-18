#!/usr/bin/env node
// Build the Press Watchlist: which corners the city's own coverage is talking
// about right now, verified against the graded-city index.
//
//   node tools/build_watchlist.mjs [--dry] [--days 45]
//
// Four citywide semantic searches, every crossing named in the results
// extracted and then checked against hard criteria before it is allowed to
// surface. Rejects are kept and published with their reasons.
//
// The cron runs this same code every morning. This tool exists so it can be
// rebuilt on demand, which is what you want after a sweep or a wording change.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { kvEnv, devVar } from "./lib/kvenv.mjs";
import { buildWatchlist, WATCHLIST_VERSION } from "../src/press.js";
import { putWatchlist, exaBudget } from "../src/store.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");
const DAYS = parseInt(process.argv[process.argv.indexOf("--days") + 1], 10) || 45;
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const env = kvEnv(ROOT, { EXA_API_KEY: devVar(ROOT, "EXA_API_KEY") });

const before = await exaBudget(env);
log(`exa budget: ${before.calls} of ${before.cap} calls spent, $${before.spendUsd} recorded`);

const meta = await env.STORE.get("city:meta", "json");
const skip = new Set(meta?.audited || []);
log(`${skip.size} audited corners excluded: a corner we have done is not a lead`);

const w = await buildWatchlist(env, { days: DAYS, skip });
log(`${w.source}: ${w.articles} articles over ${w.calls} searches, ${w.entries?.length || 0} verified, ${w.rejected || 0} rejected`);

for (const q of w.queries || []) log(`  query "${q.query.slice(0, 52)}..." -> ${q.results} results${q.failed ? ` (${q.failed})` : ""}`);
for (const e of (w.entries || []).slice(0, 10)) {
  log(`  KEEP  ${e.name} (${e.grade} ${e.index}) <- ${e.article.domain} ${e.article.date}`);
}
const byReason = new Map();
for (const r of w.rejects || []) {
  if (!byReason.has(r.reason)) byReason.set(r.reason, []);
  byReason.get(r.reason).push(r.name || r.candidate);
}
for (const [reason, names] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
  log(`  DROP  ${String(names.length).padStart(3)}  ${reason}`);
  log(`        ${names.slice(0, 14).join(", ")}`);
}

const after = await exaBudget(env);
log(`exa budget after: ${after.calls} of ${after.cap} calls, $${after.spendUsd} recorded`);

if (DRY) {
  log("dry run, press:watchlist not written");
  process.exit(0);
}
await putWatchlist(env, w);
log(`wrote press:watchlist (version ${WATCHLIST_VERSION})`);
