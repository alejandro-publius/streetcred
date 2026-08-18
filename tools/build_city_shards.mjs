#!/usr/bin/env node
// The whole graded city, packed for the edge.
//
//   node tools/build_city_shards.mjs [--dry]
//
// One KV record per corner would be 7,353 writes to publish the city and 7,353
// more to correct it, which is the wrong shape for a store with a write quota
// and no transactions. The city ships as bundles instead: a corner page is one
// read of the shard its slug falls in, and the whole city republishes in a
// single bulk operation.
//
// Nothing here recomputes a score. Points and counts come from
// sweep-results.json, which was proved identical to production's within_circle
// numbers before it was written; index and grade come from the frozen census in
// src/distribution.js through the same percentileOf and gradeFor the Worker
// calls. A second implementation of the grade would eventually disagree with
// the first, and the disagreement would be invisible on the page.
//
// Slugs come from parseQuery, never from the sweep's own slugger, so a corner
// typed into the search box lands on exactly the record this tool wrote.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseQuery } from "../src/resolve.js";
import { canonicalSlug, CORNERS } from "../src/data.js";
import { pointsFor, percentileOf, gradeFor, SCORE_RADIUS, SCORE_VERSION, DISTRIBUTION } from "../src/score.js";
import { shardKeyFor, RANK_PAGE_SIZE, CITY_VERSION } from "../src/city.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const sweep = JSON.parse(readFileSync(join(ROOT, "sweep-results.json"), "utf8"));
const census = JSON.parse(readFileSync(join(ROOT, "sweep-distribution.json"), "utf8"));

// The artifact and the frozen constant have to be the same census. If they ever
// drift, every index on every shard page is measured against a yardstick the
// live code does not use.
if (census.distribution.length !== DISTRIBUTION.length) {
  throw new Error(
    `census mismatch: sweep-distribution.json has ${census.distribution.length} values, ` +
      `src/distribution.js has ${DISTRIBUTION.length}. Refusing to build shards against a different yardstick.`,
  );
}
log(`census agrees: ${DISTRIBUTION.length} scored crossings, score ${SCORE_VERSION}`);

// ---------------------------------------------------------------- rows

const bySlug = new Map();
let unparsed = 0;
for (const c of sweep.corners) {
  const parsed = parseQuery(c.name);
  if (!parsed.ok) {
    unparsed++;
    continue;
  }
  const slug = canonicalSlug(parsed.slug);
  const { points } = pointsFor(c.counts);
  const index = percentileOf(points);
  const row = {
    slug,
    name: parsed.name,
    lat: c.lat,
    lon: c.lon,
    points: Math.round(points * 10) / 10,
    index,
    grade: gradeFor(index),
    counts: c.counts,
    district: c.district ?? null,
  };
  // Two cnns can reduce to one canonical slug. Keep the worse of them: a
  // crossing cut into quadrants is one corner to the person standing on it.
  const prev = bySlug.get(slug);
  if (!prev || row.points > prev.points) bySlug.set(slug, row);
}
const rows = [...bySlug.values()];
log(`${rows.length} corners (${unparsed} unparseable names dropped)`);

// ---------------------------------------------------------------- shards

const shards = new Map();
for (const r of rows) {
  const k = shardKeyFor(r.slug);
  if (!shards.has(k)) shards.set(k, []);
  shards.get(k).push(r);
}
// Sorted inside each shard so a diff between two builds is readable and the
// bytes are stable when nothing changed.
for (const list of shards.values()) list.sort((a, b) => a.slug.localeCompare(b.slug));

// The sweep date rides inside every shard, not just in city:meta, so a corner
// page can print "as of {date}" from the one read it already made. Reading a
// second key to caption a number the first key returned is a read spent on
// nothing.
const shardPayloads = new Map();
let largestShardBytes = 0;
let largestShardKey = "";
for (const [k, list] of shards) {
  const body = JSON.stringify({
    version: CITY_VERSION,
    sweepDate: sweep.runDate,
    radiusM: sweep.radiusM ?? SCORE_RADIUS,
    rows: list,
  });
  const bytes = Buffer.byteLength(body);
  if (bytes > largestShardBytes) {
    largestShardBytes = bytes;
    largestShardKey = k;
  }
  shardPayloads.set(k, body);
}
log(`${shards.size} shards, largest ${(largestShardBytes / 1024).toFixed(1)} KB (city:shard:${largestShardKey})`);
// KV's ceiling is 25 MiB per value. Stop well before it rather than discovering
// the limit on a build that has already half-published the city.
const KV_VALUE_LIMIT = 25 * 1024 * 1024;
if (largestShardBytes > KV_VALUE_LIMIT / 10) {
  throw new Error(`shard ${largestShardKey} is ${largestShardBytes} bytes, past the tenth of the KV limit this build allows`);
}

// ---------------------------------------------------------------- rank pages

// The leaderboard reads the city worst first. Sorting 7,000 rows inside the
// Worker would mean reading every shard on every page of the list, so the
// order is computed once here and paged.
const ranked = [...rows].sort((a, b) => b.points - a.points || a.slug.localeCompare(b.slug));
const rankPages = [];
for (let i = 0; i < ranked.length; i += RANK_PAGE_SIZE) {
  rankPages.push(
    ranked.slice(i, i + RANK_PAGE_SIZE).map((r) => ({
      slug: r.slug,
      name: r.name,
      grade: r.grade,
      index: r.index,
      points: r.points,
      district: r.district,
      lat: r.lat,
      lon: r.lon,
      // The severity line under each board row is built from these, so the
      // citywide leaderboard reads the same way the audited one always has.
      counts: r.counts,
    })),
  );
}
log(`${rankPages.length} rank pages of ${RANK_PAGE_SIZE}`);

// ---------------------------------------------------------------- tiers

// Counted from KV, not assumed. AUDITED is the imagery-warmed set, which means
// both generated states actually exist as bytes: a corner holding only the free
// Street View frame has had no audit run on it and must not be counted as one.
function kvSlugs() {
  const out = execFileSync(
    "npx",
    ["wrangler", "kv", "key", "list", "--namespace-id", "6918c07a1e1540f0ac9b6c499c5917b7", "--remote"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
  );
  const keys = JSON.parse(out).map((e) => e.name);
  const states = new Map();
  for (const n of keys) {
    if (!n.startsWith("img:")) continue;
    const [, slug, state] = n.split(":");
    if (!states.has(slug)) states.set(slug, new Set());
    states.get(slug).add(state);
  }
  const audited = [...states.entries()]
    .filter(([, s]) => s.has("hazards") && s.has("fix"))
    .map(([slug]) => slug)
    .sort();
  const stored = new Set(keys.filter((n) => n.startsWith("corner:")).map((n) => n.split(":")[1]));
  // The two flagship corners live in the code registry rather than in KV, so
  // they never appear as a corner: key and would be missed by a KV-only count.
  for (const slug of Object.keys(CORNERS)) stored.add(slug);
  const enriched = [...stored].filter((s) => !audited.includes(s)).sort();
  return { audited, enriched };
}

const { audited, enriched } = kvSlugs();
log(`${audited.length} audited (imagery warmed), ${enriched.length} enriched (stored, no imagery)`);

const meta = {
  version: CITY_VERSION,
  built: new Date().toISOString().slice(0, 10),
  sweepDate: sweep.runDate,
  scoreVersion: SCORE_VERSION,
  totalScored: rows.length,
  totalEnriched: enriched.length,
  totalAudited: audited.length,
  censusSize: DISTRIBUTION.length,
  scoreRadiusM: SCORE_RADIUS,
  districtRadiusM: sweep.districtRadiusM ?? 150,
  shardCount: shards.size,
  largestShardBytes,
  largestShardKey,
  rankPages: rankPages.length,
  rankPageSize: RANK_PAGE_SIZE,
  // The rosters, so a list surface can tag 50 rows with their tier without 50
  // KV reads. The corner page itself never trusts these: it reads the corner's
  // own record, which cannot be stale.
  audited,
  enriched,
};

// ---------------------------------------------------------------- artifacts

mkdirSync(join(ROOT, "data", "city"), { recursive: true });
writeFileSync(join(ROOT, "data", "city", "meta.json"), JSON.stringify(meta, null, 1));
log("wrote data/city/meta.json");

// [lat, lon, gradeIndex] for the heat layer. Under public/ because the browser
// reads it directly as a static asset: a second copy under data/ would be a
// file nothing writes and everything could drift from.
const gi = { A: 0, B: 1, C: 2, D: 3, F: 4 };
const dots = rows.map((r) => [r.lat, r.lon, gi[r.grade]]);
mkdirSync(join(ROOT, "public", "data", "city"), { recursive: true });
const dotsBody = JSON.stringify(dots);
writeFileSync(join(ROOT, "public", "data", "city", "dots.json"), dotsBody);
log(`wrote public/data/city/dots.json (${dots.length} dots, ${(Buffer.byteLength(dotsBody) / 1024).toFixed(0)} KB)`);

if (DRY) {
  log("dry run, no KV writes");
  process.exit(0);
}

// ---------------------------------------------------------------- KV

// Every distinct street name in the graded city, normalized by parseQuery the
// same way a typed query is. The press lanes use it to tell a phrase that
// contains no San Francisco street ("Traffic Calming", "Real Estate") from a
// real pair of SF streets that simply do not meet at a graded crossing. Both
// are rejects; only one of them is worth showing a reader.
const streetNames = new Set();
for (const r of rows) {
  const parsed = parseQuery(r.name);
  if (parsed.ok) for (const st of parsed.streets) streetNames.add(st);
}
const streetsBody = JSON.stringify([...streetNames].sort());
log(`${streetNames.size} distinct street names (${(Buffer.byteLength(streetsBody) / 1024).toFixed(0)} KB)`);

const bulk = [];
bulk.push({ key: "city:streets", value: streetsBody });
for (const [k, body] of shardPayloads) bulk.push({ key: `city:shard:${k}`, value: body });
rankPages.forEach((page, i) => {
  bulk.push({ key: `city:rank:${i}`, value: JSON.stringify({ version: CITY_VERSION, page: i, rows: page }) });
});
bulk.push({ key: "city:meta", value: JSON.stringify(meta) });
// The browser reads the asset copy above; this is the same bytes for anything
// that reads the city from KV instead of over HTTP.
bulk.push({ key: "city:dots", value: dotsBody });

const bulkFile = join(ROOT, ".city-bulk.json");
writeFileSync(bulkFile, JSON.stringify(bulk));
const totalBytes = bulk.reduce((s, e) => s + Buffer.byteLength(e.value), 0);
log(`bulk-writing ${bulk.length} KV entries, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);
execFileSync("npx", ["wrangler", "kv", "bulk", "put", bulkFile, "--binding", "STORE", "--remote"], {
  cwd: ROOT,
  stdio: "inherit",
  timeout: 600_000,
});
log("city published");
