#!/usr/bin/env node
// Publishes the score tier: the sweep's worst un-audited corners, as real
// corner pages with a grade, honest about what has not run yet.
//
//   node tools/seed_scoretier.mjs [--count 100] [--dry]
//
// Slugs and names come from src/resolve.js parseQuery, never from the sweep's
// own slugger, so typing "6th and Mission" into the search box lands on exactly
// the page this tool created. A slug convention that differed by one hyphen
// would fork every score-tier corner into two.
//
// Scores are written from the sweep's counts, which the sweep proved identical
// to production's within_circle counts before writing anything. The corner
// carries tier: "score", which is what makes the imagery lane answer "audit
// pending" instead of spending two generations on first view.
//
// Also reseeds cotd:queue worst-first from these corners, so the cron's runway
// is the city's actual priority order rather than a hand-picked list.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseQuery } from "../src/resolve.js";
import { makeCorner, canonicalSlug } from "../src/data.js";
import { pointsFor, percentileOf, gradeFor, SCORE_VERSION, SCORE_CAVEAT, SCORE_RADIUS, DISTRIBUTION } from "../src/score.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COUNT = parseInt(process.argv[process.argv.indexOf("--count") + 1], 10) || 100;
const DRY = process.argv.includes("--dry");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const sweep = JSON.parse(readFileSync(join(ROOT, "sweep-results.json"), "utf8"));

// The deployed board decides what is already audited. Loose slug matching on
// sorted street tokens, because "16th-mission" and "16th-and-mission" are the
// same corner wearing a legacy slug.
const board = await (await fetch("https://streetcred.thealexschroeder.workers.dev/api/board")).json();
const tokens = (slug) => slug.toLowerCase().replace(/-and-/g, "-").split("-").filter((w) => w && w !== "and").sort().join("|");
const audited = new Set(board.corners.map((c) => tokens(c.slug)));
log(`${board.corners.length} audited corners on the board`);

const tier = [];
const queue = [];
for (const c of sweep.corners) {
  if (tier.length >= COUNT) break;
  const parsed = parseQuery(c.name);
  if (!parsed.ok) {
    log(`  skip (unparseable): ${c.name}`);
    continue;
  }
  const slug = canonicalSlug(parsed.slug);
  if (audited.has(tokens(slug))) continue;
  if (tier.some((t) => t.slug === slug)) continue;

  const { collisionPoints, maintenanceSignal, points } = pointsFor(c.counts);
  const index = percentileOf(points);
  tier.push({
    slug,
    name: parsed.name,
    lat: c.lat,
    lon: c.lon,
    grade: gradeFor(index),
    index,
    points: Math.round(points * 10) / 10,
    collisionPoints: Math.round(collisionPoints * 10) / 10,
    maintenanceSignal,
    counts: c.counts,
  });
  queue.push(parsed.name);
}
log(`${tier.length} score-tier corners selected, worst first`);
log(`top 5: ${tier.slice(0, 5).map((t) => `${t.name} (${t.grade} ${t.index})`).join("; ")}`);

// ---------------------------------------------------------------- artifacts

// The static asset stage D's scored layer and the typeahead read. Small on
// purpose: slug, name, geometry, grade, index and nothing else.
mkdirSync(join(ROOT, "public", "data"), { recursive: true });
writeFileSync(
  join(ROOT, "public", "data", "scoretier.json"),
  JSON.stringify({
    built: new Date().toISOString().slice(0, 10),
    corners: tier.map((t) => ({ slug: t.slug, name: t.name, lat: t.lat, lon: t.lon, grade: t.grade, index: t.index })),
  }),
);
log("wrote public/data/scoretier.json");

// Every nonzero sweep corner as [lat, lon, gradeIndex] for the heat layer.
// gradeIndex maps A..F to 0..4; the client owns the palette.
const gi = { A: 0, B: 1, C: 2, D: 3, F: 4 };
const heat = sweep.corners.map((c) => {
  const { points } = pointsFor(c.counts);
  return [c.lat, c.lon, gi[gradeFor(percentileOf(points))]];
});
writeFileSync(join(ROOT, "public", "data", "heat.json"), JSON.stringify(heat));
log(`wrote public/data/heat.json (${heat.length} dots)`);

if (DRY) {
  log("dry run, no KV writes");
  process.exit(0);
}

// ---------------------------------------------------------------- KV

const bulk = [];
for (const t of tier) {
  const corner = { ...makeCorner({ slug: t.slug, name: t.name, lat: t.lat, lon: t.lon, district: null }), tier: "score" };
  bulk.push({ key: `corner:${t.slug}`, value: JSON.stringify(corner) });
  bulk.push({
    key: `score:${t.slug}`,
    value: JSON.stringify({
      source: "live",
      version: SCORE_VERSION,
      index: t.index,
      grade: t.grade,
      points: t.points,
      collisionPoints: t.collisionPoints,
      maintenanceSignal: t.maintenanceSignal,
      radius: SCORE_RADIUS,
      sampleSize: DISTRIBUTION.length,
      counts: t.counts,
      caveat: SCORE_CAVEAT,
    }),
  });
}
const bulkFile = join(ROOT, ".scoretier-bulk.json");
writeFileSync(bulkFile, JSON.stringify(bulk));
log(`bulk-writing ${bulk.length} KV entries`);
execFileSync("npx", ["wrangler", "kv", "bulk", "put", bulkFile, "--binding", "STORE", "--remote"], {
  cwd: ROOT,
  stdio: "inherit",
  timeout: 300_000,
});

// ---------------------------------------------------------------- queue

// Worst first, the whole tier. The cron consumes one per morning and skips
// anything that fails to resolve, so a deep queue is runway, not risk.
const queueFile = join(ROOT, ".cotd-queue.json");
writeFileSync(queueFile, JSON.stringify(queue));
execFileSync("npx", ["wrangler", "kv", "key", "put", "cotd:queue", "--path", queueFile, "--binding", "STORE", "--remote"], {
  cwd: ROOT,
  stdio: "inherit",
  timeout: 120_000,
});
log(`cotd:queue reseeded with ${queue.length} corners, worst first`);
log(`next three mornings: ${queue.slice(0, 3).join("; ")}`);
