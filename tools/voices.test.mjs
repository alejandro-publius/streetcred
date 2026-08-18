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

test("naming the corner itself is worth points", () => {
  const tokens = cornerTokens(corner);
  const text = "Crossing here on foot is nerve wracking, drivers turn through the crosswalk constantly.";
  assert.ok(scoreText(`${text} at 24th and Valencia`, tokens) > scoreText(text, tokens));
});

test("both actor shapes flatten to one contract", () => {
  const g = fromGmaps(
    [{ reviews: [{ text: "Drivers speed through the crosswalk here and nobody stops for pedestrians.", stars: 2, publishedAtDate: "2026-02-02T00:00:00Z" }] }],
    [],
  );
  const r = fromReddit(
    [{ title: "Dangerous crossing", body: "Cars run the red light at this intersection every single evening without fail.", createdAt: "2026-03-03" }],
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
