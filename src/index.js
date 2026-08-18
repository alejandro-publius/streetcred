import {
  CORNERS, DEFAULT_SLUG, SAMPLE, supervisorFor, hasSupervisor, canonicalSlug, makeCorner, SERVICE_NAMES,
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
} from "./store.js";
import { computeScore, SCORE_VERSION, SCORE_CAVEAT } from "./score.js";
import { imageryFor } from "./imagery.js";
import { corroborate, HAZARD_VERSION } from "./hazards.js";
import { credCheck, isSafetyCoverage, CRED_VERSION } from "./cred.js";
import { buildManifest, PUBLIC_TRIGGERS } from "./manifest.js";
import { classify, streetTokens, domainOf, searchQuery } from "./newsfilter.js";
import { buildTimeline, TIMELINE_VERSION } from "./timeline.js";
import { buildSuggestion, SUGGEST_VERSION } from "./suggest.js";
import { buildInputSet, verifyLetter, retryInstruction, VERIFY_VERSION } from "./verify.js";
import { handleAgentReport, journalStats, JOURNAL_CAP } from "./agent.js";
import { WATCHDOG } from "./watchdog.js";

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
  if (value && value.source !== "sample" && value.source !== "empty") {
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
  return stored || CORNERS[DEFAULT_SLUG];
}

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

async function getStats(c) {
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
  const fresh = await computeScore(c);
  await putScore(env, c.slug, fresh);
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
    supervisor: supervisorFor(stats?.district ?? c.district),
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
  return bakedVoices(c, env, origin);
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
  const supervisor = supervisorFor(ctx.stats?.district);
  const headlines = (ctx.news?.items || [])
    .slice(0, 2)
    .map((n) => `"${n.title}" (${n.domain}${n.date ? ", " + n.date : ""})`)
    .join("; ");
  // Only feed the letter a resident quote that is actually about the street. The
  // scrape at this corner returns plenty of transit-station commentary, and a
  // letter quoting a review of the escalators would weaken the ask.
  const ONTOPIC = /crosswalk|crossing|pedestrian|sidewalk|driver|traffic|curb|intersection|corner/i;
  const quote = (ctx.voices?.items || []).map((v) => v.text).find((t) => t && ONTOPIC.test(t));
  // With no clear district majority the addressee is the citywide official, and
  // the letter must not invent a district number to sound authoritative.
  const dist = ctx.stats?.district;
  // Title only when the district actually maps to a Supervisor. Otherwise the
  // addressee is the citywide official under their own title, never "Supervisor
  // Mayor Daniel Lurie".
  const titled = hasSupervisor(dist);
  const addressee = titled ? `Supervisor ${supervisor}` : supervisor;
  const where = dist ? ` in District ${dist}` : " in San Francisco";
  const signoff = dist ? `A resident of District ${dist}` : "A resident of San Francisco";
  // The index only enters the letter when it actually computed. A letter that
  // cites a score the page could not produce is a letter citing nothing.
  // Each verdict gets its own licence. CONFIRMED may be stated as documented,
  // REPORTED belongs to the record rather than the photograph, and CANDIDATE is
  // an observation the letter must never dress up as established fact. Before
  // this existed the letter asserted the same hardcoded audit sentence at every
  // corner, including corners whose crosswalks are visibly in good condition.
  const hz = ctx.hazards?.items || [];
  const hazardLines = hz.length
    ? hz
        .map((h) => {
          const what = h.label.toLowerCase();
          if (h.verdict === "CONFIRMED")
            return `- The automated visual audit flagged ${what} in the Street View photograph, and city records corroborate it: ${h.detail}. You may present this as documented.`;
          if (h.verdict === "CANDIDATE")
            return `- The audit also flagged ${what}, which does not yet appear in city records. Present this as an observation from the photograph only. Never state it as established fact.`;
          return `- City records show ${h.detail} relating to ${what}, although the visual audit did not find it in the photograph. Attribute this to the records, not to the audit.`;
        })
        .join("\n")
    : "- No visual audit findings are available for this corner. Do not describe any audit.";

  // Phrased as a comparison rather than a raw score, because that is what the
  // number now is. "99 out of 100" invites a reader to imagine a scale that
  // stops somewhere; "worse than 99 percent of San Francisco intersections" is
  // the actual claim and it is the one a Supervisor can check.
  const scoreLine = ctx.score
    ? `- This intersection shows more reported harm than ${ctx.score.index} percent of San Francisco intersections, which is grade ${ctx.score.grade} on the Danger Index. State that comparison in those terms, not as a score out of 100, and immediately add this caveat in your own words: ${SCORE_CAVEAT}\n`
    : "";

  // Only when the history is long enough to mean something, and only ever as
  // coverage-we-can-find. Two years is the floor: one story last year and one
  // this year is not a decade of neglect and must not be dressed up as one.
  const yrs = ctx.timeline?.yearsReported;
  const longevityLine =
    Number.isFinite(yrs) && yrs >= 2
      ? `- Press coverage of safety problems at this intersection goes back at least ${yrs} years, to ${ctx.timeline.firstReportedYear}. State this as the earliest coverage we can find, never as the first time the problem was reported.\n`
      : "";

  const prompt = `Write a respectful one-page letter from a resident to San Francisco ${addressee} about the intersection of ${c.name}${where}.

Use these facts and cite them plainly:
- ${ctx.stats?.crashes ?? 0} injury collisions recorded by the city within 150 meters of this intersection in the last five years${ctx.stats?.fatal ? `, ${ctx.stats.fatal} of them fatal` : ""}. Do not describe this figure as covering any longer period. The first time you cite this count, state in the same sentence that it covers a 150 metre radius while the Danger Index grade is computed over a tighter 80 metre core, so the two figures are measured over different areas and a reader should not expect them to reconcile.
- ${ctx.stats?.reports311 ?? 0} street-condition 311 reports at this location in the last three years, counting street defects, sidewalk and curb, signs, streetlights and blocked sidewalks only.
${headlines ? `- Recent press coverage: ${headlines}.` : "- No press coverage was found for this corner. Do not cite or invent any news reporting."}
${scoreLine}${longevityLine}${hazardLines}
${quote ? `- A resident said: ${quote}` : "- Do not quote or invent any resident testimony."}
- The request: fund ${c.fix.name}, estimated ${c.fix.cost}, through the ${c.fix.grant}.

Rules: plain civic English. Under 220 words. Address only ${addressee}. Distinguish clearly between what city records document and what the visual audit merely observed. Never present an observation as a documented fact. No em dashes anywhere. No placeholders in brackets. Sign off as "${signoff}". Return only the letter text.`;

  // 3.7-flash returns UNAVAILABLE under load often enough that a single attempt
  // makes the letter lane look broken when it is only busy. Transient statuses
  // get three tries with a short backoff; a 400 or a 403 is a real fault and is
  // surfaced immediately with the reason attached, because a bare status code
  // sent me looking for a revoked key when the answer was model overload.
  const TRANSIENT = new Set([429, 500, 502, 503, 504]);
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
  };
  await putVerifiedLetter(env, c.slug, record).catch(() => {});
  return record;
}

function sampleLetter(c, district) {
  const supervisor = supervisorFor(district);
  // Same rule as the live path: title only when the district maps to a real
  // Supervisor, never "Dear Supervisor Mayor Daniel Lurie".
  const salutation = hasSupervisor(district) ? `Dear Supervisor ${supervisor}` : `Dear ${supervisor}`;
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

// ---------------------------------------------------------------- health
async function health(env, origin) {
  const ping = async (name, fn) => {
    try {
      await fn();
      return [name, "ok"];
    } catch (e) {
      return [name, String(e.message || e).slice(0, 80)];
    }
  };
  const c = CORNERS[DEFAULT_SLUG];
  const results = await Promise.all([
    ping("datasf", () => soql(DS_CRASHES, { "$select": "count(*)", "$limit": 1 })),
    ping("exa", async () => {
      const r = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ query: "san francisco pedestrian safety", numResults: 1 }),
      });
      if (!r.ok) throw new Error(r.status === 402 ? "402 credits not redeemed" : `http ${r.status}`);
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
  return { ok: Object.values(out).every((v) => v === "ok"), ...out };
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
  const [score, cred] = await Promise.all([
    getScore(env, c.slug, SCORE_VERSION).catch(() => null),
    getCredCached(env, c.slug, CRED_VERSION).catch(() => null),
  ]);
  return { score, cred };
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
const PT_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const pacificDay = (d = new Date()) => PT_DAY.format(d);

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
  const settled = await getImageryStatus(env, corner.slug).catch(() => null);

  const entry = {
    date: today,
    slug: corner.slug,
    name: corner.name,
    grade: score?.grade ?? null,
    index: score?.index ?? null,
    imagery: settled?.status ?? imagery?.status ?? "unavailable",
    status: notes.length ? "partial" : "ok",
    ...(notes.length ? { reason: notes.join("; ") } : {}),
    ...(skipped.length ? { skipped } : {}),
  };
  await appendCotdLog(env, entry);
  return { ok: true, ...entry };
}

export default {
  // The cron. Everything it does happens inside waitUntil so a slow lane cannot
  // be cut off when the handler returns.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cornerOfTheDay(env, ctx, "https://streetcred.thealexschroeder.workers.dev"));
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
          putAgentRescore,
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

      if (p === "/watchdog" || p === "/watchdog/") {
        const [journal, rejects] = await Promise.all([
          getJournal(env).catch(() => []),
          getAgentRejects(env).catch(() => 0),
        ]);
        return new Response(WATCHDOG(journal, rejects, origin), {
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
        const [corners, cotdLog, suggestion] = await Promise.all([
          getHinList(env),
          getCotdLog(env).catch(() => []),
          // Read only. The homepage must never wait on a findSimilar call, so
          // a suggestion that has not been built yet simply does not render.
          getSuggestion(env, SUGGEST_VERSION).catch(() => null),
        ]);
        return new Response(HOME(corners, origin, cotdLog, suggestion), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }

      if (/^\/c\/[A-Za-z0-9-]+\/?$/.test(p)) {
        const og = { ...(await ogFor(c, env)), origin };
        // A corner nobody has opened has no cached verdict yet, so warm it in
        // the background. The response never waits on it.
        if (!og.cred) ctx.waitUntil(getCred(c, env, origin).catch(() => {}));
        return new Response(PAGE(c, og), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (p === "/api/stats") {
        return await edgeCached(ctx, `stats-${c.slug}`, 3600, () =>
          cached(`stats:${c.slug}`, 3600e3, () => getStats(c).catch(() => sampleStats(c))),
        );
      }

      if (p === "/api/news") {
        return await edgeCached(ctx, `news-${c.slug}`, 600, () =>
          cached(`news:${c.slug}`, 600e3, () => getNews(c, env).catch(() => sampleNews(c))),
        );
      }

      if (p === "/api/cred") {
        return await edgeCached(ctx, `cred-${c.slug}`, 3600, async () => {
          const hit = await getCredCached(env, c.slug, CRED_VERSION);
          return hit ? { ...hit, source: "cache" } : getCred(c, env, origin);
        });
      }

      if (p === "/api/hazards") {
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

      if (p === "/api/timeline") {
        return json(await getTimelineFor(c, env));
      }

      if (p === "/api/run") {
        const asked = url.searchParams.get("trigger");
        const trigger = PUBLIC_TRIGGERS.has(asked) ? asked : "user";
        return json(await runManifest(c, env, origin, trigger, url.searchParams.has("refresh")));
      }

      if (p === "/api/score") {
        return await edgeCached(ctx, `score-${c.slug}`, 3600, () => getScoreFor(c, env));
      }

      if (p === "/api/voices") {
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
            return getLetter(c, env, { stats, news, voices, score, hazards, timeline }).catch((e) => {
              // A letter quietly becoming a sample is the failure a reader is
              // least likely to notice and most likely to be misled by, so it
              // leaves a trace with the reason attached rather than vanishing.
              console.log(`letter fell back to sample at ${c.slug}: ${String(e?.message || e)}`);
              return sampleLetter(c, stats.district);
            },
            );
          }),
        );
      }

      if (p === "/api/health") {
        return json(await health(env, origin));
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
