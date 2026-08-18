// The whole graded city, read from KV shards.
//
// 7,353 corners cannot each be a KV record: publishing the city would be 7,353
// writes and correcting it 7,353 more. They are bundled instead, keyed by the
// first character of the slug, so a corner page is one read and the city
// republishes in one bulk operation. tools/build_city_shards.mjs writes them.
//
// Nothing in this file computes a grade. The index and grade were computed at
// build time by the same percentileOf and gradeFor the live path calls, against
// the same frozen census in src/distribution.js. A second implementation would
// eventually disagree with the first, and the page would show no sign of it.

import { makeCorner, SERVICE_NAMES } from "./data.js";
import { soqlUrl } from "./resolve.js";
import { scoreQueries, SCORE_CAVEAT, SCORE_VERSION, SCORE_RADIUS } from "./score.js";

const DS_CRASHES = "ubvf-ztfx";
const DS_311 = "vw6y-z8j6";

// Bump when the shard row shape changes, so a Worker deployed against the old
// shape never reads the new one half-understood.
export const CITY_VERSION = "v1";

// Rows per leaderboard page in KV. The list shows 50 at a time, so a page of
// 100 serves two clicks of "show more" from one read.
export const RANK_PAGE_SIZE = 100;

// ---------------------------------------------------------------- tiers

// Three tiers, one vocabulary, used on the page, in the API, in the map legend
// and on /methodology. The difference between them is how many evidence lanes
// have been checked at a corner, never how the grade was computed.
export const TIERS = { AUDITED: "audited", ENRICHED: "enriched", SCORED: "scored" };

export const TIER_LABEL = {
  audited: "AUDITED",
  enriched: "ENRICHED",
  scored: "SCORED",
};

export const TIER_NOTE = {
  audited: "every evidence lane has been checked at this corner",
  enriched: "records and index checked, no visual audit yet",
  scored: "graded against the citywide census, lanes not yet checked",
};

// The 100 corners published before this vocabulary existed carry tier "score"
// in KV. Renaming them would be 100 writes to change a string no reader sees,
// so the legacy value is mapped here, in the one place that reads it.
const LEGACY_ENRICHED = "score";

export function tierOf(corner, imageryStatus) {
  if (!corner) return TIERS.SCORED;
  if (corner.tier === TIERS.SCORED) return TIERS.SCORED;
  const states = imageryStatus?.states || [];
  if (states.includes("hazards") && states.includes("fix")) return TIERS.AUDITED;
  if (corner.tier === LEGACY_ENRICHED || corner.derived === false) return TIERS.ENRICHED;
  // A corner with a stored record and no imagery status is one the fleet
  // warmed before the status key existed. Its imagery is what decides, and the
  // imagery lane reports that for itself on the page.
  return imageryStatus?.status === "ready" ? TIERS.AUDITED : TIERS.ENRICHED;
}

// Whether the imagery lane should decline to spend two generations on this
// corner. Both the shard tier and the legacy one mean the same thing to it.
export const skipsAudit = (c) => c?.tier === TIERS.SCORED || c?.tier === LEGACY_ENRICHED;

// The one line every unchecked lane on a scored corner shows, so the page says
// the same thing in six places rather than six things.
export const SCORED_LANE_NOTE =
  "This corner has been scored against the citywide census. The full audit runs on demand or when it reaches the front of the queue.";

// ---------------------------------------------------------------- shards

// Which shard a slug lives in. Letters shard by their first character; slugs
// starting with a digit take two, because every numbered street in the city
// would otherwise pile into one bundle four times the size of any other.
export function shardKeyFor(slug) {
  const s = String(slug || "");
  return /[a-z]/.test(s[0]) ? s[0] : s.slice(0, 2);
}

// Parsed shards, held in the isolate. A corner page and its lanes each look the
// corner up, and re-reading and re-parsing 175KB per lane would be the cost of
// this design rather than its saving. Small on purpose: a handful of shards is
// the working set of one visitor, and an isolate is not a cache tier.
const SHARD_CACHE = new Map();
const SHARD_CACHE_MAX = 4;
const SHARD_TTL_MS = 60_000;

export async function getCityShard(env, key) {
  const hit = SHARD_CACHE.get(key);
  if (hit && Date.now() - hit.at < SHARD_TTL_MS) return hit.value;
  if (!env?.STORE) return null;
  const raw = await env.STORE.get(`city:shard:${key}`, "json").catch(() => null);
  if (!raw?.rows) return null;
  const index = new Map(raw.rows.map((r) => [r.slug, r]));
  const value = { sweepDate: raw.sweepDate, radiusM: raw.radiusM ?? SCORE_RADIUS, index };
  if (SHARD_CACHE.size >= SHARD_CACHE_MAX) SHARD_CACHE.delete(SHARD_CACHE.keys().next().value);
  SHARD_CACHE.set(key, { at: Date.now(), value });
  return value;
}

// The corner, in the exact shape every lane downstream already handles, plus
// the sweep row it came from. One KV read.
export async function cityCornerFor(env, slug) {
  const shard = await getCityShard(env, shardKeyFor(slug));
  const row = shard?.index.get(slug);
  if (!row) return null;
  return {
    ...makeCorner({
      slug: row.slug,
      name: row.name,
      lat: row.lat,
      lon: row.lon,
      district: row.district ?? null,
      cnn: null,
    }),
    tier: TIERS.SCORED,
    sweep: {
      points: row.points,
      index: row.index,
      grade: row.grade,
      counts: row.counts,
      district: row.district ?? null,
      sweepDate: shard.sweepDate,
      radiusM: shard.radiusM,
    },
  };
}

// Held in the isolate like the shards are. The homepage, the leaderboard and
// every tier tag read it, it is a few kilobytes, and it changes when the city
// is republished rather than between requests.
let META_CACHE = null;

export async function getCityMeta(env) {
  if (META_CACHE && Date.now() - META_CACHE.at < SHARD_TTL_MS) return META_CACHE.value;
  if (!env?.STORE) return null;
  const value = await env.STORE.get("city:meta", "json").catch(() => null);
  if (value) META_CACHE = { at: Date.now(), value };
  return value;
}

// Tier tags for a list of rows, from the rosters in city:meta rather than from
// one KV read per row. The corner page never trusts these: it reads the
// corner's own record, which cannot be stale.
export function tagTiers(rows, meta) {
  const audited = new Set(meta?.audited || []);
  const enriched = new Set(meta?.enriched || []);
  return rows.map((r) => ({
    ...r,
    tier: audited.has(r.slug) ? TIERS.AUDITED : enriched.has(r.slug) ? TIERS.ENRICHED : TIERS.SCORED,
  }));
}

// The rosters have to move when a corner is promoted, or the homepage counter
// keeps saying 23 while the cron quietly audits its way through the queue and
// the sentence "one more every morning" stops being true. The isolate copy is
// dropped so the write is visible to this isolate immediately.
export async function putCityMeta(env, meta) {
  if (!env?.STORE) return;
  META_CACHE = null;
  await env.STORE.put("city:meta", JSON.stringify(meta));
}

export async function getRankPage(env, n) {
  if (!env?.STORE) return null;
  return env.STORE.get(`city:rank:${n}`, "json").catch(() => null);
}

// ---------------------------------------------------------------- payloads

// Every payload below is built from the shard row and nothing else: no
// network, no model, no second KV read. The provenance URLs are built by the
// same soqlUrl and the same scoreQueries the live paths use, so clicking one
// re-runs the real query against data.sfgov.org today. The as-of date on the
// page is what covers the gap between that live re-run and the swept figure.

const injuryTotal = (counts) =>
  (counts.fatal || 0) + (counts.severe || 0) + (counts.otherVisible || 0) + (counts.pain || 0);

export function cityStats(c) {
  const s = c.sweep;
  const q = scoreQueries(c.lat, c.lon);
  const qDistrict = {
    "$select": "supervisor_district,count(*)",
    "$where": `within_circle(point, ${c.lat}, ${c.lon}, 150)`,
    "$group": "supervisor_district",
  };
  return {
    // Not live, not a cache of a live call, and emphatically not a sample:
    // these are the swept figures, true as of the date beside them. The page
    // tags this source with that date rather than with the word sample.
    source: "sweep",
    asOf: s.sweepDate,
    radiusM: s.radiusM,
    crashes: injuryTotal(s.counts),
    fatal: s.counts.fatal || 0,
    reports311: s.counts.safety311 || 0,
    // The sweep counted 311 over twelve months, where the live tiles count
    // three years. Saying "3 years" over a twelve month figure would be a
    // quiet lie, so the window travels with the number.
    reports311Window: "12 months",
    district: s.district ?? null,
    urls: {
      crashes: soqlUrl(DS_CRASHES, q.severity),
      reports311: soqlUrl(DS_311, q.reports),
      district: soqlUrl(DS_CRASHES, qDistrict),
      severity: soqlUrl(DS_CRASHES, q.severity),
      ped: soqlUrl(DS_CRASHES, q.ped),
    },
  };
}

export function cityScore(c) {
  const s = c.sweep;
  const q = scoreQueries(c.lat, c.lon);
  return {
    source: "sweep",
    asOf: s.sweepDate,
    version: SCORE_VERSION,
    index: s.index,
    grade: s.grade,
    points: s.points,
    radius: s.radiusM,
    counts: s.counts,
    caveat: SCORE_CAVEAT,
    urls: {
      severity: soqlUrl(DS_CRASHES, q.severity),
      ped: soqlUrl(DS_CRASHES, q.ped),
      reports: soqlUrl(DS_311, q.reports),
    },
  };
}

// The Cred Check on a scored corner. Absence of a check is not a failed check:
// three lanes have not run here, and the verdict says exactly that rather than
// scoring the corner down for work nobody has done yet.
export function cityCred(c) {
  const counts = c.sweep.counts;
  const collisions = injuryTotal(counts);
  const reports = counts.safety311 || 0;
  const recordsHit = collisions >= 1 || reports >= 3;
  const lanes = [
    {
      key: "records",
      label: "Official records",
      hit: recordsHit,
      detail: recordsHit
        ? `${collisions} injury collision${collisions === 1 ? "" : "s"} in 5 years` +
          `${counts.fatal ? `, ${counts.fatal} fatal` : ""}, ` +
          `${reports} street-condition 311 report${reports === 1 ? "" : "s"} in 12 months, ` +
          `within ${c.sweep.radiusM}m, as of ${c.sweep.sweepDate}`
        : "no injury collisions and too few street-condition reports in the sweep",
    },
    { key: "press", label: "Press coverage", hit: false, pending: true, detail: "not yet checked at this corner" },
    { key: "voices", label: "Resident accounts", hit: false, pending: true, detail: "not yet checked at this corner" },
    { key: "audit", label: "Visual audit", hit: false, pending: true, detail: "not yet run at this corner" },
  ];
  const unchecked = lanes.filter((l) => l.pending).length;
  return {
    source: "sweep",
    asOf: c.sweep.sweepDate,
    version: `${SCORE_VERSION}-city`,
    lanes,
    score: lanes.filter((l) => l.hit).length,
    pending: unchecked,
    verdict: recordsHit
      ? `RECORDS CONFIRMED, ${unchecked} LANES NOT YET CHECKED`
      : `NO RECORDS FOUND, ${unchecked} LANES NOT YET CHECKED`,
  };
}

// The lanes that have not run. Shaped like the payloads they stand in for, so
// the page renders them through the same code rather than a parallel path.
export const cityNews = () => ({ source: "empty", items: [], note: SCORED_LANE_NOTE });
export const cityVoices = () => ({ source: "empty", items: [], note: SCORED_LANE_NOTE });
export const cityTimeline = () => ({ source: "empty", reason: "not audited", note: SCORED_LANE_NOTE });
export const cityRun = () => ({ source: "empty", reason: "not audited", note: SCORED_LANE_NOTE });

export const cityHazards = () => ({
  source: "empty",
  audited: false,
  skipped: SCORED_LANE_NOTE,
  items: [],
  confirmed: 0,
  candidates: 0,
  reported: 0,
});

// The letter. Offered, not drafted: a draft costs a model call, and one is not
// spent because a crawler opened a page. While the generator is billing-gated
// the panel says so in plain words rather than showing a sample letter, which
// is the one artifact on this site a reader might actually send.
export const cityLetter = (c) => ({
  source: "ondemand",
  text: "",
  note:
    `No letter has been drafted for ${c.short || c.name} yet. Drafting runs when this corner is audited, ` +
    "on demand or when it reaches the front of the daily queue.",
  gated: true,
  gatedReason:
    "Letter drafting is paused: the generator is on a free tier with a 20 draft per day ceiling shared by the whole site.",
});

// 311 service names travel with the module that builds the queries, so a reader
// checking a provenance link can see the allow list without leaving the file.
export const CITY_SERVICE_NAMES = SERVICE_NAMES;
