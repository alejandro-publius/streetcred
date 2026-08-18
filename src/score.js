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
export const SCORE_VERSION = "v2";

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

// FROZEN CITYWIDE DISTRIBUTION. Computed 2026-08-18 by tools/calibrate_score.js,
// which draws 600 intersections from the 8,254 real crossings in DataSF
// gmfx-8h6i using a committed seed, then runs the points formula above against
// each one. Sorted ascending. Rerunning the script reproduces this array exactly.
//
// Points over a fixed reference maximum was the wrong shape for this data.
// Reported harm is heavy tailed: a handful of intersections carry many times the
// median, so any linear scale spends most of its range on corners that do not
// exist and pins every busy corner at 100. A percentile answers the question a
// resident actually asks, which is not "how many points" but "how bad is this
// compared to the rest of the city".
//
// Frozen means frozen. This array must never be recomputed from whatever corners
// happen to be loaded, because a corner graded B on Tuesday that becomes a C on
// Friday with nothing changed on the ground is a grade nobody can cite, and
// people screenshot these. Regenerating it regrades the whole city: bump
// SCORE_VERSION with it and say so publicly.
// n=600, min 0, median 3.1, p90 28.1, max 157.8 (Myrtle and Larkin). 47 of the
// 600 have no recorded harm at all. The shape is the argument: half the city sits
// under 3.1 points while the worst corner carries 157.8, which is why a linear
// scale against any single maximum could not tell a bad corner from a
// catastrophic one. A first pass at 150 was too coarse in the tail, where six
// distinct corners spanning 83 to 107 points all landed on the same percentile.
export const DISTRIBUTION = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1,
  0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
  0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
  0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
  0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1,
  0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2,
  0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
  0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
  0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2,
  0.2, 0.2, 0.2, 0.2, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
  0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
  0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
  0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4,
  0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.5,
  0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.6,
  0.6, 0.6, 0.6, 0.6, 0.7, 0.7, 0.7, 0.8, 0.9, 1, 1, 1,
  1, 1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1,
  1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2,
  1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.3, 1.3, 1.3,
  1.3, 1.3, 1.3, 1.4, 1.4, 1.4, 1.4, 1.4, 1.5, 1.6, 1.6, 1.6,
  1.6, 1.8, 1.8, 2, 2, 2.1, 2.1, 2.2, 2.2, 2.2, 2.3, 2.3,
  2.3, 2.4, 2.4, 2.4, 2.4, 2.5, 2.7, 2.8, 3, 3.1, 3.1, 3.1,
  3.1, 3.1, 3.1, 3.1, 3.1, 3.1, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2,
  3.2, 3.2, 3.2, 3.2, 3.2, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3, 3.3,
  3.4, 3.4, 3.4, 3.4, 3.5, 3.5, 3.5, 3.5, 3.7, 3.8, 3.9, 4.1,
  4.1, 4.1, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.3, 4.3,
  4.3, 4.3, 4.3, 4.3, 4.3, 4.4, 4.4, 4.5, 4.5, 4.5, 4.6, 4.6,
  4.7, 4.8, 4.9, 5.2, 5.2, 5.2, 5.2, 5.2, 5.3, 5.4, 5.4, 5.4,
  5.5, 5.5, 5.6, 5.6, 5.8, 5.8, 5.9, 6.1, 6.1, 6.1, 6.1, 6.1,
  6.1, 6.2, 6.2, 6.2, 6.3, 6.3, 6.4, 6.4, 6.5, 6.6, 6.6, 6.6,
  6.6, 6.6, 6.7, 6.7, 6.8, 7.1, 7.1, 7.1, 7.1, 7.1, 7.3, 7.3,
  7.3, 7.3, 7.5, 7.5, 7.5, 7.5, 7.5, 7.8, 7.8, 8, 8, 8.1,
  8.2, 8.2, 8.2, 8.3, 8.3, 8.7, 8.8, 9.1, 9.2, 9.2, 9.3, 9.4,
  9.4, 9.5, 9.6, 9.6, 9.7, 9.7, 9.7, 9.7, 9.7, 9.8, 10.1, 10.2,
  10.3, 10.3, 10.4, 10.7, 11, 11, 11.1, 11.2, 11.2, 11.2, 11.2, 11.2,
  11.3, 11.3, 11.3, 11.3, 11.3, 11.3, 12.1, 12.1, 12.1, 12.3, 12.3, 12.3,
  12.6, 12.6, 12.6, 12.8, 13, 13.1, 13.1, 13.2, 13.2, 13.2, 13.4, 13.4,
  13.5, 13.5, 13.6, 13.7, 13.7, 14, 14.2, 14.3, 15.1, 15.2, 15.3, 15.3,
  15.5, 15.5, 15.6, 16.2, 16.3, 16.3, 16.3, 16.4, 16.5, 16.6, 16.7, 17,
  17, 17.1, 17.4, 17.5, 18, 18.1, 18.1, 18.3, 18.5, 18.6, 18.6, 19,
  19.2, 19.3, 19.3, 19.5, 19.8, 20.2, 20.4, 20.5, 20.6, 20.7, 21.9, 22.3,
  22.5, 22.6, 23.2, 23.5, 23.7, 23.8, 24, 24.2, 24.3, 24.4, 24.8, 27.3,
  28.1, 29, 29.5, 30.3, 32.4, 32.6, 33.7, 33.7, 34.4, 35.1, 35.2, 35.2,
  35.4, 36.8, 36.9, 37.3, 37.9, 38.5, 38.6, 38.7, 39.1, 39.6, 41.9, 41.9,
  42.1, 42.4, 43.1, 44.7, 48.9, 49.3, 49.5, 49.7, 50.5, 50.7, 52.2, 52.7,
  53.6, 54.1, 56, 58.8, 59.6, 61.7, 62.2, 64.5, 64.6, 69.2, 70.2, 71,
  71.4, 73.7, 75.3, 85.9, 87.2, 89.8, 90.2, 110.4, 110.9, 124.1, 126, 157.8,
];

export const DISTRIBUTION_SEED = 20260818;
export const DISTRIBUTION_DATE = "2026-08-18";

// More reported harm than this share of the sampled city. Strictly-below is the
// honest count for the sentence the page prints: a corner with no recorded harm
// is not worse than any corner with none, so it reads 0 rather than borrowing
// credit from every other empty corner.
export function percentileOf(points) {
  if (!DISTRIBUTION.length) return 0;
  let below = 0;
  for (const v of DISTRIBUTION) if (v < points) below++;
  return Math.round((100 * below) / DISTRIBUTION.length);
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
