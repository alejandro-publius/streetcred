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
import { candidatesFrom } from "./press.js";

export const SUGGEST_VERSION = "v1";

// The candidate extractor used to live here. It now lives in src/press.js and
// is shared with the citywide watchlist and the connections pass, because
// three regexes proposing corners would eventually disagree about what a
// street is, and the disagreement would show up as one surface offering a
// corner another surface had already rejected.

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
