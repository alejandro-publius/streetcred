// Corner registry. A second corner is a one-object addition: give it a slug,
// coordinates, a validated Street View heading, and a costed fix.
export const CORNERS = {
  "16th-mission": {
    slug: "16th-mission",
    name: "16th Street and Mission Street",
    short: "16th & Mission",
    city: "San Francisco",
    lat: 37.76504541503217,
    lon: -122.4196931274286,
    heading: 0,
    pitch: 0,
    radiusMeters: 150,
    district: 9,
    // Upstash key holding the scraped resident quotes for this corner.
    voicesKey: "voices:16th-and-mission",
    fix: {
      name: "Continental crosswalks, corner curb extension, and a protected bike lane",
      cost: "$265,000 estimated",
      grant: "Caltrans Highway Safety Improvement Program (HSIP)",
    },
  },
  "6th-market": {
    slug: "6th-market",
    name: "6th Street and Market Street",
    short: "6th & Market",
    city: "San Francisco",
    lat: 37.78221014549322,
    lon: -122.4103752550649,
    // Heading picked the same way as the first corner: the frame a person waiting
    // to cross actually sees, with the crosswalk filling the foreground.
    heading: 270,
    pitch: 0,
    radiusMeters: 150,
    district: 6,
    voicesKey: "voices:6th-and-market",
    fix: {
      name: "Continental crosswalks, corner daylighting, and a leading pedestrian interval",
      cost: "$310,000 estimated",
      grant: "California Active Transportation Program (ATP)",
    },
  },
};

export const DEFAULT_SLUG = "16th-mission";

// 311 service types that describe the physical street. An earlier substring
// match on "Street" swept in Street and Sidewalk Cleaning, which is a sanitation
// queue, not a street-condition signal, and inflated one corner from 354 to
// 8,546. Explicit allow list only, shared by the stats lane and the score.
export const SERVICE_NAMES = [
  "Street Defects",
  "Street Defect",
  "Sign Repair",
  "Streetlights",
  "Sidewalk or Curb",
  "Sidewalk and Curb",
  "Blocked Street or SideWalk",
  "Blocked Street and Sidewalk",
  "Color Curb",
];

// The canonical slug for a typed corner is its two street names sorted
// alphabetically, which is what makes "16th and Mission" and "Mission and 16th"
// one cache entry rather than two. The two precomputed corners predate that rule
// and keep their original slugs, so every link already in the wild still works.
export const ALIASES = {
  "16th-and-mission": "16th-mission",
  "6th-and-market": "6th-market",
};

export const canonicalSlug = (slug) => ALIASES[slug] || slug;

// Applied to any corner resolved at runtime. The two precomputed corners carry
// a fix costed for that specific intersection; a corner nobody has looked at yet
// gets the standard treatment package and an order-of-magnitude estimate, which
// is stated as such on the page rather than dressed up as an engineering figure.
export const DEFAULT_FIX = {
  name: "Continental crosswalks, corner daylighting, and a leading pedestrian interval",
  cost: "$250,000 to $350,000, order of magnitude",
  grant: "Caltrans Highway Safety Improvement Program (HSIP)",
};

// Builds a corner object in the same shape as a CORNERS entry, so every lane
// downstream treats a typed corner and a precomputed one identically.
export function makeCorner({ slug, name, lat, lon, district, cnn }) {
  return {
    slug,
    name,
    short: name.replace(/ and /i, " & "),
    city: "San Francisco",
    lat,
    lon,
    // Precomputed corners carry a hand-validated heading picked to put the
    // crosswalk in the foreground. There is no way to pick that automatically,
    // so a resolved corner takes the default panorama orientation.
    heading: 0,
    pitch: 0,
    radiusMeters: 150,
    district: district ?? null,
    cnn: cnn ?? null,
    generated: true,
    voicesKey: null,
    fix: DEFAULT_FIX,
  };
}

// Names only. No email addresses anywhere in this product: nothing here is ever
// sent to a real official.
// The runway for the daily autonomous audit. Drawn from the SF Vision Zero High
// Injury Network and roughly ordered by expected severity, so the corners that
// matter most are audited first if the queue is ever cut short. None of these
// are warmed yet: that is the point, since the feature only means anything if
// the corner is new on the morning it appears.
//
// Seeded into KV under cotd:queue by tools/seed_cotd.js and consumed from the
// front. Anything that fails to resolve is logged and skipped rather than
// retried forever, so one bad entry cannot stall the queue.
export const COTD_SEED = [
  "19th and Mission", "24th and Mission", "Franklin and Geary", "Gough and Fell",
  "Cesar Chavez and Mission", "Masonic and Geary", "Divisadero and Oak",
  "Turk and Larkin", "Bayshore and Silver", "3rd and Evans",
  "Post and Leavenworth", "Ellis and Jones", "Fell and Masonic",
  "Ocean and Phelan", "Persia and Mission", "Lincoln and 19th",
  "Sloat and 19th", "Portola and Woodside",
];

export const SUPERVISORS = {
  1: "Connie Chan",
  2: "Stephen Sherrill",
  3: "Danny Sauter",
  4: "Alan Wong",
  5: "Bilal Mahmood",
  6: "Matt Dorsey",
  7: "Myrna Melgar",
  8: "Rafael Mandelman",
  9: "Jackie Fielder",
  10: "Shamann Walton",
  11: "Chyanne Chen",
};

export const FALLBACK_OFFICIAL = "Mayor Daniel Lurie";

// ------------------------------------------------------------------ dates

// Every date a visitor reads is a Pacific date, because every claim this site
// makes about time is a claim about San Francisco: "one more every morning",
// "audited this morning", "checked on". Evening Pacific is already tomorrow in
// UTC, which is how the homepage once stamped a "Your corners" chip 2026-08-19
// while Corner of the Day on the same screen read 2026-08-18. Both were reading
// the same instant; only one of them was reading it in the city's timezone.
//
// Stored timestamps stay UTC and are never rewritten. This converts at the
// render, and nowhere else.
export const PACIFIC_TZ = "America/Los_Angeles";

const PT_ISO_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// A YYYY-MM-DD Pacific day from a Date, an ISO string, or epoch milliseconds.
// Returns "" for anything missing or unparseable.
//
// Deliberately without a default argument. An earlier draft defaulted to now,
// which meant a record with no timestamp rendered as today: the one wrong date
// a reader has no way to spot, printed with full confidence. Absent input has
// to produce absent output. Callers that mean "now" say so with pacificToday().
export function pacificDay(ts) {
  if (ts === null || ts === undefined || ts === "") return "";
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return PT_ISO_DAY.format(d);
}

// Today, in the city the claims are about.
export const pacificToday = () => PT_ISO_DAY.format(new Date());


export function supervisorFor(district) {
  const d = parseInt(district, 10);
  return SUPERVISORS[d] || FALLBACK_OFFICIAL;
}

// One answer to "which district is this corner in", for every path that goes on
// to name an official.
//
// There were three. getStats resolves `c.district ?? crash-data majority` and
// the ordinary letter path read that; a second path read the raw `c.district`,
// which is absent for any corner resolved from a city shard rather than the
// registry. So the same corner got a Supervisor down one path and the citywide
// fallback down the other, and the fillmore-and-lombard letter opened with the
// Mayor while the page beside it said District 2. Two ways to answer one
// question is the bug; this is the answer.
export function resolvedDistrict(corner, stats) {
  const d = parseInt(stats?.district ?? corner?.district, 10);
  return Number.isFinite(d) ? d : null;
}

// The official a letter for this district must be addressed to, with their
// title, exactly as the letter should write it.
export function addresseeFor(district) {
  const who = supervisorFor(district);
  return hasSupervisor(district) ? `Supervisor ${who}` : who;
}

// Whether the district resolved to an actual Supervisor, as opposed to the
// citywide fallback. Callers need this because prefixing the fallback with a
// title produces "Dear Supervisor Mayor Daniel Lurie", which appeared on every
// District 4 and 5 letter for as long as those districts were missing from the
// table above. A letter that cannot get the addressee's title right is not one
// anybody will send.
export function hasSupervisor(district) {
  return Boolean(SUPERVISORS[parseInt(district, 10)]);
}

// Last-resort payloads. Every one of these is rendered with a visible SAMPLE tag
// so nothing fabricated is ever presented as live.
export const SAMPLE = {
  stats: { crashes: 241, reports311: 1204, district: 9 },
  news: [
    {
      title: "Pedestrian safety improvements planned for Mission Street corridor",
      url: "https://www.sfchronicle.com/",
      domain: "sfchronicle.com",
      date: "2025-11-04",
    },
    {
      title: "Advocates call 16th and Mission one of the city's most dangerous corners",
      url: "https://missionlocal.org/",
      domain: "missionlocal.org",
      date: "2025-09-22",
    },
    {
      title: "Vision Zero: SF misses deadline as injury crashes hold steady",
      url: "https://sfstandard.com/",
      domain: "sfstandard.com",
      date: "2025-06-13",
    },
  ],
  voices: [
    {
      source: "reddit",
      text: "Crossing 16th at Mission on foot is genuinely nerve-wracking. Cars turn through the crosswalk while people are still in it.",
      stars: null,
      when: "2025-04-18",
    },
    {
      source: "google_maps",
      text: "Busy plaza, but the crosswalk paint is worn down to almost nothing and drivers do not stop.",
      stars: 2,
      when: "2025-02-02",
    },
  ],
};
