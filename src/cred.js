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

export function isStreetQuote(text) {
  const t = String(text || "").toLowerCase();
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
  // the record, not reporting on it.
  const pressItems = (news?.items || []).filter((i) => !i.official && i.corroborates);
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
