#!/usr/bin/env node
// Warms a few deliberately calm residential corners, records lanes only.
//
//   node tools/warm_calm.js
//
// Why this exists: every corner warmed so far was drawn from the High Injury
// Network, so the whole leaderboard read D and F and the scale looked broken
// from the outside even though it was working. These corners give the board a
// bottom. They are graded by exactly the same formula with no special casing:
// if one of them came back a D, the honest move would be to report that number,
// not to tune the formula until it agreed with the intent.
//
// They are warmed for records only. It marks each stored corner record with
// derived:false, which the imagery lane reads and treats as "show the real
// Street View photograph, generate nothing". Two billed image generations per
// corner would buy nothing the argument needs.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.STREETCRED_BASE || "https://streetcred.thealexschroeder.workers.dev";
const LIST = join(ROOT, ".hin-list.json");
const TMP = join(ROOT, ".calm-corner.json");

// Richmond and Sunset. Chosen for being ordinary, not for being flattering.
const QUERIES = ["Cabrillo and 40th", "Moraga and 12th", "31st and Lawton"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const kv = (args, opts = {}) =>
  execFileSync("npx", ["wrangler", "kv", ...args, "--binding", "STORE", "--remote"], {
    cwd: ROOT,
    stdio: opts.capture ? "pipe" : "ignore",
    timeout: 180_000,
    encoding: "utf8",
  });

async function getJSON(path) {
  const r = await fetch(BASE + path);
  if (r.status === 429) {
    log(`  rate limited on ${path}, waiting 70s`);
    await sleep(70_000);
    return getJSON(path);
  }
  return r.json();
}

const warmed = [];
for (const q of QUERIES) {
  log(`corner: ${q}`);
  const res = await getJSON(`/api/resolve?q=${encodeURIComponent(q)}`);
  if (!res.ok) {
    log(`  RESOLVE FAILED: ${res.reason} ${res.message || ""}`);
    continue;
  }
  const slug = res.slug;
  log(`  slug=${slug} district=${res.district ?? "none"} via ${res.source}`);

  // Mark the stored record before anything asks for imagery. Doing it in this
  // order is the whole point: once the imagery lane has run for a corner it has
  // already decided whether to spend.
  const raw = kv(["key", "get", `corner:${slug}`], { capture: true });
  const rec = JSON.parse(raw);
  rec.derived = false;
  writeFileSync(TMP, JSON.stringify(rec));
  kv(["key", "put", `corner:${slug}`, "--path", TMP]);
  // Any imagery status written by an earlier visit would short circuit the
  // records-only branch, so clear it. Missing keys are not an error here.
  try {
    kv(["key", "delete", `imgstatus:${slug}`, "--force"]);
  } catch {}
  log(`  marked records only`);

  const stats = await getJSON(`/api/stats?x=${slug}`);
  const score = await getJSON(`/api/score?x=${slug}`);
  log(`  index=${score.index} grade=${score.grade} points=${score.points} collisions=${stats.crashes}`);

  const img = await getJSON(`/api/imagery?x=${slug}`);
  log(`  imagery: ${img.status}${img.today ? ", today frame present" : ", no today frame"}`);
  if (img.status !== "recordsonly") log(`  WARNING: expected recordsonly, got ${img.status}`);

  const letter = await getJSON(`/api/letter?x=${slug}`);
  log(`  letter: ${letter.source}, to ${letter.supervisor}`);

  const cred = await getJSON(`/api/cred?x=${slug}`);
  log(`  cred: ${cred.verdict} ${cred.score}`);

  warmed.push({
    slug,
    name: res.name || q,
    lat: res.lat,
    lon: res.lon,
    district: res.district ?? null,
    index: score.index,
    grade: score.grade,
    counts: score.counts,
    points: score.points,
    collisions: stats.crashes,
    fatal: stats.fatal,
    verdict: cred.verdict || null,
  });
  await sleep(1500);
}

if (!warmed.length) {
  log("nothing warmed, leaderboard untouched");
  process.exit(1);
}

const prior = JSON.parse(readFileSync(LIST, "utf8")).corners;
const bySlug = new Map(prior.map((c) => [c.slug, c]));
for (const c of warmed) bySlug.set(c.slug, { ...bySlug.get(c.slug), ...c });
const rows = [...bySlug.values()].sort((a, b) => b.index - a.index || (b.points || 0) - (a.points || 0));

writeFileSync(LIST, JSON.stringify({ built: new Date().toISOString(), corners: rows }, null, 2));
kv(["key", "put", "hin:list", "--path", LIST]);
log(`uploaded hin:list with ${rows.length} corners`);

const tally = {};
for (const r of rows) tally[r.grade] = (tally[r.grade] || 0) + 1;
log(`grade spread: ${JSON.stringify(tally)}`);
log("bottom of the board:");
for (const r of rows.slice(-5)) log(`  ${String(r.index).padStart(3)} ${r.grade}  ${r.name}`);
