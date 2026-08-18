#!/usr/bin/env node
// Do two different intersections ever land on the same slug?
//
//   node tools/audit_slugs.mjs
//
// The resolver's normalizer strips street types, so "19th Avenue" and "19th
// Street" both reduce to "19th". That is correct for typing (nobody types the
// suffix) and dangerous for identity: if 19th Ave and 19th St both cross the
// same street, the two crossings collapse onto one slug, one of them is
// silently dropped from the city, and the surviving page carries the other
// one's grade.
//
// This audit pulls the intersections table WITH st_type, which the sweep never
// selected, and asks the question directly.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseQuery } from "../src/resolve.js";
import { canonicalSlug } from "../src/data.js";
import { countsFor, pointsFor, percentileOf, gradeFor } from "../src/score.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".sweep-cache");
mkdirSync(CACHE, { recursive: true });
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const FILE = join(CACHE, "intersections-typed.json");
let legs;
if (existsSync(FILE)) {
  legs = JSON.parse(readFileSync(FILE, "utf8"));
  log(`${legs.length} legs from cache`);
} else {
  const rows = [];
  for (let offset = 0; ; offset += 50000) {
    const q = new URLSearchParams({
      "$select": "cnn,st_name,st_type,the_geom",
      "$limit": "50000",
      "$offset": String(offset),
      "$order": ":id",
    });
    const r = await fetch(`https://data.sfgov.org/resource/gmfx-8h6i.json?${q}`);
    if (!r.ok) throw new Error(`datasf ${r.status}`);
    const batch = await r.json();
    rows.push(...batch);
    log(`  +${batch.length} (total ${rows.length})`);
    if (batch.length < 50000) break;
    await new Promise((res) => setTimeout(res, 800));
  }
  writeFileSync(FILE, JSON.stringify(rows));
  legs = rows;
}

// Same collapse the sweep uses: one row per leg, a crossing is a cnn carrying
// more than one distinct street name.
const byCnn = new Map();
for (const r of legs) {
  if (!r.cnn) continue;
  let e = byCnn.get(r.cnn);
  if (!e) byCnn.set(r.cnn, (e = { cnn: r.cnn, names: new Map(), typed: new Map(), lat: null, lon: null }));
  if (r.st_name) {
    e.names.set(r.st_name, (e.names.get(r.st_name) || 0) + 1);
    const full = `${r.st_name}${r.st_type ? ` ${r.st_type}` : ""}`;
    e.typed.set(r.st_name, full);
  }
  if (e.lat === null && r.the_geom?.coordinates?.length === 2) {
    e.lon = Number(r.the_geom.coordinates[0]);
    e.lat = Number(r.the_geom.coordinates[1]);
  }
}

const title = (s) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b0(\d)/g, "$1");

const crossings = [];
for (const e of byCnn.values()) {
  if (e.names.size < 2 || e.lat === null) continue;
  const top = [...e.names.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([n]) => n);
  const pretty = top.map(title);
  const parsed = parseQuery(`${pretty[0]} and ${pretty[1]}`);
  if (!parsed.ok) continue;
  crossings.push({
    cnn: e.cnn,
    slug: canonicalSlug(parsed.slug),
    name: parsed.name,
    // The typed identity: what the city actually calls these two streets.
    typed: top.map((n) => e.typed.get(n)).sort().join(" + "),
    lat: e.lat,
    lon: e.lon,
  });
}
log(`${crossings.length} real crossings with a parseable name`);

const bySlug = new Map();
for (const c of crossings) {
  if (!bySlug.has(c.slug)) bySlug.set(c.slug, []);
  bySlug.get(c.slug).push(c);
}

const M_LAT = 111320, M_LON = 111320 * Math.cos((37.77 * Math.PI) / 180);
const metres = (a, b) => Math.hypot((a.lat - b.lat) * M_LAT, (a.lon - b.lon) * M_LON);

// A slug shared by two cnns is normal: a big crossing is cut into quadrants and
// each quadrant is its own cnn a few metres away, with identical street types.
// A COLLISION is two cnns on one slug whose typed street identities differ,
// which means the suffix was the only thing telling them apart.
const collisions = [];
const quadrants = [];
for (const [slug, list] of bySlug) {
  if (list.length < 2) continue;
  const typedSets = new Set(list.map((c) => c.typed));
  if (typedSets.size === 1) {
    quadrants.push({ slug, n: list.length });
    continue;
  }
  let spread = 0;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) spread = Math.max(spread, metres(list[i], list[j]));
  collisions.push({
    slug, name: list[0].name, variants: [...typedSets], spreadM: Math.round(spread), count: list.length,
    places: list.map((c) => ({ cnn: c.cnn, typed: c.typed, lat: c.lat, lon: c.lon })),
  });
}

collisions.sort((a, b) => b.spreadM - a.spreadM);

console.log("");
log(`${bySlug.size} distinct slugs`);
log(`${quadrants.length} slugs shared by cnns with identical street types (quadrants of one crossing, expected)`);
log(`${collisions.length} TRUE COLLISIONS: one slug, two different pairs of streets`);
console.log("");
for (const c of collisions.slice(0, 25)) {
  console.log(`  ${c.slug.padEnd(30)} ${String(c.spreadM).padStart(5)}m apart  ${c.variants.join("   vs   ")}`);
}

writeFileSync(join(ROOT, ".slug-collisions.json"), JSON.stringify({ builtAt: new Date().toISOString().slice(0, 10), collisions }, null, 1));
log(`wrote .slug-collisions.json (${collisions.length})`);

// ---------------------------------------------------------------- twins

// Only a collision that is actually two different places gets split. Three of
// the five are 36 to 63 metres apart, which is one junction where the city
// labels one leg a Terrace and the other a Street; two pages forty metres
// apart would be a worse answer than one. The bar is the same 150m the
// district vote already uses to decide what counts as "here".
const SPLIT_M = 150;
const splits = collisions.filter((c) => c.spreadM > SPLIT_M);
log(`${splits.length} collisions are more than ${SPLIT_M}m apart and get disambiguated slugs`);
log(`${collisions.length - splits.length} are one junction under two labels and stay merged`);

const titleCase = (t) => t.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b0(\d)/g, "$1");

const twins = [];
for (const c of splits) {
  // Which street is doing the disambiguating: the one whose type differs
  // between the variants.
  const parts = c.places.map((p) => p.typed.split(" + "));
  const differing = parts[0].findIndex((seg, i) => parts.some((other) => other[i] !== seg));
  if (differing < 0) continue;
  const rows = [];
  for (const place of c.places) {
    const segs = place.typed.split(" + ");
    const type = segs[differing].split(" ").pop().toLowerCase();
    const slug = `${c.slug}-${type}`;
    // Scored through the same countsFor the Worker calls, against the live
    // datasets, so a disambiguated page is graded by the production path
    // rather than by a second implementation of it.
    const counts = await countsFor(place.lat, place.lon);
    const { points } = pointsFor(counts);
    const index = percentileOf(points);
    rows.push({
      slug,
      name: segs.map(titleCase).join(" and "),
      lat: Math.round(place.lat * 1e6) / 1e6,
      lon: Math.round(place.lon * 1e6) / 1e6,
      points: Math.round(points * 10) / 10,
      index,
      grade: gradeFor(index),
      counts,
      cnn: place.cnn,
    });
    log(`  ${slug.padEnd(28)} ${gradeFor(index)} ${String(index).padStart(2)}  ${points.toFixed(1)} pts  ${segs.map(titleCase).join(" and ")}`);
  }
  // The bare slug keeps working and keeps pointing at whichever crossing the
  // city already served there, so no link that exists today breaks.
  const preferred = [...rows].sort((a, b) => b.points - a.points)[0];
  twins.push({ bare: c.slug, spreadM: c.spreadM, preferred: preferred.slug, rows });
}

mkdirSync(join(ROOT, "data", "city"), { recursive: true });
writeFileSync(
  join(ROOT, "data", "city", "twins.json"),
  JSON.stringify({ builtAt: new Date().toISOString().slice(0, 10), splitAboveM: SPLIT_M, twins }, null, 1),
);
log(`wrote data/city/twins.json (${twins.length} disambiguated pairs)`);
