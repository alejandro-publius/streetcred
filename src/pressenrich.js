// Frugal press enrichment.
//
// The per-page press lane spends one search per corner and returns whatever
// that search returns. Enriching the whole city that way costs a search per
// corner per lane and buries the balance in duplicates: every corner on
// Mission Street runs its own Mission Street search and gets its own copy of
// the same corridor coverage.
//
// This lane is built to be run thousands of times, so it is built around what
// is already paid for. In order, and only moving to the next when the previous
// has nothing:
//
//   1. the stored citywide sweep, which already read this month's coverage
//   2. the segment cache, one entry per street, shared by every corner on it
//   3. three dated windows on the crossing itself, which is the only query
//      that is genuinely corner specific
//
// Contents are the other half of the saving. A search that asks for page text
// pays for text on every result including the ones the filter is about to
// throw away, so searches here ask for none. Candidates are shortlisted on
// title and url, and only the shortlist is fetched, verified against its real
// text, and published. That order is stated on the methodology page, because
// it means a story that names the corner only in its body can be missed by the
// shortlist, and a reader is owed that rather than a claim of completeness.
import { classify, streetTokens, domainOf, searchQuery, DENY } from "./newsfilter.js";
import { isSafetyCoverage } from "./cred.js";
import {
  reserveExa, recordExaSpend, getWatchlist,
  getPressSegment, putPressSegment,
  EXA_SEARCH_CENTS, EXA_CONTENTS_CENTS,
} from "./store.js";

export const PRESS_VERSION = "v1";
export const SEGMENT_TTL_S = 7 * 24 * 3600;

// Three windows instead of a search per year. A year strip cost eleven
// searches to answer a question that reads the same at three: the decade
// before Vision Zero's mid course reset, the pandemic years and their
// aftermath, and now.
export const WINDOWS = [
  { key: "2014-2019", start: "2014-01-01T00:00:00.000Z", end: "2019-12-31T23:59:59.999Z" },
  { key: "2020-2023", start: "2020-01-01T00:00:00.000Z", end: "2023-12-31T23:59:59.999Z" },
  { key: "2024-present", start: "2024-01-01T00:00:00.000Z", end: null },
];

// Not press. A social post, a video page, a forum thread or a review site is
// somebody talking about coverage rather than coverage, and this lane
// publishes what it keeps as a citation under the words "found and cited".
// The first live run surfaced a Facebook post as the top result for a
// Tenderloin corner, which is how this list came to exist.
const NOT_PRESS =
  /(facebook\.com|twitter\.com|\/\/x\.com|instagram\.com|tiktok\.com|reddit\.com|youtube\.com|youtu\.be|pinterest\.|linkedin\.com|yelp\.com|tripadvisor\.|nextdoor\.com|medium\.com|substack\.com\/inbox)/i;

const SHORTLIST = 8;  // urls fetched for text, the only page contents paid for
const PUBLISH = 5;    // items the panel shows
const PER_SEARCH = 6; // results per search, small on purpose

const EXA_SEARCH = "https://api.exa.ai/search";
const EXA_CONTENTS = "https://api.exa.ai/contents";

// The streets a corner sits on, as cache keys. "19th and Mission" segments to
// 19th and to Mission, and every other corner on either one reuses them.
export function segmentsOf(corner) {
  return String(corner?.name || "")
    .split(/\s+(?:and|&|at)\s+/i)
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean);
}

export const segmentQuery = (street, city = "San Francisco") =>
  `pedestrian safety OR crash OR traffic ${street.replace(/-/g, " ")} ${city}`;

// The measured cost is summed here and written once per corner, at the end,
// rather than after each of the five or six calls. The cap is not weakened by
// that: the whole plan is reserved before the first call, and the cap is
// enforced on the greater of reserved and spent, so a corner that dies partway
// leaves its reservation standing and errs expensive. What it buys is six KV
// round trips per corner instead of twenty-odd, which is the difference
// between a burn run taking hours and taking most of a day.
async function exaPost(env, url, body, meter) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 402) throw new Error("exa 402 credits");
  if (!r.ok) throw new Error(`exa ${r.status}`);
  const d = await r.json();
  const usd = Number(d?.costDollars?.total);
  if (Number.isFinite(usd) && usd > 0) {
    meter.costUsd = Math.round((meter.costUsd + usd) * 1e6) / 1e6;
  }
  return d;
}

const rawOf = (x) => ({
  title: String(x?.title || "").trim(),
  url: x?.url || "",
  publishedDate: x?.publishedDate || "",
  text: x?.text || "",
});

// Ranked before anything is paid for. A title naming both streets is the best
// candidate there is, one naming a street is next, and recency breaks ties.
function shortlistRank(x, tokens) {
  const hay = `${x.title} ${x.url}`.toLowerCase();
  const named = tokens.filter((t) => t && hay.includes(t)).length;
  return [named, x.publishedDate || ""];
}

// `session` is an optional metering session from openExaMeter. When one is
// supplied the reserve and the spend accumulate into it and reach KV once for
// the whole batch; without one this behaves exactly as it always did, so every
// other caller is unaffected.
export async function enrichPress(env, corner, session = null, opts = {}) {
  const reserve = session ? (n, p) => session.reserve(n, p) : (n, p) => reserveExa(env, n, p);
  const record = session ? (u) => session.record(u) : (u) => recordExaSpend(env, u);
  const tokens = streetTokens(corner);
  const meter = {
    searches: 0, contentPages: 0, costUsd: 0,
    segmentsWarm: [], segmentsCold: [], sweepCandidates: 0, windows: [],
  };
  const pool = new Map(); // url -> raw

  const add = (results, where) => {
    let n = 0;
    for (const x of results || []) {
      const raw = rawOf(x);
      if (!raw.url || !raw.title || DENY.test(raw.url) || NOT_PRESS.test(raw.url)) continue;
      if (!pool.has(raw.url)) { pool.set(raw.url, raw); n += 1; }
    }
    if (where && n) meter.windows.push({ from: where, added: n });
    return n;
  };

  // 1. The stored sweep. Already paid for, so it is consulted first and it is
  // free. It only ever helps: a corner the watchlist already found coverage
  // for starts with candidates before a single call is planned.
  const sweep = await getWatchlist(env, null).catch(() => null);
  for (const e of sweep?.entries || []) {
    if (e?.slug !== corner.slug) continue;
    meter.sweepCandidates += add(e.articles || [], "stored sweep");
  }

  // 2. Segments. A warm street costs nothing and serves every corner on it.
  const segments = segmentsOf(corner);
  const cold = [];
  for (const seg of segments) {
    const hit = await getPressSegment(env, seg).catch(() => null);
    if (hit?.results?.length) {
      meter.segmentsWarm.push(seg);
      add(hit.results, `segment ${seg}`);
    } else if (hit) {
      // A stored empty segment is a result too, and re-searching it every
      // night is exactly the spend this cache exists to stop.
      meter.segmentsWarm.push(seg);
    } else {
      cold.push(seg);
    }
  }

  // 3. Plan and reserve before anything is spent. The whole plan is reserved
  // at once, because a batch that checks its budget between calls has already
  // overspent by the time it notices.
  const plannedSearches = cold.length + WINDOWS.length;
  if (!(await reserve(plannedSearches, SHORTLIST))) {
    return {
      source: "budget-deferred",
      version: PRESS_VERSION,
      slug: corner.slug,
      reason: "the exa budget is at its cap for this period",
      cost: meter,
      fetchedAt: new Date().toISOString(),
    };
  }

  for (const seg of cold) {
    const d = await exaPost(env, EXA_SEARCH, {
      query: segmentQuery(seg, corner.city), type: "auto", numResults: PER_SEARCH,
    }, meter);
    meter.searches += 1;
    const results = (d.results || []).map(rawOf);
    await putPressSegment(env, seg, { results, fetchedAt: new Date().toISOString() }).catch(() => {});
    meter.segmentsCold.push(seg);
    add(results, `segment ${seg}`);
  }

  for (const w of WINDOWS) {
    const body = {
      query: searchQuery(corner), type: "auto", numResults: PER_SEARCH,
      startPublishedDate: w.start,
    };
    if (w.end) body.endPublishedDate = w.end;
    const d = await exaPost(env, EXA_SEARCH, body, meter);
    meter.searches += 1;
    add(d.results, w.key);
  }

  // 4. Contents, for the shortlist only. This is the one place page text is
  // paid for, and every url in it is a candidate that could be published.
  const ranked = [...pool.values()].sort((a, b) => {
    const [an, ad] = shortlistRank(a, tokens);
    const [bn, bd] = shortlistRank(b, tokens);
    return bn - an || String(bd).localeCompare(String(ad));
  });
  const needText = ranked.filter((x) => !x.text).slice(0, SHORTLIST);
  if (needText.length) {
    const d = await exaPost(env, EXA_CONTENTS, {
      urls: needText.map((x) => x.url), text: { maxCharacters: 600 },
    }, meter);
    meter.contentPages += needText.length;
    for (const x of d.results || []) {
      const hit = pool.get(x.url);
      if (hit) hit.text = x.text || "";
    }
  }

  // 5. The published bar is the panel's bar, applied to real text. Nothing
  // above this line decided what is true, only what was worth reading.
  const candidates = ranked.slice(0, SHORTLIST).map((x) => pool.get(x.url) || x);
  const scored = classify(candidates, tokens);
  const tight = scored.filter((s) => s.corner);
  const precise = tight.length >= 3;
  const chosen = precise ? tight : scored.filter((s) => s.loose);

  const mapped = chosen.map(({ raw: x, corner: isCorner, official }) => ({
    title: x.title.trim(),
    url: x.url,
    domain: domainOf(x.url),
    corner: isCorner,
    date: (x.publishedDate || "").slice(0, 10),
    official,
    corroborates: isSafetyCoverage({ title: x.title, text: x.text }, tokens),
  }));
  const byRank = (a, b) =>
    Number(b.corner) - Number(a.corner) || (b.date || "").localeCompare(a.date || "");
  const byDate = (a, b) => (b.date || "").localeCompare(a.date || "");
  const items = [
    ...mapped.filter((x) => !x.official).sort(byRank),
    ...mapped.filter((x) => x.official).sort(byDate),
  ].slice(0, PUBLISH);

  const base = {
    version: PRESS_VERSION,
    slug: corner.slug,
    fetchedAt: new Date().toISOString(),
    // Not an audit. This corner keeps its tier and gains a press section, and
    // the label travels with the record so no surface can imply otherwise.
    lane: "press-checked",
    found: pool.size,
    afterFilters: chosen.length,
    shortlisted: candidates.length,
    cost: {
      searches: meter.searches,
      contentPages: meter.contentPages,
      usd: meter.costUsd,
      cents: Math.round(meter.costUsd * 10000) / 100,
      estimatedCents:
        Math.round((meter.searches * EXA_SEARCH_CENTS + meter.contentPages * EXA_CONTENTS_CENTS) * 100) / 100,
      segmentsWarm: meter.segmentsWarm,
      segmentsCold: meter.segmentsCold,
      sweepCandidates: meter.sweepCandidates,
    },
    windows: meter.windows,
  };

  // One write for everything this corner actually cost.
  if (meter.costUsd > 0) await record(meter.costUsd).catch(() => {});

  // Searched and empty is a result, stored and shown like one. The lane that
  // says nothing was found is worth more than the lane that says nothing.
  if (!items.length) {
    return { ...base, source: "empty", precise: false, heading: "Press coverage" };
  }
  return {
    ...base,
    source: "live",
    precise,
    heading: precise ? "Press coverage" : "Coverage of this corridor",
    items,
  };
}
