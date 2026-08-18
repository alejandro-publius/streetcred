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
const STRONG =
  /\b(pedestrian|crosswalk|crossing|struck|hit by|run over|killed|collision|crash|jaywalk|speeding|curb ramp)\b/gi;
const WEAK =
  /\b(traffic|sidewalk|corner|intersection|driver|drivers|car|cars|bike|walk|walking|dangerous|unsafe|safety|signal|curb|plaza)\b/gi;
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
  let s = 3 * count(STRONG, text) + count(WEAK, text);
  const low = text.toLowerCase();
  if (cornerTokens.some((t) => t && low.includes(t))) s += 2;
  return s;
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

async function startRun(env, actor, input) {
  const r = await fetch(`${API}/acts/${actor}/runs?token=${env.APIFY_TOKEN}&timeout=600&memory=2048`, {
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
export async function commissionVoices(env, c) {
  const budget = await actorRunBudget(env);
  const started = [];
  const failed = [];

  for (const [name, actor, input] of [
    ["google_maps", GMAPS_ACTOR, gmapsInput(c)],
    ["reddit", REDDIT_ACTOR, redditInput(c)],
  ]) {
    if (!(await reserveActorRun(env))) {
      failed.push({ actor: name, reason: `monthly actor run cap reached (${budget.cap})` });
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
    return { ok: false, slug: c.slug, started: [], failed };
  }

  const rec = {
    slug: c.slug,
    name: c.name,
    commissionedAt: new Date().toISOString(),
    runs: started,
    failed,
    status: "pending",
  };
  await putVoiceRun(env, c.slug, rec);
  const pending = await getVoicePending(env);
  await putVoicePending(env, [c.slug, ...pending.filter((s) => s !== c.slug)]);
  return { ok: true, ...rec };
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
    if (!statuses.every(terminal)) {
      stillPending.push(slug);
      continue;
    }

    const corner = await cornerFor(slug);
    const tokens = corner ? cornerTokens(corner) : [];
    const candidates = [];
    let costUsd = 0;
    for (const s of statuses) {
      if (Number.isFinite(s.usageTotalUsd)) costUsd += s.usageTotalUsd;
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
    await putVoiceRun(env, slug, { ...rec, status: "ingested", ingestedAt: new Date().toISOString(), costUsd, kept: items.length });
    await appendActorCost(env, {
      slug,
      name: rec.name,
      at: new Date().toISOString(),
      runs: statuses.map((s) => ({ actor: s.actor, status: s.status, usd: s.usageTotalUsd ?? null })),
      costUsd: Math.round(costUsd * 10000) / 10000,
      candidates: candidates.length,
      kept: items.length,
    });
    ingested.push({ slug, kept: items.length, candidates: candidates.length, costUsd });
  }

  await putVoicePending(env, stillPending);
  return { checked, ingested, stillPending, problems };
}
