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
// Entries are compact arrays [name, slug, grade, tier], tier 2 = audited
// (grade chip in the dropdown), 1 = score tier (grade dot), 0 = everything
// else (no grade shown, because none has been computed and the dropdown must
// not invent one).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseQuery } from "../src/resolve.js";
import { canonicalSlug } from "../src/data.js";

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
const tierList = JSON.parse(readFileSync(join(ROOT, "public", "data", "scoretier.json"), "utf8"));
const auditedBySlug = new Map(board.corners.map((c) => [c.slug, c]));
const scoredBySlug = new Map(tierList.corners.map((c) => [c.slug, c]));

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

  const audited = auditedBySlug.get(slug);
  const scored = scoredBySlug.get(slug);
  const grade = audited?.grade ?? scored?.grade ?? null;
  const tier = audited ? 2 : scored ? 1 : 0;
  entries.push([parsed.name, slug, grade, tier]);
}
log(`${entries.length} distinct crossings indexed`);

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
