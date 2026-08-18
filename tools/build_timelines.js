#!/usr/bin/env node
// Builds the press year strip for every warmed corner, once.
//
//   node tools/build_timelines.js [--limit N]
//
// About a dozen Exa searches per corner, stored in KV with no TTL, so this runs
// once per corner for the life of the product. It drives the deployed endpoint
// rather than calling Exa directly, so the same daily budget that protects a
// visitor protects this script, and a corner that already has a timeline costs
// nothing at all.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.STREETCRED_BASE || "https://streetcred.thealexschroeder.workers.dev";
const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const corners = JSON.parse(readFileSync(join(ROOT, ".hin-list.json"), "utf8")).corners;
log(`${corners.length} warmed corners, base=${BASE}`);

let built = 0;
let cached = 0;
let calls = 0;
let stopped = false;

for (const c of corners) {
  if (built >= LIMIT) {
    log(`limit of ${LIMIT} builds reached`);
    break;
  }
  let t;
  try {
    t = await (await fetch(`${BASE}/api/timeline?x=${encodeURIComponent(c.slug)}`)).json();
  } catch (e) {
    log(`  ${c.slug}: FETCH FAILED ${String(e.message || e).slice(0, 70)}`);
    continue;
  }

  if (t.source === "unavailable") {
    log(`  ${c.slug}: ${t.reason} ${t.note || ""}`);
    // The budget is global and shared with real visitors. Once it is gone,
    // hammering it is how a lane that is supposed to protect credits becomes
    // the thing spending them.
    if (t.reason === "budget") {
      stopped = true;
      break;
    }
    continue;
  }

  if (t.source === "cache") {
    cached++;
    log(`  ${c.slug.padEnd(22)} cached, first ${t.firstReportedYear ?? "none"}, ${t.totalHeadlines} headlines`);
    continue;
  }

  built++;
  calls += t.calls || 0;
  const failed = (t.failedYears || []).length;
  log(
    `  ${c.slug.padEnd(22)} built ${t.calls} searches, first ${t.firstReportedYear ?? "none"}, ` +
      `${t.yearsReported ?? "n/a"} years, ${t.totalHeadlines} headlines` +
      (failed ? `, ${failed} year(s) failed` : ""),
  );
  await sleep(900);
}

log("");
log(`${built} built, ${cached} already cached, ${calls} Exa searches spent this run`);
if (stopped) log("stopped early: the daily timeline budget was exhausted");
