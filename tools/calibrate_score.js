// Freezes the citywide points distribution the Danger Index is scored against.
//
// Run once. It draws a reproducible random sample of real San Francisco
// intersections, runs the production points formula against each one, and prints
// the sorted array to paste into src/score.js as DISTRIBUTION.
//
//   node tools/calibrate_score.js
//
// It imports countsFor and pointsFor from src/score.js rather than reimplementing
// them, so the yardstick is measured with the same ruler as every corner scored
// against it. It needs no key and no deployed Worker: DataSF is open.
//
// The sample is seeded and the seed is committed, so anyone can rerun this and
// get the same sample and the same array. That is the difference
// between a frozen constant and a number somebody once saw.

import { soql } from "../src/resolve.js";
import { countsFor, pointsFor, DISTRIBUTION_SEED } from "../src/score.js";

const DS_INTERSECTIONS = "gmfx-8h6i";
const SAMPLE_SIZE = 600;
const CONCURRENCY = 8;

// mulberry32. Small, deterministic, and identical on every machine, which is the
// only property that matters here.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// gmfx-8h6i stores one row per street leg, so an intersection is several rows
// sharing a cnn. A cnn carrying only one distinct street name is not a crossing,
// it is a dead end or a name change, and it does not belong in a distribution of
// intersections.
async function allIntersections() {
  log("fetching the intersection table");
  const rows = await soql(DS_INTERSECTIONS, {
    "$select": "cnn,st_name,the_geom",
    "$limit": "60000",
  });
  log(`${rows.length} legs`);
  const byCnn = new Map();
  for (const r of rows) {
    if (!r.cnn) continue;
    let e = byCnn.get(r.cnn);
    if (!e) byCnn.set(r.cnn, (e = { cnn: r.cnn, names: new Set(), lat: null, lon: null }));
    if (r.st_name) e.names.add(r.st_name);
    if (e.lat === null && r.the_geom?.coordinates?.length === 2) {
      e.lon = Number(r.the_geom.coordinates[0]);
      e.lat = Number(r.the_geom.coordinates[1]);
    }
  }
  const real = [...byCnn.values()].filter((e) => e.names.size > 1 && e.lat !== null);
  // Sorted by cnn so the population order does not depend on what order Socrata
  // happened to return rows in. Without this the seed alone would not reproduce.
  real.sort((a, b) => String(a.cnn).localeCompare(String(b.cnn)));
  log(`${real.length} real intersections with geometry`);
  return real;
}

function sample(pop, n, seed) {
  const rand = rng(seed);
  const idx = pop.map((_, i) => i);
  // Fisher-Yates over the index list, then take the first n.
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).map((i) => pop[i]);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const pop = await allIntersections();
const picked = sample(pop, SAMPLE_SIZE, DISTRIBUTION_SEED);
log(`sampled ${picked.length} with seed ${DISTRIBUTION_SEED}`);

let done = 0;
const scored = await mapLimit(picked, CONCURRENCY, async (e) => {
  let counts;
  try {
    counts = await countsFor(e.lat, e.lon);
  } catch (err) {
    log(`  ${e.cnn} FAILED: ${err.message}`);
    return null;
  }
  const { points } = pointsFor(counts);
  done++;
  if (done % 25 === 0) log(`  ${done}/${picked.length}`);
  return { cnn: e.cnn, names: [...e.names].join(" / "), points, counts };
});

const ok = scored.filter(Boolean);
if (ok.length < picked.length) log(`${picked.length - ok.length} failed and are excluded`);

const values = ok.map((r) => Math.round(r.points * 10) / 10).sort((a, b) => a - b);
const at = (p) => values[Math.min(values.length - 1, Math.floor((p / 100) * values.length))];

log("");
log(`n=${values.length}  min=${values[0]}  median=${at(50)}  p90=${at(90)}  max=${values[values.length - 1]}`);
log(`zero-harm intersections in sample: ${values.filter((v) => v === 0).length}`);
log("");
log("worst five in the sample:");
for (const r of [...ok].sort((a, b) => b.points - a.points).slice(0, 5)) {
  log(`  ${String(r.points).padStart(6)}  ${r.names}  (cnn ${r.cnn})`);
}

console.log("\n// paste into src/score.js\nexport const DISTRIBUTION = [");
for (let i = 0; i < values.length; i += 12) {
  console.log("  " + values.slice(i, i + 12).map((v) => String(v)).join(", ") + ",");
}
console.log("];");
