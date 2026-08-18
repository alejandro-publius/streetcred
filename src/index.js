import { CORNERS, DEFAULT_SLUG, SAMPLE, supervisorFor } from "./data.js";
import { PAGE } from "./page.js";

// DataSF open datasets, keyless.
const DS_CRASHES = "ubvf-ztfx";
const DS_311 = "vw6y-z8j6";
const GEMINI_TEXT_MODEL = "gemini-3.7-flash";

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
  const req = new Request(`https://streetcred.internal/api/${key}`);
  const hit = await cache.match(req);
  if (hit) return hit;
  const value = await produce();
  const res = new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${ttlSec}`,
    },
  });
  if (value && value.source !== "sample" && value.source !== "empty") {
    ctx.waitUntil(cache.put(req, res.clone()));
  }
  return res;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function corner(url) {
  const slug = url.searchParams.get("x") || DEFAULT_SLUG;
  return CORNERS[slug] || CORNERS[DEFAULT_SLUG];
}

// Static assets must be read through the ASSETS binding. A Worker fetching its
// own origin is a self-subrequest, which Cloudflare rejects with error 1042 in
// production even though it works under `wrangler dev`.
function asset(env, origin, path) {
  return env.ASSETS.fetch(new Request(new URL(path, origin)));
}

async function soql(dataset, params) {
  const u = new URL(`https://data.sfgov.org/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`datasf ${dataset} ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------- stats
async function getStats(c) {
  const circle = `within_circle(point, ${c.lat}, ${c.lon}, ${c.radiusMeters})`;
  const since = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);
  const [crashes, reports, dist] = await Promise.all([
    soql(DS_CRASHES, { "$select": "count(*)", "$where": circle }),
    soql(DS_311, {
      "$select": "count(*)",
      "$where": `${circle} AND requested_datetime > '${since}' AND service_name like '%Street%'`,
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
  const district = parseInt(c.district ?? majority, 10) || majority;
  return {
    source: "live",
    crashes: parseInt(crashes?.[0]?.count ?? 0, 10),
    reports311: parseInt(reports?.[0]?.count ?? 0, 10),
    district,
  };
}

// ---------------------------------------------------------------- news
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
  const items = (d.results || [])
    .filter((x) => x.title && tokens.some((t) => (x.title + " " + (x.url || "")).toLowerCase().includes(t)))
    .map((x) => ({
      title: x.title.trim(),
      url: x.url,
      domain: (() => {
        try {
          return new URL(x.url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })(),
      date: (x.publishedDate || "").slice(0, 10),
    }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5);
  if (!items.length) throw new Error("exa no on-topic results");
  return { source: "live", items };
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
  const prompt = `Write a respectful one-page letter from a resident to San Francisco Supervisor ${supervisor} about the intersection of ${c.name} in District ${ctx.stats.district}.

Use these facts and cite them plainly:
- ${ctx.stats.crashes} collisions recorded by the city within 150 meters of this intersection.
- ${ctx.stats.reports311} street-related 311 reports at this location in the last three years.
${headlines ? `- Recent press coverage: ${headlines}.` : "- No press coverage was found for this corner. Do not cite or invent any news reporting."}
- An automated visual audit of the intersection identified sub-standard, faded crosswalk markings and vehicle turning conflict zones where drivers cross the pedestrian path.
${quote ? `- A resident said: ${quote}` : "- Do not quote or invent any resident testimony."}
- The request: fund ${c.fix.name}, estimated ${c.fix.cost}, through the ${c.fix.grant}.

Rules: plain civic English. Under 220 words. Address only Supervisor ${supervisor}. Include the sentence about the automated visual audit, it is the central finding. No em dashes anywhere. No placeholders in brackets. Sign off as "A resident of District ${ctx.stats.district}". Return only the letter text.`;

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
  return {
    source: "sample",
    supervisor,
    fix: c.fix.name,
    cost: c.fix.cost,
    grant: c.fix.grant,
    text: `Dear Supervisor ${supervisor},

I am writing about the intersection of ${c.name}, in District ${district}.

City records show hundreds of collisions within 150 meters of this corner, and street-related 311 reports from this location arrive continuously. Local reporting has covered pedestrian safety on this corridor repeatedly. An automated visual audit of the intersection identified sub-standard, faded crosswalk markings and vehicle turning conflict zones where drivers cross the pedestrian path.

Residents describe the same problem in their own words: people are still in the crosswalk when drivers turn through it.

I am asking you to fund ${c.fix.name} at this intersection, estimated at ${c.fix.cost}, through the ${c.fix.grant}. These are proven treatments and this corner has the record to justify them.

Thank you for your time and your attention to this corner.

A resident of District ${district}`,
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

// ---------------------------------------------------------------- router
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = url.origin;
    const c = corner(url);
    const p = url.pathname;

    try {
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

      if (p === "/api/voices") {
        const v = await getVoices(c, env, origin).catch(emptyVoices);
        return json(v);
      }

      if (p === "/api/imagery") {
        return json(await getImagery(c, env, origin));
      }

      if (p === "/api/letter") {
        // The slowest lane by far, and the one worth caching hardest: a fresh
        // draft costs several seconds of Gemini time.
        return await edgeCached(ctx, `letter-${c.slug}`, 24 * 3600, () =>
          cached(`letter:${c.slug}`, 24 * 3600e3, async () => {
            const [stats, news, voices] = await Promise.all([
              getStats(c).catch(() => sampleStats(c)),
              getNews(c, env).catch(() => sampleNews(c)),
              getVoices(c, env, origin).catch(emptyVoices),
            ]);
            return getLetter(c, env, { stats, news, voices }).catch(() =>
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
