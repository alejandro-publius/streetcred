// The Exa time machine. Exa accepts date-bounded searches, so the press lane
// can be run once per year instead of once, which turns a list of five links
// into a history of how long a corner has been a problem in public.
//
// This is the one claim on the page that no city dataset can make and no single
// search can make either. A collision record says a corner is dangerous now. A
// year strip says people have been writing about it since 2015 and nothing was
// done, which is a different argument and a better one to put in front of a
// Supervisor.
//
// It is phrased everywhere as coverage-we-can-find, never as first report.
// Exa recall is not ground truth: an empty year means this search found nothing
// that year, not that nothing happened.

import { classify, streetTokens, domainOf, searchQuery } from "./newsfilter.js";

export const TIMELINE_VERSION = "v1";
export const TIMELINE_FROM = 2014;

// Small per year. This is counting, not curating: the panel already shows the
// current headlines, and the strip needs a magnitude and one representative
// title per year.
const PER_YEAR = 5;

async function yearSearch(c, env, year, tokens) {
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      query: searchQuery(c),
      type: "auto",
      numResults: PER_YEAR,
      startPublishedDate: `${year}-01-01T00:00:00.000Z`,
      endPublishedDate: `${year}-12-31T23:59:59.999Z`,
      contents: { text: { maxCharacters: 300 } },
    }),
  });
  if (!r.ok) throw new Error(`exa ${r.status}`);
  const d = await r.json();
  const scored = classify(d.results, tokens);
  // The same bar the panel uses: corner level if it exists, corridor level
  // otherwise. A year is only counted from results that would have been shown.
  const tight = scored.filter((s) => s.corner);
  const passing = tight.length ? tight : scored.filter((s) => s.loose);
  const best = passing.find((s) => !s.official) || passing[0];
  return {
    year,
    count: passing.length,
    cornerLevel: tight.length,
    best: best
      ? {
          title: best.raw.title.trim(),
          url: best.raw.url,
          domain: domainOf(best.raw.url),
          date: (best.raw.publishedDate || "").slice(0, 10),
          official: best.official,
        }
      : null,
  };
}

export async function buildTimeline(c, env, now = new Date()) {
  const thisYear = now.getUTCFullYear();
  const tokens = streetTokens(c);
  const years = [];
  for (let y = TIMELINE_FROM; y <= thisYear; y++) years.push(y);

  // One call per year, all at once. Thirteen sequential searches would take
  // most of a minute; in parallel the whole history costs one round trip.
  const settled = await Promise.all(
    years.map((y) =>
      yearSearch(c, env, y, tokens).catch((e) => ({
        year: y,
        count: null,
        cornerLevel: null,
        best: null,
        failed: String(e.message || e).slice(0, 80),
      })),
    ),
  );

  const ok = settled.filter((s) => s.count !== null);
  if (!ok.length) throw new Error("exa timeline: every year failed");

  const withHits = ok.filter((s) => s.count > 0);
  const firstReportedYear = withHits.length ? withHits[0].year : null;
  const totalHeadlines = ok.reduce((n, s) => n + s.count, 0);

  return {
    source: "live",
    version: TIMELINE_VERSION,
    builtAt: new Date().toISOString(),
    from: TIMELINE_FROM,
    to: thisYear,
    calls: years.length,
    failedYears: settled.filter((s) => s.count === null).map((s) => s.year),
    years: settled,
    firstReportedYear,
    // Only meaningful when a first year exists. Zero would read as "no history"
    // and null reads as what it is, which is "not established".
    yearsReported: firstReportedYear === null ? null : thisYear - firstReportedYear,
    totalHeadlines,
  };
}
