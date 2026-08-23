import {
  CORNERS, DEFAULT_SLUG, SAMPLE, supervisorFor, canonicalSlug, makeCorner, SERVICE_NAMES,
  resolvedDistrict, addresseeFor,
  pacificToday as pacificTodayShared,
  // The dated formatter, not the zero-argument one aliased below. `pacificDay`
  // in this file means TODAY; passing it a timestamp silently ignores the
  // argument and dates every row as now, which is the exact failure the alias
  // comment warns about.
  pacificDay as pacificDayOf,
  COTD_SEED,
} from "./data.js";
import { PAGE, NOT_FOUND } from "./page.js";
import { HOME, staticMapPath, fitView } from "./home.js";
import { parseQuery, locate, districtFor, soql, soqlUrl } from "./resolve.js";
import {
  getCorner, putCorner, getImage, rateLimit, getScore, putScore, getHazards, putHazards,
  getCredCached, putCredCached, getShareCard, getHinList, getRun, putRun, getApifyCounts, getLetterRun, putLetterRun,
  getTimeline, putTimeline, reserveTimeline, timelineBudget,
  getQueue, putQueue, getCotdLog, appendCotdLog, putHinList, getImageryStatus,
  getSuggestion, putSuggestion,
  getJournal, appendJournal, putAgentRescore, putAgentLetter, putAgentFlag,
  countAgentReject, getAgentRejects,
  getVerifiedLetter, putVerifiedLetter, appendTrustIncident, getTrustIncidents,
  getScoreRaw, appendChange, getChanges,
  getWatchlist, putWatchlist, getWatchlistRun, putWatchlistRun, getConnections, putConnections,
  getLetterBackoff, setLetterBackoff,
  getVoicesStored, exaBudget, actorRunBudget, getActorCosts, getVoicesSummary,
  recordExaSpend, recordExaProbe, getExaProbe,
  getPress, putPress, getPressRollup, bumpPressRollup, bumpPressRollupBulk, openExaMeter,
  getBurnCheckpoint, putBurnCheckpoint,
  radarBudget, countRadarDetection, getMonitors, putMonitors, getRadarFeed, pushRadarFeed, putRadarUnknown,
  recountPressCitations, getPressCitations, CITATION_CACHE_S,
  recountAuditTiers, getAuditTiers, AUDIT_TIER_CACHE_S,
} from "./store.js";
import {
  judge, resultsFrom, monitorIdFrom, RADAR_VERSION,
  worstCorridors, corridorQuery, META_QUERIES, CORRIDOR_LIMIT,
} from "./radar.js";
import { RADAR_PAGE } from "./radarpage.js";
import { enrichPress, PRESS_VERSION } from "./pressenrich.js";
import { computeScore, SCORE_VERSION } from "./score.js";
import {
  cityCornerFor, getCityMeta, getRankPage, cityStats, cityScore, cityCred,
  coverageDiscs, coverageRadiusM,
  cityNews, cityVoices, cityTimeline, cityRun, cityHazards, cityLetter,
  TIERS, tierOf, RANK_PAGE_SIZE, tagTiers, putCityMeta,
} from "./city.js";
import { evidenceLine } from "./page.js";
import { imageryFor, provenanceOf, PROMOTED_FROM_ENRICHED } from "./imagery.js";
import { corroborate, HAZARD_VERSION } from "./hazards.js";
import { credCheck, isSafetyCoverage, CRED_VERSION } from "./cred.js";
import { buildManifest, PUBLIC_TRIGGERS } from "./manifest.js";
import { classify, streetTokens, domainOf, searchQuery } from "./newsfilter.js";
import { buildTimeline, TIMELINE_VERSION } from "./timeline.js";
import { buildSuggestion, SUGGEST_VERSION } from "./suggest.js";
import { buildInputSet, verifyLetter, retryInstruction, VERIFY_VERSION } from "./verify.js";
import { buildLetterPrompt } from "./letterprompt.js";
import { handleAgentReport, journalStats, JOURNAL_CAP } from "./agent.js";
import { WATCHDOG } from "./watchdog.js";
import { projectImpact } from "./impact.js";
import { METHODOLOGY } from "./methodology.js";
import { WATCHLIST_PAGE } from "./watchlistpage.js";
import { AUDITED_PAGE } from "./auditedpage.js";
import { buildWatchlist, buildConnections, reciprocal, WATCHLIST_VERSION, runCounts } from "./press.js";
import { commissionVoices, ingestVoices } from "./voices.js";
import { CHANGES } from "./changes.js";
import { STATUS } from "./status.js";

// DataSF open datasets, keyless.
const DS_CRASHES = "ubvf-ztfx";
const DS_311 = "vw6y-z8j6";
const GEMINI_TEXT_MODEL = "gemini-3.7-flash";
// Bump to invalidate every edge-cached payload. Corrected figures must not be
// served from a cache holding the old ones. The edge cache is per-colo, so
// without this a correction lands unevenly across data centers and some
// visitors keep reading the old numbers for the life of the TTL.
const CACHE_VERSION = "v11";

// The letter embeds live figures, press headlines, and the Danger Index, so it
// goes stale in more ways than any other lane and it is the one artifact a
// person might actually send to an official. It carries its own version on top
// of CACHE_VERSION: bump this whenever the prompt, the facts fed into it, or the
// score semantics change, even if nothing else does.
const LETTER_VERSION = "v6";

// The quota backoff, remembered in the isolate as well as in KV.
//
// KV is eventually consistent, so the flag a request writes is not visible to
// the next request for up to a minute. Without this, every time the hour long
// flag expires there is a window where several requests each pay a full model
// round trip to rediscover the same refusal. The isolate remembers instantly;
// KV is what carries the fact to the other colos.
let quotaBackoffUntil = 0;

// Small in-process cache. The Worker isolate holds this between requests, which
// is all the caching this product needs: every slow artifact (imagery, scraped
// voices) is already baked into static assets at build time.
const memo = new Map();
async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.value, source: "cache" };
  const value = await fn();
  if (value && value.source === "live") memo.set(key, { at: Date.now(), value });
  return value;
}

// Second cache layer, in front of the in-process one. A Worker isolate is
// short-lived and per-colo, so `memo` alone cannot make a corner switch feel
// instant: the next request usually lands on a cold isolate and pays the full
// upstream cost again. The edge cache survives that. Sample and empty payloads
// are never stored, so a lane that failed once is retried rather than pinned.
async function edgeCached(ctx, key, ttlSec, produce) {
  const cache = caches.default;
  const req = new Request(`https://streetcred.internal/api/${CACHE_VERSION}/${key}`);
  // The cached copy carries max-age so the edge will hold it. What goes back to
  // the client is always no-store: a public max-age on the real URL lets the CDN
  // and the browser pin a payload for an hour, which means a data correction
  // ships but does not show up. Fast internally, never stale externally.
  const fresh = (body) =>
    new Response(body, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });

  const hit = await cache.match(req);
  if (hit) return fresh(await hit.text());

  const value = await produce();
  const body = JSON.stringify(value);
  // A degraded payload is never pinned. Sample and empty were already
  // excluded; verified-cache joins them because it is what the letter lane
  // serves while the model is unavailable, and caching it for a day would
  // outlast the hour-long backoff that produced it.
  if (value && !["sample", "empty", "verified-cache"].includes(value.source)) {
    const stored = new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${ttlSec}`,
      },
    });
    ctx.waitUntil(cache.put(req, stored));
  }
  return fresh(body);
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// A corner is either one of the two precomputed entries or one resolved from
// typed input and parked in KV. Both come back in the same shape, so every lane
// downstream is unaware of the difference.
// /c/{slug} is the shareable form. ?x= stays working forever, because links
// already exist in the wild and a dead link is a lost vote.
function slugFromUrl(url) {
  const m = url.pathname.match(/^\/c\/([A-Za-z0-9-]+)\/?$/);
  return m ? m[1] : url.searchParams.get("x") || DEFAULT_SLUG;
}

// What the caller actually asked for, or null when they asked for nothing. The
// difference matters: no slug at all is a legitimate request for the default
// corner, while a slug that resolves to nothing is a wrong answer waiting to be
// served. /api/letter?x=zzz-not-a-corner used to return 16th and Mission's
// letter, which is the same class of bug cornerBySlug already guards on the
// agent path.
function requestedSlug(url) {
  const m = url.pathname.match(/^\/c\/([A-Za-z0-9-]+)\/?$/);
  if (m) return m[1];
  return url.searchParams.get("x") || null;
}

async function corner(url, env) {
  const slug = canonicalSlug(slugFromUrl(url));
  if (CORNERS[slug]) return CORNERS[slug];
  const stored = await getCorner(env, slug);
  if (stored) return stored;
  // The city shards, read only after the stored record has missed. Order is
  // the whole correctness argument: a corner that has been audited must serve
  // its live numbers, and a shard row that shadowed the stored record would
  // quietly roll a warmed corner back to the sweep date.
  const graded = await cityCornerFor(env, slug);
  return graded || CORNERS[DEFAULT_SLUG];
}

// A corner whose numbers come from the citywide sweep rather than from a live
// query. Every lane checks this before reaching for the network.
const isScored = (c) => c?.tier === TIERS.SCORED;

// Strict lookup, null when the corner is unknown. The forgiving version above
// falls back to the default corner, which is right for a browser following a
// dead link and catastrophic for the agent ingest: a letter posted for a slug
// this instance has never resolved would otherwise be verified against 16th and
// Mission's collision record and stored as truthful.
async function cornerBySlug(env, raw) {
  const slug = canonicalSlug(String(raw || ""));
  if (!slug) return null;
  if (CORNERS[slug]) return CORNERS[slug];
  return (await getCorner(env, slug)) || null;
}

// Static assets must be read through the ASSETS binding. A Worker fetching its
// own origin is a self-subrequest, which Cloudflare rejects with error 1042 in
// production even though it works under `wrangler dev`.
function asset(env, origin, path) {
  return env.ASSETS.fetch(new Request(new URL(path, origin)));
}

// ---------------------------------------------------------------- stats

// Exported so tools/generate_letters.mjs computes the letter's figures with
// exactly this function rather than a second copy of the queries. Two stat
// builders that drift apart would put one set of numbers in the letter and
// another on the page beside it.
export async function getStats(c) {
  const circle = `within_circle(point, ${c.lat}, ${c.lon}, ${c.radiusMeters})`;
  const since = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);
  // The collision dataset reaches back to 2005. Unbounded, the count describes
  // two decades of a corner that has since been rebuilt. Five years.
  const crashSince = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);
  const crashWhere = `${circle} AND collision_datetime > '${crashSince}'`;
  const services = SERVICE_NAMES.map((s) => `'${s}'`).join(",");
  // The exact queries, kept as objects so the receipt URLs below are built
  // from the same values the fetches use. Provenance that paraphrases is not
  // provenance.
  const qCrashes = { "$select": "count(*)", "$where": crashWhere };
  const qFatal = { "$select": "sum(number_killed)", "$where": crashWhere };
  const qReports = {
    "$select": "count(*)",
    "$where": `${circle} AND requested_datetime > '${since}' AND service_name in(${services})`,
  };
  const qDistrict = {
    "$select": "supervisor_district,count(*)",
    "$where": circle,
    "$group": "supervisor_district",
  };
  const [crashes, fatal, reports, dist] = await Promise.all([
    soql(DS_CRASHES, qCrashes),
    soql(DS_CRASHES, qFatal).catch(() => []),
    soql(DS_311, qReports),
    // Grouped, not $limit 1. A major street is often a district boundary: within
    // 150m of 6th and Market, DataSF holds 242 rows in District 6 and 114 in
    // District 5, so a single arbitrary row picks the wrong Supervisor. The
    // corner's configured district wins; this is corroboration and a fallback.
    soql(DS_CRASHES, qDistrict).catch(() => []),
  ]);
  // Landmine: crashes return "11" but 311 returns "9.00000". Always parseInt.
  const majority = (dist || [])
    .map((r) => ({ d: parseInt(r.supervisor_district, 10), n: parseInt(r.count, 10) || 0 }))
    .filter((r) => Number.isFinite(r.d))
    .sort((a, b) => b.n - a.n)[0]?.d;
  const resolved = parseInt(c.district ?? majority, 10);
  return {
    source: "live",
    // The radius and the window travel with the figures, because the tiles
    // that render them are also rendered from swept counts at a different
    // radius over a different window. A label baked into the page instead of
    // into the payload would eventually describe the other one.
    radiusM: c.radiusMeters,
    reports311Window: "3 years",
    crashes: parseInt(crashes?.[0]?.count ?? 0, 10),
    fatal: parseInt(fatal?.[0]?.sum_number_killed ?? 0, 10) || 0,
    reports311: parseInt(reports?.[0]?.count ?? 0, 10),
    // Null rather than a guess. A corner on a district line with no clear
    // majority is addressed citywide instead of to a Supervisor picked at random.
    district: Number.isFinite(resolved) && resolved > 0 ? resolved : null,
    // Receipts. Each URL is the exact query the figure above came from, built
    // by the same soqlUrl the fetch went through. One click re-runs the count.
    urls: {
      crashes: soqlUrl(DS_CRASHES, qCrashes),
      fatal: soqlUrl(DS_CRASHES, qFatal),
      reports311: soqlUrl(DS_311, qReports),
      district: soqlUrl(DS_CRASHES, qDistrict),
    },
  };
}

// ---------------------------------------------------------------- score
// Computed once per corner and parked in KV, so a grade holds still. The lane
// runs in parallel with the others, so it costs no extra wall clock on a load.
async function getScoreFor(c, env) {
  const hit = await getScore(env, c.slug, SCORE_VERSION);
  if (hit) return { ...hit, source: "cache" };
  // The versioned reader returns null both for "never scored" and "scored
  // under old rules". The raw read tells them apart, because replacing an old
  // grade is a public event and creating a first one is not.
  const prior = await getScoreRaw(env, c.slug);
  const fresh = await computeScore(c);
  await putScore(env, c.slug, fresh);
  if (prior && (prior.grade !== fresh.grade || prior.index !== fresh.index)) {
    await appendChange(env, {
      slug: c.slug,
      name: c.short || c.name,
      old: { grade: prior.grade, index: prior.index, version: prior.version },
      new: { grade: fresh.grade, index: fresh.index, version: fresh.version },
      reason: prior.version !== fresh.version
        ? `score model ${prior.version} replaced by ${fresh.version}`
        : "inputs changed in the city record",
      source: "pipeline",
      date: new Date().toISOString(),
    }).catch(() => {});
  }
  return fresh;
}

// ---------------------------------------------------------------- hazards

// The Today frame lives in two places depending on how the corner arrived:
// static assets for the precomputed pair, KV for anything typed. Both are
// bytes by the time this returns, so nothing downstream has to care.
async function todayFrame(c, env) {
  const bytes = await getImage(env, c.slug, "today");
  if (!bytes) throw new Error("no today frame stored");
  return bytes;
}

async function getHazardsFor(c, env, origin) {
  const hit = await getHazards(env, c.slug, HAZARD_VERSION);
  if (hit) return { ...hit, source: "cache" };
  // Records-only corners never get audited, so they must not claim an audit
  // result of any kind. Returning zero items rather than the record-derived
  // REPORTED rows is deliberate: every REPORTED line is phrased as "the audit
  // did not find it in the photograph", which would be a statement about an
  // audit that never ran. The letter reads this and says nothing about a
  // visual audit at all, which is the truth for these corners.
  if (c.derived === false) {
    return {
      source: "live",
      version: HAZARD_VERSION,
      audited: false,
      skipped: "this corner was warmed for its records only, so no visual audit was run",
      items: [],
      confirmed: 0,
      candidates: 0,
      reported: 0,
    };
  }
  const today = await todayFrame(c, env);
  const fresh = await corroborate(c, today, env);
  await putHazards(env, c.slug, fresh);
  return fresh;
}

// ---------------------------------------------------------------- timeline

// A dozen Exa searches per corner, so this is guarded the same way image
// generation is: reject before spending, from a global KV counter rather than
// the per-colo edge cache, and never rebuild something already on disk.
async function getTimelineFor(c, env) {
  const hit = await getTimeline(env, c.slug, TIMELINE_VERSION);
  if (hit) return { ...hit, source: "cache" };

  if (!(await reserveTimeline(env))) {
    const b = await timelineBudget(env);
    return {
      source: "unavailable",
      reason: "budget",
      note: `Daily press history limit reached (${b.used} of ${b.cap}). The press panel below is unaffected.`,
    };
  }

  try {
    const fresh = await buildTimeline(c, env);
    await putTimeline(env, c.slug, fresh);
    return fresh;
  } catch (e) {
    // The reservation is deliberately not refunded. A failed build still spent
    // most of a dozen searches, and a lane that retries for free on every page
    // load is exactly how a credit balance disappears overnight.
    return { source: "unavailable", reason: "failed", note: String(e.message || e).slice(0, 120) };
  }
}

// ---------------------------------------------------------------- suggestion

// The board's one lead. Seeded from the worst corner's best recent headline,
// because that is the story most likely to be written about alongside other
// dangerous crossings. Cached for a day and never allowed to block a page.
async function boardSuggestion(env) {
  const hit = await getSuggestion(env, SUGGEST_VERSION);
  if (hit) return { ...hit, source: hit.source === "empty" ? "empty" : "cache" };

  const corners = await getHinList(env);
  if (!corners.length) return { source: "empty", reason: "no corners are warmed yet" };
  const warmed = new Set(corners.map((c) => c.slug));

  // Up to five seeds, worst corner first, stopping at the first one that yields
  // a crossing the city's own table recognises. One seed was too thin: the
  // coverage around any single corner is often entirely citywide, and a lead
  // that only exists when the top story happens to name two streets is not a
  // feature, it is a coincidence.
  let last = null;
  for (const c of corners.slice(0, 5)) {
    const tl = await getTimeline(env, c.slug, TIMELINE_VERSION).catch(() => null);
    const year = [...(tl?.years || [])].reverse().find((y) => y.best && !y.best.official);
    if (!year) continue;
    const attempt = await buildSuggestion(year.best, env, warmed).catch(() => null);
    if (!attempt) continue;
    last = attempt;
    if (attempt.slug) break;
  }
  const fresh = last || { source: "empty", version: SUGGEST_VERSION, reason: "no seed article is available" };
  await putSuggestion(env, fresh);
  return fresh;
}

// ---------------------------------------------------------------- run manifest

// One unfiltered 311 count, run only when a manifest is built rather than on
// every page load. It exists so the manifest can show the filtered figure next
// to the raw one, because the gap between them is this product's most expensive
// past mistake: substring matching on "Street" swept in a 3.4M row sanitation
// queue and inflated one corner roughly twenty four times.
async function raw311(c) {
  const since = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);
  const rows = await soql(DS_311, {
    "$select": "count(*)",
    "$where": `within_circle(point, ${c.lat}, ${c.lon}, ${c.radiusMeters}) AND requested_datetime > '${since}'`,
  });
  return parseInt(rows?.[0]?.count ?? 0, 10);
}

// Assembled from lanes that are already computed and cached, so a manifest
// costs nothing beyond the one raw 311 count above. Stored without a TTL: it
// records what happened, not something recomputable.
async function runManifest(c, env, origin, trigger, refresh) {
  if (!refresh) {
    const hit = await getRun(env, c.slug);
    if (hit) return hit;
  }

  const [stats, news, voices, hazards, score, letterRun, apify, timeline, rawReports] = await Promise.all([
    getStats(c).catch(() => null),
    // The failure text is kept, not swallowed. "exa no on-topic results" is a
    // real finding about a quiet corner and it belongs in the record.
    cached(`news:${c.slug}`, 600e3, () => getNews(c, env)).catch((e) => ({
      failed: String(e.message || e).slice(0, 120),
    })),
    getVoices(c, env, origin).catch(() => null),
    getHazardsFor(c, env, origin).catch(() => null),
    getScoreFor(c, env).catch(() => null),
    getLetterRun(env, c.slug).catch(() => null),
    getApifyCounts(env, c.slug).catch(() => null),
    // Read only. Building a manifest must never trigger a dozen Exa searches.
    getTimeline(env, c.slug, TIMELINE_VERSION).catch(() => null),
    raw311(c).catch(() => null),
  ]);

  const manifest = buildManifest({
    slug: c.slug,
    trigger,
    stats: stats ? { ...stats, reports311Raw: rawReports } : null,
    news,
    timeline,
    voices,
    apify,
    hazards,
    score,
    letterRun,
    supervisor: supervisorFor(resolvedDistrict(c, stats)),
  });
  await putRun(env, c.slug, manifest);
  return manifest;
}

// ---------------------------------------------------------------- cred check

// Every input here is a lane that has already been computed and cached, so this
// is assembly rather than work.
async function getCred(c, env, origin) {
  const [stats, news, voices, hazards] = await Promise.all([
    getStats(c).catch(() => sampleStats(c)),
    getNews(c, env).catch(() => sampleNews(c)),
    getVoices(c, env, origin).catch(emptyVoices),
    getHazardsFor(c, env, origin).catch(() => null),
  ]);
  const fresh = credCheck({ stats, news, voices, hazards });
  await putCredCached(env, c.slug, fresh);
  return fresh;
}

// ---------------------------------------------------------------- news

async function getNews(c, env) {
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      query: searchQuery(c),
      numResults: 8,
      type: "auto",
      contents: { text: { maxCharacters: 400 } },
    }),
  });
  if (r.status === 402) throw new Error("exa 402 credits");
  if (!r.ok) throw new Error(`exa ${r.status}`);
  const d = await r.json();
  // Metered even though this lane is not reserved: the per-page press lane is
  // bounded by traffic and the edge cache rather than by the budget, but it
  // spends the same balance, and a counter that ignores it is not the truth.
  await recordExaSpend(env, Number(d?.costDollars?.total)).catch(() => {});
  const tokens = streetTokens(c);
  const scored = classify(d.results, tokens);

  const tight = scored.filter((s) => s.corner);
  // Only claim corner-level precision when there is enough of it to stand on.
  const precise = tight.length >= 3;
  const chosen = precise ? tight : scored.filter((s) => s.loose);

  const mapped = chosen.map(({ raw: x, corner, official }) => {
    const domain = domainOf(x.url);
    return {
      title: x.title.trim(),
      url: x.url,
      domain,
      corner,
      date: (x.publishedDate || "").slice(0, 10),
      official,
      // Computed here because this is the only place the Exa page text still
      // exists. The Cred Check reads the flag rather than the article.
      corroborates: isSafetyCoverage({ title: x.title, text: x.text }, tokens),
    };
  });

  // Agency pages are primary sources. They are real and worth linking, but they
  // are the thing coverage is about rather than coverage itself, so they sort
  // last, carry a tag, and never satisfy the press lane on their own.
  const press = mapped.filter((x) => !x.official);
  const official = mapped.filter((x) => x.official);

  // Corner level first, then newest. A story naming both streets is about this
  // crossing; a story naming one is about the corridor it sits on. Both belong
  // in the panel, but the reader should meet them in that order, and this is
  // what lets the README promise ranking rather than precision it cannot show.
  const byRank = (a, b) =>
    Number(b.corner) - Number(a.corner) || (b.date || "").localeCompare(a.date || "");
  const byDate = (a, b) => (b.date || "").localeCompare(a.date || "");
  const cutoff = Date.now() - 18 * 30 * 24 * 3600 * 1000;
  const fresh = (x) => x.date && Date.parse(x.date) >= cutoff;
  // Only push stale results down when there is enough recent coverage to fill
  // the panel without them. A 2022 story beats an empty lane. Recency is the
  // coarse bucket and corner level is the ordering inside it, so an old story
  // about this exact crossing never displaces this month's corridor coverage.
  const recent = press.filter(fresh);
  const orderedPress =
    recent.length >= 3
      ? [...recent.sort(byRank), ...press.filter((x) => !fresh(x)).sort(byRank)]
      : [...press].sort(byRank);

  const items = [...orderedPress, ...official.sort(byDate)].slice(0, 5);
  if (!items.length) throw new Error("no on-topic results found");
  return {
    source: "live",
    precise,
    fetchedAt: new Date().toISOString(),
    heading: precise ? "Press coverage" : "Coverage of this corridor",
    // Carried on the payload so the run manifest can report what Exa actually
    // returned rather than only what survived. These are the two numbers that
    // show the filter doing work: without them the panel looks like a search
    // box that happened to return five things.
    found: (d.results || []).length,
    afterFilters: chosen.length,
    items,
  };
}

// ---------------------------------------------------------------- voices
// Real resident quotes, scraped ahead of time and baked into public/data. An
// Apify actor run takes minutes and a page load cannot wait on one.
//
// An Upstash Redis read used to sit in front of this, guarded by credentials
// that were never set in any deployed environment. It was dead in production
// and would have woken up silently the first time somebody added those two
// variables, which is the wrong way for a data path to change. Removed rather
// than left dormant; the audit trail is in git.
async function getVoices(c, env, origin) {
  // Voices the cron commissioned and ingested live in KV. The baked assets
  // predate that path and stay authoritative for the two corners that were
  // scraped by hand before the demo.
  const stored = await getVoicesStored(env, c.slug).catch(() => null);
  if (stored?.items?.length) return { ...stored, source: "cache" };
  const baked = await bakedVoices(c, env, origin);
  if (baked.items?.length) return baked;
  // A commissioned run that came back with nothing is a real result and says
  // so, rather than falling back to the generic empty state that means nobody
  // has ever looked.
  if (stored) return { ...stored, source: "empty" };
  return baked;
}


async function bakedVoices(c, env, origin) {
  const r = await asset(env, origin, `/data/voices-${c.slug}.json`);
  // No committed scrape for this corner is an answer, not an error. Almost every
  // corner is in that state, including every corner the cron audits, and
  // throwing here made a normal empty lane look like a broken one in the run
  // log. A real failure to read or parse still throws.
  if (r.status === 404) return emptyVoices();
  if (!r.ok) throw new Error(`voices asset ${r.status}`);
  const d = await r.json();
  if (!d.items?.length) return emptyVoices();
  return { source: "cache", items: d.items.slice(0, 5), collected: d.collected || null };
}

// ---------------------------------------------------------------- fallbacks
// Fallback payloads are built per corner, never shared. The sample stats and
// headlines describe one specific intersection, and showing them under a
// different corner would put the wrong district, and therefore the wrong
// Supervisor, on the page.
function sampleStats(c) {
  const s = c.slug === DEFAULT_SLUG ? SAMPLE.stats : { crashes: 0, reports311: 0 };
  return { source: "sample", crashes: s.crashes, reports311: s.reports311, district: c.district };
}

function sampleNews(c) {
  return { source: "sample", items: c.slug === DEFAULT_SLUG ? SAMPLE.news : [] };
}

// No scraped accounts means an empty panel that says so. Inventing resident
// testimony to fill space would be the one failure this product cannot afford.
const emptyVoices = () => ({ source: "empty", items: [] });

// ---------------------------------------------------------------- map
// A Static Maps thumbnail, fetched server side for the same reason the Street
// View frame is: the key must never reach the browser. Static image only, no
// Maps JS. The bytes are identical for every visitor, so the response is parked
// in the edge cache and Google is hit once per corner per day.
function staticMapUrl(c, env) {
  const q = new URLSearchParams({
    center: `${c.lat},${c.lon}`,
    zoom: "17",
    size: "640x400",
    maptype: "roadmap",
    markers: `color:0xF07E26|${c.lat},${c.lon}`,
    key: env.GOOGLE_MAPS_API_KEY,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${q}`;
}

const mapCacheKey = (c) => new Request(`https://streetcred.internal/map/${c.slug}.jpg`);

async function mapImage(c, env, ctx) {
  const cache = caches.default;
  const key = mapCacheKey(c);
  const hit = await cache.match(key);
  if (hit) return hit;

  const r = await fetch(staticMapUrl(c, env));
  const type = r.headers.get("content-type") || "";
  // A bad key or a blown quota comes back as text, not an image. Fail with a 404
  // so the page drops the panel instead of rendering a broken thumbnail.
  if (!r.ok || !type.startsWith("image/")) {
    return new Response("map unavailable", { status: 404 });
  }
  const out = new Response(r.body, {
    headers: { "content-type": type, "cache-control": "public, max-age=86400" },
  });
  ctx.waitUntil(cache.put(key, out.clone()));
  return out;
}

// ---------------------------------------------------------------- letter
async function getLetter(c, env, ctx) {
  // Built by the shared module so the Worker and the offline generator in
  // tools/generate_letters.mjs cannot drift. Everything this used to compute
  // inline lives there now, unchanged.
  const { prompt, supervisor, district: dist, quote, headlines, signoff } = buildLetterPrompt(c, ctx);


  // 3.7-flash returns UNAVAILABLE under load often enough that a single attempt
  // makes the letter lane look broken when it is only busy. Transient statuses
  // get three tries with a short backoff; a 400 or a 403 is a real fault and is
  // surfaced immediately with the reason attached, because a bare status code
  // sent me looking for a revoked key when the answer was model overload.
  const TRANSIENT = new Set([429, 500, 502, 503, 504]);
  // What a spent allowance looks like, as opposed to a momentary rate limit.
  const QUOTA_SPENT = /RESOURCE_EXHAUSTED|quota|PerDay|per day|limit: *0/i;
  // Five attempts with exponential backoff, not three with a flat one. Flash
  // returns UNAVAILABLE for roughly one request in four during a busy hour, and
  // waiting on a fetch costs no Worker CPU, so patience here is nearly free and
  // the alternative is a flagship letter silently becoming a sample.
  const draft = async (extra = "") => {
    let lastErr = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt + extra }] }] }),
        },
      );
      if (r.ok) {
        const d = await r.json();
        const t = (d.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || "")
          .join("")
          .trim();
        if (!t) throw new Error("gemini empty letter");
        return t.replace(/—/g, ", ");
      }
      const detail = await r.text().catch(() => "");
      lastErr = `gemini ${r.status}: ${detail.slice(0, 180)}`;
      // 429 covers two different things. A burst limit clears in a second and
      // is worth waiting out; a daily quota does not clear today, and five
      // attempts with exponential backoff spend 15.5 seconds proving it. The
      // body says which one it is.
      if (r.status === 429 && QUOTA_SPENT.test(detail)) {
        const quotaErr = new Error(`gemini quota: ${detail.slice(0, 140)}`);
        quotaErr.quota = true;
        throw quotaErr;
      }
      if (!TRANSIENT.has(r.status)) throw new Error(lastErr);
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
    }
    throw new Error(lastErr || "gemini unavailable");
  };

  // The verifier runs on the same inputs the prompt was built from, so a claim
  // that survives it is a claim traceable to a record. One retry, and the retry
  // names the exact token that failed, because a retry that only says "try
  // again" reshuffles the same invention into a new sentence.
  const inputSet = buildInputSet({
    corner: c,
    stats: ctx.stats,
    score: ctx.score,
    news: ctx.news,
    timeline: ctx.timeline,
    supervisor: dist ? supervisor : null,
    // Arms the completeness rule. A letter served to a visitor must have
    // reached its request, and the signoff is where a finished letter ends.
    signoff,
    // The voices lane was already fetched to pick the prompt's quote. Passing
    // it here is what lets the verifier refuse a letter that describes what
    // residents said at a corner where nobody said anything.
    voices: ctx.voices,
    // The prompt quotes h.detail and tells the model to present it as
    // documented, so the figures inside it have to be sourced.
    hazards: ctx.hazards,
  });

  let text = await draft();
  let check = verifyLetter(text, inputSet);
  let attempts = 1;

  if (!check.ok) {
    text = await draft(retryInstruction(check));
    check = verifyLetter(text, inputSet);
    attempts = 2;
  }

  // Which lanes actually reached the prompt, recorded from the prompt itself
  // rather than from what was available. A letter written with no press
  // coverage must never be described as having cited press.
  const inputs = ["stats"];
  if (headlines) inputs.push("press");
  if (quote) inputs.push("voices");
  if (hz.length) inputs.push("audit");
  if (ctx.score) inputs.push("index");
  if (longevityLine) inputs.push("history");
  const generatedAt = new Date().toISOString();

  if (!check.ok) {
    // Twice unverified. Serving this would put an unsourced figure in front of
    // someone about to send it to an elected official, so it is not served.
    // Last week's verified letter is stale and true, which beats fresh and
    // invented every time.
    await appendTrustIncident(env, {
      at: generatedAt,
      slug: c.slug,
      attempts,
      failures: check.failures.slice(0, 8),
      model: GEMINI_TEXT_MODEL,
    });
    const fallback = await getVerifiedLetter(env, c.slug).catch(() => null);
    if (fallback?.text) {
      return {
        source: "verified-cache",
        supervisor: fallback.supervisor ?? supervisor,
        generatedAt: fallback.generatedAt,
        verified: true,
        stale: true,
        text: fallback.text,
        fix: c.fix.name,
        cost: c.fix.cost,
        grant: c.fix.grant,
      };
    }
    // Nothing verified has ever been written for this corner, so there is
    // nothing honest to fall back to. The sample path handles it, tagged.
    throw new Error(`letter failed verification twice: ${check.failures.map((f) => f.token).join(", ")}`);
  }

  await putLetterRun(env, c.slug, {
    generatedAt, supervisor, inputs, model: GEMINI_TEXT_MODEL,
    verified: true, attempts, numbersChecked: check.checked.numbers,
  });

  const record = {
    source: "live",
    supervisor,
    generatedAt,
    verified: true,
    attempts,
    text,
    fix: c.fix.name,
    cost: c.fix.cost,
    grant: c.fix.grant,
    // Which rules this passed, on the record itself. Without it, a stored
    // letter is a claim to have been verified with no way to ask verified
    // against what, and a rule added later cannot tell an already-checked
    // letter from one that predates the check.
    verifyVersion: check.version,
    checkedAt: generatedAt,
  };
  await putVerifiedLetter(env, c.slug, record).catch(() => {});
  return record;
}

// ------------------------------------------------------- the serving gate
//
// A letter reaches a reader by four routes: a fresh draft, a stored letter that
// passed verification, the sample, and the score-tier "not drafted yet" state.
// Only the first is checked at the moment it is written. The other three were
// trusted, and one of them was lying.
//
// The sample is the one that shipped. Its text asserts resident accounts, press
// coverage and "hundreds of collisions" at every corner it is served for,
// because it is one fixed paragraph written to look like a letter, not a claim
// about any particular intersection. On 16th and Potrero that put "residents
// describe the problem" beside a voices lane reading NONE FOUND and "hundreds
// of collisions" beside a displayed 65. Nothing caught it, because none of
// those sentences contains a digit to check.
//
// So a letter now has to earn its way out of here. Failing closed is the point:
// an unchecked letter is exactly what this gate exists to stop, and the honest
// pending state below is always available and always true.
export const LETTER_PENDING_NOTE =
  "A verified letter for this corner is queued behind generation.";

function pendingLetter(c, reasons = []) {
  return {
    source: "pending-verification",
    supervisor: null,
    verified: false,
    gated: true,
    text: "",
    note: LETTER_PENDING_NOTE,
    // Named rather than summarised. A reader who wants to know why this corner
    // has no letter can read the reasons the check gave, in the same words the
    // regeneration prompt will be conditioned on.
    gatedReason: reasons.length
      ? `The last draft for this corner failed the letter check: ${reasons.join("; ")}.`
      : "No letter for this corner has passed the current letter check.",
    fix: c.fix.name,
    cost: c.fix.cost,
    grant: c.fix.grant,
  };
}

// A stored letter may serve only if it was checked by the rules in force now.
// A letter verified under an older, weaker verifier has not been checked for
// the thing that went wrong, and "it passed once" is not the same claim as "it
// passes". This costs nothing: the version is on the record.
function storedLetterServes(stored) {
  return Boolean(stored?.text) && stored?.verifyVersion === VERIFY_VERSION;
}

// Kept, exported and no longer served anywhere.
//
// It is the exhibit: tools/verify.test.mjs runs it through the check and
// asserts it fails, so if a future change ever routes it back to a reader the
// test says so by name. Deleting it would remove the evidence of what the site
// used to say and leave nothing pinning the rule to the letter that broke it.
export function sampleLetter(c, district) {
  const supervisor = supervisorFor(district);
  // Same rule as the live path, through the same helper: title only when the
  // district maps to a real Supervisor, never "Dear Supervisor Mayor Daniel
  // Lurie".
  const salutation = `Dear ${addresseeFor(district)}`;
  const where = district ? `, in District ${district}` : ", in San Francisco";
  const signoff = district ? `A resident of District ${district}` : "A resident of San Francisco";
  return {
    source: "sample",
    supervisor,
    fix: c.fix.name,
    cost: c.fix.cost,
    grant: c.fix.grant,
    text: `${salutation},

I am writing about the intersection of ${c.name}${where}.

City records show hundreds of collisions within 150 meters of this corner, and street-related 311 reports from this location arrive continuously. Local reporting has covered pedestrian safety on this corridor repeatedly.

Residents describe the same problem in their own words: people are still in the crosswalk when drivers turn through it.

I am asking you to fund ${c.fix.name} at this intersection, estimated at ${c.fix.cost}, through the ${c.fix.grant}. These are proven treatments and this corner has the record to justify them.

Thank you for your time and your attention to this corner.

${signoff}`,
  };
}

// ---------------------------------------------------------------- radar setup

// Monitor creation lives in the Worker, not in a tool.
//
// The tool version needed the webhook secret in a shell, and the shell it was
// meant to run in has no terminal to type into: `read -rs` hit EOF, the && chain
// stopped, and nothing was created or installed with no output to say so. The
// secret already lives here, so the creation belongs here, and nobody has to
// hold it twice.
//
// Idempotent by construction. It refuses if monitors already exist, so the
// cron can call it every morning and it will do nothing every morning after
// the first.
export async function ensureMonitors(env) {
  const out = await ensureMonitorsInner(env);
  // Written every time, success or not. This ran three times inside
  // waitUntil with its reason thrown away, which looks identical from the
  // outside to it never running at all.
  await env.STORE?.put("radar:setup", JSON.stringify({ ...out, at: new Date().toISOString() })).catch(() => {});
  return out;
}

async function ensureMonitorsInner(env) {
  if (!env.WEBHOOK_SECRET) return { created: 0, reason: "no webhook secret installed" };
  if (!env.EXA_API_KEY) return { created: 0, reason: "no exa key installed" };

  const rows = [];
  for (let page = 1; page <= 12; page += 1) {
    const p = await getRankPage(env, page).catch(() => null);
    if (!p?.rows?.length) break;
    rows.push(...p.rows);
  }
  if (!rows.length) return { created: 0, reason: "no ranked corners to derive corridors from" };

  const plan = [
    ...worstCorridors(rows, CORRIDOR_LIMIT).map((c) => ({
      kind: "corridor", corridor: c.street, query: corridorQuery(c.street),
    })),
    ...META_QUERIES.map((q) => ({ kind: "meta", corridor: "citywide", query: q })),
  ];

  // Partial progress is the design, not a fallback. Twenty nine sequential
  // POSTs did not fit in a page load's budget: the run was killed partway,
  // wrote nothing, and left a lock behind that made every later attempt report
  // "already in flight" while nothing was in flight at all. So the set is
  // created in parallel batches and stored after each one, and a run that dies
  // costs at most the batch it was in.
  const existing = await getMonitors(env).catch(() => null);
  const list = [...(existing?.list || [])];
  const done = new Set(list.map((m) => m.query));
  const todo = plan.filter((m) => !done.has(m.query));
  if (!todo.length) return { created: 0, reason: "already created", count: list.length };

  const url = `https://streetcred.thealexschroeder.workers.dev/api/radar/hook/${env.WEBHOOK_SECRET}`;
  const failed = [];
  const BATCH = 6;
  let added = 0;

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const made = await Promise.all(
      batch.map(async (m) => {
        try {
          const r = await fetch("https://api.exa.ai/monitors", {
            method: "POST",
            headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
            body: JSON.stringify({
              name: `streetcred ${m.kind} ${m.corridor}`.slice(0, 60),
              search: { query: m.query, numResults: 5 },
              webhook: { url },
              metadata: { corridor: m.corridor, kind: m.kind },
            }),
          });
          const d = await r.json().catch(() => null);
          const id = d?.id || d?.monitorId || d?.data?.id;
          if (!r.ok || !id) {
            failed.push({ query: m.query, status: r.status, body: JSON.stringify(d).slice(0, 220) });
            return null;
          }
          return { id, query: m.query, corridor: m.corridor, kind: m.kind, createdAt: new Date().toISOString() };
        } catch (e) {
          failed.push({ query: m.query, error: String(e.message || e).slice(0, 140) });
          return null;
        }
      }),
    );
    const ok = made.filter(Boolean);
    if (ok.length) {
      list.push(...ok);
      added += ok.length;
      // Stored every batch, so the next invocation resumes rather than restarts.
      await putMonitors(env, { version: "v1", createdAt: existing?.createdAt || new Date().toISOString(), list });
    }
  }

  return { created: added, total: list.length, remaining: plan.length - list.length, failed: failed.slice(0, 4), failedCount: failed.length };
}

// ---------------------------------------------------------------- radar webhook

// Exa pushes detections here as coverage appears.
//
// The endpoint is public by necessity: a webhook has to be reachable. So it is
// treated as hostile input from end to end. Two independent checks before a
// payload is read at all, a shared secret in the path and a monitor id this
// Worker created, and after that nothing in the payload is trusted to be true.
// Every article runs the same relevance filter and the same graded-index bar
// as the rest of the press lane, and a detection that fails is published as a
// filtered detection rather than discarded. Nothing in a payload can cause an
// action: no imagery, no voices, no grade movement, ever.
async function radarHook(request, env, url) {
  if (request.method !== "POST") return json({ error: "post only" }, 405);

  const secret = url.pathname.split("/").pop();
  if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
    return json({ error: "not found" }, 404);
  }

  const payload = await request.json().catch(() => null);
  const monitors = await getMonitors(env);
  const known = new Set((monitors?.list || []).map((m) => m.id));
  const monitorId = monitorIdFrom(payload);
  if (!monitorId || !known.has(monitorId)) {
    return json({ error: "unknown monitor" }, 403);
  }

  const results = resultsFrom(payload);
  if (!results) {
    // Not a failure of the sender. The reader does not know this shape, and
    // recording it is how the next version learns to read it.
    await putRadarUnknown(env, payload).catch(() => {});
    return json({ ok: true, read: 0, note: "payload shape not recognised, recorded" });
  }

  const entry = (monitors.list || []).find((m) => m.id === monitorId);
  const corridor = entry?.corridor || entry?.query || "citywide";
  const detectedAt = new Date().toISOString();
  const index = await cityIndexForRadar(env, corridor);

  const hits = results.map((a) => ({ ...judge(a, corridor, index, detectedAt), version: RADAR_VERSION }));
  const { added } = await pushRadarFeed(env, hits);
  await countRadarDetection(env, hits.length).catch(() => {});

  // A passing hit that names a graded corner is queued, not published on that
  // corner directly. The nightly press lane is what writes citations, so the
  // radar can never put an article on a corner page without the same filter
  // the batch applies.
  const queued = [];
  for (const h of hits) {
    if (!h.passed) continue;
    for (const slug of h.corners || []) {
      if (queued.includes(slug)) continue;
      queued.push(slug);
      // No old and no new, deliberately. A radar entry records that a corner
      // was queued for a press re-check, and a grade that did not move must
      // not be rendered as a movement to nowhere.
      await appendChange(env, {
        slug,
        name: slug.replace(/-and-/g, " and ").replace(/-/g, " "),
        source: "radar",
        reason: `${h.domain} covered this corner; press re-check queued`,
        date: detectedAt,
      }).catch(() => {});
    }
  }
  if (queued.length) await queueRadarRecheck(env, queued).catch(() => {});

  return json({ ok: true, read: hits.length, added, passed: hits.filter((h) => h.passed).length, queued: queued.length });
}

// The corners a corridor could be about, read from the shard the corridor's
// first letter lives in. One KV read, no fan-out over the whole city.
async function cityIndexForRadar(env, corridor) {
  const first = String(corridor || "").trim().toLowerCase()[0];
  if (!first) return [];
  const shard = await env.STORE?.get(`city:shard:${first}`, "json").catch(() => null);
  const rows = shard?.rows || shard || [];
  return (Array.isArray(rows) ? rows : []).map((r) => ({ slug: r.slug, name: r.name })).filter((r) => r.slug && r.name);
}

// A bounded nudge, written where the nightly run reads it. Press attention is
// a signal about what to look at next and never a grade: the Danger Index does
// not move because somebody wrote an article.
async function queueRadarRecheck(env, slugs) {
  const raw = await env.STORE?.get("radar:queue", "json").catch(() => null);
  const q = Array.isArray(raw) ? raw : [];
  const merged = [...new Set([...slugs, ...q])].slice(0, 200);
  await env.STORE?.put("radar:queue", JSON.stringify(merged));
}

// ---------------------------------------------------------------- press batch

// Press enrichment for corners nobody has asked about, worst first.
//
// Runs after the morning audit, never instead of it. Everything that could
// spend without a bound has one: a corner ceiling per night, a small
// concurrency so a stall on one corner does not hold the rest, and the budget
// meter, which refuses inside enrichPress and turns the run into a recorded
// deferral rather than an overspend.
//
// Audited corners are excluded. Their press lane ran with their audit, and
// re-running it here would spend the balance re-reading what the site knows.
export const PRESS_BATCH_PER_NIGHT = 100;
// A quarter-hourly run is bounded by the platform, not by taste: a Worker
// invocation may make 50 subrequests, and a corner costs up to six calls to
// Exa. Six corners is 36, which leaves room for the searches a warm segment
// does not save. Overnight that is roughly 190 corners, at a cost the cap
// still governs.
export const PRESS_BATCH_PER_TICK = 6;

// What the provider says when the key itself is out of credit, as opposed to
// when our own cap is reached. Two different facts: the first needs a new key,
// the second needs a new period or a raised cap, and reporting either as the
// other sends somebody to fix the wrong thing.
export const EXA_CREDITS_SPENT = /\b402\b|credits?/i;
const PRESS_FRESH_DAYS = 30;
const PRESS_LANES = 4;

export async function pressBatch(env, limit = PRESS_BATCH_PER_NIGHT) {
  const budget = await exaBudget(env).catch(() => null);
  if (!budget || budget.exhausted) {
    return { source: "budget-reached", checked: 0, spentUsd: 0 };
  }
  // An unattended batch does not spend against a workspace nobody has
  // confirmed. The price of a search identifies a plan tier and nothing more,
  // so until a human has watched a specific dashboard move, this refuses.
  if (!budget.accountVerified) {
    return { source: "account-unverified", checked: 0, spentUsd: 0, reason: budget.reconciliation };
  }

  const meta = await getCityMeta(env).catch(() => null);
  const fresh = Date.now() - PRESS_FRESH_DAYS * 24 * 3600 * 1000;
  const targets = [];
  // Resume where the last run stopped rather than rescanning the rank from the
  // top. Without this every tick re-reads several hundred already-checked
  // corners to find six new ones, which is the same work the checkpoint exists
  // to avoid.
  const checkpoint = await getBurnCheckpoint(env).catch(() => null);
  const startPage = Math.max(1, Number(checkpoint?.nextPage) || 1);
  let lastPage = startPage;
  for (let page = startPage; targets.length < limit && page <= 80; page += 1) {
    lastPage = page;
    const rank = await getRankPage(env, page).catch(() => null);
    if (!rank?.rows?.length) break;
    for (const row of tagTiers(rank.rows, meta)) {
      if (targets.length >= limit) break;
      if (row.tier === TIERS.AUDITED) continue;
      const have = await getPress(env, row.slug, PRESS_VERSION).catch(() => null);
      if (have && Date.parse(have.fetchedAt || 0) >= fresh) continue;
      targets.push(row);
    }
  }

  const out = { source: "live", checked: 0, withCoverage: 0, empty: 0, deferred: 0, failed: 0, spentUsd: 0 };
  // One metering session and one rollup write for the whole tick, instead of
  // three meter writes per Exa call and a rollup write per corner. The lane was
  // spending roughly 2,976 KV writes a day against a 1,000 a day allowance, and
  // almost all of it was write amplification rather than work: the counts stay
  // identical, the ledger still measures every dollar, and nothing is throttled.
  const meter = openExaMeter(env);
  const rollup = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const row = targets[next++];
      if (!row) return;
      if (out.deferred) return;   // the cap is reached, stop the whole run
      try {
        const corner = { slug: row.slug, name: row.name, city: "San Francisco", lat: row.lat, lon: row.lon };
        const rec = await enrichPress(env, corner, meter);
        if (rec.source === "budget-deferred") {
          out.deferred += 1;
          rollup.push(rec);
          return;
        }
        await putPress(env, row.slug, rec);
        rollup.push(rec);
        out.checked += 1;
        out.spentUsd = Math.round((out.spentUsd + (rec.cost?.usd || 0)) * 1e6) / 1e6;
        if (rec.source === "live") out.withCoverage += 1;
        else out.empty += 1;
      } catch (e) {
        // A key with no credit left is not a corner that failed.
        //
        // exaPost throws "exa 402 credits" when the provider refuses on
        // balance, and this catch counted it as a generic failure, so a key at
        // its ceiling read as six corners breaking for unknown reasons. That is
        // the silent degradation: the lane looked broken instead of paused, and
        // nothing on the site said the word credit.
        //
        // Recorded as its own state, and the run stops: every remaining corner
        // in this tick would refuse for the same reason and counting them as
        // failures would bury the one fact worth reporting.
        if (EXA_CREDITS_SPENT.test(String(e?.message || e))) {
          out.paused = (out.paused || 0) + 1;
          out.pausedReason = "the exa key was refused on credit (402); the lane is paused, not broken";
          rollup.push({
            source: "budget-paused",
            version: PRESS_VERSION,
            slug: row.slug,
            reason: out.pausedReason,
            fetchedAt: new Date().toISOString(),
          });
          return;
        }
        out.failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PRESS_LANES, targets.length) }, worker));
  // Flushed after the lanes finish, in a fixed order, so a partial tick still
  // records what it measured. bumpPressRollupBulk has existed since the rollup
  // was written and nothing called it.
  await meter.flush().catch(() => {});
  if (rollup.length) await bumpPressRollupBulk(env, rollup).catch(() => {});
  // The stored press records are what make this resumable corner by corner.
  // The checkpoint only carries the reader's place in the rank and the running
  // totals the status card reads.
  await putBurnCheckpoint(env, {
    startedAt: checkpoint?.startedAt || new Date().toISOString(),
    nextPage: targets.length < limit ? 1 : lastPage,
    done: (checkpoint?.done || 0) + out.checked,
    withCoverage: (checkpoint?.withCoverage || 0) + out.withCoverage,
    empty: (checkpoint?.empty || 0) + out.empty,
    spentUsd: Math.round(((checkpoint?.spentUsd || 0) + out.spentUsd) * 1e6) / 1e6,
    chunks: (checkpoint?.chunks || 0) + 1,
    source: "worker",
    stopReason: out.deferred ? "budget cap reached" : null,
  }).catch(() => {});
  return { ...out, queued: targets.length, fromPage: startPage };
}

// ---------------------------------------------------------------- health
async function health(env, origin, opts = {}) {
  const ping = async (name, fn) => {
    try {
      await fn();
      return [name, "ok"];
    } catch (e) {
      return [name, String(e.message || e).slice(0, 80)];
    }
  };
  const c = CORNERS[DEFAULT_SLUG];
  let probe = null;
  // The Exa ping is a billed search. Every health check has always spent one,
  // which was fine while nobody was counting and is not fine while nobody can
  // say which workspace is billed. So it runs when the workspace is confirmed,
  // or when a caller asks for it deliberately with ?probe=exa, which is the
  // one call a human watches their dashboard for.
  const budget = await exaBudget(env).catch(() => null);
  const probeExa = Boolean(opts.probeExa) || Boolean(budget?.accountVerified);
  const skipped = [];
  const results = await Promise.all([
    ping("datasf", () => soql(DS_CRASHES, { "$select": "count(*)", "$limit": 1 })),
    ping("exa", async () => {
      if (!probeExa) {
        skipped.push("exa");
        throw new Error("not probed: a search is billed and the workspace is unconfirmed, add ?probe=exa");
      }
      const r = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ query: "san francisco pedestrian safety", numResults: 1 }),
      });
      if (!r.ok) throw new Error(r.status === 402 ? "402 credits not redeemed" : `http ${r.status}`);
      // This search is billed whether or not anybody reads the price, so read
      // it: one result, no contents, which makes the total the plain per
      // search unit price and therefore the account fingerprint.
      const d = await r.json().catch(() => null);
      const cost = d?.costDollars || null;
      await recordExaSpend(env, Number(cost?.total)).catch(() => {});
      probe = await recordExaProbe(env, cost).catch(() => null);
    }),
    ping("apify", async () => {
      const r = await fetch(`https://api.apify.com/v2/users/me?token=${env.APIFY_TOKEN}`);
      if (!r.ok) throw new Error(`http ${r.status}`);
    }),
    ping("gemini", async () => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}`,
        { headers: { "x-goog-api-key": env.GEMINI_API_KEY } },
      );
      if (!r.ok) throw new Error(`http ${r.status}`);
    }),
    ping("maps", async () => {
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/streetview/metadata?location=${c.lat},${c.lon}&key=${env.GOOGLE_MAPS_API_KEY}`,
      );
      const d = await r.json();
      if (d.status !== "OK") throw new Error(d.status);
    }),
    ping("imagery", async () => {
      const bytes = await getImage(env, c.slug, "fix");
      if (!bytes) throw new Error("not in KV");
    }),
    ping("staticmap", async () => {
      // Cache first, so a health check does not spend a Static Maps request.
      if (await caches.default.match(mapCacheKey(c))) return;
      const r = await fetch(staticMapUrl(c, env));
      if (!r.ok || !(r.headers.get("content-type") || "").startsWith("image/"))
        throw new Error(`http ${r.status}`);
    }),
    ping("kv", async () => {
      if (!env.STORE) throw new Error("no STORE binding");
      await env.STORE.get("healthcheck");
    }),
    ping("voices", async () => {
      const r = await asset(env, origin, `/data/voices-${c.slug}.json`);
      if (!r.ok) throw new Error(`missing ${r.status}`);
    }),
  ]);
  const out = Object.fromEntries(results);
  // Only this run's probe describes this run. Falling back to the last stored
  // one printed a price and a plan tier directly beside "http 401", which
  // reads as though the failed call had produced them. A stale reading is
  // reported as stale, with the date it was taken, or not at all.
  const stored = probe ? null : await getExaProbe(env).catch(() => null);
  const seen = probe;
  return {
    // A probe that was deliberately not run is not a failing probe. It is also
    // not a passing one, so it is named rather than folded into either.
    ok: Object.entries(out).every(([k, v]) => v === "ok" || skipped.includes(k)),
    skipped,
    ...out,
    // The measured price of the search this check just made, and the plan
    // tier it identifies. A price matching neither tier reports as null rather
    // than being rounded into the nearer one. This does NOT identify a
    // workspace: any number of workspaces bill identically on one tier, and
    // reading a price as an account is how a batch ran against a workspace
    // nobody had confirmed.
    exaUnitUsd: seen?.unitUsd ?? null,
    exaPlan: seen?.plan ?? null,
    lastGoodProbe: stored ? { unitUsd: stored.unitUsd, plan: stored.plan, at: stored.at } : null,
    exaAccountVerified: Boolean((await exaBudget(env).catch(() => null))?.accountVerified),
  };
}

// ---------------------------------------------------------------- resolve

const titleCase = (s) => String(s).replace(/\b([a-z])/g, (m) => m.toUpperCase());

// Free text to a corner. Everything cheap and local happens before anything
// billable: rate limit, then parse, then the alias table, then the KV cache, and
// only then a network lookup. A nonsense query never leaves the Worker.
// Free text to a stored corner, with no HTTP in it. The scheduled handler and
// the search box both go through here, so an autonomously audited corner is
// created by exactly the same code that creates one somebody typed. Anything
// else would mean the cron was testing a path visitors never take.
async function resolveCorner(q, env) {
  const parsed = parseQuery(q);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      message: 'Type two cross streets, like "24th and Valencia" or "Turk & Taylor".',
    };
  }

  const slug = canonicalSlug(parsed.slug);
  if (CORNERS[slug]) return { ok: true, corner: CORNERS[slug], source: "precomputed" };

  const cached = await getCorner(env, slug);
  if (cached) return { ok: true, corner: cached, source: "cache" };

  // The city shards, before any geocoding. Every corner the sweep graded
  // resolves here from one KV read: no DataSF lookup, no Nominatim fallback,
  // nothing external at all. Deliberately not written back to KV: storing it
  // would promote a corner to the warmed fleet just because somebody looked at
  // it, and the fleet is what the daily audit works through.
  const graded = await cityCornerFor(env, slug);
  if (graded) return { ok: true, corner: graded, source: "city" };

  const loc = await locate(parsed);
  if (!loc.ok) {
    const [a, b] = parsed.streets.map(titleCase);
    let message;
    if (loc.reason === "out of bounds") {
      message = `${parsed.name} is outside San Francisco. This tool only covers SF intersections.`;
    } else if (loc.reason === "no intersection") {
      // Both are real SF streets that never cross. Saying "not found" here would
      // send someone hunting for a typo that does not exist.
      message = `${a} and ${b} are both San Francisco streets, but they do not intersect.`;
    } else if (loc.known && (loc.known[0] || loc.known[1])) {
      const missing = loc.known[0] ? b : a;
      message = `San Francisco has no street named ${missing}. Check the spelling.`;
    } else {
      message = `No San Francisco intersection found at ${parsed.name}. Try two cross streets, like "24th and Valencia".`;
    }
    return { ok: false, reason: loc.reason, message };
  }

  const district = await districtFor(loc.lat, loc.lon).catch(() => null);
  const c = makeCorner({ slug, name: parsed.name, lat: loc.lat, lon: loc.lon, district, cnn: loc.cnn });
  await putCorner(env, c);
  return { ok: true, corner: c, source: loc.source };
}

async function handleResolve(url, request, env) {
  const q = url.searchParams.get("q") || "";

  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-real-ip");
  const rl = await rateLimit(env, ip);
  if (!rl.allowed) {
    return json(
      {
        ok: false,
        reason: "rate limited",
        message: "Too many lookups from this connection. Try again in a few minutes.",
      },
      429,
    );
  }

  const res = await resolveCorner(q, env);
  if (!res.ok) return json({ ok: false, reason: res.reason, message: res.message });
  const c = res.corner;
  return json({
    ok: true, slug: c.slug, name: c.name, district: c.district ?? null,
    lat: c.lat, lon: c.lon, heading: c.heading ?? 0, source: res.source,
  });
}

// ---------------------------------------------------------------- city map

// The whole city in one Static Maps request, pins already drawn into the image.
// Server side for the same reason the corner thumbnail is: the key must never
// reach a browser. Cached hard, because the bytes are identical for everyone
// until the corner set changes.
async function cityMap(env, ctx) {
  // Versioned, and it has to be. The transparent tap anchors are laid out from
  // the live corner list on every page render, but the pins underneath them are
  // burned into this image. An unversioned key means adding a corner moves every
  // anchor while the drawn pins stay put, and every tap lands on the wrong
  // corner. The count is in the key too, so warming a corner refreshes the map
  // without waiting on a deploy.
  const corners = await getHinList(env);
  const key = new Request(
    `https://streetcred.internal/citymap-${CACHE_VERSION}-${corners.length}.jpg`,
  );
  const hit = await caches.default.match(key);
  if (hit) return hit;

  if (!corners.length) return new Response("no corners", { status: 404 });

  const view = fitView(corners);
  const url =
    `https://maps.googleapis.com/maps/api/staticmap?${staticMapPath(corners, view)}` +
    `&key=${env.GOOGLE_MAPS_API_KEY}`;
  const r = await fetch(url);
  const type = r.headers.get("content-type") || "";
  if (!r.ok || !type.startsWith("image/")) return new Response("map unavailable", { status: 404 });

  const out = new Response(r.body, {
    headers: { "content-type": type, "cache-control": "public, max-age=86400" },
  });
  ctx.waitUntil(caches.default.put(key, out.clone()));
  return out;
}

// ---------------------------------------------------------------- share card

// Deliberately never the annotated or edited states. Those are modified Street
// View imagery, and pushing them out as social preview assets is exactly the
// redistribution question the risk review flagged as unsettled. The card is
// built on the untouched frame, attribution included.
async function shareCard(c, env, ctx, origin) {
  const key = new Request(`https://streetcred.internal/og/${c.slug}.jpg`);
  const hit = await caches.default.match(key);
  if (hit) return hit;

  let bytes = await getShareCard(env, c.slug);

  // A scored corner has no composited card and compositing 7,353 of them
  // would be 7,353 Street View fetches and 7,353 KV writes, which is the
  // shape the shards exist to avoid. It falls back to the card for its grade:
  // a static asset, no generation, no KV write, and the grade is the claim the
  // page makes. The corner's name and exact index ride in og:title and
  // og:description, which every platform renders beside the image.
  if (!bytes && isScored(c) && c.sweep?.grade) {
    const card = await asset(env, origin, `/og/grade-${c.sweep.grade}.jpg`).catch(() => null);
    if (card?.ok) {
      const res = new Response(card.body, {
        headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" },
      });
      ctx.waitUntil(caches.default.put(key, res.clone()));
      return res;
    }
  }

  // No composited card for this corner yet. The plain frame is a worse card but
  // an honest one, and it means every corner has a preview.
  if (!bytes) bytes = await getImage(env, c.slug, "today");
  if (!bytes) return new Response("no preview", { status: 404 });

  const res = new Response(bytes, {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400" },
  });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

// Reads only what is already computed. A crawler must never trigger a score, a
// corroboration pass, or an image generation just by fetching a page.
async function ogFor(c, env) {
  // A scored corner already carries all of this on the shard row that resolved
  // it. Two more KV reads to confirm two records that by construction do not
  // exist would double the cost of the commonest page on the site.
  // The three stat tiles, server-side, for the 7,355 corners whose figures are
  // already on the shard row. cityStats is synchronous and reads nothing, so
  // this costs the page nothing and puts the numbers in the raw HTML instead of
  // leaving them to a count-up that only fires if the tiles are scrolled into
  // view. A corner without a shard row keeps its skeleton, which says "loading"
  // rather than claiming a figure this render does not have.
  if (isScored(c)) {
    return { score: cityScore(c), cred: cityCred(c), tier: TIERS.SCORED, stats: cityStats(c) };
  }
  const [score, cred, imagery, letter] = await Promise.all([
    getScore(env, c.slug, SCORE_VERSION).catch(() => null),
    getCredCached(env, c.slug, CRED_VERSION).catch(() => null),
    // Which of the two warmed tiers this is, decided by whether both generated
    // states exist as bytes rather than by a label somebody set once.
    getImageryStatus(env, c.slug).catch(() => null),
    // The last letter that passed verification here. Rendered into the HTML
    // when one exists, so the page's conclusion does not depend on a model
    // call completing while somebody reads it.
    getVerifiedLetter(env, c.slug).catch(() => null),
  ]);
  // Whether this corner actually has a generated fix image. The page's own
  // subtitle promises "a picture of the fix", and it must not promise one it
  // is not showing. It comes back by itself when generation does.
  // The frames, in the server HTML.
  //
  // The stage used to ship a loading card on every corner and let the client
  // fill it, even when this very function had already read the record that says
  // which states exist. So the raw HTML of a fully audited corner said "loading"
  // about photographs that were sitting in KV, and anything reading the page
  // without running scripts saw a corner with no imagery at all.
  //
  // Only a record that says ready earns srcs. A pending or failed one still
  // hands the client the placeholder, because those are the cases where the
  // answer genuinely is not known yet.
  const st = imagery?.states || [];
  const frames =
    imagery?.status === "ready"
      ? {
          today: `/gen/${c.slug}/today.jpg`,
          hazards: st.includes("hazards") ? `/gen/${c.slug}/hazards.jpg` : null,
          fix: st.includes("fix") ? `/gen/${c.slug}/fix.jpg` : null,
        }
      : null;

  return {
    score,
    cred,
    frames,
    // Where the render came from, so the caption can say so without waiting on
    // the imagery fetch.
    provenance: provenanceOf(imagery),
    // Whether a stored probe actually confirmed Street View has nothing here,
    // as opposed to us simply not having fetched it. Those are different facts
    // and only the first is a claim about Google.
    imageryStatus: imagery?.status || null,
    // Same gate as the API path. This one writes the letter straight into the
    // server HTML, so a letter that may not be served over the API must not
    // arrive by the shorter route either; that is how a rail becomes a
    // suggestion.
    letter: storedLetterServes(letter) ? letter : null,
    tier: tierOf(c, imagery),
    showsFix: Boolean(imagery?.states?.includes("fix")),
  };
}

// ---------------------------------------------------------------- the audited index

// Everything /audited renders, assembled from stored records only.
//
// The section a corner lands in is decided by the provenance field on its
// imagery record, not by which roster list it appears in. Those two can drift,
// and when they do the provenance is the one attached to the render itself, so
// it is the one that decides what the page may claim about it.
//
// Every lane cell is read rather than inferred. "No press found" is a result
// and it renders as one; a corner with no press record at all lands in the same
// cell, because an absent record is not evidence of a lane that ran.
export async function auditedIndex(env) {
  const meta = await getCityMeta(env).catch(() => null);
  const roster = [...new Set([...(meta?.audited || []), ...(meta?.enriched || [])])];
  const log = (await env.STORE?.get("cotd:log", "json").catch(() => null)) || [];
  const dateBySlug = new Map(
    (Array.isArray(log) ? log : log.entries || []).filter((e) => e?.slug).map((e) => [e.slug, e.date]),
  );

  const rows = await Promise.all(
    roster.map(async (slug) => {
      const img = await getImageryStatus(env, slug).catch(() => null);
      // Only a corner that actually holds a fix render belongs on this page.
      // The roster lists corners at every stage; this page is about the ones
      // carrying generated imagery.
      if (img?.status !== "ready" || !(img.states || []).includes("fix")) return null;
      const [corner, score, letter, press, voices] = await Promise.all([
        cornerBySlug(env, slug).catch(() => null),
        getScore(env, slug, SCORE_VERSION).catch(() => null),
        getVerifiedLetter(env, slug).catch(() => null),
        getPress(env, slug, PRESS_VERSION).catch(() => null),
        getVoicesStored(env, slug).catch(() => null),
      ]);
      return {
        slug,
        name: corner?.name || slug,
        grade: score?.grade || null,
        index: Number.isFinite(score?.index) ? score.index : null,
        // Two different facts, and the row says which it is showing. cotd:log
        // records the morning cron auditing a corner, which is the audit date.
        // imgstatus.at records when the imagery was generated, which is not the
        // same claim and must not borrow the same label. The log only reaches
        // back three mornings, so without the fallback 22 of 23 rows would
        // carry no date at all and the sort would be alphabetical wearing a
        // chronological caption.
        // A date beyond today in America/Los_Angeles is treated as absent:
        // an absent date sorts last and reads "no recorded date", which is
        // true; a future one would be a claim about an audit yet to happen.
        date: (() => {
          const d = dateBySlug.get(slug) || (Number.isFinite(img.at) ? pacificDayOf(img.at) : null);
          return d && String(d) > pacificDay() ? null : d;
        })(),
        dateKind: dateBySlug.has(slug) ? "audited" : "generated",
        provenance: provenanceOf(img),
        letter: storedLetterServes(letter),
        fix: true,
        // Three states, not two. "No press found" says a search ran and came
        // back empty, which is a result. Most audited corners have no
        // press:corner record at all, meaning the batch lane has not reached
        // them: /api/news answers those with a LIVE Exa search at read time,
        // which is why the corner page shows items the store does not hold.
        // Reporting that as "no press found" would be the page claiming a
        // result for a search that never ran.
        press: !press ? "unchecked" : (press.items || []).length > 0 ? "found" : "none",
        voices: !voices ? "unchecked" : (voices.items || []).length > 0 ? "found" : "none",
      };
    }),
  );

  const live = rows.filter(Boolean);
  // Most recently audited first, so the morning cron's newest corner is on top
  // by itself. A corner with no recorded date sorts last rather than to the
  // top, because an absent date is not a recent one.
  const bydate = (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || a.slug.localeCompare(b.slug);
  return {
    full: live.filter((r) => r.provenance !== PROMOTED_FROM_ENRICHED).sort(bydate),
    promoted: live.filter((r) => r.provenance === PROMOTED_FROM_ENRICHED).sort(bydate),
  };
}

// ---------------------------------------------------------------- generated imagery

async function generatedImage(pathname, env, ctx) {
  const parts = pathname.split("/").filter(Boolean); // gen, slug, state.jpg
  if (parts.length !== 3) return new Response("not found", { status: 404 });
  const slug = canonicalSlug(parts[1]);
  const state = parts[2].replace(/\.jpg$/, "");
  if (!["today", "hazards", "fix"].includes(state)) {
    return new Response("not found", { status: 404 });
  }

  const key = new Request(`https://streetcred.internal/gen/${slug}/${state}.jpg`);
  const hit = await caches.default.match(key);
  if (hit) return hit;

  const bytes = await getImage(env, slug, state);
  if (!bytes) return new Response("not generated", { status: 404 });

  const res = new Response(bytes, {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=604800" },
  });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

// ---------------------------------------------------------------- router
// ---------------------------------------------------------------- corner of the day

// Cloudflare crons fire in UTC with no timezone support, so the schedule in
// wrangler.jsonc is 13:10 UTC, which is 06:10 Pacific while daylight time is in
// force and 05:10 once it ends. Pacific is what the log records, because the
// claim being made is "a new corner every morning" and mornings are local.
// One definition, in data.js, shared by every surface that prints a date. Two
// Pacific formatters that drift apart is the same bug in a slower form. Every
// call here means today, which the shared helper spells out rather than
// defaulting to, so a missing timestamp elsewhere cannot render as now.
const pacificDay = pacificTodayShared;


// A timestamp a reader can act on: the local date and time a figure was last
// true, in the timezone the claim is about. A number with no as-of is a
// number that reads as current forever.
const fmtAsOf = (ts) => {
  const d = new Date(ts || 0);
  if (isNaN(d) || !ts) return null;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
};

// Cost, stated plainly because it is billed and recurring: a fully warmed
// corner is two Gemini image generations, roughly 8 to 14 cents, plus about a
// dozen Exa searches for the press history and one text call for the letter.
// The cron counts against the same daily generation cap as everybody else and
// never bypasses it. If image quota runs out, or sponsor credits expire, the
// run publishes with the records lanes and honest pending-free imagery, and
// says so in the log. A records-only audit is still a daily autonomous audit.
async function cornerOfTheDay(env, ctx, origin) {
  const today = pacificDay();
  const log = await getCotdLog(env);

  // Idempotent by date, not by invocation. A redeploy, a retry, or a manual
  // trigger on a day that already ran must not audit a second corner and must
  // not spend a second pair of image generations.
  const already = log.find((e) => e.date === today);
  if (already) {
    return { ok: true, skipped: "already ran today", date: today, entry: already };
  }

  // Yesterday's commissioned scrapes, picked up before anything else runs. An
  // actor takes minutes and this handler must never wait on one, so the run
  // that starts a scrape is never the run that reads it.
  const ingest = await ingestVoices(env, (slug) => cornerBySlug(env, slug)).catch((e) => ({
    checked: 0,
    ingested: [],
    failed: String(e.message || e).slice(0, 90),
  }));

  let queue = await getQueue(env);
  if (!queue) {
    queue = [...COTD_SEED];
    await putQueue(env, queue);
  }
  if (!queue.length) {
    const entry = { date: today, slug: null, status: "failed", reason: "the queue is empty" };
    await appendCotdLog(env, entry);
    return { ok: false, ...entry };
  }

  // A resolver failure is the only thing that skips to the next entry, and only
  // a few times, so one run cannot drain a fortnight of runway on bad input.
  let corner = null;
  const skipped = [];
  for (let tries = 0; tries < 4 && queue.length; tries++) {
    const query = queue.shift();
    const res = await resolveCorner(query, env).catch((e) => ({
      ok: false,
      reason: String(e.message || e).slice(0, 80),
    }));
    if (res.ok) {
      corner = res.corner;
      break;
    }
    skipped.push({ query, reason: res.reason });
  }
  await putQueue(env, queue);

  if (!corner) {
    const entry = {
      date: today,
      slug: null,
      status: "failed",
      reason: `no queue entry resolved: ${skipped.map((s) => `${s.query} (${s.reason})`).join("; ")}`,
    };
    await appendCotdLog(env, entry);
    return { ok: false, ...entry };
  }

  // The queue resolves its corners out of the city shards, and out of the
  // published score tier before that. Both tags mean the same thing to the
  // imagery lane: do not spend two generations on a corner nobody scheduled.
  // This run is that schedule. The tag comes off and the corner is stored
  // before any lane reads it, or the morning audit would politely decline to
  // audit the corner it woke up for.
  if (corner.tier) {
    const { tier, sweep, ...promoted } = corner;
    corner = promoted;
    await putCorner(env, corner);
  }

  // Every lane is allowed to fail on its own. A failed lane publishes in its
  // labelled degraded state rather than taking the corner down with it, which
  // is the same rule the page has always followed for a visitor.
  const notes = [];
  const lane = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      notes.push(`${name}: ${String(e.message || e).slice(0, 60)}`);
      return null;
    }
  };

  const stats = await lane("stats", () => getStats(corner));
  const score = await lane("index", () => getScoreFor(corner, env));
  const imagery = await lane("imagery", () => imageryFor(corner, env, ctx));
  if (imagery && imagery.status !== "ready" && imagery.status !== "pending") {
    notes.push(`imagery: ${imagery.status}`);
  }
  await lane("timeline", () => getTimelineFor(corner, env));
  const news = (await lane("press", () => getNews(corner, env))) || { source: "empty", items: [] };
  const hazards = await lane("audit", () => getHazardsFor(corner, env, origin));
  // A corner with no committed scrape has no baked voices asset, which is the
  // normal case for anything the cron audits. That is an empty lane, not a
  // failure, and it must not be reported as one.
  const voices = (await lane("voices", () => getVoices(corner, env, origin))) || emptyVoices();

  await lane("cred", async () => {
    const fresh = credCheck({ stats, news, voices, hazards });
    await putCredCached(env, corner.slug, fresh);
    return fresh;
  });

  await lane("letter", async () => {
    const timeline = await getTimeline(env, corner.slug, TIMELINE_VERSION).catch(() => null);
    return getLetter(corner, env, { stats, news, voices, score, hazards, timeline });
  });

  // Stamped on the corner itself so its page can say so without consulting the
  // log. This is the whole story in one line: nobody was here when this ran.
  await putCorner(env, { ...corner, cotd: today });
  await lane("manifest", () => runManifest(corner, env, origin, "cron", true));

  // The leaderboard is the front door, so a corner audited overnight has to be
  // on it by morning or the streak is invisible.
  await lane("leaderboard", async () => {
    const list = await getHinList(env);
    const row = {
      slug: corner.slug,
      name: corner.name,
      lat: corner.lat,
      lon: corner.lon,
      district: stats?.district ?? corner.district ?? null,
      index: score?.index ?? 0,
      grade: score?.grade ?? "A",
      counts: score?.counts ?? {},
      points: score?.points ?? 0,
      collisions: stats?.crashes ?? 0,
      fatal: stats?.fatal ?? 0,
      cotd: today,
    };
    const merged = [...list.filter((c) => c.slug !== corner.slug), row].sort(
      (a, b) => b.index - a.index || (b.points || 0) - (a.points || 0),
    );
    await putHinList(env, merged);
  });

  // Generation runs in the background, so the status captured at the start of
  // the run is almost always "pending". By now the slower lanes have taken long
  // enough that it has usually settled: report where it actually landed.
  // Commission tomorrow's resident voices for this corner. Two actor runs,
  // started and not awaited, against a hard monthly ceiling. The next cycle
  // reads them.
  const commissioned = await lane("voices commission", () => commissionVoices(env, corner));

  // The press, connected. findSimilar on this corner's best story, every
  // crossing named in the related coverage put through the same verification
  // the watchlist uses, and the surviving link written to BOTH corners so the
  // claim reads the same from either page.
  const connected = await lane("press connections", async () => {
    const seed = (news.items || []).find((x) => !x.official) || null;
    if (!seed) return { source: "empty", reason: "no press seed at this corner" };
    const conn = await buildConnections(env, corner, seed);
    if (conn.source !== "live") return conn;
    await putConnections(env, corner.slug, conn);
    const self = { slug: corner.slug, name: corner.short || corner.name, grade: score?.grade ?? null, index: score?.index ?? null };
    for (const link of conn.links) {
      const existing = await getConnections(env, link.slug).catch(() => null);
      // Never overwrite a corner's own findSimilar record with a reciprocal
      // one: the corner that ran the search owns its page's version.
      if (existing && !existing.reciprocal) continue;
      await putConnections(env, link.slug, reciprocal(self, link));
    }
    return conn;
  });

  // The citywide watchlist used to run here, as the last lane of this
  // invocation, and it is the one thing this function no longer does. It is not
  // about today's corner, it never was, and sharing an invocation with the
  // audit meant sharing the audit's spent subrequest budget: 29 searches
  // arriving with about seven of the fifty left. It has its own cron now, and
  // therefore its own budget. See watchlistRun below.

  const settled = await getImageryStatus(env, corner.slug).catch(() => null);

  // Move this corner between the city's tier rosters. The homepage counter
  // promises one more audited corner every morning, so the roster it counts
  // has to gain one every morning; without this the number would sit still
  // while the cron worked its way through the queue underneath it. Audited
  // means both generated states exist as bytes, exactly as the builder counts
  // them, so a run that could not spend on imagery lands in enriched instead
  // of claiming an audit that did not happen.
  await lane("city roster", async () => {
    const meta = await getCityMeta(env);
    if (!meta) return null;
    const audited = new Set(meta.audited || []);
    const enriched = new Set(meta.enriched || []);
    const states = settled?.states || [];
    if (states.includes("hazards") && states.includes("fix")) {
      audited.add(corner.slug);
      enriched.delete(corner.slug);
    } else if (!audited.has(corner.slug)) {
      enriched.add(corner.slug);
    }
    const next = {
      ...meta,
      audited: [...audited].sort(),
      enriched: [...enriched].sort(),
      totalAudited: audited.size,
      totalEnriched: enriched.size,
    };
    await putCityMeta(env, next);
    return { audited: audited.size, enriched: enriched.size };
  });

  const entry = {
    date: today,
    slug: corner.slug,
    name: corner.name,
    grade: score?.grade ?? null,
    index: score?.index ?? null,
    imagery: settled?.status ?? imagery?.status ?? "unavailable",
    // What this run commissioned and what the last one produced, so the record
    // of an unattended morning includes the money it spent on the reader's
    // behalf and the work it queued for tomorrow.
    voices: {
      commissioned: commissioned?.ok ? commissioned.runs.length : 0,
      ...(commissioned?.failed?.length ? { failed: commissioned.failed.map((f) => `${f.actor}: ${f.reason}`) } : {}),
      ingested: (ingest?.ingested || []).map((i) => ({ slug: i.slug, kept: i.kept, usd: Math.round((i.costUsd || 0) * 10000) / 10000 })),
      pending: (ingest?.stillPending || []).length,
    },
    // Connections only. This run no longer builds the watchlist, so it does not
    // report on one: reading the stored record here would put another run's
    // numbers in this run's log entry, which is the quieter version of the
    // problem this whole change is about.
    press: {
      connections: connected?.links?.length ?? 0,
    },
    status: notes.length ? "partial" : "ok",
    ...(notes.length ? { reason: notes.join("; ") } : {}),
    ...(skipped.length ? { skipped } : {}),
  };
  await appendCotdLog(env, entry);
  return { ok: true, ...entry };
}

// The cron expressions this Worker dispatches on, named once.
//
// These strings have to match wrangler.jsonc exactly. A schedule changed in the
// config but not here does not fail: the firing falls through to the last
// branch and quietly runs the press batch instead of the job it was scheduled
// for, forever, with nothing red anywhere. tools/cron.test.mjs reads the config
// and asserts the two agree, which is the only way that mistake gets caught.
// Coverage discs, memoised for the life of the isolate.
//
// Keyed on the roster and the recount timestamp, so a corner promoted overnight
// produces a new key and a fresh build rather than a stale layer. Deliberately
// an isolate memo and not a KV record: this is derived data, it costs a handful
// of shard reads to rebuild, and writing it would be a third place for the
// audited count to disagree with itself.
let COVERAGE_MEMO = null;

async function coverageCached(env, meta, tiers, rows) {
  const key = `${(meta?.audited || []).join(",")}|${tiers?.at || ""}`;
  if (COVERAGE_MEMO && COVERAGE_MEMO.key === key) return COVERAGE_MEMO.value;
  const value = await coverageDiscs(env, meta, tiers, rows).catch(() => []);
  COVERAGE_MEMO = { key, value };
  return value;
}

export const CRON_MORNING = "10 13 * * *";
export const CRON_WATCHLIST = "20 13 * * *";
export const CRON_PRESS_TICK = "*/15 * * * *";

// ------------------------------------------------------- the watchlist run
//
// Its own invocation, and that is the entire point.
//
// This lane used to run last inside the daily audit, which by then had spent
// most of its fifty external subrequests on DataSF, Exa press, Apify, imagery
// and findSimilar. Twenty-nine searches arrived with about seven of the budget
// left, so seven ran and twenty-two returned "Too many subrequests by single
// Worker invocation" without ever reaching Exa. The number on the page said 29
// either way.
//
// A separate cron trigger is a separate invocation and a fresh fifty. The lane
// costs one external fetch per query and nothing else external, so 29 fits with
// twenty-one unspent. The KV reads it makes come out of a different allowance
// of a thousand and are not part of this arithmetic.
//
// Called by the 13:20 UTC cron and by the operator-triggered endpoint below.
export async function watchlistRun(env) {
  const started = new Date().toISOString();
  const meta = await getCityMeta(env).catch(() => null);
  // Corners already audited are leads we have already followed, so they are
  // excluded from the watchlist exactly as they were when this ran inside the
  // audit. The one difference: the audit's own corner for the day is not
  // excluded any more, because this no longer knows which corner that was and
  // guessing would be worse than including it.
  const skip = new Set(meta?.audited || []);

  try {
    const w = await buildWatchlist(env, { skip });
    if (w.source === "unavailable") {
      await putWatchlistRun(env, { at: started, ok: false, reason: w.reason });
      return { ok: false, reason: w.reason };
    }
    await putWatchlist(env, w);
    const counts = runCounts(w);
    const record = {
      at: started,
      ok: counts.failed === 0,
      attempted: counts.attempted,
      completed: counts.completed,
      failed: counts.failed,
      entries: w.entries.length,
      rejected: w.rejected,
      cycle: w.cycle,
      ...(counts.commonReason ? { reason: counts.commonReason } : {}),
    };
    await putWatchlistRun(env, record);
    // A run that did not complete every search it attempted is the exact
    // failure this move was made to end, so it is logged loudly rather than
    // left to be inferred from the page.
    if (counts.failed) {
      console.log(
        `watchlist run incomplete: ${counts.completed} of ${counts.attempted} completed, ${counts.failed} cut off`,
      );
    }
    return { ok: true, ...record };
  } catch (e) {
    const reason = String(e?.message || e).slice(0, 200);
    await putWatchlistRun(env, { at: started, ok: false, reason }).catch(() => {});
    console.log(`watchlist run failed: ${reason}`);
    return { ok: false, reason };
  }
}

export default {
  // The cron. Everything it does happens inside waitUntil so a slow lane cannot
  // be cut off when the handler returns.
  async scheduled(event, env, ctx) {
    const origin = "https://streetcred.thealexschroeder.workers.dev";
    // Three schedules, three jobs, and the split between the first two is the
    // whole reason this Worker has three. Each cron firing is its own
    // invocation with its own subrequest budget; two jobs sharing one firing
    // share one budget, and the second one gets whatever the first left.
    //
    // 13:10 UTC, the morning run: the audit, then the monitors if they do not
    // exist, then a full press batch. This is the claim the site makes about
    // itself and it runs alone.
    if (event.cron === CRON_MORNING) {
      ctx.waitUntil(
        cornerOfTheDay(env, ctx, origin)
          .then(() => ensureMonitors(env).catch(() => null))
          .then(() => pressBatch(env, PRESS_BATCH_PER_NIGHT)),
      );
      return;
    }
    // 13:20 UTC, ten minutes later: the citywide watchlist, alone, on a fresh
    // budget. Ten minutes is not synchronisation and is not relied on as any;
    // the two invocations are independent whatever order they finish in. It is
    // spaced only so the log reads in the order the work happened.
    if (event.cron === CRON_WATCHLIST) {
      ctx.waitUntil(watchlistRun(env).catch(() => null));
      return;
    }
    // Every quarter hour: the press batch presses on, in ticks small enough to
    // fit a single invocation's budget.
    ctx.waitUntil(pressBatch(env, PRESS_BATCH_PER_TICK).catch(() => null));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = url.origin;
    const p = url.pathname;

    try {
      // Resolve runs before the corner lookup, since it is what creates corners.
      if (p === "/api/resolve") {
        return await handleResolve(url, request, env);
      }

      // Imagery generated at runtime lives in KV, not in the repo. The edge
      // cache sits in front so a corner's bytes are read from KV once per colo.
      if (p.startsWith("/gen/")) {
        return await generatedImage(p, env, ctx);
      }

      // The watchdog surface. Deliberately above the corner lookup: none of
      // these are corner-scoped, and routing them through it would resolve a
      // default corner they have no use for.
      if (p === "/api/agent/report") {
        const out = await handleAgentReport(request, env, {
          countReject: countAgentReject,
          appendJournal: (envRef, record) => appendJournal(envRef, record, JOURNAL_CAP),
          // An accepted agent rescore that disagrees with the published grade
          // is a grade-change event, and it goes in the same public changelog
          // as the pipeline's own, labeled by who claimed it.
          putAgentRescore: async (envRef, rec) => {
            await putAgentRescore(envRef, rec);
            const current = await getScoreRaw(envRef, rec.slug).catch(() => null);
            if (current && (current.grade !== rec.grade || current.index !== rec.index)) {
              await appendChange(envRef, {
                slug: rec.slug,
                old: { grade: current.grade, index: current.index },
                new: { grade: rec.grade, index: rec.index },
                reason: "watchdog agent rescore claim, published grade unchanged",
                source: "agent",
                date: rec.at,
              }).catch(() => {});
            }
          },
          putAgentLetter,
          putAgentFlag,
          cornerFor: (slug) => cornerBySlug(env, slug),
          statsFor: async (slug) => {
            const target = await cornerBySlug(env, slug);
            return target ? getStats(target) : null;
          },
          scoreFor: async (slug) => {
            const target = await cornerBySlug(env, slug);
            return target ? getScoreFor(target, env) : null;
          },
          timelineFor: (slug) => getTimeline(env, slug, TIMELINE_VERSION),
        });
        return json(out.body, out.status);
      }

      // The warmed fleet and its geometry, as JSON. The homepage has held this
      // list since the first day but only ever rendered it, so anything outside
      // the Worker had to scrape HTML to find out which corners exist. The
      // watchdog needs it to seed its baseline snapshots, and diffing against
      // an empty baseline would report every corner as brand new on day one.
      if (p === "/api/board") {
        const corners = await getHinList(env).catch(() => []);
        return json({
          source: "live",
          count: corners.length,
          corners: corners.map((x) => ({
            slug: x.slug,
            name: x.name,
            lat: x.lat,
            lon: x.lon,
            district: x.district ?? null,
            grade: x.grade ?? null,
            index: x.index ?? null,
            radiusMeters: x.radiusMeters ?? 150,
          })),
        });
      }

      // The leaderboard at city scale. The order was computed once when the
      // city was built, so a page of it is one KV read: sorting 7,000 rows
      // inside the Worker would mean reading every shard on every page.
      if (p === "/api/city") {
        const meta = await getCityMeta(env);
        if (!meta) return json({ source: "empty", reason: "the city has not been built yet" });
        const size = 50;
        const pages = Math.max(1, Math.ceil(meta.totalScored / size));
        const page = Math.min(Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1), pages);
        const offset = (page - 1) * size;
        // 50 divides the 100-row KV page exactly, so a leaderboard page never
        // spans two reads. If RANK_PAGE_SIZE ever stops being a multiple of
        // this, the second half of the city would silently go missing.
        const kvPage = Math.floor(offset / RANK_PAGE_SIZE);
        const stored = await getRankPage(env, kvPage);
        const rows = (stored?.rows || []).slice(offset % RANK_PAGE_SIZE, (offset % RANK_PAGE_SIZE) + size);
        return json({
          source: "live",
          page,
          pages,
          size,
          total: meta.totalScored,
          sweepDate: meta.sweepDate,
          rows: tagTiers(rows, meta),
        });
      }

      // The nearest real crossing to a tapped point. One keyless SoQL query
      // against the city's own intersection table, 120m ceiling. This is the
      // read half of tap-anywhere; it never resolves, never warms, never
      // spends. Navigation happens only when the person taps the popup's link,
      // which goes through the same resolver guards as typing the name.
      if (p === "/api/nearest") {
        const lat = parseFloat(url.searchParams.get("lat"));
        const lon = parseFloat(url.searchParams.get("lon"));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          return json({ ok: false, error: "lat and lon required" }, 400);
        }
        const legs = await soql("gmfx-8h6i", {
          "$select": "cnn,st_name,the_geom",
          "$where": `within_circle(the_geom, ${lat}, ${lon}, 120)`,
          "$limit": "80",
        }).catch(() => []);
        const byCnn = new Map();
        for (const r of legs) {
          if (!r.cnn) continue;
          let e = byCnn.get(r.cnn);
          if (!e) byCnn.set(r.cnn, (e = { names: new Set(), lat: null, lon: null }));
          if (r.st_name) e.names.add(r.st_name);
          if (e.lat === null && r.the_geom?.coordinates?.length === 2) {
            e.lon = Number(r.the_geom.coordinates[0]);
            e.lat = Number(r.the_geom.coordinates[1]);
          }
        }
        // Nearest cnn carrying at least two street names: one name is a dead
        // end or a rename, not a crossing anyone can stand on.
        const mLat = 111320, mLon = 111320 * Math.cos((lat * Math.PI) / 180);
        let best = null;
        for (const e of byCnn.values()) {
          if (e.names.size < 2 || e.lat === null) continue;
          const d = Math.hypot((e.lat - lat) * mLat, (e.lon - lon) * mLon);
          if (!best || d < best.d) best = { ...e, d };
        }
        if (!best) return json({ ok: false, reason: "no crossing within 120m" });
        const names = [...best.names].slice(0, 2);
        const q = `${names[0]} and ${names[1]}`;
        const parsed = parseQuery(q);
        return json({
          ok: true,
          name: parsed.ok ? parsed.name : q,
          slug: parsed.ok ? canonicalSlug(parsed.slug) : null,
          query: q,
          lat: best.lat,
          lon: best.lon,
          distanceM: Math.round(best.d),
        });
      }

      // Public, unauthenticated, and the reason the diary's numbers are worth
      // anything: every figure on /watchdog can be recounted from this.
      if (p === "/api/agent/journal") {
        const journal = await getJournal(env).catch(() => []);
        return json({
          source: "live",
          stats: journalStats(journal),
          rejected: await getAgentRejects(env).catch(() => 0),
          entries: journal,
        });
      }

      // The citywide count the masthead prints on every page. One live source,
      // read here rather than written down once per template.
      const mastScored = async () => (await getCityMeta(env).catch(() => null))?.totalScored ?? 0;

      // The Press Watchlist. Read only: the pass that builds it runs on the
      // cron, because a couple of dozen semantic searches is not something a
      // page load should start.
      if (p === "/watchlist" || p === "/watchlist/" || p === "/api/watchlist") {
        const [w, hub, lastRun] = await Promise.all([
          getWatchlist(env, WATCHLIST_VERSION).catch(() => null),
          env.STORE?.get("press:hub", "json").catch(() => null) ?? null,
          getWatchlistRun(env).catch(() => null),
        ]);
        if (p === "/api/watchlist") {
          // The run record rides along on the API too, so anything checking
          // this lane can ask whether the last pass finished without scraping
          // the page for it.
          return json(w ? { ...w, lastRun } : { source: "empty", reason: "the watchlist has not been built yet", lastRun });
        }
        const pressRollup = await getPressRollup(env).catch(() => null);
        return new Response(WATCHLIST_PAGE(w, origin, hub, Boolean(env.PREVIEW), await mastScored(), pressRollup, lastRun), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      // What the press connects this corner to. One KV read, no external call,
      // so it costs a scored corner nothing to answer.
      if (p === "/api/connections") {
        const slug = canonicalSlug(url.searchParams.get("x") || "");
        if (!slug) return json({ source: "empty", links: [] });
        const rec = await getConnections(env, slug).catch(() => null);
        return json(rec || { source: "empty", slug, links: [] });
      }

      if (p === "/radar" || p === "/radar/" || p === "/api/radar") {
        const [feed, monitors, budget, burn] = await Promise.all([
          getRadarFeed(env).catch(() => []),
          getMonitors(env).catch(() => null),
          radarBudget(env).catch(() => null),
          getBurnCheckpoint(env).catch(() => null),
        ]);
        // The burn's hit rate is shown beside the radar's, labelled as the
        // separate question it is: the worst corners in the city against this
        // week's news is not one population.
        // Self healing, once. The operator installing a webhook secret is the
        // signal of intent; nothing else is needed and nobody has to hold the
        // secret a second time to make the radar exist. Idempotent and locked,
        // so a busy minute cannot create the set twice.
        if (!monitors?.list?.length && env.WEBHOOK_SECRET) {
          ctx.waitUntil(ensureMonitors(env).catch(() => null));
        }
        const burnChecked = burn?.done || 0;
        const radar = {
          feed, monitors, budget, burnChecked,
          // A boolean, never the value. Whether the Worker can see the secret
          // is the difference between "the radar is broken" and "the radar is
          // waiting", and that is worth being able to ask from outside.
          hasWebhookSecret: Boolean(env.WEBHOOK_SECRET),
          // Booleans only, never values. Which secrets the runtime can see
          // separates "wrangler did not attach it" from "this code is looking
          // in the wrong place", and guessing between those cost four deploys.
          secretsVisible: Object.fromEntries(
            ["EXA_API_KEY", "APIFY_TOKEN", "GEMINI_API_KEY", "GOOGLE_MAPS_API_KEY", "WATCHDOG_INGEST_TOKEN", "WEBHOOK_SECRET"]
              .map((k) => [k, Boolean(env[k])]),
          ),
          envKeyCount: Object.keys(env || {}).length,
          // A length, never a value. An empty secret is bound, listed by
          // wrangler, and reported as a successful upload, so "missing" and
          // "present but empty" look identical from every angle except this
          // one. Diagnosing that as a deployment-versions problem cost six
          // deploys and a confident wrong answer.
          webhookSecretLength: String(env.WEBHOOK_SECRET || "").length,
          setup: await env.STORE?.get("radar:setup", "json").catch(() => null),
          burnHitRate: burnChecked ? Math.round((burn.withCoverage / burnChecked) * 1000) / 10 : null,
        };
        if (p === "/api/radar") return json(radar);
        return new Response(RADAR_PAGE(radar, origin, Boolean(env.PREVIEW), await mastScored()), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (p === "/methodology" || p === "/methodology/") {
        // The watchlist record rides along so the search counts on this page
        // are the stored completion record rather than a number typed once.
        const wlRec = await getWatchlist(env, WATCHLIST_VERSION).catch(() => null);
        return new Response(METHODOLOGY(origin, Boolean(env.PREVIEW), await mastScored(), wlRec), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      // The public record of every stored grade or index change, newest first.
      if (p === "/changes" || p === "/api/changes") {
        const changes = (await getChanges(env).catch(() => [])).slice(0, 50);
        if (p === "/api/changes") return json({ source: "live", changes });
        return new Response(CHANGES(changes, origin, Boolean(env.PREVIEW), await mastScored()), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (p === "/status" || p === "/status/") {
        const [synthRaw, incidents, changes, exa, apify, costs, invoice] = await Promise.all([
          env.STORE?.get("synth:log").catch(() => null),
          getTrustIncidents(env).catch(() => []),
          getChanges(env).catch(() => []),
          exaBudget(env).catch(() => null),
          actorRunBudget(env).catch(() => null),
          getActorCosts(env).catch(() => []),
          env.STORE?.get("apify:invoice", "json").catch(() => null) ?? null,
        ]);
        let synth = [];
        try { synth = synthRaw ? JSON.parse(synthRaw) : []; } catch { synth = []; }
        const spend = exa && apify
          ? { exa, apify, costs, invoice, apifyUsd: costs.reduce((n, c) => n + (Number(c.costUsd) || 0), 0) }
          : null;
        // A run counts as live only while it is still reporting progress. A
        // checkpoint with no stop reason is not evidence of a running process:
        // a killed run leaves exactly that behind forever.
        const burn = await getBurnCheckpoint(env).catch(() => null);
        const scan = burn
          ? {
              ...burn,
              live: !burn.stopReason && Date.now() - Date.parse(burn.updatedAt || 0) < 30 * 60 * 1000,
            }
          : null;
        return new Response(STATUS(synth, incidents, changes, origin, spend, Boolean(env.PREVIEW), await mastScored(), scan, await getWatchlist(env, WATCHLIST_VERSION).catch(() => null), await env.STORE?.get("budget:gemini", "json").catch(() => null)), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      // Deliberately above the corner lookup, for the same reason /watchlist
      // and /watchdog are: `corner(url, env)` resolves any unclaimed path as a
      // corner slug, so a surface routed after it is answered with NOT_FOUND
      // for a corner named "audited" that does not exist.
      if (p === "/audited" || p === "/audited/") {
        const rows = await auditedIndex(env);
        return new Response(AUDITED_PAGE(rows, origin, Boolean(env.PREVIEW), await mastScored()), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (p === "/watchdog" || p === "/watchdog/") {
        const [journal, rejects] = await Promise.all([
          getJournal(env).catch(() => []),
          getAgentRejects(env).catch(() => 0),
        ]);
        return new Response(WATCHDOG(journal, rejects, origin, Boolean(env.PREVIEW), await mastScored()), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      const c = await corner(url, env);

      // Asked for a specific corner and got something else back means the corner
      // does not exist. Say so rather than quietly answering about another one.
      const asked = requestedSlug(url);
      if (asked && canonicalSlug(asked) !== c.slug) {
        if (p.startsWith("/api/")) {
          return json({ source: "empty", error: "corner not found", slug: canonicalSlug(asked) }, 404);
        }
        return new Response(NOT_FOUND(canonicalSlug(asked), origin), {
          status: 404,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (p === "/og.jpg") {
        return await shareCard(c, env, ctx, origin);
      }

      if (p === "/map.jpg") {
        return await mapImage(c, env, ctx);
      }

      if (p === "/citymap.jpg") {
        return await cityMap(env, ctx);
      }

      if (p === "/" || p === "/index.html") {
        // An ?x= link predates /c/ and still exists in the wild. Send it to the
        // canonical corner rather than silently showing the city instead.
        const legacy = url.searchParams.get("x");
        if (legacy) {
          return Response.redirect(`${origin}/c/${canonicalSlug(legacy)}`, 301);
        }
        const [corners, cotdLog, suggestion, meta, rank0, queue, watchlist, voicesSummary, pressSummary, pressRoll, pressCites, auditTiers, actorCosts] = await Promise.all([
          getHinList(env),
          getCotdLog(env).catch(() => []),
          // Read only. The homepage must never wait on a findSimilar call, so
          // a suggestion that has not been built yet simply does not render.
          getSuggestion(env, SUGGEST_VERSION).catch(() => null),
          getCityMeta(env).catch(() => null),
          // The first page of the citywide order, so the board's top rows are
          // in the HTML rather than arriving after a round trip.
          getRankPage(env, 0).catch(() => null),
          getQueue(env).catch(() => null),
          getWatchlist(env, WATCHLIST_VERSION).catch(() => null),
          getVoicesSummary(env).catch(() => null),
          env.STORE?.get("press:summary", "json").catch(() => null) ?? null,
          getPressRollup(env).catch(() => null),
          getPressCitations(env).catch(() => null),
          getAuditTiers(env).catch(() => null),
          getActorCosts(env).catch(() => []),
        ]);
        // The audited coverage layer, built once per isolate rather than per
        // request. The roster changes at most once a morning, so the signature
        // below is stable for the life of an isolate and the shard reads behind
        // it happen on the first homepage load and never again.
        const coverage = await coverageCached(env, meta, auditTiers, corners);

        const city = meta
          ? {
              meta,
              top: tagTiers((rank0?.rows || []).slice(0, 25), meta),
              queueLength: Array.isArray(queue) ? queue.length : 0,
            }
          : null;
        // The spend the band shows is the provider's own figure when one has
        // been reconciled, and our ledger only as a fallback. They disagreed
        // once and the invoice is what settles.
        // The corner of the day, assembled for the hero. Every field comes from
        // KV that the audit pipeline already wrote: no provider call happens
        // here, and the frames are stored bytes served by /gen.
        const embed = await (async () => {
          const log = [...(cotdLog || [])].filter((e) => e && e.slug);
          if (!log.length) return null;
          const newest = log[log.length - 1];

          // The hero features the newest corner that actually has both frames,
          // not simply the newest corner. The embed's whole point is the drag
          // slider, and a slider needs two panes: featuring a corner whose
          // imagery lane has not returned puts a pending card where the product
          // demonstration should be. Bounded walk backwards, because the log is
          // long and this runs on every homepage load.
          const WALK = 20;
          let featured = null;
          let fimg = null;
          for (let i = log.length - 1; i >= 0 && i >= log.length - WALK; i -= 1) {
            const img = await getImageryStatus(env, log[i].slug).catch(() => null);
            const st = img?.states || [];
            if (st.includes("hazards") && st.includes("fix")) {
              featured = log[i];
              fimg = img;
              break;
            }
          }
          // Nothing in living memory has both frames. Fall back to the newest
          // rather than showing nothing: a text-only hero is worse than a
          // slider and better than a hole.
          if (!featured) {
            featured = newest;
            fimg = await getImageryStatus(env, newest.slug).catch(() => null);
          }

          const [ec, escore, ecred] = await Promise.all([
            cornerBySlug(env, featured.slug).catch(() => null),
            getScore(env, featured.slug, SCORE_VERSION).catch(() => null),
            getCredCached(env, featured.slug, CRED_VERSION).catch(() => null),
          ]);
          const states = fimg?.states || [];
          const base = `/gen/${featured.slug}`;
          // A frame is only offered if it is actually stored. The embed never
          // borrows another corner's imagery and never re-shows yesterday's.
          const frames = {
            today: fimg && fimg.status !== "nocoverage" ? `${base}/today.jpg` : null,
            hazards: states.includes("hazards") ? `${base}/hazards.jpg` : null,
            fix: states.includes("fix") ? `${base}/fix.jpg` : null,
          };
          // Where the featured corner's render came from, so the hero can say
          // so under the image. Resolved from the stored record rather than
          // inferred from the roster: absent means the record predates the
          // field and the hero says nothing at all.
          const featuredProvenance = provenanceOf(fimg);
          const hasGenerated = Boolean(frames.hazards || frames.fix);

          // The daily cadence is carried by the subtitle, which says one is
          // attempted every morning, and by the ticker chips, which link every
          // audited corner including today's. A third statement of it inside
          // the hero card read as a stranded row under the buttons, so it is
          // not made here. The featured corner still states its own date.
          const today = pacificDay();

          return {
            slug: featured.slug,
            name: ec?.name || featured.name || featured.slug,
            date: featured.date,
            provenance: featuredProvenance,
            // "This morning" is only true if this audit ran this morning in
            // Pacific, which is the timezone the claim is about. An older
            // featured corner states its real date and drops the claim rather
            // than softening it.
            auditedToday: featured.date === today,
            partial: featured.status === "partial",
            grade: escore?.grade || featured.grade || null,
            evidence: evidenceLine(ecred, ec?.district),
            frames,
            state: hasGenerated ? "full" : frames.today ? "text-only" : "none",
          };
        })();

        const invoice = await (env.STORE?.get("apify:invoice", "json").catch(() => null) ?? null);
        const spendUsd = invoice?.cycleUsd ?? actorCosts.reduce((n2, c2) => n2 + (Number(c2.costUsd) || 0), 0);
        // Two sources, one figure, and the time it was true. The timeline
        // snapshot alone read the same all day while the batch lane was adding
        // citations by the hundred.
        // Counted from the stored records, not from a counter that only knows
        // what happened after it was added. Recounted in the background when
        // the cache ages out, so a page load never waits on a scan and never
        // shows a figure it cannot date.
        // Same pattern as the citation count: refreshed in the background when
        // it ages out, so a page load never waits on a scan of the roster and
        // never shows a split it cannot date.
        const tiersFresh =
          auditTiers && Date.now() - Date.parse(auditTiers.at || 0) < AUDIT_TIER_CACHE_S * 1000;
        if (!tiersFresh) ctx.waitUntil(recountAuditTiers(env, meta?.audited || []).catch(() => {}));
        const citesFresh =
          pressCites && Date.now() - Date.parse(pressCites.at || 0) < CITATION_CACHE_S * 1000;
        if (!citesFresh) ctx.waitUntil(recountPressCitations(env).catch(() => {}));
        const pressTile = {
          ...(pressSummary || {}),
          checkCitations: pressCites?.citations || 0,
          asOf: fmtAsOf(pressCites?.at || pressRoll?.updated || pressSummary?.at),
        };
        return new Response(HOME(corners, origin, cotdLog, suggestion, Boolean(env.PREVIEW), city, watchlist, voicesSummary, pressTile, spendUsd, embed, auditTiers, { discs: coverage, radiusM: coverageRadiusM(meta) }), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (/^\/c\/[A-Za-z0-9-]+\/?$/.test(p)) {
        const og = { ...(await ogFor(c, env)), origin, preview: Boolean(env.PREVIEW), scored: await mastScored() };
        // A corner nobody has opened has no cached verdict yet, so warm it in
        // the background. The response never waits on it.
        if (!og.cred) ctx.waitUntil(getCred(c, env, origin).catch(() => {}));
        return new Response(PAGE(c, og), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (p === "/api/stats") {
        // A scored corner answers from the shard row already in hand. No
        // Socrata query, no edge cache entry, no wait.
        if (isScored(c)) return json(cityStats(c));
        return await edgeCached(ctx, `stats-${c.slug}`, 3600, () =>
          cached(`stats:${c.slug}`, 3600e3, () => getStats(c).catch(() => sampleStats(c))),
        );
      }

      if (p === "/api/news") {
        // A stored press check answers first, on every tier. It is the record
        // of a search that really ran, it costs nothing to serve, and it is
        // what makes the batch lane visible to a reader. A deferred record is
        // not an answer: that corner was never checked.
        const stored = await getPress(env, c.slug, PRESS_VERSION).catch(() => null);
        if (stored && stored.source !== "budget-deferred" && stored.source !== "budget-paused") {
          return await edgeCached(ctx, `news-${c.slug}`, 600, async () => stored);
        }
        // Press coverage is an Exa search per corner. Running one for every
        // corner in the city on first view would spend the credit balance on
        // corners nobody asked about; the lane says it has not run instead.
        if (isScored(c)) return json(cityNews());
        return await edgeCached(ctx, `news-${c.slug}`, 600, () =>
          cached(`news:${c.slug}`, 600e3, () => getNews(c, env).catch(() => sampleNews(c))),
        );
      }

      if (p === "/api/cred") {
        // Records from the sweep, three lanes honestly not yet checked. Never
        // stored: cred:{slug} is the record of a real four lane check.
        if (isScored(c)) return json(cityCred(c));
        return await edgeCached(ctx, `cred-${c.slug}`, 3600, async () => {
          const hit = await getCredCached(env, c.slug, CRED_VERSION);
          return hit ? { ...hit, source: "cache" } : getCred(c, env, origin);
        });
      }

      if (p === "/api/hazards") {
        if (isScored(c)) return json(cityHazards());
        return await edgeCached(ctx, `hazards-${c.slug}`, 24 * 3600, () =>
          getHazardsFor(c, env, origin).catch(() => ({ source: "empty", items: [] })),
        );
      }

      if (p === "/api/suggest") {
        // Two callers share this path. With ?q= it is the typeahead: one KV
        // shard read, zero DataSF calls, ranked prefix-beats-contains. Without
        // it, the original related-corner suggestion for the homepage.
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        if (q) {
          const words = q.replace(/[&+/]/g, " and ").split(/\s+/).filter((w) => w && w !== "and" && w !== "at" && w !== "x");
          const first = words.find((w) => w.replace(/[^a-z0-9]/g, "").length >= 2);
          if (!first || q.length < 2) return json({ ok: true, items: [] });
          const shard = first.replace(/[^a-z0-9]/g, "").slice(0, 2);
          const raw = await env.STORE?.get(`suggest:idx:${shard}`);
          if (!raw) return json({ ok: true, items: [] });
          let list = [];
          try { list = JSON.parse(raw); } catch { list = []; }
          const scored = [];
          for (const [name, slug, grade, tier] of list) {
            const hay = name.toLowerCase();
            const parts = hay.split(/[^a-z0-9]+/).filter(Boolean);
            // Every typed word must match somewhere; a word that starts a
            // street name outranks one buried inside it.
            let ok = true, prefixHits = 0;
            for (const w of words) {
              if (parts.some((pw) => pw.startsWith(w))) prefixHits++;
              else if (!hay.includes(w)) { ok = false; break; }
            }
            if (!ok) continue;
            scored.push({ name, slug, grade, tier, rank: tier * 100 + prefixHits * 10 - name.length / 100 });
          }
          scored.sort((a, b) => b.rank - a.rank);
          return json({ ok: true, items: scored.slice(0, 8).map(({ rank, ...it }) => it) });
        }
        return json(await boardSuggestion(env).catch((e) => ({
          source: "empty",
          reason: String(e.message || e).slice(0, 120),
        })));
      }

      if (p === "/api/impact") {
        // Deterministic arithmetic over the curated CMF table and this
        // corner's own crash counts. Cached beside the score it derives from.
        return await edgeCached(ctx, `impact-${c.slug}`, 24 * 3600, async () => {
          const [score, tableRes] = await Promise.all([
            isScored(c) ? cityScore(c) : getScoreFor(c, env).catch(() => null),
            asset(env, origin, "/data/cmf.json").catch(() => null),
          ]);
          let table = null;
          try { table = tableRes && tableRes.ok ? await tableRes.json() : null; } catch { table = null; }
          if (!score?.counts || !table) {
            return { source: "empty", reason: "no counts or no factor table" };
          }
          return projectImpact(score.counts, table);
        });
      }

      if (p === "/api/timeline") {
        // A timeline is a dozen Exa searches. A scored corner must not be able
        // to start one by being opened, and must not consume a reservation
        // from the daily timeline budget to find that out.
        if (isScored(c)) return json(cityTimeline());
        return json(await getTimelineFor(c, env));
      }

      if (p === "/api/run") {
        // There is no run to replay: no pipeline has run at this corner. The
        // manifest builder would go and run one, lane by lane, to find that out.
        if (isScored(c)) return json(cityRun());
        const asked = url.searchParams.get("trigger");
        const trigger = PUBLIC_TRIGGERS.has(asked) ? asked : "user";
        return json(await runManifest(c, env, origin, trigger, url.searchParams.has("refresh")));
      }

      if (p === "/api/score") {
        // The grade a scored corner already carries, computed at build time by
        // the same formula and the same frozen census the live path uses.
        // Deliberately not written to score:{slug}: a stored score is what
        // makes a corner part of the warmed fleet.
        if (isScored(c)) return json(cityScore(c));
        return await edgeCached(ctx, `score-${c.slug}`, 3600, () => getScoreFor(c, env));
      }

      if (p === "/api/voices") {
        if (isScored(c)) return json(cityVoices());
        const v = await getVoices(c, env, origin).catch(emptyVoices);
        return json(v);
      }

      if (p === "/api/imagery") {
        // One path for every corner now. A warmed corner answers "ready" from
        // KV on the first ask and never polls; only a cold corner generates.
        return json(
          await imageryFor(c, env, ctx, {
            recordsEmpty: async () => {
              const s = await getStats(c).catch(() => null);
              return !s || (s.crashes === 0 && s.reports311 === 0);
            },
          }),
        );
      }

      if (p === "/api/letter") {
        // Offered, never drafted on sight. A draft is a billed model call and
        // one is not spent because a crawler opened a page.
        if (isScored(c)) return json(cityLetter(c));

        // The circuit breaker. While the model has no allowance left, every
        // request serves this corner's last verified letter and touches
        // nothing else: no model call, no retry gauntlet, no 17 second wait
        // to rediscover a fact the last request already established.
        const backoff =
          quotaBackoffUntil > Date.now()
            ? { at: new Date().toISOString(), until: new Date(quotaBackoffUntil).toISOString(), reason: "model quota, remembered in this isolate" }
            : await getLetterBackoff(env).catch(() => null);
        if (backoff) {
          const stored = await getVerifiedLetter(env, c.slug).catch(() => null);
          if (storedLetterServes(stored)) {
            return json({
              ...stored,
              source: "verified-cache",
              backoff,
              note: "Letter drafting is paused while the generator has no allowance left. This is the last draft that passed verification at this corner.",
            });
          }
          // No letter here has passed the current check, so there is nothing
          // true to serve. The sample used to fill this gap and that is the
          // hole this closes: one fixed paragraph asserting resident accounts,
          // press coverage and hundreds of collisions, at whichever corner
          // happened to ask.
          return json({
            ...pendingLetter(c, stored?.text ? ["it was verified under an earlier version of the letter check"] : []),
            backoff,
          });
        }
        // A stored letter is served before anything is drafted.
        //
        // This used to sit only inside the backoff branch above, so a corner
        // with a perfectly good verified letter served it only while a backoff
        // record happened to exist. That record has a TTL. When it expired the
        // request fell through to drafting, drafting failed, and the catch
        // below returned the pending state for a corner whose letter was
        // sitting in KV the whole time. Corners went dark one at a time as
        // their edge caches expired, which is why it looked per-corner.
        //
        // Drafting is the fallback, not the default. The letter lane's own
        // claim is that it serves what passed the check; going to the model
        // first and only remembering the stored answer on one particular
        // failure path had that backwards.
        const alreadyVerified = await getVerifiedLetter(env, c.slug).catch(() => null);
        if (storedLetterServes(alreadyVerified)) {
          return json({ ...alreadyVerified, source: "verified-cache" });
        }

        // The slowest lane by far, and the one worth caching hardest: a fresh
        // draft costs several seconds of Gemini time.
        return await edgeCached(ctx, `letter-${LETTER_VERSION}-${c.slug}`, 24 * 3600, () =>
          cached(`letter:${LETTER_VERSION}:${c.slug}`, 24 * 3600e3, async () => {
            const [stats, news, voices, score, hazards, timeline] = await Promise.all([
              getStats(c).catch(() => sampleStats(c)),
              getNews(c, env).catch(() => sampleNews(c)),
              getVoices(c, env, origin).catch(emptyVoices),
              getScoreFor(c, env).catch(() => null),
              getHazardsFor(c, env, origin).catch(() => null),
              // Read only, never built here. Drafting a letter must not be able
              // to trigger a dozen Exa searches as a side effect.
              getTimeline(env, c.slug, TIMELINE_VERSION).catch(() => null),
            ]);
            return getLetter(c, env, { stats, news, voices, score, hazards, timeline }).catch(async (e) => {
              // A spent allowance is a fact about the whole site, not about
              // this corner, so it is recorded once and every other request
              // for the next hour reads it instead of rediscovering it.
              if (e?.quota) {
                quotaBackoffUntil = Date.now() + 3600 * 1000;
                await setLetterBackoff(env, e.message).catch(() => {});
                const stored = await getVerifiedLetter(env, c.slug).catch(() => null);
                if (storedLetterServes(stored)) {
                  return {
                    ...stored,
                    source: "verified-cache",
                    note: "Letter drafting is paused while the generator has no allowance left. This is the last draft that passed verification at this corner.",
                  };
                }
              }
              // A letter quietly becoming a sample is the failure a reader is
              // least likely to notice and most likely to be misled by, so it
              // leaves a trace with the reason attached rather than vanishing.
              // It no longer becomes a sample: the sample asserts three lanes
              // it cannot possibly have checked, so the honest pending state is
              // what a corner with no verified letter gets.
              console.log(`letter went pending at ${c.slug}: ${String(e?.message || e)}`);
              return pendingLetter(c);
            },
            );
          }),
        );
      }

      if (p.startsWith("/api/radar/hook/")) {
        return await radarHook(request, env, url);
      }

      // Run the watchlist now, on this invocation's own budget.
      //
      // Two reasons this exists: the operator should be able to rebuild the
      // watchlist without waiting for tomorrow's cron, and a run reachable over
      // HTTP is how "it completes all of them in its own invocation" gets
      // verified against the live site rather than asserted. An HTTP invocation
      // has the same fifty external subrequests a cron firing does, so it is
      // the same test.
      //
      // Its own token, deliberately, rather than WEBHOOK_SECRET. That secret is
      // shared with an external service that posts detections to
      // /api/radar/hook, so it travels outside this system; this endpoint
      // SPENDS, one Exa search per query attempted. Authorising money on a
      // credential that was handed to a third party for a different purpose is
      // the kind of shortcut that reads fine until it does not. Revoke or
      // rotate this one on its own with `wrangler secret put
      // WATCHLIST_RUN_TOKEN`, and nothing about the radar changes.
      //
      // NOT idempotent. It spends against the same cent counter and the same
      // cap as every other lane, and it refuses at the cap exactly as they do.
      if (p.startsWith("/api/watchlist/run/")) {
        const token = p.split("/").pop();
        if (!env.WATCHLIST_RUN_TOKEN || token !== env.WATCHLIST_RUN_TOKEN) {
          return json({ error: "not found" }, 404);
        }
        return json(await watchlistRun(env));
      }

      // Same secret, same shape as the webhook: whoever can be told a
      // detection can also ask for the monitors to exist. It is idempotent,
      // so calling it twice is not a way to spend twice.
      if (p.startsWith("/api/radar/setup/")) {
        const secret = p.split("/").pop();
        if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) return json({ error: "not found" }, 404);
        return json(await ensureMonitors(env));
      }

      if (p === "/api/health") {
        return json(await health(env, origin, { probeExa: url.searchParams.get("probe") === "exa" }));
      }

      return new Response("not found", { status: 404 });
    } catch (e) {
      // The browser gets a generic string and nothing else. This block used to
      // return String(e.message), which meant an upstream response body could be
      // echoed to a client verbatim: the comment claimed one thing and the code
      // did the reverse. Detail goes to the Worker log, where operators can read
      // it and visitors cannot.
      console.log(`unhandled at ${p}: ${String(e?.stack || e?.message || e)}`);
      if (p.startsWith("/api/")) return json({ source: "error", error: "internal error" }, 500);
      return new Response("not found", { status: 404 });
    }
  },
};
