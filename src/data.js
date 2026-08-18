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
};

export const DEFAULT_SLUG = "16th-mission";

// Names only. No email addresses anywhere in this product: nothing here is ever
// sent to a real official.
export const SUPERVISORS = {
  1: "Connie Chan",
  3: "Danny Sauter",
  6: "Matt Dorsey",
  7: "Myrna Melgar",
  8: "Rafael Mandelman",
  9: "Jackie Fielder",
  10: "Shamann Walton",
  11: "Chyanne Chen",
};

export const FALLBACK_OFFICIAL = "Mayor Daniel Lurie";

export function supervisorFor(district) {
  const d = parseInt(district, 10);
  return SUPERVISORS[d] || FALLBACK_OFFICIAL;
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
