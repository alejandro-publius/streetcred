#!/usr/bin/env node
// Builds the typeahead index: every real crossing in the city, sharded into KV
// so one keystroke costs one KV read and zero DataSF calls.
//
//   node tools/build_suggest_index.mjs
//
// Names and slugs come from parseQuery, the same normalizer the resolver uses,
// so a suggestion always lands on the page the resolver would build for the
// typed name. Each crossing is indexed under the first two characters of BOTH
// its street names: "16 mis" finds 16th and Mission through the "16" shard,
// "mis 16" finds it through the "mi" shard.
//
// Entries are compact arrays [name, slug, grade, tier]:
//   3 audited   grade chip, every lane checked
//   2 enriched  grade chip, records and index, no visual audit
//   1 scored    grade dot, graded against the citywide census
//   0 no grade  a real crossing the sweep found no reported harm at, so no
//               grade is shown, because the dropdown must not invent one
// Every corner in the city shards now carries its grade here, which is what
// makes the whole city suggestible rather than the warmed 123.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseQuery } from "../src/resolve.js";
import { canonicalSlug } from "../src/data.js";
import { pointsFor, percentileOf, gradeFor } from "../src/score.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const legs = JSON.parse(readFileSync(join(ROOT, ".sweep-cache", "intersections.json"), "utf8"));
const byCnn = new Map();
for (const r of legs) {
  if (!r.cnn) continue;
  let e = byCnn.get(r.cnn);
  if (!e) byCnn.set(r.cnn, (e = { names: new Map() }));
  if (r.st_name) e.names.set(r.st_name, (e.names.get(r.st_name) || 0) + 1);
}

const title = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

const board = await (await fetch("https://streetcred.thealexschroeder.workers.dev/api/board")).json();
const auditedBySlug = new Map(board.corners.map((c) => [c.slug, c]));

// Grades for the whole graded city, from the sweep through the same three
// functions the Worker and the shard builder call. Not a second grade
// implementation: a second caller of the one implementation.
const sweep = JSON.parse(readFileSync(join(ROOT, "sweep-results.json"), "utf8"));
const gradeBySlug = new Map();
for (const c of sweep.corners) {
  const parsed = parseQuery(c.name);
  if (!parsed.ok) continue;
  const { points } = pointsFor(c.counts);
  gradeBySlug.set(canonicalSlug(parsed.slug), gradeFor(percentileOf(points)));
}
log(`${gradeBySlug.size} graded corners available to the typeahead`);

// Which tier each warmed corner is in, read from the city meta the shard
// builder wrote out of KV rather than guessed at here.
const meta = JSON.parse(readFileSync(join(ROOT, "data", "city", "meta.json"), "utf8"));
const auditedSet = new Set(meta.audited || []);
const enrichedSet = new Set(meta.enriched || []);

const seen = new Set();
const entries = [];
for (const e of byCnn.values()) {
  const top = [...e.names.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([n]) => title(n));
  if (top.length < 2) continue;
  const parsed = parseQuery(`${top[0]} and ${top[1]}`);
  if (!parsed.ok) continue;
  const slug = canonicalSlug(parsed.slug);
  if (seen.has(slug)) continue;
  seen.add(slug);

  // An audited corner's grade is its live one; everything else takes the
  // swept grade, which is exactly what its page will show.
  const grade = auditedBySlug.get(slug)?.grade ?? gradeBySlug.get(slug) ?? null;
  const tier = auditedSet.has(slug) ? 3 : enrichedSet.has(slug) ? 2 : gradeBySlug.has(slug) ? 1 : 0;
  entries.push([parsed.name, slug, grade, tier]);
}
const byTier = entries.reduce((acc, e) => ((acc[e[3]] = (acc[e[3]] || 0) + 1), acc), {});
log(`${entries.length} distinct crossings indexed: ${JSON.stringify(byTier)}`);

// Shard by the first two characters of each street word that starts a name
// half. "16th and Mission" shards under "16" and "mi".
const shards = new Map();
for (const entry of entries) {
  const halves = entry[0].toLowerCase().split(" and ");
  const keys = new Set();
  for (const h of halves) {
    const k = h.replace(/[^a-z0-9]/g, "").slice(0, 2);
    if (k.length === 2) keys.add(k);
  }
  for (const k of keys) {
    if (!shards.has(k)) shards.set(k, []);
    shards.get(k).push(entry);
  }
}
let biggest = ["", 0];
for (const [k, v] of shards) if (v.length > biggest[1]) biggest = [k, v.length];
log(`${shards.size} shards, largest "${biggest[0]}" holds ${biggest[1]}`);

const bulk = [...shards.entries()].map(([k, v]) => ({
  key: `suggest:idx:${k}`,
  value: JSON.stringify(v),
}));
const bulkFile = join(ROOT, ".suggest-bulk.json");
writeFileSync(bulkFile, JSON.stringify(bulk));
execFileSync("npx", ["wrangler", "kv", "bulk", "put", bulkFile, "--binding", "STORE", "--remote"], {
  cwd: ROOT,
  stdio: "inherit",
  timeout: 600_000,
});
log(`uploaded ${bulk.length} shards to KV`);
