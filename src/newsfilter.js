// The press filter, in one place, because two callers depend on it agreeing
// with itself: the panel that shows this year's coverage and the year strip
// that counts every year since 2014. If those two used different rules, the
// strip would be a chart of a filter nobody can see, which is worse than no
// chart at all.

// Agency primary sources. A police bulletin or an SFMTA project page is a real,
// citable document, but it is not press coverage of the corner: it is the
// record that coverage would be written about. Listed explicitly rather than
// pattern matched, so adding one is a deliberate decision.
//
// ceqanet is the state CEQA filings database. A project's environmental filing
// is the most purely record-like document on this list: it is the paperwork the
// work generates, and treating it as coverage would let a 2017 filing satisfy
// the press lane at a corner no journalist has written about.
export const OFFICIAL_SOURCE =
  /^(sanfranciscopolice\.org|sfmta\.com|sfpublicworks\.org|sf\.gov|sfgov\.org|sfcta\.org|ceqanet\.lci\.ca\.gov)$/i;

// Law firm and lead generation sites republish crash reports to farm clients.
// They are not press coverage and they do not belong in an evidence lane.
export const DENY = /(lawfirm|law-firm|attorney|lawyer|injuryl|accidentl|legal)/i;

// Street names pulled from the corner itself, so the relevance filter travels to
// any corner. "16th Street and Mission Street" gives ["16th", "mission"].
export function streetTokens(c) {
  return c.name
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|and)\b/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// The one query string both callers use. The year strip has to search for
// exactly what the panel searches for, or the strip is counting a different
// question than the one the panel answers.
export function searchQuery(c) {
  return `pedestrian safety OR crash OR traffic ${c.name} ${c.city || "San Francisco"}`;
}

// Classifies a raw Exa result set against a corner. Returns every result that
// survives the deny list, each tagged with whether it names both streets
// (corner level) or only one (corridor level), and whether its domain is an
// agency primary source.
export function classify(results, tokens) {
  return (results || [])
    .filter((x) => x && x.title && !DENY.test(x.url || ""))
    .map((x) => {
      const hay = `${x.title} ${x.url || ""} ${x.text || ""}`.toLowerCase();
      const titleHay = `${x.title} ${x.url || ""}`.toLowerCase();
      const hits = tokens.filter((t) => hay.includes(t)).length;
      // Corner level means both street names, not just the neighborhood.
      const corner =
        tokens.every((t) => titleHay.includes(t)) || (hits >= tokens.length && tokens.length > 1);
      return {
        raw: x,
        corner,
        loose: tokens.some((t) => titleHay.includes(t)),
        official: OFFICIAL_SOURCE.test(domainOf(x.url)),
      };
    });
}
