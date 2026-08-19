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
import {
  getPress, putPress, bumpPressRollup, bumpPressRollupBulk, exaBudget,
  getBurnCheckpoint, putBurnCheckpoint,
} from "../src/store.js";

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
const BURN = Boolean(arg("burn"));
const CHUNK = num("chunk", 50);
// The press signal is finite. Three chunks in a row where almost nothing has
// coverage means the worst-first queue has walked past the corners anybody
// writes about, and the honest move is to stop and say where.
const DRY_CHUNKS = 3;
const DRY_RATE = 0.05;
const ERROR_RUN = 10;

// A run of failures is a stop condition, but naming the wrong subsystem in the
// stop message sends the next person to debug the wrong provider. The first
// burn stopped saying "exa failed on 10 calls in a row" when every one of the
// ten was a Cloudflare API failure reading the budget meter. The counter is
// blind to which layer broke, so the message quotes what actually failed.
const failureKind = (msg) => {
  const m = String(msg || "");
  if (/kv (read|write) failed|wrangler kv|api\.cloudflare\.com/i.test(m)) return "cloudflare kv";
  if (/exa \d|exa 402|api\.exa\.ai/i.test(m)) return "exa";
  if (/fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(m)) return "network";
  return "unknown";
};

const env = kvEnv(ROOT, { EXA_API_KEY: devVar(ROOT, "EXA_API_KEY") });

const before = await exaBudget(env);
log(`exa meter: $${before.spentUsd.toFixed(4)} of $${before.capUsd.toFixed(2)}, ${before.searches} searches`);
log(`workspace: ${before.accountVerified ? `${before.account}, confirmed ${before.verifiedAt?.slice(0, 10)}` : "NOT CONFIRMED"}`);
if (before.exhausted) {
  log("budget reached, nothing to do");
  process.exit(0);
}
// The same refusal the Worker's nightly batch makes. A price identifies a plan
// tier and nothing more, so nothing spends in bulk until somebody has watched
// a specific workspace's dashboard move after a known call.
if (!before.accountVerified && !DRY) {
  log(`refusing to spend: ${before.reconciliation}`);
  log("verify with: node tools/exa_verify.mjs --workspace <name> --balance <usd>");
  process.exit(2);
}

// The queue is the citywide rank, worst first. Audited corners are excluded:
// their press lane already ran as part of the audit, and re-running it here
// would spend the balance re-reading what the site already knows.
const meta = await getCityMeta(env);

// Scans the rank from a page hint and returns the next `want` corners that are
// not audited and not already checked inside the freshness window. Returns the
// page it stopped on so the next chunk does not rescan from the top.
async function nextTargets(want, fromPage = 1) {
  const fresh = Date.now() - FRESH_DAYS * 24 * 3600 * 1000;
  const targets = [];
  let page = fromPage;
  let audited = 0;
  let scanned = 0;
  for (; targets.length < want && page <= 200; page += 1) {
    const rank = await getRankPage(env, page);
    if (!rank?.rows?.length) return { targets, page: null, audited, scanned };
    for (const row of tagTiers(rank.rows, meta)) {
      if (ONLY && row.slug !== ONLY) continue;
      scanned += 1;
      if (row.tier === TIERS.AUDITED) { audited += 1; continue; }
      const have = await getPress(env, row.slug, PRESS_VERSION).catch(() => null);
      if (have && Date.parse(have.fetchedAt || 0) >= fresh) continue;
      targets.push(row);
      if (targets.length >= want) break;
    }
  }
  return { targets, page, audited, scanned };
}

// One corner. Returns the stored record, or null when the corner failed, or
// the string "deferred" when the budget refused.
async function checkCorner(row) {
  // Fresh budget every time. A cached meter is a meter that reads low.
  env.uncache?.("budget:exa", "exa:spend");
  const corner = { slug: row.slug, name: row.name, city: "San Francisco", lat: row.lat, lon: row.lon };
  const rec = await enrichPress(env, corner);
  if (rec.source === "budget-deferred") return "deferred";
  await putPress(env, row.slug, rec);
  return rec;
}

const line = (rec, slug) => {
  const c = rec.cost;
  return `  ${slug}: ${rec.source}, ${rec.items?.length || 0} items, ` +
    `${c.searches} searches + ${c.contentPages} pages = ${c.cents.toFixed(2)}c measured, ` +
    `warm [${c.segmentsWarm.join(",") || "none"}], cold [${c.segmentsCold.join(",") || "none"}]`;
};

// ---------------------------------------------------------------- burn mode

if (BURN) {
  const started = new Date().toISOString();
  const prior = await getBurnCheckpoint(env);
  if (prior && !prior.stopReason) log(`resuming a run that stopped without a reason at ${prior.updatedAt}`);
  let page = prior?.nextPage && !prior?.stopReason ? prior.nextPage : 1;

  const run = { done: 0, withCoverage: 0, empty: 0, failed: 0, spentUsd: 0, chunks: 0 };
  let dryChunks = 0;
  let errorRun = 0;
  const lastKinds = [];
  let stopReason = null;

  while (!stopReason) {
    const { targets, page: nextPage, audited } = await nextTargets(CHUNK, page);
    if (!targets.length) { stopReason = "queue exhausted, every corner in the rank is checked or audited"; break; }
    page = nextPage || page;
    run.chunks += 1;
    log("");
    log(`chunk ${run.chunks}: ${targets.length} corners, rank page ${page}, ${audited} audited skipped so far`);

    const written = [];
    let chunkCovered = 0;
    for (const row of targets) {
      let rec;
      try {
        rec = await checkCorner(row);
      } catch (e) {
        run.failed += 1;
        errorRun += 1;
        const kind = failureKind(e.message || e);
        lastKinds.push(kind);
        if (lastKinds.length > ERROR_RUN) lastKinds.shift();
        log(`  ${row.slug}: FAILED [${kind}] ${String(e.message || e).slice(0, 80)} (${errorRun} in a row)`);
        if (errorRun >= ERROR_RUN) {
          const tally = lastKinds.reduce((a, k) => ({ ...a, [k]: (a[k] || 0) + 1 }), {});
          const named = Object.entries(tally).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${v} ${k}`).join(", ");
          stopReason = `${ERROR_RUN} failures in a row (${named})`;
          break;
        }
        continue;
      }
      if (rec === "deferred") { stopReason = "budget cap reached"; break; }
      errorRun = 0;
      written.push(rec);
      run.done += 1;
      run.spentUsd = Math.round((run.spentUsd + rec.cost.usd) * 1e6) / 1e6;
      if (rec.source === "live") { run.withCoverage += 1; chunkCovered += 1; } else run.empty += 1;
      log(line(rec, row.slug));
    }

    // One roll-up write for the chunk, and one checkpoint, so a kill costs at
    // most the corner in flight. The stored press records are what actually
    // make the resume exact; this only saves the rescan.
    if (written.length) await bumpPressRollupBulk(env, written).catch(() => {});
    env.uncache?.("budget:exa", "exa:spend");
    const b = await exaBudget(env);
    await putBurnCheckpoint(env, {
      startedAt: prior?.startedAt || started, nextPage: page, lastSlug: targets[targets.length - 1]?.slug,
      done: (prior?.done || 0) + run.done, withCoverage: (prior?.withCoverage || 0) + run.withCoverage,
      empty: (prior?.empty || 0) + run.empty, spentUsd: Math.round(((prior?.spentUsd || 0) + run.spentUsd) * 1e6) / 1e6,
      chunks: (prior?.chunks || 0) + run.chunks, stopReason,
    }).catch(() => {});

    const rate = targets.length ? chunkCovered / targets.length : 0;
    log(`  chunk ${run.chunks} done: ${run.done} corners this run, ` +
      `${run.done ? ((run.spentUsd / run.done) * 100).toFixed(2) : "0.00"}c per corner, ` +
      `hit rate ${(rate * 100).toFixed(1)}% this chunk, ${run.done ? ((run.withCoverage / run.done) * 100).toFixed(1) : "0.0"}% overall, ` +
      `attributed $${(b.attributedUsd ?? 0).toFixed(4)}, ${(b.remainingCents / 100).toFixed(2)} dollars left of the cap`);

    if (stopReason) break;
    if (b.exhausted) { stopReason = "budget cap reached"; break; }
    if (rate < DRY_RATE) {
      dryChunks += 1;
      log(`  hit rate under ${DRY_RATE * 100}% for ${dryChunks} chunk${dryChunks === 1 ? "" : "s"} in a row`);
      if (dryChunks >= DRY_CHUNKS) {
        stopReason = `press signal exhausted: ${DRY_CHUNKS} chunks in a row under ${DRY_RATE * 100}% hit rate, stopped at rank page ${page}, last corner ${targets[targets.length - 1]?.slug}`;
      }
    } else dryChunks = 0;
  }

  env.uncache?.("budget:exa", "exa:spend");
  const b = await exaBudget(env);
  await putBurnCheckpoint(env, {
    startedAt: prior?.startedAt || started, nextPage: page,
    done: (prior?.done || 0) + run.done, withCoverage: (prior?.withCoverage || 0) + run.withCoverage,
    empty: (prior?.empty || 0) + run.empty, spentUsd: Math.round(((prior?.spentUsd || 0) + run.spentUsd) * 1e6) / 1e6,
    chunks: (prior?.chunks || 0) + run.chunks, stopReason,
  }).catch(() => {});

  log("");
  log(`STOPPED: ${stopReason}`);
  log(`corners checked ${run.done} over ${run.chunks} chunks, ${run.withCoverage} with coverage, ${run.empty} searched and empty, ${run.failed} failed`);
  log(`hit rate ${run.done ? ((run.withCoverage / run.done) * 100).toFixed(1) : "0.0"}%`);
  log(`measured this run $${run.spentUsd.toFixed(4)}${run.done ? `, ${((run.spentUsd / run.done) * 100).toFixed(2)}c per corner` : ""}`);
  log(`meter: $${b.spentUsd.toFixed(4)} of $${b.capUsd.toFixed(2)}, attributed to ${b.account} $${(b.attributedUsd ?? 0).toFixed(4)}`);
  process.exit(0);
}

// ---------------------------------------------------------------- single run

const { targets, audited } = await nextTargets(LIMIT, 1);
log(`queue: ${targets.length} to check, ${audited} audited skipped, skipping anything checked inside ${FRESH_DAYS} days`);

if (DRY) {
  for (const t of targets) log(`  would check ${t.slug} (${t.name}, grade ${t.grade})`);
  process.exit(0);
}

let checked = 0, withCoverage = 0, empty = 0, deferred = 0, spentUsd = 0;
for (const row of targets) {
  let rec;
  try {
    rec = await checkCorner(row);
  } catch (e) {
    log(`  ${row.slug}: FAILED ${String(e.message || e).slice(0, 90)}`);
    continue;
  }
  if (rec === "deferred") {
    deferred += 1;
    log(`  ${row.slug}: budget deferred, stopping the run`);
    break;
  }
  await bumpPressRollup(env, rec).catch(() => {});
  checked += 1;
  spentUsd += rec.cost.usd;
  if (rec.source === "live") withCoverage += 1; else empty += 1;
  log(line(rec, row.slug));
  if (rec.cost.cents > CENT_CEILING) {
    log(`  STOP: ${rec.cost.cents.toFixed(2)}c is over the ${CENT_CEILING}c per corner ceiling`);
    break;
  }
}

env.uncache?.("budget:exa", "exa:spend");
const after = await exaBudget(env);
log("");
log(`checked ${checked}, coverage found ${withCoverage}, searched and empty ${empty}, deferred ${deferred}`);
log(`measured this run: $${spentUsd.toFixed(4)}${checked ? `, ${((spentUsd / checked) * 100).toFixed(2)}c per corner` : ""}`);
log(`exa meter after: $${after.spentUsd.toFixed(4)} of $${after.capUsd.toFixed(2)}, ${after.searches} searches, ${after.contentPages} pages`);
log(`attributed to ${after.account}: $${(after.attributedUsd ?? 0).toFixed(4)}`);
