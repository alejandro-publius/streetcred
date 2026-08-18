#!/usr/bin/env node
// The citywide sweep: every real intersection in San Francisco, scored.
//
//   node tools/sweep.mjs
//
// Three bulk pulls (collisions, filtered 311, the intersection table), then
// pure local arithmetic. No model, no key, no Worker: DataSF is open and the
// formula is imported from src/score.js so this cannot drift from production.
//
// Why bulk-then-bucket instead of one countsFor() per intersection: countsFor
// costs three Socrata queries, so the census would be ~25,000 queries against a
// public API. The same information arrives in about a dozen 50k-row pages, and
// an equirectangular distance check against a ~100m grid reproduces the same
// within_circle(80m) counts locally. The parity test at the bottom proves that
// claim against production's own numbers before anything is written.
//
// Pages are cached to scratch files, so a dropped connection resumes instead of
// re-downloading the city.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pointsFor } from "../src/score.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".sweep-cache");
mkdirSync(CACHE, { recursive: true });

const DS_CRASHES = "ubvf-ztfx";
const DS_311 = "vw6y-z8j6";
const DS_INTERSECTIONS = "gmfx-8h6i";
const BASE = "https://data.sfgov.org/resource";

// Identical to src/data.js SERVICE_NAMES. Imported values, not a copy.
import { SERVICE_NAMES } from "../src/data.js";

const RADIUS_M = 80; // SCORE_RADIUS. The grade's footprint, per src/score.js.
const PAGE = 50000;
const DELAY_MS = 400; // polite sequential paging

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const iso = (yearsBack) =>
  new Date(Date.now() - yearsBack * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);

async function page(dataset, params, cacheName) {
  const file = join(CACHE, `${cacheName}.json`);
  if (existsSync(file)) {
    const rows = JSON.parse(readFileSync(file, "utf8"));
    log(`${cacheName}: ${rows.length} rows from cache`);
    return rows;
  }
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({ ...params, "$limit": String(PAGE), "$offset": String(offset), "$order": ":id" });
    const r = await fetch(`${BASE}/${dataset}.json?${q}`);
    if (!r.ok) throw new Error(`${dataset} page ${offset}: http ${r.status}`);
    const batch = await r.json();
    rows.push(...batch);
    log(`${cacheName}: +${batch.length} (total ${rows.length})`);
    if (batch.length < PAGE) break;
    await sleep(DELAY_MS);
  }
  writeFileSync(file, JSON.stringify(rows));
  return rows;
}

// ---------------------------------------------------------------- pulls

const since5 = iso(5);
const since1 = iso(1);

const collisions = await page(
  DS_CRASHES,
  {
    "$select": "point,collision_datetime,collision_severity,ped_action",
    "$where": `point IS NOT NULL AND collision_datetime > '${since5}'`,
  },
  "collisions-5y",
);

const services = SERVICE_NAMES.map((s) => `'${s}'`).join(",");
const reports = await page(
  DS_311,
  {
    "$select": "point,requested_datetime",
    "$where": `point IS NOT NULL AND requested_datetime > '${since1}' AND service_name in(${services})`,
  },
  "reports311-1y",
);

const legs = await page(
  DS_INTERSECTIONS,
  { "$select": "cnn,st_name,the_geom" },
  "intersections",
);

// ---------------------------------------------------------------- crossings

// One row per street leg; a real crossing is a cnn carrying more than one
// distinct street name. Same rule as tools/calibrate_score.js.
const byCnn = new Map();
for (const r of legs) {
  if (!r.cnn) continue;
  let e = byCnn.get(r.cnn);
  if (!e) byCnn.set(r.cnn, (e = { cnn: r.cnn, names: new Map(), lat: null, lon: null }));
  if (r.st_name) e.names.set(r.st_name, (e.names.get(r.st_name) || 0) + 1);
  if (e.lat === null && r.the_geom?.coordinates?.length === 2) {
    e.lon = Number(r.the_geom.coordinates[0]);
    e.lat = Number(r.the_geom.coordinates[1]);
  }
}
const crossings = [...byCnn.values()].filter((e) => e.names.size > 1 && e.lat !== null);
log(`${legs.length} legs -> ${crossings.length} real crossings`);

const title = (s) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b0(\d)/g, "$1");

function nameAndSlug(e) {
  // The two most frequent leg names are the crossing's streets. Ties break
  // alphabetically so reruns are stable.
  const top = [...e.names.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([n]) => n);
  const pretty = top.map(title);
  const sorted = [...pretty].sort((a, b) => a.localeCompare(b));
  return {
    name: `${sorted[0]} and ${sorted[1]}`,
    slug: sorted
      .join(" and ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  };
}

// ---------------------------------------------------------------- buckets

// Equirectangular locally: at SF's latitude the error against true haversine is
// far under a metre at 80m scales, which is smaller than the GPS noise in the
// underlying points.
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((37.77 * Math.PI) / 180);
const CELL_M = 100;
const cellOf = (lat, lon) =>
  `${Math.floor((lat * M_PER_DEG_LAT) / CELL_M)}:${Math.floor((lon * M_PER_DEG_LON) / CELL_M)}`;

function bucket(rows, getPoint) {
  const map = new Map();
  let skipped = 0;
  for (const r of rows) {
    const p = getPoint(r);
    if (!p) {
      skipped++;
      continue;
    }
    const key = cellOf(p.lat, p.lon);
    let arr = map.get(key);
    if (!arr) map.set(key, (arr = []));
    arr.push({ ...r, _lat: p.lat, _lon: p.lon });
  }
  if (skipped) log(`  ${skipped} rows without usable coordinates skipped`);
  return map;
}

// Two shapes for the same column name: the collision dataset stores GeoJSON
// ({coordinates: [lon, lat]}) while the 311 dataset stores the legacy Socrata
// location type ({latitude: "...", longitude: "..."} as strings). Both are
// called point, and the first draft only read the first shape, which zeroed
// safety311 across the whole city and failed the parity check.
const pointOf = (r) => {
  const g = r.point?.coordinates;
  if (g && g.length === 2) {
    const lon = Number(g[0]), lat = Number(g[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  const lat = Number(r.point?.latitude), lon = Number(r.point?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return null;
};

const collisionCells = bucket(collisions, pointOf);
const reportCells = bucket(reports, pointOf);

function* near(cells, lat, lon) {
  const ci = Math.floor((lat * M_PER_DEG_LAT) / CELL_M);
  const cj = Math.floor((lon * M_PER_DEG_LON) / CELL_M);
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const arr = cells.get(`${ci + di}:${cj + dj}`);
      if (arr) yield* arr;
    }
  }
}

const within = (lat, lon, r) => {
  const dy = (r._lat - lat) * M_PER_DEG_LAT;
  const dx = (r._lon - lon) * M_PER_DEG_LON;
  return dy * dy + dx * dx <= RADIUS_M * RADIUS_M;
};

// ---------------------------------------------------------------- score all

// Exact production classification, from src/score.js countsFor: the four named
// severity labels, ped_action non-null and outside the two non-pedestrian
// values (SoQL `not in` drops nulls, so the local test must too).
function countsAt(lat, lon) {
  const c = { fatal: 0, severe: 0, otherVisible: 0, pain: 0, ped: 0, safety311: 0 };
  for (const r of near(collisionCells, lat, lon)) {
    if (!within(lat, lon, r)) continue;
    const s = r.collision_severity;
    if (s === "Fatal") c.fatal++;
    else if (s === "Injury (Severe)") c.severe++;
    else if (s === "Injury (Other Visible)") c.otherVisible++;
    else if (s === "Injury (Complaint of Pain)") c.pain++;
    if (r.ped_action && r.ped_action !== "No Pedestrian Involved" && r.ped_action !== "Not Stated") c.ped++;
  }
  for (const r of near(reportCells, lat, lon)) {
    if (within(lat, lon, r)) c.safety311++;
  }
  return c;
}

log("scoring every crossing");
const results = [];
for (const e of crossings) {
  const counts = countsAt(e.lat, e.lon);
  const { points } = pointsFor(counts);
  results.push({ e, counts, points: Math.round(points * 10) / 10 });
}

const nonzero = results.filter((r) => r.points > 0);
const distribution = results.map((r) => r.points).sort((a, b) => a - b);
log(`${results.length} scored, ${nonzero.length} with nonzero points`);

// ---------------------------------------------------------------- outputs

const seen = new Set();
const out = nonzero
  .sort((a, b) => b.points - a.points)
  .map((r) => {
    const { name, slug } = nameAndSlug(r.e);
    // Distinct cnns can share the same two street names (a crossing cut into
    // quadrants). Keep the highest-scoring instance of each name.
    if (seen.has(slug)) return null;
    seen.add(slug);
    return {
      slug,
      name,
      lat: Math.round(r.e.lat * 1e6) / 1e6,
      lon: Math.round(r.e.lon * 1e6) / 1e6,
      points: r.points,
      counts: r.counts,
    };
  })
  .filter(Boolean);

writeFileSync(
  join(ROOT, "sweep-results.json"),
  JSON.stringify({ runDate: new Date().toISOString().slice(0, 10), radiusM: RADIUS_M, corners: out }, null, 1),
);
writeFileSync(
  join(ROOT, "sweep-distribution.json"),
  JSON.stringify(
    {
      runDate: new Date().toISOString().slice(0, 10),
      rows: { collisions: collisions.length, reports311: reports.length, legs: legs.length, crossings: crossings.length },
      distribution,
    },
    null,
  ),
);
log(`wrote sweep-results.json (${out.length} named corners) and sweep-distribution.json (${distribution.length} values)`);

// ---------------------------------------------------------------- parity

// The whole sweep rests on the local 80m counter matching production's SoQL
// within_circle. Prove it on the flagships before trusting anything above.
log("parity check against production /api/score");
const board = await (await fetch("https://streetcred.thealexschroeder.workers.dev/api/board")).json();
for (const slug of ["16th-mission", "6th-market", "taylor-and-turk"]) {
  const c = board.corners.find((x) => x.slug === slug);
  if (!c) continue;
  const prod = await (
    await fetch(`https://streetcred.thealexschroeder.workers.dev/api/score?x=${slug}`)
  ).json();
  const local = countsAt(c.lat, c.lon);
  const same = JSON.stringify(local) === JSON.stringify(prod.counts);
  log(
    `  ${slug}: ${same ? "MATCH" : "MISMATCH"} local=${JSON.stringify(local)} prod=${JSON.stringify(prod.counts)}`,
  );
}
