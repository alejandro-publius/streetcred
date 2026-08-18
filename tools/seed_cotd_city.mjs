#!/usr/bin/env node
// Reseeds the corner-of-the-day queue from the whole graded city.
//
//   node tools/seed_cotd_city.mjs [--limit N] [--dry]
//
// The queue used to be the top 100 of the sweep, which is a hundred mornings
// of runway. The city has 7,353 graded corners, so the runway is the city:
// worst first, skipping anything already audited or enriched, because a corner
// of the day that was audited last week is not news and the whole feature is
// that the corner is new on the morning it appears.
//
// Entries are corner NAMES, not slugs, because the cron feeds them through the
// same resolver a person types into. The queue is consumed from the front.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseQuery } from "../src/resolve.js";
import { canonicalSlug, CORNERS } from "../src/data.js";
import { pointsFor } from "../src/score.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(ROOT, ".cotd-queue.json");
const DRY = process.argv.includes("--dry");
const LIMIT = parseInt(process.argv[process.argv.indexOf("--limit") + 1], 10) || 0;
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const sweep = JSON.parse(readFileSync(join(ROOT, "sweep-results.json"), "utf8"));
const meta = JSON.parse(readFileSync(join(ROOT, "data", "city", "meta.json"), "utf8"));

// Already checked, at either depth. Both rosters were counted out of KV by
// tools/build_city_shards.mjs, so this reflects what actually exists rather
// than what a local file remembers.
const done = new Set([...(meta.audited || []), ...(meta.enriched || []), ...Object.keys(CORNERS)]);
log(`${done.size} corners already audited or enriched, excluded from the runway`);

const rows = [];
const seen = new Set();
for (const c of sweep.corners) {
  const parsed = parseQuery(c.name);
  if (!parsed.ok) continue;
  const slug = canonicalSlug(parsed.slug);
  if (done.has(slug) || seen.has(slug)) continue;
  // DataSF carries 53 crossings where one leg is literally "Unnamed 106".
  // They are real crossings and they stay in the city, on the map and in the
  // leaderboard, because dropping them would be inventing an exclusion the
  // data does not support. They are kept out of the daily runway only: the
  // morning audit ends in a letter naming a corner, and a street the city has
  // not named cannot carry that sentence.
  if (/\bunnamed\b/i.test(parsed.name)) continue;
  seen.add(slug);
  const { points } = pointsFor(c.counts);
  rows.push({ name: parsed.name, slug, points });
}
rows.sort((a, b) => b.points - a.points || a.slug.localeCompare(b.slug));

const queue = (LIMIT ? rows.slice(0, LIMIT) : rows).map((r) => r.name);
log(`${queue.length} corners of runway, worst first`);
log(`next five mornings: ${queue.slice(0, 5).join("; ")}`);
log(`last in line: ${queue[queue.length - 1]}`);

writeFileSync(TMP, JSON.stringify(queue));
const bytes = Buffer.byteLength(JSON.stringify(queue));
log(`queue payload ${(bytes / 1024).toFixed(1)} KB`);

if (DRY) {
  log("dry run, cotd:queue not written");
  process.exit(0);
}

execFileSync("npx", ["wrangler", "kv", "key", "put", "cotd:queue", "--path", TMP, "--binding", "STORE", "--remote"], {
  cwd: ROOT,
  stdio: "inherit",
  timeout: 180_000,
});
log(`cotd:queue reseeded with ${queue.length} corners`);
