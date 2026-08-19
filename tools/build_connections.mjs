#!/usr/bin/env node
// Press connections across the audited fleet.
//
//   node tools/build_connections.mjs [--dry] [--limit N]
//
// For every audited corner that has a best article, ask Exa what else is being
// written in the same breath, pull every crossing named in that related
// coverage, and put each one through the same verification the watchlist uses.
// Where a crossing survives, both corners get the link: the one that ran the
// search and the one it found.
//
// One findSimilar call per corner. The cron does this for the corner it audits
// each morning; this pass does the standing fleet in one go.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { kvEnv, devVar } from "./lib/kvenv.mjs";
import { buildConnections, reciprocal } from "../src/press.js";
import { cityCornerFor } from "../src/city.js";
import { putConnections, getConnections, exaBudget } from "../src/store.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");
const LIMIT = parseInt(process.argv[process.argv.indexOf("--limit") + 1], 10) || 0;
const SITE = "https://streetcred.thealexschroeder.workers.dev";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const env = kvEnv(ROOT, { EXA_API_KEY: devVar(ROOT, "EXA_API_KEY") });

// The board carries each audited corner's real name and live grade, so the
// record written to the far end of a connection names a corner rather than a
// slug.
const board = await fetch(`${SITE}/api/board`).then((r) => r.json()).catch(() => ({ corners: [] }));
const bySlug = new Map((board.corners || []).map((c) => [c.slug, c]));

const meta = await env.STORE.get("city:meta", "json");
let audited = meta?.audited || [];
if (LIMIT) audited = audited.slice(0, LIMIT);
log(`${audited.length} audited corners to connect`);

const before = await exaBudget(env);
log(`exa budget: ${before.searches} searches, $${before.spentUsd} of $${before.capUsd} this period`);

let linked = 0;
let empty = 0;
let skipped = 0;

for (const slug of audited) {
  // The seed is this corner's own best story, taken from the live press lane
  // rather than re-searched, so the connection starts from exactly what the
  // corner's page shows a reader.
  const news = await fetch(`${SITE}/api/news?x=${slug}`).then((r) => r.json()).catch(() => null);
  const seed = (news?.items || []).find((x) => !x.official) || null;
  if (!seed) {
    skipped++;
    log(`  --   ${slug}: no press seed`);
    continue;
  }

  // The board carries the live grade, but not every audited corner is on it:
  // three have generated imagery and never made the leaderboard. The city
  // index knows every corner's name, so it is the fallback rather than the
  // slug, which is what a reader would otherwise see on the far end of a
  // connection.
  const row = bySlug.get(slug);
  const fromCity = row ? null : await cityCornerFor(env, slug);
  const name = row?.name || fromCity?.name || slug;
  const corner = { slug, name, short: name };
  const conn = await buildConnections(env, corner, seed).catch((e) => ({
    source: "error",
    reason: String(e.message || e).slice(0, 90),
  }));

  if (conn.source === "unavailable" || conn.source === "error") {
    log(`  !!   ${slug}: ${conn.reason}`);
    continue;
  }
  if (conn.source !== "live") {
    empty++;
    log(`  --   ${slug}: ${conn.reason || "no connection"} (${conn.results} related results)`);
    // Recorded, not skipped. "We asked and found nothing" and "nobody has
    // asked" are different states, and only one of them should look like
    // silence. Never overwrites a corner that has real links.
    if (!DRY) {
      const existing = await getConnections(env, slug);
      if (!existing || !existing.links?.length) await putConnections(env, slug, { ...conn, slug, name });
    }
    continue;
  }

  linked++;
  log(`  LINK ${slug} -> ${conn.links.map((l) => `${l.name} (${l.grade} ${l.index})`).join(", ")}`);
  for (const l of conn.links) log(`         via ${l.article.domain} ${l.article.date}: ${l.article.title.slice(0, 70)}`);

  if (DRY) continue;
  await putConnections(env, slug, conn);
  const self = {
    slug,
    name,
    grade: row?.grade ?? fromCity?.sweep?.grade ?? null,
    index: row?.index ?? fromCity?.sweep?.index ?? null,
  };
  for (const l of conn.links) {
    const existing = await getConnections(env, l.slug);
    // A corner that ran its own search owns its page's version; only a
    // reciprocal record is ever overwritten by another reciprocal.
    if (existing && !existing.reciprocal) continue;
    await putConnections(env, l.slug, reciprocal(self, l));
  }
}

const after = await exaBudget(env);
log(`${linked} corners connected, ${empty} found nothing, ${skipped} had no seed`);
log(`exa budget after: ${after.searches} searches, $${after.spentUsd} of $${after.capUsd} this period`);
if (DRY) log("dry run, nothing written");
