#!/usr/bin/env node
// Press year strips for the warmed city, plus the earliest-collision backfill.
//
//   node tools/build_timelines_bulk.mjs [--limit N] [--max-calls M] [--dry]
//
// Two different jobs, because they cost two very different things.
//
// A corner that already has a timeline only needs the comparison: the earliest
// collision the city records there, which is one keyless DataSF query and free.
// A corner with no timeline needs the whole strip, which is one Exa search per
// year since 2014 and is what the call budget is for.
//
// This calls buildTimeline directly rather than through /api/timeline. The
// daily timeline cap is a public rail: it stops a visitor's page load from
// spending a dozen searches, and it is untouched here. This path has its own
// ceiling instead, reserved against the same cumulative Exa budget every other
// batch lane reserves against, which is the rule the imagery queue already
// follows: operator budgets are separate and stricter, never a bypass.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { kvEnv, devVar } from "./lib/kvenv.mjs";
import { buildTimeline, TIMELINE_VERSION, TIMELINE_FROM } from "../src/timeline.js";
import { getTimeline, putTimeline, exaBudget, reserveExa } from "../src/store.js";
import { cityCornerFor } from "../src/city.js";
import { CORNERS } from "../src/data.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const val = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : null);
const LIMIT = parseInt(val("--limit") || "0", 10) || Infinity;
const MAX_CALLS = parseInt(val("--max-calls") || "0", 10) || 0;
const DRY = args.includes("--dry");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const env = kvEnv(ROOT, { EXA_API_KEY: devVar(ROOT, "EXA_API_KEY") });
const meta = await env.STORE.get("city:meta", "json");
const before = await exaBudget(env);
log(`exa budget: ${before.searches} searches, $${before.spentUsd} of $${before.capUsd} this period`);

// Warmed corners worst first, then anything the watchlist is pointing at.
const ranked = [];
for (let p = 1; p <= 6; p++) {
  const d = await (await fetch(`https://streetcred.thealexschroeder.workers.dev/api/city?page=${p}`)).json();
  ranked.push(...d.rows);
}
const warm = new Set([...(meta?.audited || []), ...(meta?.enriched || [])]);
const watchlist = await env.STORE.get("press:watchlist", "json");
const watchSlugs = (watchlist?.entries || []).map((e) => e.slug);

const order = [
  ...ranked.filter((r) => warm.has(r.slug)).map((r) => r.slug),
  ...watchSlugs,
  ...[...warm],
];
const targets = [...new Set(order)];
log(`${targets.length} corners in scope: warmed fleet worst first, plus ${watchSlugs.length} on the watchlist`);

const cornerFor = async (slug) =>
  CORNERS[slug] || (await env.STORE.get(`corner:${slug}`, "json")) || (await cityCornerFor(env, slug));

const YEARS = new Date().getUTCFullYear() - TIMELINE_FROM + 1;
let built = 0, backfilled = 0, skipped = 0, failed = 0, calls = 0;
let sawFirst = 0, hadFlag = 0;

for (const slug of targets) {
  if (built + backfilled >= LIMIT) break;
  const corner = await cornerFor(slug);
  if (!corner) continue;

  const existing = await getTimeline(env, slug, TIMELINE_VERSION);

  // Already complete: nothing to spend.
  if (existing && typeof existing.sawItFirst === "boolean") {
    skipped++;
    if (existing.sawItFirst) hadFlag++;
    continue;
  }

  // Has a strip, missing the comparison. One free query.
  if (existing?.years?.length) {
    if (DRY) {
      log(`  would backfill ${slug}`);
      backfilled++;
      continue;
    }
    const fresh = await buildTimelineComparisonOnly(existing, corner);
    await putTimeline(env, slug, fresh);
    backfilled++;
    if (fresh.sawItFirst) sawFirst++;
    log(`  backfilled ${slug.padEnd(26)} coverage ${fresh.firstReportedYear ?? "none"} vs first crash ${fresh.firstCrashYear ?? "none"}${fresh.sawItFirst ? "  PRESS FIRST" : ""}`);
    continue;
  }

  // No strip at all. This is the expensive one.
  if (MAX_CALLS && calls + YEARS > MAX_CALLS) {
    log(`  stopping: ${slug} would need ${YEARS} searches and the batch ceiling is ${MAX_CALLS}`);
    break;
  }
  if (DRY) {
    log(`  would build ${slug} (${YEARS} searches)`);
    calls += YEARS;
    built++;
    continue;
  }
  if (!(await reserveExa(env, YEARS))) {
    log("  exa budget exhausted, stopping");
    break;
  }
  try {
    const fresh = await buildTimeline(corner, env);
    await putTimeline(env, slug, fresh);
    calls += YEARS;
    built++;
    if (fresh.sawItFirst) sawFirst++;
    log(
      `  built ${slug.padEnd(26)} ${fresh.totalHeadlines} headlines, coverage from ${fresh.firstReportedYear ?? "none"}, first crash ${fresh.firstCrashYear ?? "none"}${fresh.sawItFirst ? "  PRESS FIRST" : ""}`,
    );
  } catch (e) {
    failed++;
    log(`  FAILED ${slug}: ${String(e.message || e).slice(0, 90)}`);
  }
}

// Recomputes only the comparison, reusing the stored strip. Imported lazily so
// the expensive path stays the obvious one.
async function buildTimelineComparisonOnly(existing, corner) {
  const { soql } = await import("../src/resolve.js");
  const rows = await soql("ubvf-ztfx", {
    "$select": "min(collision_datetime)",
    "$where": `within_circle(point, ${corner.lat}, ${corner.lon}, ${corner.radiusMeters || 150})`,
  }).catch(() => null);
  const raw = rows?.[0]?.min_collision_datetime;
  const firstCrashYear = raw ? parseInt(String(raw).slice(0, 4), 10) : null;
  return {
    ...existing,
    firstCrashYear: Number.isFinite(firstCrashYear) ? firstCrashYear : null,
    sawItFirst: Boolean(
      existing.firstReportedYear && firstCrashYear && existing.firstReportedYear < firstCrashYear,
    ),
  };
}

const after = await exaBudget(env);
log("");
log(`${built} strips built (${calls} searches), ${backfilled} backfilled free, ${skipped} already complete, ${failed} failed`);
log(`${sawFirst + hadFlag} corners where the earliest coverage predates the earliest recorded collision`);
log(`exa budget after: ${after.searches} searches, $${after.spentUsd} of $${after.capUsd} this period`);
if (DRY) log("dry run, nothing written");
