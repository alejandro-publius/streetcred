// Press enrichment, worst corners first.
//
//   node tools/press_batch.mjs --limit 1 --dry        plan only, spends nothing
//   node tools/press_batch.mjs --limit 1              the phase 2 gate, one corner
//   node tools/press_batch.mjs --limit 100            a batch night
//   node tools/press_batch.mjs --only 19th-and-mission
//
// Resumable by construction. The skip rule is the stored record itself: a
// corner whose press was checked inside the freshness window is skipped on the
// next run, so a batch killed halfway through resumes where it stopped without
// a cursor file to go stale. The budget is re-read before every corner because
// the Worker spends the same balance.
import { kvEnv, devVar } from "./lib/kvenv.mjs";
import { getRankPage, getCityMeta, tagTiers, TIERS } from "../src/city.js";
import { enrichPress, PRESS_VERSION } from "../src/pressenrich.js";
import { getPress, putPress, bumpPressRollup, exaBudget } from "../src/store.js";

const ROOT = new URL("..", import.meta.url).pathname;
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : process.argv.includes(`--${name}`) ? true : fallback;
};
const log = (s) => console.log(s);

const LIMIT = parseInt(arg("limit", "1"), 10) || 1;
const ONLY = typeof arg("only") === "string" ? arg("only") : null;
const DRY = Boolean(arg("dry"));
// Zero is a meaningful value for both of these, so a falsy fallback would
// silently ignore --fresh-days 0, which is how a forced re-check turns into a
// run that does nothing and reports success.
const num = (name, dflt) => {
  const v = Number(arg(name, String(dflt)));
  return Number.isFinite(v) ? v : dflt;
};
const FRESH_DAYS = num("fresh-days", 30);
const CENT_CEILING = num("max-cents", 5);

const env = kvEnv(ROOT, { EXA_API_KEY: devVar(ROOT, "EXA_API_KEY") });

const before = await exaBudget(env);
log(`exa meter: $${before.spentUsd.toFixed(4)} of $${before.capUsd.toFixed(2)}, ${before.searches} searches, ${before.account} account`);
if (before.exhausted) {
  log("budget reached, nothing to do");
  process.exit(0);
}

// The queue is the citywide rank, worst first. Audited corners are excluded:
// their press lane already ran as part of the audit, and re-running it here
// would spend the balance re-reading what the site already knows.
const meta = await getCityMeta(env);
const queue = [];
let audited = 0;
for (let page = 1; queue.length < LIMIT * 6 && page <= 80; page += 1) {
  const p = await getRankPage(env, page);
  if (!p?.rows?.length) break;
  for (const row of tagTiers(p.rows, meta)) {
    if (row.tier === TIERS.AUDITED) { audited += 1; continue; }
    queue.push(row);
  }
}
log(`queue: ${queue.length} enriched or scored corners from the worst-first rank, ${audited} audited skipped`);

const fresh = Date.now() - FRESH_DAYS * 24 * 3600 * 1000;
const targets = [];
for (const row of queue) {
  if (ONLY && row.slug !== ONLY) continue;
  const have = await getPress(env, row.slug, PRESS_VERSION).catch(() => null);
  if (have && Date.parse(have.fetchedAt || 0) >= fresh) continue;
  targets.push(row);
  if (targets.length >= LIMIT) break;
}
log(`${targets.length} to check, skipping anything checked inside ${FRESH_DAYS} days`);

if (DRY) {
  for (const t of targets) log(`  would check ${t.slug} (${t.name}, grade ${t.grade})`);
  process.exit(0);
}

let checked = 0, withCoverage = 0, empty = 0, deferred = 0, spentUsd = 0;
for (const row of targets) {
  // Fresh budget every time. A cached meter is a meter that reads low.
  env.uncache?.("budget:exa", "exa:spend");
  const corner = { slug: row.slug, name: row.name, city: "San Francisco", lat: row.lat, lon: row.lon };
  let rec;
  try {
    rec = await enrichPress(env, corner, {});
  } catch (e) {
    log(`  ${row.slug}: FAILED ${String(e.message || e).slice(0, 90)}`);
    continue;
  }
  if (rec.source === "budget-deferred") {
    deferred += 1;
    log(`  ${row.slug}: budget deferred, stopping the run`);
    await bumpPressRollup(env, rec).catch(() => {});
    break;
  }
  await putPress(env, row.slug, rec);
  await bumpPressRollup(env, rec).catch(() => {});
  checked += 1;
  spentUsd += rec.cost.usd;
  if (rec.source === "live") withCoverage += 1; else empty += 1;
  const c = rec.cost;
  log(
    `  ${row.slug}: ${rec.source}, ${rec.items?.length || 0} items, ` +
    `${c.searches} searches + ${c.contentPages} pages = ${c.cents.toFixed(2)}c measured ` +
    `(${c.estimatedCents.toFixed(2)}c estimated), warm [${c.segmentsWarm.join(",") || "none"}], ` +
    `cold [${c.segmentsCold.join(",") || "none"}], sweep ${c.sweepCandidates}`,
  );
  if (c.cents > CENT_CEILING) {
    log(`  STOP: ${c.cents.toFixed(2)}c is over the ${CENT_CEILING}c per corner ceiling`);
    break;
  }
}

env.uncache?.("budget:exa", "exa:spend");
const after = await exaBudget(env);
log("");
log(`checked ${checked}, coverage found ${withCoverage}, searched and empty ${empty}, deferred ${deferred}`);
log(`measured this run: $${spentUsd.toFixed(4)}${checked ? `, ${((spentUsd / checked) * 100).toFixed(2)}c per corner` : ""}`);
log(`exa meter after: $${after.spentUsd.toFixed(4)} of $${after.capUsd.toFixed(2)}, ${after.searches} searches, ${after.contentPages} pages`);
log(`all time on this account: $${after.allTimeUsd.toFixed(4)}`);
