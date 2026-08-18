#!/usr/bin/env node
// Re-scores every warmed corner against the deployed Worker and rebuilds the
// leaderboard KV key.
//
//   node tools/rescore.js
//
// Deliberately narrow. It touches the score lane and the leaderboard and
// nothing else: no imagery, no Exa, no letters. When the scoring rules change,
// the grade has to move everywhere at once, but regenerating a letter is a
// billed model call and belongs in its own explicit pass.
//
// SCORE_VERSION already invalidates stored scores on read, so a visitor would
// get the new grade anyway. This exists so the leaderboard and the share cards
// do not sit on the old numbers until somebody happens to open each corner.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.STREETCRED_BASE || "https://streetcred.thealexschroeder.workers.dev";
const LIST = join(ROOT, ".hin-list.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// The deployed board is the source of truth for WHICH corners exist, because
// the cron adds a corner every morning and the local file goes stale the same
// day. Rescoring from the stale file once dropped the corner of the day off the
// production board. Fetch the live list, fall back to the file only if the
// fetch fails.
let prior;
try {
  const live = await (await fetch(`${BASE}/api/board`)).json();
  if (!live?.corners?.length) throw new Error("empty board");
  const localById = new Map(
    (JSON.parse(readFileSync(LIST, "utf8")).corners || []).map((c) => [c.slug, c]),
  );
  prior = { corners: live.corners.map((c) => ({ ...localById.get(c.slug), ...c })) };
} catch {
  prior = JSON.parse(readFileSync(LIST, "utf8"));
}
log(`${prior.corners.length} warmed corners, base=${BASE}`);

const rows = [];
for (const c of prior.corners) {
  const url = `${BASE}/api/score?x=${encodeURIComponent(c.slug)}`;
  let s;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url);
    // The per-IP limiter applies to this script exactly as it applies to a
    // visitor. Waiting it out is the correct behaviour; bypassing it would make
    // this script a hole in the protection it is supposed to respect.
    if (r.status === 429) {
      log(`  rate limited on ${c.slug}, waiting 70s`);
      await sleep(70_000);
      continue;
    }
    s = await r.json();
    break;
  }
  if (!s || typeof s.index !== "number") {
    log(`  ${c.slug}: SCORE FAILED, keeping prior ${c.index} ${c.grade}`);
    rows.push(c);
    continue;
  }
  const moved = s.index !== c.index || s.grade !== c.grade;
  log(
    `  ${c.slug.padEnd(23)} ${String(c.index).padStart(3)} ${c.grade} -> ` +
      `${String(s.index).padStart(3)} ${s.grade}  ${String(s.points).padStart(6)} pts` +
      `${moved ? "" : "  (unchanged)"}`,
  );
  rows.push({ ...c, index: s.index, grade: s.grade, counts: s.counts, points: s.points });
  await sleep(400);
}

rows.sort((a, b) => b.index - a.index || (b.points || 0) - (a.points || 0));
writeFileSync(LIST, JSON.stringify({ built: new Date().toISOString(), corners: rows }, null, 2));
log(`wrote .hin-list.json with ${rows.length} corners`);

execFileSync(
  "npx",
  ["wrangler", "kv", "key", "put", "hin:list", "--binding", "STORE", "--remote", "--path", LIST],
  { cwd: ROOT, stdio: "pipe", timeout: 180_000 },
);
log("uploaded hin:list to KV");

const tally = {};
for (const r of rows) tally[r.grade] = (tally[r.grade] || 0) + 1;
log(`grade spread: ${JSON.stringify(tally)}`);
