// The Cred Check. Four lanes, four booleans, one verdict.
//
// No model anywhere. Each lane is a token test or a count over payloads the
// page already fetched, so the verdict on the page is reproducible by anyone
// reading this file.

// Words that only mean the street. Any one of these is enough on its own.
const STREET_STRONG = [
  "crossing", "cross", "crosswalk", "driver", "drivers", "traffic", "cars",
  "speeding", "signal", "curb", "sidewalk", "intersection", "pedestrian",
];

// Words that often mean the street and often mean something else entirely. A
// review calling a neighborhood "scary" is not testimony about a crossing, so
// these only count when a strong token appears with them. Without this split,
// "Safe even though it's a scary movie outside" lights the resident lane at
// 16th and Mission, which is precisely the quote the lane should ignore.
const STREET_WEAK = ["dangerous", "scary", "dark"];

const SAFETY_TOKENS = [
  "crash", "struck", "killed", "injured", "pedestrian", "safety", "traffic", "collision",
];

const has = (hay, list) => list.some((t) => hay.includes(t));

// A quote saying the corner is fine is not testimony that it is dangerous.
// The street-word lists above only ask whether a quote is ABOUT the street,
// not which way it points, so a review reassuring readers that drivers are
// careful here and nothing has ever happened passed the same gate as a
// complaint: it raised the Resident accounts lane in the Cred Check and was
// eligible, unedited, to be quoted in a letter to a Supervisor arguing that
// same corner needs a safety fix.
//
// Every pattern here is checked for a nearby negation before it counts, using
// a short word-window rather than one big regex, because the negation and the
// word it negates are not always adjacent: "I don't ever feel safe crossing
// here" negates "safe" from four words away. A regex that only excluded
// "not safe" as a fixed phrase would flag that sentence as reassurance, which
// is backwards: it is a complaint that happens to contain the word "safe".
// Scraped review text drops apostrophes as often as it keeps them ("dont",
// "isnt", "wasnt", "cant"), so a negation check anchored to "n't" alone
// misses half of what it is looking for. Both spellings are listed rather
// than stripping punctuation and matching one, because stripping would also
// have to be applied everywhere else this text is read and this is the only
// place the distinction matters.
const NEGATED_WORD =
  /\b(?:not|never|no|nobody|nothing|hardly|barely|rarely|don'?t|doesn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|can'?t|won'?t|didn'?t)\b/;
const negated = (window) => NEGATED_WORD.test(window);

// The window checked for a negation spans both sides of the verb: "I
// don't feel safe" negates from three words before "feel", and "it feels
// perfectly safe" only has words between "feels" and "safe". Checking only
// one side reads "I dont feel safe crossing here" as reassurance, which is
// backwards -- it is the complaint the whole guard exists to keep counting.
const REASSURE_VERB =
  /((?:\S+\s+){0,3})\b(?:is|are|feels?|seems?|looks?|remains?)\b\s+((?:\S+\s+){0,3})safe\b/;
const REASSURE_NOUN = /((?:\S+\s+){0,3})safe\s+(?:crossing|intersection|corner|street)\b/;
const REASSURE_NEVER =
  /\bnever\s+(?:had|seen|witnessed)\s+(?:an?\s+)?(?:issue|problem|incident|accident)\b/;
const REASSURE_NO_ISSUE = /\bno\s+(?:problems?|issues?)\s+(?:here|crossing|at this corner)\b/;

export function isReassuring(text) {
  const t = String(text || "").toLowerCase();
  const verb = t.match(REASSURE_VERB);
  if (verb && !negated(verb[1] + " " + verb[2])) return true;
  const noun = t.match(REASSURE_NOUN);
  if (noun && !negated(noun[1])) return true;
  // These two already only mean their reassuring sense in ordinary English --
  // "never NOT had an issue" and "no NOT problems" are not real sentences --
  // so no negation window is needed for them.
  return REASSURE_NEVER.test(t) || REASSURE_NO_ISSUE.test(t);
}

export function isStreetQuote(text) {
  const t = String(text || "").toLowerCase();
  if (isReassuring(t)) return false;
  if (has(t, STREET_STRONG)) return true;
  return has(t, STREET_WEAK) && has(t, STREET_STRONG);
}

export function isSafetyCoverage(item, streetTokens) {
  const hay = `${item.title || ""} ${item.text || ""}`.toLowerCase();
  const street = streetTokens.some((t) => hay.includes(t));
  return street && has(hay, SAFETY_TOKENS);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// stats, news, voices and hazards are the payloads the lanes already produced.
// Bump when a lane rule or a token list changes.
export const CRED_VERSION = "v2";

export function credCheck({ stats, news, voices, hazards }) {
  // Official records. One injury collision is not noise, and three filtered
  // street-condition reports in a year is a pattern.
  const collisions = stats?.crashes ?? 0;
  const reports = stats?.reports311 ?? 0;
  const recordsHit = collisions >= 1 || reports >= 3;
  const recordsDetail = recordsHit
    ? `${plural(collisions, "collision")} in 5 years${stats?.fatal ? `, ${stats.fatal} fatal` : ""}, ` +
      `${plural(reports, "street-condition 311 report")} in 3 years`
    : "no injury collisions and too few street-condition reports";

  // Press coverage. Agency primary sources are excluded: a police bulletin is
  // the record, not reporting on it. A domain is required too: this is the
  // grading function the site's whole "no source means no claim" rule points
  // at, so it does not take an upstream lane's word that an item corroborates
  // without a link a reader can actually check -- `domain` is what the
  // citation below actually displays, and it is empty exactly when the item's
  // url was empty or unparseable (domainOf() returns "" rather than
  // throwing). Belt and suspenders with the filter in newsfilter.js's
  // classify(), which is the fix for how an item with no real url got this
  // far in the first place.
  const pressItems = (news?.items || []).filter((i) => !i.official && i.corroborates && i.domain);
  const pressHit = pressItems.length > 0;
  const pressDetail = pressHit
    ? `${pressItems[0].domain}${pressItems[0].date ? `, ${pressItems[0].date}` : ""}` +
      (pressItems.length > 1 ? ` and ${pressItems.length - 1} more` : "")
    : "no coverage naming this corner and a safety term";

  // Resident accounts.
  const quotes = (voices?.items || []).filter((v) => isStreetQuote(v.text));
  const voicesHit = quotes.length > 0;
  const sources = [...new Set(quotes.map((q) => String(q.source || "web").replace("_", " ")))];
  const voicesDetail = voicesHit
    ? `${plural(quotes.length, "quote")} about the street, from ${sources.join(" and ")}`
    : "no scraped account is about the street itself";

  // Visual audit.
  const zones = (hazards?.items || []).filter(
    (h) => h.verdict === "CONFIRMED" || h.verdict === "CANDIDATE",
  );
  const auditHit = zones.length > 0;
  const confirmed = zones.filter((h) => h.verdict === "CONFIRMED").length;
  const auditDetail = auditHit
    ? `${plural(zones.length, "zone")} flagged, ${confirmed} corroborated by records`
    : "the audit found nothing in the photograph";

  const lanes = [
    { key: "records", label: "Official records", hit: recordsHit, detail: recordsDetail },
    { key: "press", label: "Press coverage", hit: pressHit, detail: pressDetail },
    { key: "voices", label: "Resident accounts", hit: voicesHit, detail: voicesDetail },
    { key: "audit", label: "Visual audit", hit: auditHit, detail: auditDetail },
  ];

  const score = lanes.filter((l) => l.hit).length;
  const verdict =
    score === 4 ? "CORROBORATED" : score === 3 ? "SUPPORTED" : score === 2 ? "PARTIAL" : "REPORTED ONLY";

  return { source: "live", version: CRED_VERSION, lanes, score, verdict };
}
