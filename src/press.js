// Entity discovery over press coverage.
//
// Every other lane on this site starts from a corner and asks what is written
// about it. This one runs the other way: it starts from the city's coverage and
// asks which corners are in it. That is an entity-discovery problem, and it is
// only worth anything if the entities are verified, so the shape is:
//
//   citywide semantic query  ->  candidate crossings named in the text
//                            ->  exact match in the graded-city index
//                            ->  coverage confirmed to be about safety
//                            ->  surfaced, with the article that named it
//   everything that fails    ->  logged as a reject, with the reason
//
// A candidate that cannot clear all three bars is not shown. The rejects are
// kept and published because a discovery pipeline that only shows its hits is
// indistinguishable from a search box with good luck.
//
// This is a Websets-shaped workflow (find entities, verify each against hard
// criteria, keep the ones that survive) implemented directly on Exa's search
// API, which is what the event credits cover.

import { cityCornerFor, getCityStreets } from "./city.js";
import { parseQuery } from "./resolve.js";
import { canonicalSlug } from "./data.js";
import { DENY, domainOf } from "./newsfilter.js";
import { isSafetyCoverage } from "./cred.js";
import { reserveExa, recordExaSpend } from "./store.js";

export const WATCHLIST_VERSION = "v1";
export const CONNECTIONS_VERSION = "v1";

const EXA_SEARCH = "https://api.exa.ai/search";
const EXA_SIMILAR = "https://api.exa.ai/findSimilar";

// Domains handed to Exa rather than filtered after the fact. The client-side
// DENY regex still runs, because it catches the ones that are not in this list,
// but excluding them at the API means the result slots are spent on coverage
// instead of on lead generation.
const EXCLUDE_DOMAINS = [
  "lawyer.com", "findlaw.com", "justia.com", "avvo.com", "nolo.com",
  "attorneys.com", "lawfirms.com", "injuryclaimcoach.com",
];

// The San Francisco outlets that actually name a crossing. National and wire
// coverage says "a San Francisco intersection"; a neighbourhood newsroom says
// "Mission and Norton", which is the only kind of sentence this pipeline can
// verify. One query is restricted to them at the API rather than filtered
// afterwards, so the whole result slate comes from outlets that write at
// corner resolution.
const LOCAL_OUTLETS = [
  "missionlocal.org", "sfstandard.com", "sfchronicle.com", "sfexaminer.com",
  "hoodline.com", "sf.streetsblog.org", "inglesidelight.com", "sfist.com",
  "richmondsunsetnews.com", "broked.com", "48hills.org", "sfgate.com",
];

// The neighbourhoods whose local coverage names crossings. A citywide query
// finds citywide stories; "the Excelsior" finds the story about one corner in
// the Excelsior, which is the only kind this pipeline can verify.
const NEIGHBOURHOODS = [
  "the Tenderloin", "the Excelsior", "the Bayview", "the Sunset", "the Mission",
  "SoMa", "the Richmond", "Chinatown", "the Castro", "Visitacion Valley",
];

// Citywide, deliberately not corner-shaped. Each is a different way of asking
// the same question, because one phrasing finds one kind of story: a death, a
// redesign, a campaign, a petition, a meeting, a piece of enforcement news.
// Roughly thirty in total once the neighbourhood variants are expanded, which
// is thirty searches per build and the reason this runs once a morning rather
// than on a page load.
export const WATCHLIST_QUERIES = [
  { query: "pedestrian struck or killed crossing the street in San Francisco" },
  { query: "San Francisco intersection redesign, crosswalk or traffic calming project" },
  { query: "residents demand safety changes at a San Francisco intersection" },
  { query: "San Francisco Vision Zero high injury corridor collision report" },
  { query: "San Francisco neighborhood traffic safety meeting about a dangerous corner" },
  { query: "SFMTA approves changes at a San Francisco intersection after a crash" },
  { query: "cyclist hit by a driver at a San Francisco intersection" },
  { query: "hit and run at a San Francisco crosswalk" },
  { query: "San Francisco school crossing safety concerns for children" },
  { query: "senior pedestrian injured crossing a street in San Francisco" },
  // Petitions and organising: the corner people are already asking about.
  { query: "petition for a stop sign or traffic signal at a San Francisco intersection" },
  { query: "neighbors petition San Francisco for a crosswalk after a collision" },
  { query: "community meeting about a dangerous San Francisco crossing" },
  { query: "supervisor calls for safety improvements at a San Francisco intersection" },
  { query: "San Francisco daylighting or leading pedestrian interval at an intersection" },
  { query: "quick build safety project San Francisco street corner" },
  // The local pass, restricted to the outlets that write at corner resolution.
  { query: "dangerous intersection where pedestrians have been hit in San Francisco", includeDomains: LOCAL_OUTLETS },
  { query: "crosswalk safety changes coming to a San Francisco corner", includeDomains: LOCAL_OUTLETS },
  { query: "collision at an intersection reported in San Francisco this month", includeDomains: LOCAL_OUTLETS },
  // Neighbourhood anchored, one per neighbourhood, rotating the safety term so
  // the set is not ten copies of one query with the place name swapped.
  ...NEIGHBOURHOODS.map((hood, i) => ({
    query: `${["crosswalk", "crash", "traffic calming", "pedestrian safety"][i % 4]} at an intersection in ${hood}, San Francisco`,
  })),
];

// ---------------------------------------------------------------- extraction

// Two street-ish names joined by and, at, or an ampersand. Deliberately narrow:
// it only proposes a candidate, and every candidate then has to survive being
// looked up in the city's own index, which is what stops "Vision Zero" or
// "Walk and Bike" from being offered as a corner.
const PAIR =
  /\b((?:\d{1,3}(?:st|nd|rd|th))|(?:[A-Z][a-z]{2,})(?:\s[A-Z][a-z]{2,})?)\s+(?:and|at|&)\s+((?:\d{1,3}(?:st|nd|rd|th))|(?:[A-Z][a-z]{2,})(?:\s[A-Z][a-z]{2,})?)\b/g;

// Words that pass the shape test but are never street names, so a headline
// about "Safety and Enforcement" does not become a corner.
const NOT_A_STREET = new Set([
  "safety", "vision", "zero", "traffic", "pedestrian", "bike", "walk", "transit",
  "police", "city", "san", "francisco", "muni", "bart", "street", "streets",
  "avenue", "district", "supervisor", "mayor", "plan", "project", "program",
  "improvement", "improvements", "crash", "crashes", "collision", "collisions",
  "death", "deaths", "injury", "injuries", "news", "report", "reports", "study",
  "public", "works", "board", "county", "state", "california", "bay", "area",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "june", "july", "august",
  "september", "october", "november", "december", "years", "year", "people",
  "man", "woman", "driver", "drivers", "victim", "officials", "hours", "morning",
  "evening", "night", "east", "west", "north", "south", "one", "two", "three",
]);

// A pair of capitalized words joined by "and" is an extremely common shape in
// English, and page text from a news site is full of it: "Metro Areas and Our
// Cities", "Development and Real Estate", "Crime and Emergencies" are all
// navigation menus, and all three look exactly like an intersection to a
// regex. The index rejects every one of them, but a reject log full of
// navigation furniture reads as a broken extractor rather than a careful one.
//
// So a candidate also has to sit in street context: somewhere in the 70
// characters either side there must be a word that means this sentence is
// about a road. That is how a person reads it, and it is the difference
// between proposing four real crossings and proposing thirty phrases.
const STREET_CONTEXT =
  /\b(street|streets|st|avenue|avenues|ave|boulevard|blvd|road|roads|rd|drive|dr|way|highway|intersection|intersections|junction|crossing|crossings|crosswalk|crosswalks|corner|corners|block|blocks|sidewalk|curb|lane|lanes|traffic|collision|collisions|crash|crashes|struck|killed|injured|hit|died|pedestrian|pedestrians|cyclist|driver|drivers|vehicle|car|cars|bus|muni|signal|signals|stop|speeding)\b/i;

const CONTEXT_WINDOW = 70;

// How recent a connecting article has to be. The claim a connection makes is
// that the press is writing about two corners in the same breath, and a blog
// post from 2007 is not the same breath as anything: it is the archive, which
// findSimilar is happy to return.
const CONNECTION_MAX_AGE_MS = 3 * 365 * 24 * 3600 * 1000;

// The candidate names a piece of text proposes. Shared by the watchlist, the
// connections pass and the homepage lead, so all three propose corners by the
// same rule; three regexes would eventually disagree about what a street is.
export function candidatesFrom(text) {
  const src = String(text || "");
  const out = [];
  for (const m of src.matchAll(PAIR)) {
    const a = m[1].trim();
    const b = m[2].trim();
    if (a.toLowerCase() === b.toLowerCase()) continue;
    if (NOT_A_STREET.has(a.toLowerCase()) || NOT_A_STREET.has(b.toLowerCase())) continue;
    const from = Math.max(0, m.index - CONTEXT_WINDOW);
    const window = src.slice(from, m.index + m[0].length + CONTEXT_WINDOW);
    // The pair itself must not be what satisfies the context test: a street
    // named "Lane" would otherwise vouch for itself.
    const around = window.slice(0, m.index - from) + " " + window.slice(m.index - from + m[0].length);
    if (!STREET_CONTEXT.test(around)) continue;
    out.push(`${a} and ${b}`);
  }
  return out;
}

// The street tokens a candidate is made of, used to ask whether the article
// that named it is actually about safety AT it rather than about the city.
const tokensOf = (name) =>
  String(name).toLowerCase().split(/\s+and\s+/).map((t) => t.trim()).filter((t) => t.length > 1);

// ---------------------------------------------------------------- verification

// The hard criteria, in one place, returning either a verified entity or the
// precise reason it failed. Nothing surfaces without passing all of them.
//
// The index is the graded city itself: 7,353 crossings in KV shards, one read
// per lookup, no geocoding and no external call. A candidate that is not an
// exact slug match in it is not a corner this site can stand behind, and the
// reject says exactly that rather than claiming the street does not exist.
export async function verifyCandidate(env, candidate, article, opts = {}) {
  const parsed = parseQuery(candidate);
  if (!parsed.ok) return { ok: false, candidate, noise: true, reason: `not a pair of street names (${parsed.reason})` };

  // First bar, and the cheap one: are these San Francisco street names at all?
  // Page text is full of capitalized pairs joined by "and", and without this
  // the reject log is mostly navigation menus. A phrase that names no street
  // in the city is noise and is counted rather than shown; a pair of real
  // street names that do not meet at a graded crossing is a finding, and that
  // one is worth reading.
  const streets = opts.streets || (await getCityStreets(env));
  if (streets) {
    const unknown = parsed.streets.filter((st) => !streets.has(st));
    if (unknown.length) {
      return {
        ok: false,
        candidate,
        noise: true,
        reason:
          unknown.length === parsed.streets.length
            ? "neither name is a San Francisco street"
            : `"${unknown[0]}" is not a San Francisco street name`,
      };
    }
  }

  const slug = canonicalSlug(parsed.slug);

  if (opts.skip && opts.skip.has(slug)) {
    return { ok: false, candidate, slug, name: parsed.name, reason: "already audited, so this is a corner we have done rather than a lead" };
  }


  const corner = await cityCornerFor(env, slug);
  if (!corner) {
    return { ok: false, candidate, slug, name: parsed.name, reason: "no graded crossing by that name in the citywide index" };
  }

  // Coverage confirmed: the article has to name this crossing AND talk about
  // harm on the street. Without this a redesign announcement that lists six
  // intersections in passing would put all six on a safety watchlist.
  const confirmed = isSafetyCoverage(
    { title: article.title, text: article.text },
    tokensOf(parsed.name),
  );
  if (!confirmed) {
    return { ok: false, candidate, slug, name: parsed.name, reason: "the article names this crossing but is not about safety at it" };
  }

  return {
    ok: true,
    slug,
    name: parsed.name,
    grade: corner.sweep.grade,
    index: corner.sweep.index,
    points: corner.sweep.points,
    district: corner.sweep.district,
    lat: corner.lat,
    lon: corner.lon,
  };
}

// ---------------------------------------------------------------- exa calls

async function exaSearch(env, body) {
  const r = await fetch(EXA_SEARCH, {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 402) throw new Error("exa 402 credits");
  if (!r.ok) throw new Error(`exa search ${r.status}`);
  const d = await r.json();
  await recordExaSpend(env, d?.costDollars?.total).catch(() => {});
  return d;
}

async function exaSimilar(env, body) {
  const r = await fetch(EXA_SIMILAR, {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 402) throw new Error("exa 402 credits");
  if (!r.ok) throw new Error(`exa findSimilar ${r.status}`);
  const d = await r.json();
  await recordExaSpend(env, d?.costDollars?.total).catch(() => {});
  return d;
}

const articleOf = (x) => ({
  title: String(x.title || "").trim(),
  url: x.url,
  domain: domainOf(x.url),
  date: (x.publishedDate || "").slice(0, 10),
  text: x.text || "",
});

const publicArticle = ({ title, url, domain, date }) => ({ title, url, domain, date });

// ---------------------------------------------------------------- watchlist

// One pass over the city's recent coverage. Costs one Exa search per query, so
// the whole watchlist is four searches, reserved against the budget up front.
export async function buildWatchlist(env, opts = {}) {
  const queries = opts.queries || WATCHLIST_QUERIES;
  const days = opts.days || 90;
  const skip = opts.skip || new Set();

  if (!(await reserveExa(env, queries.length))) {
    return { source: "unavailable", version: WATCHLIST_VERSION, reason: "exa call budget exhausted" };
  }

  // Loaded once, not per candidate. A per-candidate read that fails once
  // disables the bar for the rest of the pass, and the only symptom is a
  // reject log quietly filling with navigation menus.
  const streets = await getCityStreets(env);
  if (!streets) return { source: "unavailable", version: WATCHLIST_VERSION, reason: "the city street index is missing, so no candidate can be verified" };

  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const searches = await Promise.all(
    queries.map((q) =>
      exaSearch(env, {
        query: q.query,
        type: "neural",
        category: "news",
        numResults: 15,
        startPublishedDate: since,
        contents: { text: { maxCharacters: 800 } },
        // Include and exclude are mutually exclusive at the API: a query
        // restricted to a list of outlets does not also need a deny list,
        // because nothing outside the list can come back.
        ...(q.includeDomains
          ? { includeDomains: q.includeDomains }
          : { excludeDomains: EXCLUDE_DOMAINS }),
      })
        .then((d) => ({ query: q.query, local: Boolean(q.includeDomains), results: d.results || [] }))
        .catch((e) => ({ query: q.query, local: Boolean(q.includeDomains), results: [], failed: String(e.message || e).slice(0, 90) })),
    ),
  );

  const entries = [];
  const rejects = [];
  const noise = [];
  const seenEntry = new Set();
  const seenReject = new Set();
  let articles = 0;

  for (const s of searches) {
    for (const raw of s.results) {
      if (!raw?.title || DENY.test(raw.url || "")) continue;
      articles++;
      const article = articleOf(raw);
      const cands = [...new Set(candidatesFrom(`${article.title}. ${article.text}`))];
      for (const cand of cands) {
        const v = await verifyCandidate(env, cand, article, { skip, streets });
        if (v.ok) {
          if (seenEntry.has(v.slug)) continue;
          seenEntry.add(v.slug);
          entries.push({ ...v, query: s.query, article: publicArticle(article) });
        } else {
          const key = `${v.slug || v.candidate}:${v.reason}`;
          if (seenReject.has(key)) continue;
          seenReject.add(key);
          if (v.noise) noise.push(v);
          else rejects.push({ ...v, article: publicArticle(article) });
        }
      }
    }
  }

  // Worst first, because a watchlist is a work queue and the point is which
  // corner to look at next.
  entries.sort((a, b) => b.points - a.points);

  return {
    source: entries.length ? "live" : "empty",
    version: WATCHLIST_VERSION,
    builtAt: new Date().toISOString(),
    windowDays: days,
    queries: searches.map((s) => ({ query: s.query, results: s.results.length, local: s.local, ...(s.failed ? { failed: s.failed } : {}) })),
    calls: queries.length,
    articles,
    entries,
    // Kept deliberately. A discovery pass that publishes only its hits is
    // indistinguishable from a lucky search box. These are the corner-shaped
    // rejects: real San Francisco street names that did not clear one of the
    // remaining bars.
    rejects: rejects.slice(0, 40),
    rejected: rejects.length,
    // Phrases that named no street in the city. Counted rather than listed,
    // because a page of "Metro Areas and Our Cities" teaches a reader nothing
    // except that the extractor reads navigation menus.
    discarded: noise.length,
  };
}

// ---------------------------------------------------------------- connections

// findSimilar, used for what it is actually good at: given the story about this
// corner, what else is being written in the same breath. Where that related
// coverage names another crossing the city index knows, the two corners are
// connected, and both pages say so. Anything fuzzy is dropped, and an empty
// result stays empty.
export async function buildConnections(env, corner, seed, opts = {}) {
  if (!seed?.url) return { source: "empty", version: CONNECTIONS_VERSION, reason: "no seed article at this corner" };
  if (!(await reserveExa(env, 1))) {
    return { source: "unavailable", version: CONNECTIONS_VERSION, reason: "exa call budget exhausted" };
  }

  const d = await exaSimilar(env, {
    url: seed.url,
    numResults: 10,
    excludeSourceDomain: false,
    excludeDomains: EXCLUDE_DOMAINS,
    contents: { text: { maxCharacters: 800 } },
  });

  const streets = await getCityStreets(env);
  if (!streets) return { source: "unavailable", version: CONNECTIONS_VERSION, reason: "the city street index is missing, so no candidate can be verified" };

  const results = (d.results || []).filter((x) => x?.title && !DENY.test(x.url || ""));
  const links = [];
  const rejects = [];
  const seen = new Set([corner.slug]);

  for (const raw of results) {
    const article = articleOf(raw);

    // A connection asserts a relationship between two corners, which is a
    // stronger claim than "this article mentions a corner", so it gets two
    // bars the watchlist does not need.
    //
    // First: an undated result with a bare path is a site homepage, not an
    // article. findSimilar returns them and they carry whatever happens to be
    // on the front page that day, which is how "Welcome to Westside Observer"
    // became a citation.
    if (!article.date) {
      rejects.push({ candidate: article.domain, reason: "undated result, not a dated article" });
      continue;
    }

    // Second: the claim is that the press writes about these two corners in
    // the same breath, and a 2007 blog post is not the same breath as
    // anything. Without this bar findSimilar happily returns the archive, and
    // an eighteen-year-old signal-timing post becomes a live connection.
    if (Date.now() - Date.parse(article.date) > CONNECTION_MAX_AGE_MS) {
      rejects.push({ candidate: article.domain, reason: `coverage from ${article.date} is too old to be a current connection` });
      continue;
    }
    let path = "/";
    try { path = new URL(article.url).pathname; } catch { path = "/"; }
    if (path === "/" || path === "") {
      rejects.push({ candidate: article.domain, reason: "site homepage rather than an article" });
      continue;
    }

    for (const cand of [...new Set(candidatesFrom(`${article.title}. ${article.text}`))]) {
      const v = await verifyCandidate(env, cand, article, { ...opts, streets });
      if (!v.ok) {
        rejects.push({ candidate: v.candidate, reason: v.reason });
        continue;
      }
      if (seen.has(v.slug)) continue;
      seen.add(v.slug);
      links.push({
        slug: v.slug,
        name: v.name,
        grade: v.grade,
        index: v.index,
        article: publicArticle(article),
      });
    }
  }

  return {
    source: links.length ? "live" : "empty",
    version: CONNECTIONS_VERSION,
    builtAt: new Date().toISOString(),
    slug: corner.slug,
    name: corner.short || corner.name,
    seed: { title: seed.title, url: seed.url, domain: seed.domain || domainOf(seed.url) },
    results: results.length,
    links: links.slice(0, 3),
    rejected: rejects.length,
    ...(links.length ? {} : { reason: rejects.length
      ? `${rejects.length} crossings named in the related coverage did not survive verification`
      : "the related coverage named no cross streets" }),
  };
}

// The record written to the OTHER end of a connection, so the claim reads the
// same from either corner's page rather than existing only where it was found.
export function reciprocal(from, link) {
  return {
    source: "live",
    version: CONNECTIONS_VERSION,
    builtAt: new Date().toISOString(),
    slug: link.slug,
    name: link.name,
    reciprocal: true,
    links: [
      {
        slug: from.slug,
        name: from.name,
        grade: from.grade ?? null,
        index: from.index ?? null,
        article: link.article,
      },
    ],
  };
}
