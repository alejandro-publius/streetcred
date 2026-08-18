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
    soql(DS_CRASHES, { "$select": "supervisor_district", "$where": circle, "$limit": 1 }),
  ]);
  // Landmine: crashes return "11" but 311 returns "9.00000". Always parseInt.
  const district = parseInt(dist?.[0]?.supervisor_district ?? c.district, 10) || c.district;
  return {
    source: "live",
    crashes: parseInt(crashes?.[0]?.count ?? 0, 10),
    reports311: parseInt(reports?.[0]?.count ?? 0, 10),
    district,
  };
}

// ---------------------------------------------------------------- news
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
  const tokens = ["16th", "mission", "sixteenth"];
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
- Recent press coverage: ${headlines || "local reporting on Mission Street pedestrian safety"}.
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
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    const c = corner(url);
    const p = url.pathname;

    try {
      if (p === "/" || p === "/index.html") {
        return new Response(PAGE(c), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (p === "/api/stats") {
        const v = await cached(`stats:${c.slug}`, 3600e3, () =>
          getStats(c).catch(() => ({ source: "sample", ...SAMPLE.stats })),
        );
        return json(v);
      }

      if (p === "/api/news") {
        const v = await cached(`news:${c.slug}`, 600e3, () =>
          getNews(c, env).catch(() => ({ source: "sample", items: SAMPLE.news })),
        );
        return json(v);
      }

      if (p === "/api/voices") {
        const v = await getVoices(c, env, origin).catch(() => ({
          source: "sample",
          items: SAMPLE.voices,
        }));
        return json(v);
      }

      if (p === "/api/imagery") {
        return json(await getImagery(c, env, origin));
      }

      if (p === "/api/letter") {
        const v = await cached(`letter:${c.slug}`, 24 * 3600e3, async () => {
          const [stats, news, voices] = await Promise.all([
            getStats(c).catch(() => ({ source: "sample", ...SAMPLE.stats })),
            getNews(c, env).catch(() => ({ source: "sample", items: SAMPLE.news })),
            getVoices(c, env, origin).catch(() => ({ source: "sample", items: SAMPLE.voices })),
          ]);
          return getLetter(c, env, { stats, news, voices }).catch(() =>
            sampleLetter(c, stats.district),
          );
        });
        return json(v);
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
