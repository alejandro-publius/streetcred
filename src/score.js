// The Danger Index. Nothing in this file touches a model: the score is arithmetic
// over two public datasets, and every input is a number a person can look up.
// That is the point. A score nobody can audit is worth less than no score.

import { soql } from "./resolve.js";
import { SERVICE_NAMES } from "./data.js";

const DS_CRASHES = "ubvf-ztfx";
const DS_311 = "vw6y-z8j6";

// Tighter than the 150m the stats lane uses. A score is a claim about one
// intersection, not about a block in every direction.
export const SCORE_RADIUS = 80;

// Bump to invalidate every stored score. Any change to the weights, the radius,
// the time windows, or the frozen distribution must bump this or corners will
// keep serving grades computed under the old rules.
// v3: the 600-sample distribution was replaced by the full census, 2026-08-18.
export const SCORE_VERSION = "v3";

// Harm only. A 311 report is paperwork and must never outweigh a person.
const WEIGHTS = { fatal: 10, severe: 6, otherVisible: 3, pain: 1, ped: 2 };

// v1 gave each 311 report half a point, uncapped. A corner with 353 reports
// therefore collected 176 points from maintenance complaints against 10 for a
// death, and the report count, not the collision record, decided the grade.
// The signal is worth keeping because a corner nobody reports is a corner
// nobody is watching, but it is context and it is capped at 8 points, which is
// less than one fatality.
const MAINTENANCE_PER_REPORT = 0.05;
const MAINTENANCE_CAP = 8;

export function pointsFor(counts) {
  const collisionPoints =
    WEIGHTS.fatal * counts.fatal +
    WEIGHTS.severe * counts.severe +
    WEIGHTS.otherVisible * counts.otherVisible +
    WEIGHTS.pain * counts.pain +
    WEIGHTS.ped * counts.ped;
  const maintenanceSignal = Math.min(counts.safety311 * MAINTENANCE_PER_REPORT, MAINTENANCE_CAP);
  return {
    collisionPoints,
    maintenanceSignal: Math.round(maintenanceSignal * 10) / 10,
    points: collisionPoints + maintenanceSignal,
  };
}

// The distribution lives in src/distribution.js: the full census of the city's
// crossings, computed once by tools/sweep.mjs and declared final there. It
// replaced a 600-sample estimate on 2026-08-18; the two agreed closely (both
// medians 3.1), so the swap moved percentiles by at most a point or two while
// removing the sampling caveat entirely. The seed constant went with the
// sampler: a census has no seed.
export { DISTRIBUTION, DISTRIBUTION_DATE } from "./distribution.js";
import { DISTRIBUTION } from "./distribution.js";

// More reported harm than this share of the sampled city. Strictly-below is the
// honest count for the sentence the page prints: a corner with no recorded harm
// is not worse than any corner with none, so it reads 0 rather than borrowing
// credit from every other empty corner.
export function percentileOf(points) {
  if (!DISTRIBUTION.length) return 0;
  let below = 0;
  for (const v of DISTRIBUTION) if (v < points) below++;
  // Capped at 99: with a full census the worst corner rounds to 100, and
  // "more reported harm than 100 percent of intersections" would include the
  // corner itself. No corner is worse than itself, so no corner reads 100.
  return Math.min(99, Math.round((100 * below) / DISTRIBUTION.length));
}

// An F now means worse than 93 percent of San Francisco intersections, which is
// a sentence that survives being read out loud at a public comment session.
export function gradeFor(index) {
  if (index >= 93) return "F";
  if (index >= 80) return "D";
  if (index >= 65) return "C";
  if (index >= 40) return "B";
  return "A";
}

// The one sentence that has to travel with the number everywhere it is shown.
export const SCORE_CAVEAT =
  "No exposure normalization: the index ranks reported harm, not risk per crossing.";

const yearsAgo = (n) =>
  new Date(Date.now() - n * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);

// Split out from computeScore so the calibration script that freezes the
// distribution runs the exact same queries against the exact same windows. If
// these ever drift apart, every corner is scored against a yardstick measured
// with a different ruler.
export async function countsFor(lat, lon) {
  const circle = `within_circle(point, ${lat}, ${lon}, ${SCORE_RADIUS})`;
  const since5 = yearsAgo(5);
  const since1 = yearsAgo(1);
  const services = SERVICE_NAMES.map((s) => `'${s}'`).join(",");

  // All four in one parallel batch, so the score costs one round trip in wall
  // clock rather than four.
  const [sev, ped, r311] = await Promise.all([
    soql(DS_CRASHES, {
      "$select": "collision_severity,count(*)",
      "$where": `${circle} AND collision_datetime > '${since5}'`,
      "$group": "collision_severity",
    }).catch(() => []),
    soql(DS_CRASHES, {
      "$select": "count(*)",
      "$where":
        `${circle} AND collision_datetime > '${since5}' ` +
        "AND ped_action not in('No Pedestrian Involved','Not Stated')",
    }).catch(() => []),
    // Explicit allow list, never a substring match on "Street": that sweeps in
    // Street and Sidewalk Cleaning, a 3.4M row sanitation queue, and inflates
    // this input roughly 24 times.
    soql(DS_311, {
      "$select": "count(*)",
      "$where": `${circle} AND requested_datetime > '${since1}' AND service_name in(${services})`,
    }).catch(() => []),
  ]);

  const bySeverity = Object.fromEntries(
    (sev || []).map((r) => [r.collision_severity, parseInt(r.count, 10) || 0]),
  );
  return {
    fatal: bySeverity["Fatal"] || 0,
    severe: bySeverity["Injury (Severe)"] || 0,
    otherVisible: bySeverity["Injury (Other Visible)"] || 0,
    pain: bySeverity["Injury (Complaint of Pain)"] || 0,
    ped: parseInt(ped?.[0]?.count ?? 0, 10) || 0,
    safety311: parseInt(r311?.[0]?.count ?? 0, 10) || 0,
  };
}

export async function computeScore(c) {
  const counts = await countsFor(c.lat, c.lon);
  const { collisionPoints, maintenanceSignal, points } = pointsFor(counts);
  const index = percentileOf(points);

  return {
    source: "live",
    version: SCORE_VERSION,
    index,
    grade: gradeFor(index),
    points: Math.round(points * 10) / 10,
    collisionPoints: Math.round(collisionPoints * 10) / 10,
    maintenanceSignal,
    radius: SCORE_RADIUS,
    sampleSize: DISTRIBUTION.length,
    counts,
    caveat: SCORE_CAVEAT,
  };
}
