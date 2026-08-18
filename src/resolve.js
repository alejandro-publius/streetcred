// Turning typed text into a corner.
//
// San Francisco publishes its own intersection dataset, which is keyless, has no
// rate limit, and carries exact city geometry. It is the right first source, but
// its shape is not obvious: gmfx-8h6i stores ONE ROW PER STREET LEG, so a single
// intersection is two or three rows sharing a `cnn` and an identical point.
// Matching a pair of street names is therefore a self-join on cnn, not a lookup.
//
// Fields, verified against the live dataset on 2026-08-17:
//   cnn       "24170000"   intersection id, repeats once per leg
//   st_name   "16TH"       street name with the type stripped out
//   st_type   "ST"         separate column, sometimes null
//   the_geom  Point        GeoJSON, coordinates are [lon, lat]

const DS_INTERSECTIONS = "gmfx-8h6i";
const DS_CRASHES = "ubvf-ztfx";

// San Francisco proper. Wide enough for Treasure Island and the ocean edge,
// tight enough to exclude Daly City, Berkeley, and Oakland. Berkeley sits at
// about 37.87, -122.26, well outside this box.
export const SF_BOUNDS = { minLat: 37.695, maxLat: 37.835, minLon: -122.525, maxLon: -122.345 };

export const inSF = (lat, lon) =>
  lat >= SF_BOUNDS.minLat && lat <= SF_BOUNDS.maxLat &&
  lon >= SF_BOUNDS.minLon && lon <= SF_BOUNDS.maxLon;

// One builder for both the fetch and the receipt. soqlUrl is what provenance
// links hand to a reader: the exact query the page ran, openable in a browser,
// so "check the math" is one click rather than an act of faith. If a future
// query is ever built any other way, its link would describe a query the page
// did not run, which is the precise lie this file exists to make impossible.
export function soqlUrl(dataset, params) {
  const u = new URL(`https://data.sfgov.org/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export async function soql(dataset, params) {
  const r = await fetch(soqlUrl(dataset, params), { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`datasf ${dataset} ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------- normalizing

// Trailing tokens that describe the kind of street rather than naming it. Only
// ever stripped as a whole trailing word, never as a substring: "Broadway" is a
// single token and survives, where "Broad Way" would not be a real street.
const STREET_TYPES = new Set([
  "st", "street", "ave", "av", "avenue", "blvd", "boulevard", "dr", "drive",
  "way", "ct", "court", "pl", "place", "ter", "terrace", "rd", "road",
  "ln", "lane", "aly", "alley", "cir", "circle", "hwy", "highway", "plz", "plaza",
]);

// Spelled ordinals up to thirtieth, which covers every numbered street in the
// city. Numbered avenues run past 40th but nobody types "forty-eighth".
const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20, twentyfirst: 21, twentysecond: 22,
  twentythird: 23, twentyfourth: 24, twentyfifth: 25, twentysixth: 26,
  twentyseventh: 27, twentyeighth: 28, twentyninth: 29, thirtieth: 30,
};

function ordinalSuffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
}

// "16th and Mission", "16TH ST & MISSION ST", "Mission/16th" all reduce to the
// same pair. Returns display-cased street names, not the DataSF spelling.
function normalizeStreet(raw) {
  let s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";

  let words = s.split(" ");
  // Drop a trailing street type, but never the only word: a corner cannot be
  // named "Street", and stripping it would leave nothing to match on.
  if (words.length > 1 && STREET_TYPES.has(words[words.length - 1])) words = words.slice(0, -1);

  // Spelled ordinals to numeric, both as one word and as two ("twenty fourth").
  const joined = words.join("");
  if (ORDINAL_WORDS[joined]) {
    const n = ORDINAL_WORDS[joined];
    return `${n}${ordinalSuffix(n)}`;
  }
  words = words.map((w) => {
    if (ORDINAL_WORDS[w]) {
      const n = ORDINAL_WORDS[w];
      return `${n}${ordinalSuffix(n)}`;
    }
    // "16" typed bare becomes "16th", since every numbered SF street is ordinal.
    if (/^\d+$/.test(w)) {
      const n = parseInt(w, 10);
      return `${n}${ordinalSuffix(n)}`;
    }
    // Normalize a typed ordinal with the wrong suffix: "16st" becomes "16th".
    const m = w.match(/^(\d+)(st|nd|rd|th)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      return `${n}${ordinalSuffix(n)}`;
    }
    return w;
  });
  return words.join(" ").trim();
}

// DataSF zero-pads single-digit ordinals: 01ST, 02ND, 09TH all exist and 1ST,
// 2ND, 9TH return nothing at all. Without this, "6th and Market" silently fails
// to resolve, which is how the second shipped corner would have been missed.
export function datasfName(display) {
  const m = String(display).match(/^(\d+)(st|nd|rd|th)$/i);
  if (m) return `${m[1].padStart(2, "0")}${m[2]}`.toUpperCase();
  return String(display).toUpperCase();
}

// Accepts and, &, /, +, at, x as separators. Word separators are matched as
// whole tokens so "Grand and Market" and "Van Ness at Market" both split
// correctly while "Grand" and "Atlantic" keep their letters.
export function parseQuery(q) {
  const raw = String(q || "").trim();
  if (!raw) return { ok: false, reason: "empty" };

  const unified = raw
    .toLowerCase()
    .replace(/[&+/]/g, " and ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = unified.split(/\s+(?:and|at|x)\s+/).filter(Boolean);
  if (parts.length < 2) return { ok: false, reason: "no separator" };

  // More than two parts means a street name swallowed a separator word. First
  // and last is the best available guess and is right for "A and B and C".
  const a = normalizeStreet(parts[0]);
  const b = normalizeStreet(parts[parts.length - 1]);
  if (!a || !b) return { ok: false, reason: "unparsed" };
  if (a === b) return { ok: false, reason: "same street" };

  // Alphabetical, so "16th and Mission" and "Mission and 16th" are one corner
  // with one cache entry and one imagery generation.
  const [first, second] = [a, b].sort();
  return {
    ok: true,
    streets: [first, second],
    slug: `${first}-and-${second}`.replace(/\s+/g, "-"),
    name: `${title(first)} and ${title(second)}`,
  };
}

const title = (s) =>
  s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, n, x) => n + x.toLowerCase());

// ---------------------------------------------------------------- lookup

// One grouped query finds the intersection, a second reads its geometry. Using
// count(distinct st_name) rather than count(*) matters: a plain row count would
// match a cnn that happens to carry two rows for the same street.
async function datasfIntersection(streets) {
  const names = streets.map(datasfName);
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  const groups = await soql(DS_INTERSECTIONS, {
    "$select": "cnn",
    "$where": `st_name in(${list})`,
    "$group": "cnn",
    "$having": "count(distinct st_name) > 1",
    "$limit": "5",
  });
  if (!groups?.length) return null;
  // Two streets can genuinely meet more than once. Take the first and move on
  // rather than refusing to answer.
  const cnn = groups[0].cnn;
  const rows = await soql(DS_INTERSECTIONS, { cnn, "$limit": "5" });
  const withGeom = (rows || []).find((r) => r?.the_geom?.coordinates?.length === 2);
  if (!withGeom) return null;
  const [lon, lat] = withGeom.the_geom.coordinates;
  return { lat: Number(lat), lon: Number(lon), cnn, source: "datasf" };
}

// Which of the two names San Francisco has as a street at all. This is what
// separates "not a street here" from "both are streets here but they never
// meet", and it costs one query against a dataset already being used.
async function knownStreets(streets) {
  const names = streets.map(datasfName);
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
  const rows = await soql(DS_INTERSECTIONS, {
    "$select": "st_name",
    "$where": `st_name in(${list})`,
    "$group": "st_name",
  }).catch(() => []);
  const found = new Set((rows || []).map((r) => r.st_name));
  return names.map((n) => found.has(n));
}

// Only reached when DataSF has no such pair. Nominatim wants a real User-Agent
// and one request per second. The viewbox biases toward San Francisco but
// `bounded` is deliberately off: with it on, a corner in another city comes back
// as no result at all, which is indistinguishable from a typo and makes an
// honest out-of-bounds message impossible. The box is enforced in code instead,
// which is stricter than the hint would have been.
async function nominatimIntersection(streets) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", `${streets[0]} and ${streets[1]}, San Francisco, CA`);
  u.searchParams.set("format", "json");
  u.searchParams.set("limit", "1");
  u.searchParams.set("bounded", "0");
  u.searchParams.set(
    "viewbox",
    `${SF_BOUNDS.minLon},${SF_BOUNDS.maxLat},${SF_BOUNDS.maxLon},${SF_BOUNDS.minLat}`,
  );
  const r = await fetch(u, {
    headers: {
      "user-agent": "StreetCred/1.0 (civic street safety tool; github.com/alejandro-publius/streetcred)",
      accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`nominatim ${r.status}`);
  const d = await r.json();
  if (!d?.length) return null;
  return { lat: Number(d[0].lat), lon: Number(d[0].lon), cnn: null, source: "nominatim" };
}

// ---------------------------------------------------------------- district

// Grouped majority, never the first arbitrary row. Within 150m of 6th and
// Market DataSF holds 242 crash rows in District 6 and 114 in District 5, so a
// single-row lookup returns whichever the API happened to sort first, and the
// letter goes to the wrong elected official without anything looking broken.
export async function districtFor(lat, lon, radius = 150) {
  const rows = await soql(DS_CRASHES, {
    "$select": "supervisor_district,count(*)",
    "$where": `within_circle(point, ${lat}, ${lon}, ${radius})`,
    "$group": "supervisor_district",
  }).catch(() => []);
  // Landmine: collisions return "11", 311 returns "9.00000". Always parseInt.
  const ranked = (rows || [])
    .map((r) => ({ d: parseInt(r.supervisor_district, 10), n: parseInt(r.count, 10) || 0 }))
    .filter((r) => Number.isFinite(r.d) && r.d > 0)
    .sort((a, b) => b.n - a.n);
  if (!ranked.length) return null;
  // A near-tie is not a majority. Saying "citywide" is better than naming the
  // wrong Supervisor with confidence.
  if (ranked.length > 1 && ranked[0].n > 0 && ranked[1].n / ranked[0].n > 0.9) return null;
  return ranked[0].d;
}

// ---------------------------------------------------------------- resolve

export async function locate(parsed) {
  const hit = await datasfIntersection(parsed.streets).catch(() => null);
  if (hit) {
    if (!inSF(hit.lat, hit.lon)) return { ok: false, reason: "out of bounds" };
    return { ok: true, ...hit };
  }

  // No such pair in the city's own dataset. Before falling back, work out which
  // kind of miss this is, because the three cases deserve different answers.
  const known = await knownStreets(parsed.streets);
  if (known[0] && known[1]) {
    // Both are San Francisco streets that simply never meet. Telegraph Place on
    // Telegraph Hill and Bancroft Avenue in the Bayview are six miles apart.
    return { ok: false, reason: "no intersection", known };
  }

  const alt = await nominatimIntersection(parsed.streets).catch(() => null);
  if (alt && !inSF(alt.lat, alt.lon)) return { ok: false, reason: "out of bounds" };
  if (alt) return { ok: true, ...alt };
  return { ok: false, reason: "not found", known };
}
