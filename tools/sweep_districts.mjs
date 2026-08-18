#!/usr/bin/env node
// The district pass over the citywide sweep.
//
//   node tools/sweep_districts.mjs
//
// The sweep scores every crossing but never asked which district each one is
// in, so sweep-results.json shipped without the one field the letter's
// addressee depends on. This adds it, in place, without touching a single
// score: the counts and points in that file were proved identical to
// production's within_circle numbers before they were written, and re-deriving
// them against a window that has since moved by a few hours would replace
// verified figures with unverified ones for no gain.
//
// One bulk pull, one local majority vote per corner, using the same
// districtFromRows the Worker uses. No model, no key.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { districtsForCorners, DISTRICT_RADIUS_M } from "./lib/districts.mjs";
import { SUPERVISORS } from "../src/data.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".sweep-cache");
mkdirSync(CACHE, { recursive: true });

const DS_CRASHES = "ubvf-ztfx";
const BASE = "https://data.sfgov.org/resource";
const PAGE = 50000;
const DELAY_MS = 1000;

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cache files are named for the columns they hold, not just the dataset. A
// cache keyed only on "collisions" would be reused by a later run that asked
// for one more column, and every corner would silently come back districtless.
const CACHE_NAME = "collisions-district-5y";

async function pull() {
  const file = join(CACHE, `${CACHE_NAME}.json`);
  if (existsSync(file)) {
    const rows = JSON.parse(readFileSync(file, "utf8"));
    log(`${rows.length} collision rows from cache`);
    return rows;
  }
  // The same 5 year window the sweep scored over, so the rows voting on a
  // district are the rows that produced the counts.
  const since = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({
      "$select": "point,supervisor_district",
      "$where": `point IS NOT NULL AND collision_datetime > '${since}'`,
      "$limit": String(PAGE),
      "$offset": String(offset),
      "$order": ":id",
    });
    const r = await fetch(`${BASE}/${DS_CRASHES}.json?${q}`);
    if (!r.ok) throw new Error(`collisions page ${offset}: http ${r.status}`);
    const batch = await r.json();
    rows.push(...batch);
    log(`  +${batch.length} (total ${rows.length})`);
    if (batch.length < PAGE) break;
    await sleep(DELAY_MS);
  }
  writeFileSync(file, JSON.stringify(rows));
  return rows;
}

const path = join(ROOT, "sweep-results.json");
const sweep = JSON.parse(readFileSync(path, "utf8"));
log(`${sweep.corners.length} corners in sweep-results.json (run ${sweep.runDate})`);

const rows = await pull();
const { districts, rowsPlaced } = districtsForCorners(sweep.corners, rows);
log(`${rowsPlaced} of ${rows.length} collision rows carry a usable district and point`);

let placed = 0;
const byDistrict = new Map();
for (const c of sweep.corners) {
  const d = districts.get(c.slug) ?? null;
  c.district = d;
  if (d !== null) {
    placed++;
    byDistrict.set(d, (byDistrict.get(d) || 0) + 1);
  }
}

sweep.districtRadiusM = DISTRICT_RADIUS_M;
writeFileSync(path, JSON.stringify(sweep, null, 1));

const pct = Math.round((100 * placed) / sweep.corners.length);
log(`${placed} of ${sweep.corners.length} corners placed in a district (${pct} percent)`);
log(`${sweep.corners.length - placed} fall back to the citywide addressee`);
for (const [d, n] of [...byDistrict.entries()].sort((a, b) => a[0] - b[0])) {
  log(`  district ${String(d).padStart(2)}: ${String(n).padStart(4)} corners  ${SUPERVISORS[d] || "unknown"}`);
}

// The two flagships carry hand-verified districts in src/data.js. If the sweep
// disagrees with those, the vote is wrong and nothing downstream should run.
const check = [
  ["16th-and-mission", 9],
  ["6th-and-market", 6],
];
for (const [slug, expected] of check) {
  const c = sweep.corners.find((x) => x.slug === slug);
  if (!c) {
    log(`  flagship ${slug}: NOT IN SWEEP`);
    continue;
  }
  log(`  flagship ${slug}: district ${c.district} expected ${expected} ${c.district === expected ? "MATCH" : "MISMATCH"}`);
}
