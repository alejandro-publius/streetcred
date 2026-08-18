#!/usr/bin/env node
// Backfills real Apify counts for corners that have a committed scrape.
//
//   node tools/backfill_apify.js
//
// It does NOT re-scrape. Re-running an actor to count what a previous run
// already collected would spend money to learn something already sitting on
// Apify's disk, and it would produce different numbers than the quotes actually
// shown on the page, which is worse than useless in a manifest whose whole
// point is that its numbers are real.
//
// The IDs committed in public/data/voices-*.json are RUN ids, not dataset ids,
// which is a trap worth naming: /v2/datasets/{runId} answers 404 "Dataset was
// not found" and reads exactly like an expired dataset. Each run is resolved to
// its defaultDatasetId first.
//
// A Google Places item is a PLACE, not a review: the reviews ride inside it as
// an array. Counting items would report 2 accounts read where the run actually
// collected 65. Reddit items are individual comments and count one for one.
//
// If a dataset really has expired, the corner records countsUnavailable:true and
// the manifest and the replay both say so rather than guessing.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "public", "data");
const TMP = join(ROOT, ".apify-counts.json");

const TOKEN = (() => {
  for (const line of readFileSync(join(ROOT, ".dev.vars"), "utf8").split("\n")) {
    const m = line.match(/^APIFY_TOKEN\s*=\s*"?([^"\s]+)"?/);
    if (m) return m[1];
  }
  throw new Error("APIFY_TOKEN not found in .dev.vars");
})();

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// The same split the Cred Check uses, copied deliberately rather than imported:
// src/cred.js runs in the Worker and these counts must describe the same rule
// the page applies. If the two ever drift, the funnel line stops describing the
// panel underneath it. Keep them in step.
const STREET_STRONG = [
  "crossing", "cross", "crosswalk", "driver", "drivers", "traffic", "cars",
  "speeding", "signal", "curb", "sidewalk", "intersection", "pedestrian",
];
const STREET_WEAK = ["dangerous", "scary", "dark"];
const has = (hay, list) => list.some((t) => hay.includes(t));
const isStreetQuote = (text) => {
  const t = String(text || "").toLowerCase();
  if (has(t, STREET_STRONG)) return true;
  return has(t, STREET_WEAK) && has(t, STREET_STRONG);
};

const THEMES = {
  scary: ["scary", "sketchy", "unsafe", "afraid", "dangerous"],
  speeding: ["speeding", "speed", "fast", "racing", "blow through", "run the light"],
  dark: ["dark", "lighting", "unlit", "streetlight"],
  crossing: ["crossing", "crosswalk", "cross the street", "pedestrian", "walk signal"],
};

async function api(path) {
  const r = await fetch(`https://api.apify.com/v2/${path}${path.includes("?") ? "&" : "?"}token=${TOKEN}`);
  if (!r.ok) {
    const e = new Error(`apify ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// A Google Places record carries its reviews inline; a Reddit record is one
// comment. Anything else is counted as one account and its text hunted for.
//
// `bound` is whether the account is tied to this corner by where it came from
// rather than by what it says. A Google Maps review is a review of a business
// standing inside the corner's own 350m circle, so it is about this corner by
// construction. A Reddit comment came from an open web search and could be
// about anywhere, so it has to name the streets to count.
function accountsFrom(items) {
  const out = [];
  for (const it of items) {
    if (Array.isArray(it.reviews)) {
      for (const r of it.reviews) {
        out.push({ text: r.text || r.textTranslated || "", where: it.title || "google maps", bound: true });
      }
      continue;
    }
    out.push({ text: it.body || it.text || it.title || "", where: it.communityName || "reddit", bound: false });
  }
  return out;
}

const files = readdirSync(DATA).filter((f) => f.startsWith("voices-") && f.endsWith(".json"));
log(`${files.length} committed scrape file(s)`);

for (const file of files) {
  const slug = file.replace(/^voices-/, "").replace(/\.json$/, "");
  const doc = JSON.parse(readFileSync(join(DATA, file), "utf8"));
  const runIds = Object.entries(doc.sources || {});
  log(`corner: ${slug}, ${runIds.length} run(s) recorded`);

  const datasets = [];
  const accounts = [];
  let unavailable = false;
  let reason = "";

  for (const [lane, runId] of runIds) {
    let dsId;
    try {
      dsId = (await api(`actor-runs/${runId}`)).data.defaultDatasetId;
    } catch (e) {
      log(`  ${lane}: run ${runId} not retrievable (${e.status || e.message})`);
      unavailable = true;
      reason = `the Apify run ${runId} is no longer retrievable`;
      continue;
    }
    let meta, items;
    try {
      meta = (await api(`datasets/${dsId}`)).data;
      items = await api(`datasets/${dsId}/items?clean=1`);
    } catch (e) {
      log(`  ${lane}: dataset ${dsId} expired or unreadable (${e.status || e.message})`);
      unavailable = true;
      reason = `the Apify dataset ${dsId} has expired`;
      continue;
    }
    const got = accountsFrom(items);
    accounts.push(...got);
    datasets.push({ lane, runId, datasetId: dsId, records: meta.itemCount, accounts: got.length });
    log(`  ${lane}: dataset ${dsId}, ${meta.itemCount} records, ${got.length} accounts`);
  }

  if (!datasets.length) {
    log(`  nothing readable, recording countsUnavailable`);
    writeFileSync(TMP, JSON.stringify({ countsUnavailable: true, reason: reason || "no readable Apify data" }));
    execFileSync("npx", ["wrangler", "kv", "key", "put", `apify:${slug}`,
      "--binding", "STORE", "--remote", "--path", TMP],
      { cwd: ROOT, stdio: "pipe", timeout: 180_000 });
    continue;
  }

  // Corner tokens from the slug: "16th-mission" gives ["16th", "mission"].
  const tokens = slug.split("-").filter((t) => t && t !== "and");
  const namesCorner = (t) => {
    const s = String(t || "").toLowerCase();
    return tokens.every((tok) => s.includes(tok));
  };
  // Counting "mentions the street" as "contains street words" was the first
  // version of this, and it was quietly wrong: the Reddit search returns
  // comments from r/SantaBarbara, r/astoria and r/BikeLA that use the word
  // crosswalk, so it reported 22 accounts about a corner that had 2. An account
  // counts here only if it is tied to this corner by where it came from or by
  // naming both of its streets.
  const aboutCorner = accounts.filter((a) => a.bound || namesCorner(a.text));
  const streetRelevant = aboutCorner.filter((a) => isStreetQuote(a.text)).length;
  const themes = {};
  for (const [name, toks] of Object.entries(THEMES)) {
    themes[name] = aboutCorner.filter((a) => has(String(a.text).toLowerCase(), toks)).length;
  }

  const record = {
    itemsRead: accounts.length,
    aboutCorner: aboutCorner.length,
    streetRelevant,
    kept: (doc.items || []).length,
    themes,
    datasets,
    collected: doc.collected || null,
    // Recorded even when everything else worked, so a partial read is never
    // silently presented as a complete one.
    ...(unavailable ? { partial: true, reason } : {}),
  };
  log(`  totals: ${record.itemsRead} read, ${aboutCorner.length} about this corner, ${streetRelevant} describe the street, ${record.kept} shown`);
  log(`  themes: ${JSON.stringify(themes)}`);

  writeFileSync(TMP, JSON.stringify(record));
  execFileSync("npx", ["wrangler", "kv", "key", "put", `apify:${slug}`,
    "--binding", "STORE", "--remote", "--path", TMP],
    { cwd: ROOT, stdio: "pipe", timeout: 180_000 });
  log(`  uploaded apify:${slug}`);
}
