// The press radar.
//
// The batch lane takes a snapshot: it asks what the record says about a corner
// at the moment it runs, stores the answer, and moves on. The radar is the
// present tense. Exa Monitors hold the queries open and push a detection to
// this Worker as coverage appears, so new reporting about a watched corridor
// lands on the site without anybody running anything.
//
// Three things are deliberately true of the design:
//
//   Corridors, not corners. A street-level query is the efficient unit, which
//   the segment cache already proved: every corner on Mission shares Mission's
//   coverage, so one standing query serves all of them.
//
//   Delivery is push, and Exa owns the timing. The create API has no cadence,
//   schedule or interval field, so this code cannot claim a frequency and does
//   not. What it can state is the observed lag between an article's publish
//   date and the moment the detection arrived, which is measured per hit.
//
//   A detection is data, never an instruction and never evidence on its own.
//   Everything that arrives at the webhook runs the same relevance filter the
//   rest of the press lane uses, and is checked against the graded index,
//   before it can appear as a citation anywhere.
import { classify, streetTokens, domainOf, DENY } from "./newsfilter.js";
import { isSafetyCoverage } from "./cred.js";

export const RADAR_VERSION = "v1";

// The citywide watch. Small on purpose: these fire on stories that name no
// corridor at all, which is where a city-level policy change shows up first.
export const META_QUERIES = [
  "San Francisco Vision Zero",
  "SFMTA quick build",
  "San Francisco pedestrian death",
  "San Francisco protected bike lane",
];

export const CORRIDOR_LIMIT = 25;

export const corridorQuery = (street) =>
  `${street} San Francisco pedestrian OR collision OR crash`;

// The worst corridors by aggregate harm, derived from the rank rows rather
// than asserted. A street's score is the sum of its corners' points, so a long
// arterial with many bad crossings outranks one notorious intersection, which
// is the right unit for a standing query about a street.
export function worstCorridors(rows, limit = CORRIDOR_LIMIT) {
  const byStreet = new Map();
  for (const r of rows || []) {
    const parts = String(r?.name || "").split(/\s+(?:and|&|at)\s+/i);
    for (const raw of parts) {
      const street = raw.trim();
      if (!street || street.length < 3) continue;
      const key = street.toLowerCase();
      const cur = byStreet.get(key) || { street, points: 0, corners: 0 };
      cur.points += Number(r.points) || 0;
      cur.corners += 1;
      byStreet.set(key, cur);
    }
  }
  return [...byStreet.values()]
    // A street represented by a single corner is that corner, not a corridor.
    .filter((s) => s.corners >= 2)
    .sort((a, b) => b.points - a.points || b.corners - a.corners)
    .slice(0, limit);
}

// ---------------------------------------------------------------- webhook

// Exa's webhook payload shape is not documented anywhere this code can read,
// so the reader accepts the shapes it might plausibly take and records
// anything it does not recognise instead of dropping it. An unrecognised
// payload is a bug to look at, not a detection to invent.
export function resultsFrom(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.results,
    payload.data?.results,
    payload.data,
    payload.items,
    payload.event?.results,
    payload.search?.results,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.every((x) => x && typeof x === "object")) return c;
  }
  return null;
}

export function monitorIdFrom(payload) {
  return (
    payload?.monitorId ||
    payload?.monitor?.id ||
    payload?.data?.monitorId ||
    payload?.id ||
    null
  );
}

// Publication to detection, in hours. Null when the article carries no date,
// which is common enough that the page says so rather than guessing zero.
export function lagHours(publishedDate, detectedAt) {
  const p = Date.parse(publishedDate || "");
  const d = Date.parse(detectedAt || "");
  if (!Number.isFinite(p) || !Number.isFinite(d) || d < p) return null;
  return Math.round(((d - p) / 3600000) * 10) / 10;
}

// The median of the lags that exist. Hits with no publication date are not
// counted as zero and not counted at all; the caller reports how many were
// excluded, because a median over half the data with no note is a lie.
export function medianLag(hits) {
  const xs = (hits || []).map((h) => h.lagHours).filter((n) => typeof n === "number").sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round(((xs[mid - 1] + xs[mid]) / 2) * 10) / 10;
}

// Which graded corners a detection is about.
//
// A corridor match is not a corner match. The article named a street; the
// corners on that street are candidates, and only those the article actually
// names both streets of are attached. That is the same bar the press panel
// uses, and it is why a story about Mission Street does not become a citation
// on forty Mission crossings.
export function cornersFor(article, corridor, index) {
  const hay = `${article.title || ""} ${article.url || ""} ${article.text || ""}`.toLowerCase();
  const out = [];
  for (const c of index || []) {
    const tokens = streetTokens(c);
    if (tokens.length < 2) continue;
    if (tokens.every((t) => t && hay.includes(t))) out.push(c.slug);
  }
  return out.slice(0, 5);
}

// One detection, judged. Returns the record that goes in the feed either way,
// because a detection that failed the filter is the more interesting half and
// is published as such.
export function judge(article, corridor, index, detectedAt) {
  const clean = {
    title: String(article?.title || "").trim(),
    url: article?.url || "",
    domain: domainOf(article?.url),
    date: (article?.publishedDate || "").slice(0, 10),
    text: article?.text || "",
  };
  const base = {
    title: clean.title,
    url: clean.url,
    domain: clean.domain,
    date: clean.date,
    corridor,
    detectedAt,
    lagHours: lagHours(article?.publishedDate, detectedAt),
  };
  if (!clean.title || !clean.url) return { ...base, passed: false, reason: "no title or url" };
  if (DENY.test(clean.url)) return { ...base, passed: false, reason: "excluded domain" };

  const tokens = streetTokens({ name: corridor });
  const scored = classify([{ ...clean, publishedDate: article?.publishedDate }], tokens);
  if (!scored.length) return { ...base, passed: false, reason: "filtered out before scoring" };
  const hit = scored[0];
  if (!hit.corner && !hit.loose) return { ...base, passed: false, reason: "does not name the corridor" };
  if (!isSafetyCoverage({ title: clean.title, text: clean.text }, tokens)) {
    return { ...base, passed: false, reason: "not safety coverage" };
  }
  const corners = cornersFor(clean, corridor, index);
  return { ...base, passed: true, official: hit.official, corners };
}
