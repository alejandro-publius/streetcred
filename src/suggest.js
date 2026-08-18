// "Related corner worth auditing", from Exa findSimilar.
//
// The press lane answers "has anyone written about this corner". findSimilar
// answers a different question that no dataset can: given the reporting about
// the worst corner on the board, what else is being written about in the same
// breath. That is a lead, not a finding, and it is labeled as a suggestion
// everywhere it appears.
//
// Nothing here runs a pipeline. A suggestion is a link to a search, because
// auto-auditing whatever a headline mentioned would spend billed generations on
// a regex's opinion.

import { locate, parseQuery, inSF } from "./resolve.js";
import { DENY, domainOf } from "./newsfilter.js";

export const SUGGEST_VERSION = "v1";

// Two street-ish names joined by and, at, or an ampersand. Deliberately narrow:
// it only proposes a candidate, and every candidate then has to survive being
// looked up in the city's own intersection table, which is what stops
// "Vision Zero" or "Walk and Bike" from being offered as a corner.
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
]);

function candidatesFrom(text) {
  const out = [];
  for (const m of String(text || "").matchAll(PAIR)) {
    const a = m[1].trim();
    const b = m[2].trim();
    if (a.toLowerCase() === b.toLowerCase()) continue;
    if (NOT_A_STREET.has(a.toLowerCase()) || NOT_A_STREET.has(b.toLowerCase())) continue;
    out.push(`${a} and ${b}`);
  }
  return out;
}

export async function buildSuggestion(seed, env, warmedSlugs) {
  if (!seed?.url) throw new Error("no seed article");

  const r = await fetch("https://api.exa.ai/findSimilar", {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      url: seed.url,
      numResults: 10,
      excludeSourceDomain: false,
      contents: { text: { maxCharacters: 500 } },
    }),
  });
  if (!r.ok) throw new Error(`exa findSimilar ${r.status}`);
  const d = await r.json();

  const results = (d.results || []).filter((x) => x?.title && !DENY.test(x.url || ""));
  const seen = new Set();
  const tried = [];

  for (const x of results) {
    for (const cand of candidatesFrom(`${x.title}. ${x.text || ""}`)) {
      const parsed = parseQuery(cand);
      if (!parsed.ok || seen.has(parsed.slug)) continue;
      seen.add(parsed.slug);
      // Already on the board is not a lead, it is a corner we have done.
      if (warmedSlugs.has(parsed.slug)) continue;
      tried.push(cand);
      // The city's own intersection table is the arbiter. If DataSF does not
      // hold this crossing, the regex found a phrase and not a corner.
      const loc = await locate(parsed).catch(() => null);
      if (!loc?.ok || !inSF(loc.lat, loc.lon)) continue;
      return {
        source: "live",
        version: SUGGEST_VERSION,
        builtAt: new Date().toISOString(),
        slug: parsed.slug,
        name: parsed.name,
        query: cand,
        from: { title: x.title.trim(), url: x.url, domain: domainOf(x.url) },
        seed: { title: seed.title, url: seed.url, domain: seed.domain },
        considered: tried.length,
        results: results.length,
      };
    }
  }

  return {
    source: "empty",
    version: SUGGEST_VERSION,
    builtAt: new Date().toISOString(),
    reason: tried.length
      ? `none of the ${tried.length} candidate crossings in the related coverage exist in the city's intersection table`
      : "the related coverage named no cross streets",
    seed: { title: seed.title, url: seed.url, domain: seed.domain },
    results: results.length,
  };
}
