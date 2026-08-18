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

// FROZEN. Computed 2026-08-17 by running the points formula below against ten
// known-severe SF intersections: 6th & Market, 16th & Mission, Market & Octavia,
// Mission & Silver, Geary & Webster, 19th & Dolores, Turk & Taylor, Golden Gate
// & Hyde, Leavenworth & Eddy, Potrero & 16th. The highest was 16th & Mission
// (cnn 24170000) at 142.0 points, with 6th & Market second at 136.0.
//
// This must never be recomputed from whatever corners happen to be loaded. If it
// floated with the corner set, a corner graded B on Tuesday would become a C on
// Friday with nothing having changed on the ground, and people screenshot these
// grades. Changing this number is a deliberate act that regrades the whole city,
// so bump SCORE_VERSION with it and say so publicly.
export const REFERENCE_MAX = 142;

// Bump to invalidate every stored score. Any change to the weights, the radius,
// the time windows, or REFERENCE_MAX must bump this or corners will keep serving
// grades computed under the old rules.
export const SCORE_VERSION = "v1";

const WEIGHTS = { fatal: 10, severe: 6, otherVisible: 3, pain: 1, ped: 2, safety311: 0.5 };

export function gradeFor(index) {
  if (index >= 80) return "F";
  if (index >= 60) return "D";
  if (index >= 40) return "C";
  if (index >= 20) return "B";
  return "A";
}

// The one sentence that has to travel with the number everywhere it is shown.
export const SCORE_CAVEAT =
  "No exposure normalization: the index ranks reported harm, not risk per crossing.";

const yearsAgo = (n) =>
  new Date(Date.now() - n * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);

export async function computeScore(c) {
  const circle = `within_circle(point, ${c.lat}, ${c.lon}, ${SCORE_RADIUS})`;
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
  const counts = {
    fatal: bySeverity["Fatal"] || 0,
    severe: bySeverity["Injury (Severe)"] || 0,
    otherVisible: bySeverity["Injury (Other Visible)"] || 0,
    pain: bySeverity["Injury (Complaint of Pain)"] || 0,
    ped: parseInt(ped?.[0]?.count ?? 0, 10) || 0,
    safety311: parseInt(r311?.[0]?.count ?? 0, 10) || 0,
  };

  const points =
    WEIGHTS.fatal * counts.fatal +
    WEIGHTS.severe * counts.severe +
    WEIGHTS.otherVisible * counts.otherVisible +
    WEIGHTS.pain * counts.pain +
    WEIGHTS.ped * counts.ped +
    WEIGHTS.safety311 * counts.safety311;

  const index = Math.min(100, Math.round((100 * points) / REFERENCE_MAX));

  return {
    source: "live",
    version: SCORE_VERSION,
    index,
    grade: gradeFor(index),
    points: Math.round(points * 10) / 10,
    referenceMax: REFERENCE_MAX,
    radius: SCORE_RADIUS,
    counts,
    caveat: SCORE_CAVEAT,
  };
}
