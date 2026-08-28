// Resident voices, commissioned autonomously.
//
// Scraping cannot happen during a page load: an actor run takes minutes and a
// visitor will not wait. Until now that meant voices existed only for corners
// somebody had scraped by hand before the demo, which is two of them.
//
// So the cron commissions them. When the morning run promotes a corner it
// starts both actors for that corner and writes down the run ids. It does not
// wait. The NEXT morning's run picks up whatever finished overnight, scores it,
// and publishes it into the voices lane. One corner a day, unattended, from a
// schedule nobody is watching.
//
// Two things make that safe to leave running: a hard monthly ceiling on actor
// runs, checked before anything starts, and a per-run cost ledger written from
// the number Apify itself reports. An autonomous system spending real credit
// without a ledger is the thing nobody should ship.

import {
  reserveActorRun, actorRunBudget, putVoiceRun, getVoiceRun,
  getVoicePending, putVoicePending, putVoicesStored, appendActorCost,
  getVoicesSummary, putVoicesSummary,
} from "./store.js";

export const VOICES_VERSION = "v1";

const API = "https://api.apify.com/v2";

// Actor ids in the tilde form the REST API wants.
const GMAPS_ACTOR = "compass~crawler-google-places";
const REDDIT_ACTOR = "trudax~reddit-scraper-lite";

// The targeting rules, unchanged from the ones that were worked out by hand.
//
// An intersection is not a place: geocoding "16th and Mission" resolves to a
// road junction, which has no reviews attached to it, so the obvious query
// returns nothing. The corner is treated as a geographic circle instead, and it
// borrows the voices of the businesses and the transit stops standing inside
// it.
const CIRCLE_M = 350;

// Given as an explicit GeoJSON polygon rather than a point with a radius
// field: a 16-gon is unambiguous GeoJSON that any consumer reads the same way,
// where a radius extension is a guess about one actor's input parser.
export function circleGeoJson(lat, lon, meters = CIRCLE_M, points = 16) {
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= points; i++) {
    const t = (2 * Math.PI * i) / points;
    ring.push([
      Number((lon + dLon * Math.cos(t)).toFixed(6)),
      Number((lat + dLat * Math.sin(t)).toFixed(6)),
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

// Broad terms, because the point is who is standing on this corner, not what
// they sell. Places per search is small and deliberate: this actor bills per
// place scraped, so the input is also the invoice.
export function gmapsInput(c) {
  return {
    customGeolocation: circleGeoJson(c.lat, c.lon),
    searchStringsArray: ["restaurant", "cafe", "store"],
    maxCrawledPlacesPerSearch: 4,
    maxReviews: 12,
    reviewsSort: "newest",
    language: "en",
    scrapePlaceDetailPage: false,
    skipClosedPlaces: true,
  };
}

// Driven by explicit startUrls rather than the actor's search builder, which in
// the configuration used here enqueued zero requests and returned an empty
// dataset. Pointing it at a search results page is less elegant and completely
// reliable.
export function redditInput(c) {
  const q = encodeURIComponent(`${c.name} San Francisco`);
  return {
    startUrls: [
      { url: `https://www.reddit.com/r/sanfrancisco/search/?q=${q}&restrict_sr=1&sort=relevance&t=all` },
      { url: `https://www.reddit.com/search/?q=${q}&sort=relevance&t=all` },
    ],
    maxItems: 25,
    maxPostCount: 25,
    skipComments: true,
    searchPosts: true,
    searchComments: false,
  };
}

// ---------------------------------------------------------------- scoring

// The relevance scorer, ported from tools/collect_voices.py, which remains the
// offline path. This copy is the canonical one: it is the one that runs
// unattended, and tools/voices.test.mjs pins its behaviour.
//
// Relevance here is not binary. A post about a pedestrian killed at this corner
// is worth more than a review that happens to contain the word "street".
// Words that can only mean a street. These are what qualify a quote.
const ROAD =
  /\b(pedestrian|pedestrians|crosswalk|crossing|jaywalk|curb ramp|bike lane|cyclist|biking|driver|drivers|traffic|intersection|sidewalk|stop sign|red light|left turn|right turn)\b/gi;

// Words that describe harm but say nothing about a street. "Killed" appears in
// "San Francisco Killed 8th-Grade Algebra" and in "Man shot and killed in
// SoMa", and both cleared a traffic-safety filter that treated harm as
// sufficient. They raise a quote's score and can no longer qualify one.
const HARM = /\b(struck|hit by|run over|killed|collision|crash|fatal|injured|speeding)\b/gi;

// What makes a quote about SAFETY rather than merely about a street. Without
// this bar, "the magical intersection of California and Market" and a story
// about a woman throwing burning objects near an intersection both qualified,
// because both mention a road. This lane is evidence about how a crossing
// behaves, not a record of everything that happened near one.
const SAFETY =
  /\b(unsafe|dangerous|safety|speeding|reckless|enforce|enforcement|calming|daylighting|neckdown|stop sign|signal|slow down|near miss|almost hit|blind spot|visibility|violation|violations)\b/gi;

const WEAK =
  /\b(corner|car|cars|bike|walk|walking|curb|plaza|lane|block)\b/gi;
const BLOCK = /\b(fuck|shit|bitch|cunt|nigg|retard|junkie)\b/i;
const BOILER = /submitted by.*$|\[link\]|\[comments\]|&#\d+;|https?:\/\/\S+/gi;

export function cleanText(text) {
  let t = String(text ?? "");
  // Named entities the scrapers leave behind, then numeric ones via BOILER.
  t = t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  t = t.replace(BOILER, " ");
  t = t.split(/\s+/).filter(Boolean).join(" ");
  if (t.length > 240) t = `${t.slice(0, 240).replace(/\s+\S*$/, "")}...`;
  return t;
}

const count = (re, s) => (s.match(re) || []).length;

// Zero means drop it. Higher means it speaks more directly to street safety.
export function scoreText(text, cornerTokens = []) {
  if (!text || text.length < 40 || BLOCK.test(text)) return 0;
  const road = count(ROAD, text);
  const harm = count(HARM, text);
  const weak = count(WEAK, text);
  const low = text.toLowerCase();

  // Two requirements, both learned from what the first fifteen corners
  // returned. The quote has to say something that can only mean a street, and
  // it has to name this corner. A Reddit search for "9th and Mission" returns
  // everything that mentions either street, so without the second bar a fatal
  // collision on I-280 and a photo of somebody crossing with a balloon in 1997
  // both land in a corner's evidence lane.
  const namesCorner = cornerTokens.length === 0 || cornerTokens.some((t) => t && low.includes(t));
  const safety = count(SAFETY, text);
  // Three bars, each one added because a real commissioned run put something
  // through the previous two: it has to mean a street, it has to be about
  // safety on that street, and it has to name this corner.
  if (road === 0 || !namesCorner) return 0;
  if (harm === 0 && safety === 0) return 0;
  // A weak word never qualifies a quote on its own. This is the rule
  // src/cred.js already applies to the same question: "dangerous" and "corner"
  // mean the street about half the time and something else the rest, so they
  // only count beside a word that can only mean the street. The first
  // autonomous run proved it necessary here too, keeping four restaurant
  // reviews out of five because a steak dinner mentioned the street name.
  // Two points per street named, not two for naming any. A quote that names
  // both streets is about this crossing; one that names a single street is
  // about the corridor it sits on. Both belong, and the first should rank
  // above the second, which is the same order the press panel uses.
  const named = cornerTokens.filter((t) => t && low.includes(t)).length;
  return 3 * harm + 2 * road + 2 * safety + weak + 2 * named;
}

// Which of a corner's two streets a quote actually names.
//
// Counted per SIDE, not per token, and that is not fussiness: cornerTokens
// flattens "Cyril Magnin and Eddy" to ["cyril","magnin","eddy"], so a quote
// naming only Cyril Magnin would match two tokens and read as though it named
// both streets. Sides are the two things a crossing is made of, and a
// multi-word side has to be named in full to count.
export const cornerSides = (c) =>
  String(c?.name || "")
    .toLowerCase()
    .split(/\s+and\s+/)
    .map((side) =>
      side
        .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|way|place|terrace)\b/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2),
    )
    .filter((side) => side.length);

// "crossing" when the quote names both streets, "corridor" when it names one.
//
// scoreText already admits both and ranks the first above the second, on
// purpose. What it never did was say which one a published quote was, so a
// corridor quote was displayed exactly like testimony about the crossing
// itself. This is the fact the page needs in order to label it.
export function matchLevel(text, sides) {
  const low = String(text || "").toLowerCase();
  const named = (sides || []).filter((side) => side.every((t) => low.includes(t))).length;
  if (named >= 2) return "crossing";
  return named === 1 ? "corridor" : "none";
}

// Does this text name a crossing that is not this one?
//
// scoreText admits a quote naming ONE of a corner's two streets on purpose: a
// quote about Valencia Street belongs on 24th and Valencia, and the comment
// there calls that the corridor case. What that rule cannot see is the
// difference between a quote about this corridor and a quote about a
// DIFFERENT crossing that happens to share one street name with this one.
//
// On 2026-08-24 three of the four published quotes were the second kind: a
// driver at 4th and King published under 4th and Ellis, a truck at Polk and
// Geary published under Polk and Willow, and a neckdown on Kirkham between
// 9th and 10th Avenue published under 9th and Mission, which is the 19th
// Street versus 19th Avenue confusion gotcha 23 already names, arriving
// through the voices lane instead of the press lane.
//
// The bar: if the text names a crossing at all, that crossing has to be this
// one. A quote that names no crossing is untouched, which is what keeps the
// corridor case working.
//
// `streets` is the city's own 2,219-name index, lowercase with street types
// stripped, the same shape cornerTokens produces. It is required rather than
// optional: a bar that reads its own data and treats a failed read as a pass
// is a bar that switches itself off, which is gotcha 22, so the caller has to
// handle an unavailable index rather than this returning a quiet false.
export function namesForeignCrossing(text, tokens, streets) {
  if (!streets || !streets.size) throw new Error("namesForeignCrossing needs the city street index");
  const mine = new Set((tokens || []).filter(Boolean));
  if (!mine.size) return false;
  const low = String(text || "").toLowerCase();
  // "a & b", "a and b", and "between a and b", which is the same shape with a
  // different word in front of it.
  const re = /\b([a-z0-9]+)\s*(?:&|and)\s*([a-z0-9]+)\b/g;
  for (const m of low.matchAll(re)) {
    const a = m[1];
    const b = m[2];
    if (a === b) continue;
    // Both sides have to be real SF street names, or this is ordinary prose
    // like "cars and trucks" rather than a crossing.
    if (!streets.has(a) || !streets.has(b)) continue;
    // Named in full and it is this crossing: the strongest possible match.
    if (mine.has(a) && mine.has(b)) continue;
    // Any other pair of real streets is a location that is not this one.
    return true;
  }
  return false;
}

export const cornerTokens = (c) =>
  String(c.name || "")
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|and)\b/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

export function fromGmaps(rows, tokens) {
  const out = [];
  for (const place of rows || []) {
    for (const r of place?.reviews || []) {
      const text = cleanText(r.text ?? r.textTranslated);
      const score = scoreText(text, tokens);
      if (!score) continue;
      out.push({
        source: "google_maps",
        stars: r.stars ?? r.rating ?? null,
        text,
        when: String(r.publishedAtDate || "").slice(0, 10) || null,
        score,
      });
    }
  }
  return out;
}

export function fromReddit(rows, tokens) {
  const out = [];
  for (const p of rows || []) {
    // Reddit splits the point across title and body, and either can carry it.
    const title = cleanText(p?.title);
    const body = cleanText(p?.body ?? p?.text ?? p?.selftext);
    const joined = cleanText(!body ? title : title ? `${title}. ${body}` : body);
    const score = scoreText(joined, tokens);
    if (!score) continue;
    out.push({
      source: "reddit",
      stars: null,
      text: joined,
      when: String(p?.createdAt || p?.created || p?.date || "").slice(0, 10) || null,
      score,
    });
  }
  return out;
}

// Strongest signal first, both sources represented, at most five shown. Same
// selection the hand-run collector makes.
export function pickVoices(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || String(b.when || "").localeCompare(String(a.when || "")));
  const perSource = new Map();
  const picked = [];
  for (const v of sorted) {
    const n = perSource.get(v.source) || 0;
    if (n >= 3) continue;
    perSource.set(v.source, n + 1);
    picked.push({ source: v.source, stars: v.stars, text: v.text, when: v.when });
    if (picked.length >= 5) break;
  }
  return picked;
}

// ---------------------------------------------------------------- apify api

// 1024MB, not the actor default of 2048 or 4096. The account has a hard
// ceiling on the memory of everything running at once (16GB), and it is
// account-wide rather than per-actor: at 2048 a batch of twelve corners
// started eight runs and then got 402 "you will exceed the memory limit" for
// the rest. These actors are billed per event rather than per second, so
// halving the memory costs nothing except wall clock and doubles how many
// corners can be in flight before the ceiling bites.
async function startRun(env, actor, input) {
  const r = await fetch(`${API}/acts/${actor}/runs?token=${env.APIFY_TOKEN}&timeout=900&memory=1024`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`apify ${actor} start ${r.status}: ${String(d?.error?.message || "").slice(0, 90)}`);
  return { id: d.data.id, datasetId: d.data.defaultDatasetId, status: d.data.status };
}

async function runStatus(env, id) {
  const r = await fetch(`${API}/actor-runs/${id}?token=${env.APIFY_TOKEN}`);
  if (!r.ok) throw new Error(`apify run ${id} ${r.status}`);
  const d = await r.json();
  return { status: d.data.status, usageTotalUsd: d.data.usageTotalUsd ?? null, datasetId: d.data.defaultDatasetId };
}

async function datasetItems(env, datasetId, limit = 200) {
  const r = await fetch(`${API}/datasets/${datasetId}/items?token=${env.APIFY_TOKEN}&limit=${limit}`);
  if (!r.ok) throw new Error(`apify dataset ${datasetId} ${r.status}`);
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

// ---------------------------------------------------------------- commission

// Start both actors for a corner and write down where the results will land.
// Never waits. Every failure is returned rather than thrown, because this runs
// inside the morning audit and a scraper that will not start must not take the
// audit down with it.
// opts.only restricts the commission to one actor. Used to top up a corner
// whose second run never started, and to spend on the actor that actually
// produces evidence: across twelve corners the Maps scraper returned 60
// reviews a corner and not one of them cleared the street-safety bar, while
// four of the five corners that got a Reddit run produced a quote.
export async function commissionVoices(env, c, opts = {}) {
  // `opts.now` exists so a test can ask about a fixed instant. The reserve is
  // a function of the calendar, so a test that reads the wall clock passes or
  // fails depending on the hour it runs at, which is not a test.
  const budget = await actorRunBudget(env, opts.now);
  const started = [];
  const failed = [];

  const wanted = [
    ["google_maps", GMAPS_ACTOR, gmapsInput(c)],
    ["reddit", REDDIT_ACTOR, redditInput(c)],
  ].filter(([name]) => !opts.only || opts.only === name);

  for (const [name, actor, input] of wanted) {
    const slot = await reserveActorRun(env, { forCron: Boolean(opts.forCron), now: opts.now });
    if (!slot.ok) {
      // Two refusals, said apart. The ceiling means the month is spent. The
      // reserve means the month is spoken for by the daily cron, which is a
      // different thing to fix and must never read as the same failure.
      failed.push({
        actor: name,
        reason:
          slot.why === "reserved"
            ? `commissioning paused to protect the monthly ceiling: ${slot.used} of ${slot.cap} runs used, ` +
              `${slot.remaining} left and all ${slot.reserved} reserved for the daily cron through month end`
            : `monthly actor run cap reached (${budget.cap})`,
        why: slot.why,
      });
      continue;
    }
    try {
      const run = await startRun(env, actor, input);
      started.push({ actor: name, id: run.id, datasetId: run.datasetId });
    } catch (e) {
      failed.push({ actor: name, reason: String(e.message || e).slice(0, 120) });
    }
  }

  if (!started.length) {
    // Journaled in the same ledger the successful runs use. A refusal that
    // leaves no record is indistinguishable from a lane nobody asked to run,
    // and the status page reads this to say which of the two happened.
    await appendActorCost(env, {
      slug: c.slug,
      name: c.name,
      at: new Date().toISOString(),
      event: "refused",
      reason: failed[0]?.reason || "no run started",
      why: failed[0]?.why || "error",
      runs: [],
      costUsd: 0,
    }).catch(() => {});
    return { ok: false, slug: c.slug, started: [], failed };
  }

  // A top-up keeps the runs the corner already has, so the ingest reads both
  // the original dataset and the new one rather than losing the first.
  const prior = opts.only ? await getVoiceRun(env, c.slug) : null;
  const priorRuns = (prior?.runs || []).filter((r) => r.actor !== opts.only);
  const rec = {
    slug: c.slug,
    name: c.name,
    commissionedAt: new Date().toISOString(),
    runs: [...priorRuns, ...started],
    failed,
    status: "pending",
  };
  await putVoiceRun(env, c.slug, rec);
  const pending = await getVoicePending(env);
  await putVoicePending(env, [c.slug, ...pending.filter((s) => s !== c.slug)]);

  // The ledger records the commission, not just the invoice. A run in flight is
  // money already committed, and a ledger that only shows finished runs cannot
  // answer "what is this thing spending right now", which is the question
  // somebody asks when an autonomous system is running unattended.
  await appendActorCost(env, {
    slug: c.slug,
    name: c.name,
    at: rec.commissionedAt,
    event: "commissioned",
    runs: started.map((r) => ({ actor: r.actor, id: r.id, datasetId: r.datasetId })),
    costUsd: null,
  }).catch(() => {});

  return { ok: true, ...rec };
}

// Re-apply the current scorer to datasets already paid for. Dataset reads are
// free; the scrape is the billed part and it has already happened. Without
// this, improving the relevance filter would mean re-commissioning every
// corner, which is the wrong incentive for a filter that should keep getting
// stricter.
export async function rescoreVoices(env, slug, corner) {
  const rec = await getVoiceRun(env, slug);
  if (!rec?.runs?.length) return { ok: false, reason: "no commissioned run recorded for this corner" };
  const tokens = corner ? cornerTokens(corner) : [];
  const candidates = [];
  for (const run of rec.runs) {
    const rows = await datasetItems(env, run.datasetId).catch(() => []);
    candidates.push(...(run.actor === "google_maps" ? fromGmaps(rows, tokens) : fromReddit(rows, tokens)));
  }
  const items = pickVoices(candidates);
  await putVoicesStored(env, slug, {
    source: items.length ? "live" : "empty",
    version: VOICES_VERSION,
    commissioned: true,
    collected: new Date().toISOString().slice(0, 10),
    commissionedAt: rec.commissionedAt,
    candidates: candidates.length,
    rescoredAt: new Date().toISOString(),
    items,
  });
  await recordOutcome(env, slug, items.length).catch(() => {});
  // The ledger has to follow, or it keeps reporting what the first ingest kept
  // while the page shows what the current filter keeps, and the two disagree
  // in public. No cost: a rescore reads datasets already paid for.
  await appendActorCost(env, {
    slug,
    name: rec.name,
    at: new Date().toISOString(),
    event: "rescored",
    commissionedAt: rec.commissionedAt,
    costUsd: 0,
    candidates: candidates.length,
    kept: items.length,
  }).catch(() => {});
  return { ok: true, slug, candidates: candidates.length, kept: items.length, items };
}

// The homepage states how many corners have been scraped unattended and how
// many produced something that cleared the filter. Both numbers move only when
// a corner is ingested or rescored, so they are maintained here rather than
// recounted from a hundred keys on every page load.
async function recordOutcome(env, slug, kept) {
  const prior = (await getVoicesSummary(env)) || { corners: {}, at: null };
  const corners = { ...(prior.corners || {}), [slug]: kept };
  const slugs = Object.keys(corners);
  await putVoicesSummary(env, {
    at: new Date().toISOString(),
    corners,
    commissioned: slugs.length,
    withQuote: slugs.filter((s) => corners[s] > 0).length,
    quotes: slugs.reduce((n, s) => n + corners[s], 0),
  });
}

// ---------------------------------------------------------------- ingest

// Pick up whatever finished since the last cycle. A run still going is left
// pending and looked at again tomorrow; a run that failed is recorded as
// failed and dropped, because retrying a scrape forever is how a credit
// balance disappears.
export async function ingestVoices(env, cornerFor, max = 3) {
  const pending = await getVoicePending(env);
  if (!pending.length) return { checked: 0, ingested: [], stillPending: [] };

  const ingested = [];
  const stillPending = [];
  const problems = [];
  let checked = 0;

  for (const slug of pending) {
    if (checked >= max) {
      stillPending.push(slug);
      continue;
    }
    checked++;
    const rec = await getVoiceRun(env, slug);
    if (!rec) continue;

    const statuses = [];
    for (const run of rec.runs) {
      try {
        statuses.push({ ...run, ...(await runStatus(env, run.id)) });
      } catch (e) {
        statuses.push({ ...run, status: "UNKNOWN", error: String(e.message || e).slice(0, 90) });
      }
    }
    const terminal = (s) => ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(s.status);
    // A run whose cost is already in the ledger must not be counted again. A
    // corner topped up with a second actor keeps its first run in the record
    // so its dataset is still read, and without this the ledger would bill
    // that first run once per ingest.
    const alreadyBilled = new Set((rec.runs || []).filter((r) => r.billed).map((r) => r.id));
    if (!statuses.every(terminal)) {
      stillPending.push(slug);
      continue;
    }

    const corner = await cornerFor(slug);
    const tokens = corner ? cornerTokens(corner) : [];
    const candidates = [];
    let costUsd = 0;
    for (const s of statuses) {
      if (Number.isFinite(s.usageTotalUsd) && !alreadyBilled.has(s.id)) costUsd += s.usageTotalUsd;
      if (s.status !== "SUCCEEDED") {
        problems.push({ slug, actor: s.actor, status: s.status, ...(s.error ? { error: s.error } : {}) });
        continue;
      }
      try {
        const rows = await datasetItems(env, s.datasetId);
        candidates.push(...(s.actor === "google_maps" ? fromGmaps(rows, tokens) : fromReddit(rows, tokens)));
      } catch (e) {
        problems.push({ slug, actor: s.actor, status: "READ_FAILED", error: String(e.message || e).slice(0, 90) });
      }
    }

    const items = pickVoices(candidates);
    await putVoicesStored(env, slug, {
      source: items.length ? "live" : "empty",
      version: VOICES_VERSION,
      commissioned: true,
      collected: new Date().toISOString().slice(0, 10),
      commissionedAt: rec.commissionedAt,
      candidates: candidates.length,
      items,
    });
    await putVoiceRun(env, slug, {
      ...rec,
      status: "ingested",
      ingestedAt: new Date().toISOString(),
      costUsd,
      kept: items.length,
      // Marked here rather than at commission time, because a run only has a
      // final cost once it has finished.
      runs: (rec.runs || []).map((r) => ({ ...r, billed: true })),
    });
    await appendActorCost(env, {
      slug,
      name: rec.name,
      at: new Date().toISOString(),
      event: "ingested",
      commissionedAt: rec.commissionedAt,
      runs: statuses.map((s) => ({
        actor: s.actor,
        status: s.status,
        usd: alreadyBilled.has(s.id) ? null : s.usageTotalUsd ?? null,
        ...(alreadyBilled.has(s.id) ? { alreadyBilled: true } : {}),
      })),
      costUsd: Math.round(costUsd * 10000) / 10000,
      candidates: candidates.length,
      kept: items.length,
    });
    await recordOutcome(env, slug, items.length).catch(() => {});
    ingested.push({ slug, kept: items.length, candidates: candidates.length, costUsd });
  }

  await putVoicePending(env, stillPending);
  return { checked, ingested, stillPending, problems };
}
