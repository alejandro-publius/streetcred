#!/usr/bin/env node
// Seeds the corner-of-the-day queue in KV from COTD_SEED in src/data.js.
//
//   node tools/seed_cotd.js [--force]
//
// Refuses to overwrite an existing queue unless forced, because the queue is
// consumed from the front: reseeding it would make the cron re-audit corners it
// has already done and spend a second pair of image generations on each.
//
// Anything already warmed is dropped from the seed. A "corner of the day" that
// was audited last week is not news, and the whole point of the feature is that
// the corner is new on the morning it appears.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COTD_SEED } from "../src/data.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(ROOT, ".cotd-queue.json");
const FORCE = process.argv.includes("--force");
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const kv = (args) =>
  execFileSync("npx", ["wrangler", "kv", ...args, "--binding", "STORE", "--remote"], {
    cwd: ROOT,
    stdio: "pipe",
    timeout: 180_000,
    encoding: "utf8",
  });

let existing = null;
try {
  existing = JSON.parse(kv(["key", "get", "cotd:queue"]));
} catch {
  existing = null;
}

if (existing && existing.length && !FORCE) {
  log(`cotd:queue already holds ${existing.length} entries. Pass --force to replace it.`);
  log(`next up: ${existing.slice(0, 3).join(", ")}`);
  process.exit(0);
}

// Drop anything already on the board. Slug matching is loose on purpose: the
// seed is written the way a person says a corner, not the way it is stored.
const warmed = new Set(
  JSON.parse(readFileSync(join(ROOT, ".hin-list.json"), "utf8")).corners.map((c) => c.slug),
);
const slugish = (q) =>
  q.toLowerCase().replace(/\band\b|&/g, " ").split(/\s+/).filter(Boolean).sort().join("-");
const warmedSlugish = new Set([...warmed].map((s) => slugish(s.replace(/-/g, " "))));

const queue = COTD_SEED.filter((q) => !warmedSlugish.has(slugish(q)));
const dropped = COTD_SEED.length - queue.length;

writeFileSync(TMP, JSON.stringify(queue));
kv(["key", "put", "cotd:queue", "--path", TMP]);
log(`seeded cotd:queue with ${queue.length} entries${dropped ? `, ${dropped} already warmed and dropped` : ""}`);
log(`${queue.length} days of runway. First three: ${queue.slice(0, 3).join(", ")}`);
