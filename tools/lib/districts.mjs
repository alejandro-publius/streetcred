// Which Supervisor's district a corner sits in, decided locally over bulk rows.
//
// The Worker asks DataSF this question one corner at a time, with a grouped
// within_circle query (src/resolve.js districtFor). That is right for a single
// typed corner and wrong for eight thousand of them: it would be eight thousand
// queries against a public API to learn something already contained in one bulk
// pull. This module answers the same question over rows already in memory.
//
// The VOTE is not reimplemented here. districtFromRows is imported from
// src/resolve.js, so the sweep and the live resolver cannot disagree about
// which elected official receives a letter.

import { districtFromRows } from "../../src/resolve.js";

// The letter's addressee is decided over a wider footprint than the grade is:
// 150m, matching the live districtFor default. A corner one block from a
// district line still belongs to the district its crashes are recorded in.
export const DISTRICT_RADIUS_M = 150;

// Equirectangular, as everywhere else in the sweep. At this latitude the error
// against true haversine is far under a metre at these distances, well inside
// the GPS noise already present in the points.
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((37.77 * Math.PI) / 180);

// Cell size at least the search radius, so a single neighbour ring is provably
// enough: nothing 150m away can land more than one 200m cell out.
const CELL_M = 200;
const cellIndex = (lat, lon) => [
  Math.floor((lat * M_PER_DEG_LAT) / CELL_M),
  Math.floor((lon * M_PER_DEG_LON) / CELL_M),
];

// Both dataset shapes for a column called `point`: collisions use GeoJSON,
// the 311 feed uses the legacy Socrata location type. A reader that handles
// one silently zeroes the other, which is gotcha 9 in the handoff.
export function pointOf(r) {
  const g = r.point?.coordinates;
  if (g && g.length === 2) {
    const lon = Number(g[0]), lat = Number(g[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  const lat = Number(r.point?.latitude), lon = Number(r.point?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return null;
}

// Returns a Map of slug to district (or null), plus the tallies, so a caller
// can report how many corners the records could actually place.
export function districtsForCorners(corners, rows) {
  const cells = new Map();
  let placed = 0;
  for (const r of rows) {
    const p = pointOf(r);
    if (!p) continue;
    const d = parseInt(r.supervisor_district, 10);
    if (!Number.isFinite(d) || d <= 0) continue;
    const [i, j] = cellIndex(p.lat, p.lon);
    const key = `${i}:${j}`;
    let arr = cells.get(key);
    if (!arr) cells.set(key, (arr = []));
    arr.push({ lat: p.lat, lon: p.lon, d });
    placed++;
  }

  const out = new Map();
  const r2 = DISTRICT_RADIUS_M * DISTRICT_RADIUS_M;
  for (const c of corners) {
    const [ci, cj] = cellIndex(c.lat, c.lon);
    const tally = new Map();
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const arr = cells.get(`${ci + di}:${cj + dj}`);
        if (!arr) continue;
        for (const r of arr) {
          const dy = (r.lat - c.lat) * M_PER_DEG_LAT;
          const dx = (r.lon - c.lon) * M_PER_DEG_LON;
          if (dy * dy + dx * dx > r2) continue;
          tally.set(r.d, (tally.get(r.d) || 0) + 1);
        }
      }
    }
    // Handed over in the exact shape a grouped SoQL query returns, because the
    // function that reads it is the one the Worker uses.
    const asRows = [...tally.entries()].map(([d, n]) => ({
      supervisor_district: String(d),
      count: String(n),
    }));
    out.set(c.slug, districtFromRows(asRows));
  }
  return { districts: out, rowsPlaced: placed };
}
