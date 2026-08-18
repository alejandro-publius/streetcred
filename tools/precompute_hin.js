#!/usr/bin/env node
// Warm a batch of High Injury Network corners against the deployed Worker.
//
// It drives the real endpoints rather than reaching into KV directly, so every
// corner is computed by exactly the code a visitor hits, and the daily
// generation cap applies to this run like it applies to anybody else. The cap
// is honored, never bypassed: if it is reached mid-run the script stops
// cleanly and says which corners finished.
//
// Resumable. Progress is written after every corner, so a second invocation
// skips what already completed.
//
//   node tools/precompute_hin.js [--limit N] [--dry]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.STREETCRED_BASE || "https://streetcred.thealexschroeder.workers.dev";
const PROGRESS = join(ROOT, ".hin-progress.json");
const LOGFILE = join(ROOT, "hin-run.log");

// Drawn from the SF Vision Zero High Injury Network, weighted toward the
// intersections carrying the most severe and fatal collisions.
const QUERIES = [
  "6th and Market", "16th and Mission", "Market and Octavia", "Turk and Taylor",
  "Golden Gate and Hyde", "Leavenworth and Eddy", "Mission and Silver",
  "Geary and Webster", "19th and Dolores", "Potrero and 16th",
  "Mission and Geneva", "3rd and Palou", "Alemany and Ocean",
  "Fulton and Masonic", "Oak and Octavia", "Sunset and Sloat",
  "9th and Judah", "Polk and Geary", "Columbus and Broadway", "Van Ness and Market",
];

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : QUERIES.length;
const DRY = args.includes("--dry");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(line) {
  const stamp = new Date().toISOString().slice(11, 19);
  const msg = `[${stamp}] ${line}`;
  console.log(msg);
  appendFileSync(LOGFILE, msg + "\n");
}

function loadProgress() {
  if (!existsSync(PROGRESS)) return { done: {}, started: new Date().toISOString() };
  try {
    return JSON.parse(readFileSync(PROGRESS, "utf8"));
  } catch {
    return { done: {}, started: new Date().toISOString() };
  }
}

function saveProgress(p) {
  writeFileSync(PROGRESS, JSON.stringify(p, null, 2));
}

async function getJSON(path, { tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(BASE + path);
    if (r.status === 429) {
      // The resolve endpoint rate limits per IP. Wait out the window rather
      // than hammering it, since this script is not special.
      log(`  rate limited on ${path}, waiting 70s`);
      await sleep(70_000);
      continue;
    }
    if (r.ok) return r.json();
    if (i === tries - 1) throw new Error(`${path} -> HTTP ${r.status}`);
    await sleep(2000);
  }
  throw new Error(`${path} -> exhausted retries`);
}

// Poll imagery until it settles. Returns the terminal status.
async function waitForImagery(slug, maxMs = 150_000) {
  const start = Date.now();
  let last = "unknown";
  while (Date.now() - start < maxMs) {
    const d = await getJSON(`/api/imagery?x=${encodeURIComponent(slug)}`);
    last = d.status || "ready";
    if (last !== "pending") return last;
    await sleep(5000);
  }
  return last;
}

function buildCard(slug, corner, score) {
  if (DRY) return "skipped (dry)";
  try {
    execFileSync(
      "python3",
      [
        join(ROOT, "tools", "make_og.py"),
        slug,
        String(corner.lat),
        String(corner.lon),
        corner.name,
        String(score.index),
        score.grade,
        String(corner.heading ?? 0),
      ],
      { cwd: ROOT, stdio: "pipe", timeout: 240_000 },
    );
    return "built";
  } catch (e) {
    return `failed: ${String(e.message || e).slice(0, 90)}`;
  }
}

async function doCorner(query, progress) {
  log(`corner: ${query}`);

  const resolved = await getJSON(`/api/resolve?q=${encodeURIComponent(query)}`);
  if (!resolved.ok) {
    log(`  RESOLVE FAILED: ${resolved.message || resolved.reason}`);
    return { query, ok: false, stage: "resolve", detail: resolved.reason };
  }
  const slug = resolved.slug;
  const x = `?x=${encodeURIComponent(slug)}`;
  log(`  slug=${slug} district=${resolved.district ?? "none"} via ${resolved.source}`);

  // Records lanes first. These are keyless or cheap and they decide whether
  // imagery is even worth generating.
  const stats = await getJSON(`/api/stats${x}`);
  const score = await getJSON(`/api/score${x}`);
  log(`  index=${score.index} grade=${score.grade} collisions=${stats.crashes} 311=${stats.reports311}`);

  // Imagery. This is the only billed step, and the Worker's own daily cap
  // governs it. A corner that comes back at capacity is recorded, not retried.
  const imageryStatus = await waitForImagery(slug);
  log(`  imagery: ${imageryStatus}`);
  if (imageryStatus === "atcapacity") {
    return { query, slug, ok: false, stage: "imagery", detail: "daily generation cap reached", capped: true };
  }

  // Everything else, warmed in order. A corner ships even if one of these
  // fails: a missing picture is not a reason to drop a corner that has
  // collisions.
  const warmed = {};
  for (const [name, path] of [
    ["news", `/api/news${x}`],
    ["hazards", `/api/hazards${x}`],
    ["cred", `/api/cred${x}`],
    ["letter", `/api/letter${x}`],
  ]) {
    try {
      const d = await getJSON(path);
      warmed[name] = d.source || "ok";
    } catch (e) {
      warmed[name] = `failed: ${String(e.message || e).slice(0, 60)}`;
      log(`  ${name} FAILED: ${warmed[name]}`);
    }
  }
  log(`  warmed: ${Object.entries(warmed).map(([k, v]) => `${k}=${v}`).join(" ")}`);

  const corner = {
    lat: resolved.lat,
    lon: resolved.lon,
    name: resolved.name,
    heading: resolved.heading ?? 0,
  };

  const card = corner.lat ? buildCard(slug, corner, score) : "skipped (no geometry)";
  log(`  share card: ${card}`);

  const cred = await getJSON(`/api/cred${x}`).catch(() => ({}));

  // Record what this run actually did, labelled as a precompute rather than
  // as a visit, so the replay says who drove it.
  const run = await getJSON(`/api/run?x=${slug}&trigger=precompute&refresh=1`).catch(() => null);
  log(`  manifest: ${run ? Object.keys(run.stages).filter((k) => run.stages[k].ran).length + " stages ran" : "FAILED"}`);

  return {
    query,
    slug,
    ok: true,
    name: corner.name,
    lat: corner.lat,
    lon: corner.lon,
    district: resolved.district ?? null,
    index: score.index,
    grade: score.grade,
    counts: score.counts,
    collisions: stats.crashes,
    fatal: stats.fatal,
    verdict: cred.verdict || null,
    imagery: imageryStatus,
    card,
  };
}

const progress = loadProgress();
log(`=== run start, base=${BASE}, ${QUERIES.length} corners, limit=${LIMIT}${DRY ? ", DRY" : ""} ===`);

let processed = 0;
let capped = false;
for (const query of QUERIES) {
  if (processed >= LIMIT) break;
  if (progress.done[query]?.ok) {
    log(`corner: ${query} (already done, skipping)`);
    continue;
  }
  let result;
  try {
    result = await doCorner(query, progress);
  } catch (e) {
    result = { query, ok: false, stage: "exception", detail: String(e.message || e).slice(0, 140) };
    log(`  EXCEPTION: ${result.detail}`);
  }
  progress.done[query] = result;
  saveProgress(progress);
  processed++;

  if (result.capped) {
    capped = true;
    log("STOPPING: daily generation cap reached. Re-run tomorrow to continue.");
    break;
  }
  // Space out the billed calls. The Worker is not the bottleneck here, quota is.
  await sleep(4000);
}

const rows = Object.values(progress.done).filter((r) => r.ok);
rows.sort((a, b) => b.index - a.index);

log("");
log(`=== summary: ${rows.length} warmed, ${Object.values(progress.done).length - rows.length} incomplete ===`);
for (const r of rows) log(`  ${String(r.index).padStart(3)} ${r.grade}  ${r.name} (${r.slug}) imagery=${r.imagery} card=${r.card}`);
for (const r of Object.values(progress.done).filter((x) => !x.ok)) {
  log(`  FAILED ${r.query} at ${r.stage}: ${r.detail}`);
}

// The leaderboard the homepage reads. One KV key, already ranked.
const list = rows.map((r) => ({
  slug: r.slug, name: r.name, lat: r.lat, lon: r.lon, district: r.district,
  index: r.index, grade: r.grade, collisions: r.collisions, fatal: r.fatal,
  counts: r.counts, verdict: r.verdict,
}));
writeFileSync(join(ROOT, ".hin-list.json"), JSON.stringify({ built: new Date().toISOString(), corners: list }, null, 2));
log(`wrote .hin-list.json with ${list.length} corners`);

if (!DRY && list.length) {
  try {
    execFileSync("npx", ["wrangler", "kv", "key", "put", "hin:list",
      "--binding", "STORE", "--remote", "--path", join(ROOT, ".hin-list.json")],
      { cwd: ROOT, stdio: "pipe", timeout: 180_000 });
    log("uploaded hin:list to KV");
  } catch (e) {
    log(`hin:list UPLOAD FAILED: ${String(e.message || e).slice(0, 140)}`);
  }
}

log(capped ? "=== run stopped at cap ===" : "=== run complete ===");
