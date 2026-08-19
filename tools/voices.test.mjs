// The autonomous voices contract.
//
// This is the lane that spends real credit while nobody is watching, so what
// is pinned here is the shape of what it commissions and the filter that
// decides what survives. The scorer is a port of the one in
// tools/collect_voices.py; this copy is the canonical one because it is the
// one that runs unattended.

import test from "node:test";
import assert from "node:assert/strict";
import {
  circleGeoJson, gmapsInput, redditInput, cleanText, scoreText, cornerTokens,
  fromGmaps, fromReddit, pickVoices,
} from "../src/voices.js";

const corner = { slug: "24th-and-valencia", name: "24th and Valencia", lat: 37.752374, lon: -122.420715 };

test("the search area is a closed polygon about 350m across", () => {
  const g = circleGeoJson(corner.lat, corner.lon);
  assert.equal(g.type, "Polygon");
  const ring = g.coordinates[0];
  assert.equal(ring.length, 17, "16 points plus the closing point");
  assert.deepEqual(ring[0], ring[ring.length - 1], "a GeoJSON ring must close");
  // Every vertex sits within a metre or two of 350m from the centre.
  const mLat = 111320, mLon = 111320 * Math.cos((corner.lat * Math.PI) / 180);
  for (const [lon, lat] of ring) {
    const d = Math.hypot((lat - corner.lat) * mLat, (lon - corner.lon) * mLon);
    assert.ok(Math.abs(d - 350) < 3, `vertex ${d.toFixed(1)}m from centre`);
  }
});

// An intersection is not a place: geocoding one resolves to a road junction
// with no reviews attached, which is why the corner is a circle and not a
// query string.
test("the maps actor is aimed at an area, never at a place name", () => {
  const i = gmapsInput(corner);
  assert.equal(i.customGeolocation.type, "Polygon");
  assert.ok(!JSON.stringify(i).includes("24th and Valencia"), "the corner name must not be a search term");
  assert.ok(i.maxCrawledPlacesPerSearch <= 6, "this actor bills per place, so the input is also the invoice");
  assert.equal(i.scrapePlaceDetailPage, false);
});

test("the reddit actor is driven by explicit start urls", () => {
  const i = redditInput(corner);
  assert.ok(Array.isArray(i.startUrls) && i.startUrls.length >= 1);
  for (const u of i.startUrls) assert.match(u.url, /^https:\/\/www\.reddit\.com\//);
  assert.ok(i.maxItems <= 40, "billed per result stored");
});

test("boilerplate and entities are stripped, long text truncated", () => {
  assert.equal(cleanText("submitted by /u/someone"), "");
  assert.equal(cleanText("Cars &amp; trucks"), "Cars & trucks");
  assert.equal(cleanText("see https://example.com/x now"), "see now");
  const long = cleanText("word ".repeat(200));
  assert.ok(long.length <= 244 && long.endsWith("..."));
});

test("relevance is weighted, not binary", () => {
  const strong = "A pedestrian was struck in the crosswalk here and the driver never stopped at all.";
  const weak = "The sidewalk outside is usually busy with people walking around this corner area.";
  assert.ok(scoreText(strong) > scoreText(weak), "harm outranks ambience");
});

test("short, abusive, and empty text is dropped outright", () => {
  assert.equal(scoreText("too short"), 0);
  assert.equal(scoreText(""), 0);
  assert.equal(scoreText("the traffic here is absolute shit and the crosswalk is bad every day"), 0);
});

// The flaw the first real autonomous run exposed: four of five kept quotes
// were restaurant reviews that mentioned the street and said nothing about it.
test("naming the corner does not by itself qualify a quote", () => {
  const tokens = cornerTokens(corner);
  const review = "Super low key place with good espresso and quiet vibes, the opposite of the extreme coffee bars on Valencia.";
  assert.equal(scoreText(review, tokens), 0, "a coffee review is not testimony about a crossing");
  const closing = "Funky Elephant at Valencia and 24th is closing, last day of service is June 21st this year.";
  assert.equal(scoreText(closing, tokens), 0, "a business closing is not testimony about a crossing");
  // "corner" means the street about half the time. It cannot qualify a quote
  // by itself, which is the rule src/cred.js already applies.
  const store = "In a city of plenty options, for years this has been my go-to corner store for convenience.";
  assert.equal(scoreText(store, tokens), 0, "a corner store is not a street corner");
});

test("a weak word only counts beside a word that can only mean the street", () => {
  assert.equal(scoreText("The sidewalk here is usually busy with people around this corner most days.", []), 0);
  assert.ok(scoreText("A cyclist was struck on the sidewalk here and drivers never slow down at all.", []) > 0);
});

// Every case below is a real quote a real commissioned run put into a real
// corner's evidence lane. Harm words alone were qualifying them.
test("harm without a street is not a traffic quote", () => {
  assert.equal(
    scoreText("San Francisco Killed 8th-Grade Algebra. Now It is Set to Come Back next year", ["8th", "minna"]),
    0,
    "an education headline matched on the word killed",
  );
  assert.equal(
    scoreText("Man shot and killed in San Francisco SoMa neighborhood late on Friday evening", ["9th", "mission"]),
    0,
    "a shooting is not a traffic safety account",
  );
});

// A Reddit search for "9th and Mission" returns everything mentioning either
// street, including a fatal crash on a freeway several miles away.
test("a quote has to name the corner it is filed under", () => {
  assert.equal(
    scoreText("280 Southbound Going Out of SF Closed Due to Fatal Traffic Collision overnight", ["6th", "natoma"]),
    0,
  );
  assert.ok(
    scoreText("Another San Francisco cyclist struck in Valencia Street center bike lane today", ["24th", "valencia"]) > 0,
    "corridor level coverage that names one street still counts",
  );
});

test("naming the corner itself is worth points", () => {
  const tokens = cornerTokens(corner);
  // Both must clear the bars first: a street word, a safety word, and the
  // corner named. The bonus is what separates two quotes that both qualify.
  const base = "Crossing here on foot is dangerous, drivers turn through the crosswalk constantly at Valencia.";
  const named = "Crossing 24th at Valencia on foot is dangerous, drivers turn through the crosswalk constantly.";
  assert.ok(scoreText(base, tokens) > 0, "the base quote should qualify");
  assert.ok(scoreText(named, tokens) > scoreText(base, tokens), "naming both streets should rank higher");
});

test("both actor shapes flatten to one contract", () => {
  const g = fromGmaps(
    [{ reviews: [{ text: "Drivers speed through the crosswalk here, it is dangerous and nobody stops for pedestrians.", stars: 2, publishedAtDate: "2026-02-02T00:00:00Z" }] }],
    [],
  );
  const r = fromReddit(
    [{ title: "Dangerous crossing", body: "Cars run the red light at this intersection every evening, it is unsafe for pedestrians.", createdAt: "2026-03-03" }],
    [],
  );
  for (const v of [...g, ...r]) {
    assert.ok(["google_maps", "reddit"].includes(v.source));
    assert.equal(typeof v.text, "string");
    assert.ok("stars" in v && "when" in v && "score" in v);
  }
  assert.equal(g[0].stars, 2);
  assert.equal(r[0].stars, null, "reddit has no rating and must not invent one");
});

test("selection keeps both sources represented and caps at five", () => {
  const many = [];
  for (let i = 0; i < 10; i++) many.push({ source: "google_maps", stars: 3, text: `g${i}`, when: "2026-01-01", score: 100 - i });
  for (let i = 0; i < 10; i++) many.push({ source: "reddit", stars: null, text: `r${i}`, when: "2026-01-01", score: 50 - i });
  const picked = pickVoices(many);
  assert.equal(picked.length, 5);
  assert.equal(picked.filter((p) => p.source === "google_maps").length, 3, "no source may take the whole panel");
  assert.ok(picked.some((p) => p.source === "reddit"));
});

test("nothing relevant means nothing shown", () => {
  assert.deepEqual(pickVoices([]), []);
});
