import {
  CORNERS, DEFAULT_SLUG, SAMPLE, supervisorFor, canonicalSlug, makeCorner, SERVICE_NAMES,
} from "./data.js";
import { PAGE } from "./page.js";
import { parseQuery, locate, districtFor, soql } from "./resolve.js";
import {
  getCorner, putCorner, getImage, rateLimit, getScore, putScore, getHazards, putHazards,
} from "./store.js";
import { computeScore, SCORE_VERSION, SCORE_CAVEAT } from "./score.js";
import { imageryFor } from "./imagery.js";
import { corroborate, HAZARD_VERSION } from "./hazards.js";
import { credCheck, isSafetyCoverage } from "./cred.js";

// DataSF open datasets, keyless.
const DS_CRASHES = "ubvf-ztfx";
const DS_311 = "vw6y-z8j6";
const GEMINI_TEXT_MODEL = "gemini-3.7-flash";
// Bump to invalidate every edge-cached payload. Corrected figures must not be
// served from a cache holding the old ones. The edge cache is per-colo, so
// without this a correction lands unevenly across data centers and some
// visitors keep reading the old numbers for the life of the TTL.
const CACHE_VERSION = "v6";

// The letter embeds live figures, press headlines, and the Danger Index, so it
// goes stale in more ways than any other lane and it is the one artifact a
// person might actually send to an official. It carries its own version on top
// of CACHE_VERSION: bump this whenever the prompt, the facts fed into it, or the
// score semantics change, even if nothing else does.
const LETTER_VERSION = "v3";

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
async function corner(url, env) {
  const slug = canonicalSlug(url.searchParams.get("x") || DEFAULT_SLUG);
  if (CORNERS[slug]) return CORNERS[slug];
  const stored = await getCorner(env, slug);
  return stored || CORNERS[DEFAULT_SLUG];
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
  const [crashes, fatal, reports, dist] = await Promise.all([
    soql(DS_CRASHES, { "$select": "count(*)", "$where": crashWhere }),
    soql(DS_CRASHES, { "$select": "sum(number_killed)", "$where": crashWhere }).catch(() => []),
    soql(DS_311, {
      "$select": "count(*)",
      "$where": `${circle} AND requested_datetime > '${since}' AND service_name in(${services})`,
    }),
    // Grouped, not $limit 1. A major street is often a district boundary: within
    // 150m of 6th and Market, DataSF holds 242 rows in District 6 and 114 in
    // District 5, so a single arbitrary row picks the wrong Supervisor. The
    // corner's configured district wins; this is corroboration and a fallback.
    soql(DS_CRASHES, {
      "$select": "supervisor_district,count(*)",
      "$where": circle,
      "$group": "supervisor_district",
    }).catch(() => []),
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
async function todayFrame(c, env, origin) {
  if (CORNERS[c.slug]) {
    const r = await asset(env, origin, `/img/${c.slug}-today.jpg`);
    if (!r.ok) throw new Error(`today asset ${r.status}`);
    return r.arrayBuffer();
  }
  const bytes = await getImage(env, c.slug, "today");
  if (!bytes) throw new Error("no today frame stored");
  return bytes;
}

async function getHazardsFor(c, env, origin) {
  const hit = await getHazards(env, c.slug, HAZARD_VERSION);
  if (hit) return { ...hit, source: "cache" };
  const today = await todayFrame(c, env, origin);
  const fresh = await corroborate(c, today, env);
  await putHazards(env, c.slug, fresh);
  return fresh;
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
  return credCheck({ stats, news, voices, hazards });
}

// ---------------------------------------------------------------- news

// Agency primary sources. A police bulletin or an SFMTA project page is a real,
// citable document, but it is not press coverage of the corner: it is the
// record that coverage would be written about. Listed explicitly rather than
// pattern matched, so adding one is a deliberate decision.
const OFFICIAL_SOURCE = /^(sanfranciscopolice\.org|sfmta\.com|sf\.gov|sfgov\.org)$/i;
// Street names pulled from the corner itself, so the relevance filter travels to
// any corner. "16th Street and Mission Street" gives ["16th", "mission"].
function streetTokens(c) {
  return c.name
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|and)\b/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

async function getNews(c, env) {
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      query: `pedestrian safety OR crash OR traffic ${c.name} ${c.city}`,
      numResults: 8,
      type: "auto",
      contents: { text: { maxCharacters: 400 } },
    }),
  });
  if (r.status === 402) throw new Error("exa 402 credits");
  if (!r.ok) throw new Error(`exa ${r.status}`);
  const d = await r.json();
  const tokens = streetTokens(c);
  // Law firm and lead generation sites republish crash reports to farm clients.
  // They are not press coverage and they do not belong in an evidence lane.
  const DENY = /(lawfirm|law-firm|attorney|lawyer|injuryl|accidentl|legal)/i;
  const all = (d.results || []).filter((x) => x.title && !DENY.test(x.url || ""));

  const scored = all.map((x) => {
    const hay = (x.title + " " + (x.url || "") + " " + (x.text || "")).toLowerCase();
    const hits = tokens.filter((t) => hay.includes(t)).length;
    const titleHay = (x.title + " " + (x.url || "")).toLowerCase();
    // Corner level means both street names, not just the neighborhood.
    const corner = tokens.every((t) => titleHay.includes(t)) || (hits >= tokens.length && tokens.length > 1);
    return { x, corner, loose: tokens.some((t) => titleHay.includes(t)) };
  });

  const tight = scored.filter((s) => s.corner);
  // Only claim corner-level precision when there is enough of it to stand on.
  const precise = tight.length >= 3;
  const chosen = (precise ? tight : scored.filter((s) => s.loose)).map((s) => s.x);

  const mapped = chosen.map((x) => {
    const domain = (() => {
      try {
        return new URL(x.url).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })();
    return {
      title: x.title.trim(),
      url: x.url,
      domain,
      date: (x.publishedDate || "").slice(0, 10),
      official: OFFICIAL_SOURCE.test(domain),
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

  const byDate = (a, b) => (b.date || "").localeCompare(a.date || "");
  const cutoff = Date.now() - 18 * 30 * 24 * 3600 * 1000;
  const fresh = (x) => x.date && Date.parse(x.date) >= cutoff;
  // Only push stale results down when there is enough recent coverage to fill
  // the panel without them. A 2022 story beats an empty lane.
  const recent = press.filter(fresh);
  const orderedPress =
    recent.length >= 3
      ? [...recent.sort(byDate), ...press.filter((x) => !fresh(x)).sort(byDate)]
      : [...press].sort(byDate);

  const items = [...orderedPress, ...official.sort(byDate)].slice(0, 5);
  if (!items.length) throw new Error("exa no on-topic results");
  return {
    source: "live",
    precise,
    heading: precise ? "Press coverage" : "Coverage of this corridor",
    items,
  };
}

// ---------------------------------------------------------------- voices
// Real resident quotes, scraped once and parked in Upstash Redis. The panel
// reads that key directly: an Apify actor run takes minutes and a demo cannot
// wait on one. The baked asset stays behind it as a fallback.
async function getVoices(c, env, origin) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      return await redisVoices(c, env);
    } catch {
      // Fall through to the baked asset rather than showing the panel empty.
    }
  }
  return bakedVoices(c, env, origin);
}

async function redisVoices(c, env) {
  const key = c.voicesKey || `voices:${c.slug}`;
  const r = await fetch(`${env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  // Upstash wraps every reply as {"result": ...}, and the value stored under this
  // key is itself a JSON string, so it needs a second parse.
  const { result } = await r.json();
  if (!result) throw new Error("upstash key empty");
  const parsed = typeof result === "string" ? JSON.parse(result) : result;
  const items = (Array.isArray(parsed) ? parsed : parsed.items || [])
    .filter((v) => v && v.text)
    .map((v) => ({
      source: v.source || "web",
      stars: v.stars ?? null,
      text: String(v.text).trim(),
      when: v.when || null,
    }))
    .slice(0, 5);
  if (!items.length) throw new Error("upstash no usable quotes");
  return { source: "live", items };
}

async function bakedVoices(c, env, origin) {
  const r = await asset(env, origin, `/data/voices-${c.slug}.json`);
  if (!r.ok) throw new Error(`voices asset ${r.status}`);
  const d = await r.json();
  if (!d.items?.length) throw new Error("voices empty");
  return { source: "cache", items: d.items.slice(0, 5), collected: d.collected || null };
}

// ---------------------------------------------------------------- imagery
// Three states, all generated at build time by tools/generate_imagery.py and
// served as static assets. Nothing is generated during a demo.
async function getImagery(c, env, origin) {
  const base = `/img/${c.slug}`;
  const head = await asset(env, origin, `${base}-fix.jpg`);
  return {
    source: head.ok ? "cache" : "sample",
    today: `${base}-today.jpg`,
    hazards: `${base}-hazards.jpg`,
    fix: `${base}-fix.jpg`,
  };
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
  const supervisor = supervisorFor(ctx.stats.district);
  const headlines = (ctx.news.items || [])
    .slice(0, 2)
    .map((n) => `"${n.title}" (${n.domain}${n.date ? ", " + n.date : ""})`)
    .join("; ");
  // Only feed the letter a resident quote that is actually about the street. The
  // scrape at this corner returns plenty of transit-station commentary, and a
  // letter quoting a review of the escalators would weaken the ask.
  const ONTOPIC = /crosswalk|crossing|pedestrian|sidewalk|driver|traffic|curb|intersection|corner/i;
  const quote = (ctx.voices.items || []).map((v) => v.text).find((t) => t && ONTOPIC.test(t));
  // With no clear district majority the addressee is the citywide official, and
  // the letter must not invent a district number to sound authoritative.
  const dist = ctx.stats.district;
  const addressee = dist ? `Supervisor ${supervisor}` : supervisor;
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

  const scoreLine = ctx.score
    ? `- This intersection scores ${ctx.score.index} out of 100 on our reported-harm index, grade ${ctx.score.grade}. State that score and immediately add this caveat in your own words: ${SCORE_CAVEAT}\n`
    : "";

  const prompt = `Write a respectful one-page letter from a resident to San Francisco ${addressee} about the intersection of ${c.name}${where}.

Use these facts and cite them plainly:
- ${ctx.stats.crashes} injury collisions recorded by the city within 150 meters of this intersection in the last five years${ctx.stats.fatal ? `, ${ctx.stats.fatal} of them fatal` : ""}. Do not describe this figure as covering any longer period.
- ${ctx.stats.reports311} street-condition 311 reports at this location in the last three years, counting street defects, sidewalk and curb, signs, streetlights and blocked sidewalks only.
${headlines ? `- Recent press coverage: ${headlines}.` : "- No press coverage was found for this corner. Do not cite or invent any news reporting."}
${scoreLine}${hazardLines}
${quote ? `- A resident said: ${quote}` : "- Do not quote or invent any resident testimony."}
- The request: fund ${c.fix.name}, estimated ${c.fix.cost}, through the ${c.fix.grant}.

Rules: plain civic English. Under 220 words. Address only ${addressee}. Distinguish clearly between what city records document and what the visual audit merely observed. Never present an observation as a documented fact. No em dashes anywhere. No placeholders in brackets. Sign off as "${signoff}". Return only the letter text.`;

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  );
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const d = await r.json();
  const text = (d.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("gemini empty letter");
  return {
    source: "live",
    supervisor,
    text: text.replace(/—/g, ", "),
    fix: c.fix.name,
    cost: c.fix.cost,
    grant: c.fix.grant,
  };
}

function sampleLetter(c, district) {
  const supervisor = supervisorFor(district);
  const salutation = district ? `Dear Supervisor ${supervisor}` : `Dear ${supervisor}`;
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
      const r = await asset(env, origin, `/img/${c.slug}-fix.jpg`);
      if (!r.ok) throw new Error(`missing ${r.status}`);
    }),
    ping("staticmap", async () => {
      // Cache first, so a health check does not spend a Static Maps request.
      if (await caches.default.match(mapCacheKey(c))) return;
      const r = await fetch(staticMapUrl(c, env));
      if (!r.ok || !(r.headers.get("content-type") || "").startsWith("image/"))
        throw new Error(`http ${r.status}`);
    }),
    ping("upstash", async () => {
      if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN)
        throw new Error("not configured");
      await redisVoices(c, env);
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

  const parsed = parseQuery(q);
  if (!parsed.ok) {
    return json({
      ok: false,
      reason: parsed.reason,
      message: 'Type two cross streets, like "24th and Valencia" or "Turk & Taylor".',
    });
  }

  const slug = canonicalSlug(parsed.slug);

  if (CORNERS[slug]) {
    const c = CORNERS[slug];
    return json({ ok: true, slug: c.slug, name: c.name, district: c.district, source: "precomputed" });
  }

  const cached = await getCorner(env, slug);
  if (cached) {
    return json({ ok: true, slug: cached.slug, name: cached.name, district: cached.district, source: "cache" });
  }

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
    return json({ ok: false, reason: loc.reason, message });
  }

  const district = await districtFor(loc.lat, loc.lon).catch(() => null);
  const c = makeCorner({
    slug,
    name: parsed.name,
    lat: loc.lat,
    lon: loc.lon,
    district,
    cnn: loc.cnn,
  });
  await putCorner(env, c);

  return json({ ok: true, slug: c.slug, name: c.name, district, source: loc.source });
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
export default {
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

      const c = await corner(url, env);

      if (p === "/map.jpg") {
        return await mapImage(c, env, ctx);
      }

      if (p === "/" || p === "/index.html") {
        return new Response(PAGE(c), {
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
        return await edgeCached(ctx, `cred-${c.slug}`, 3600, () => getCred(c, env, origin));
      }

      if (p === "/api/hazards") {
        return await edgeCached(ctx, `hazards-${c.slug}`, 24 * 3600, () =>
          getHazardsFor(c, env, origin).catch(() => ({ source: "empty", items: [] })),
        );
      }

      if (p === "/api/score") {
        return await edgeCached(ctx, `score-${c.slug}`, 3600, () => getScoreFor(c, env));
      }

      if (p === "/api/voices") {
        const v = await getVoices(c, env, origin).catch(emptyVoices);
        return json(v);
      }

      if (p === "/api/imagery") {
        // Precomputed corners serve from static assets exactly as before: no
        // status field, no polling, no generation, same speed.
        if (CORNERS[c.slug]) return json(await getImagery(c, env, origin));
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
            const [stats, news, voices, score, hazards] = await Promise.all([
              getStats(c).catch(() => sampleStats(c)),
              getNews(c, env).catch(() => sampleNews(c)),
              getVoices(c, env, origin).catch(emptyVoices),
              getScoreFor(c, env).catch(() => null),
              getHazardsFor(c, env, origin).catch(() => null),
            ]);
            return getLetter(c, env, { stats, news, voices, score, hazards }).catch(() =>
              sampleLetter(c, stats.district),
            );
          }),
        );
      }

      if (p === "/api/health") {
        return json(await health(env, origin));
      }

      return new Response("not found", { status: 404 });
    } catch (e) {
      // No endpoint may ever return an error to the browser.
      if (p.startsWith("/api/")) return json({ source: "sample", error: String(e.message || e) });
      return new Response("not found", { status: 404 });
    }
  },
};
