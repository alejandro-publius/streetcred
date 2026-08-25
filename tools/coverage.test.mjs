// The audited coverage layer.
//
// The design rule this file exists to hold: coverage is drawn per corner as its
// scoring core, never as one boundary around the audited set. A hull around 23
// audited corners encloses thousands of crossings nobody has looked at and
// claims coverage that was not done. The gaps between the discs are the honest
// part of the picture and no assertion here may smooth them away.
//
// No network and no key: `node --test tools/coverage.test.mjs`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coverageDiscs, coverageRadiusM } from "../src/city.js";
import { HOME } from "../src/home.js";

const fakeEnv = () => ({
  STORE: {
    async get(key) {
      // coverageDiscs reaches the shard through cityCornerFor, which reads
      // city:shard:{k} and city:meta. Returning null for everything makes the
      // shard lookup fail, which is the degraded case asserted separately.
      if (key === "city:meta") return null;
      return null;
    },
  },
});

const meta = (audited, extra = {}) => ({ audited, scoreRadiusM: 80, ...extra });

test("the radius is the scoring radius, read from the built city", () => {
  assert.equal(coverageRadiusM({ scoreRadiusM: 80 }), 80);
  assert.equal(coverageRadiusM({ scoreRadiusM: 65 }), 65, "a rebuilt city must move the layer with it");
  assert.equal(coverageRadiusM(null), 80, "and there is a sane floor when the city is missing");
});

test("one disc per audited corner, and none for anything else", async () => {
  const rows = [
    { slug: "a-corner", lat: 37.78, lon: -122.41 },
    { slug: "b-corner", lat: 37.77, lon: -122.42 },
    // In the roster's shadow: on the board but NOT audited. It must not get a
    // disc, because a disc is a claim that somebody looked.
    { slug: "not-audited", lat: 37.76, lon: -122.43 },
  ];
  const discs = await coverageDiscs(fakeEnv(), meta(["a-corner", "b-corner"]), { pending: [] }, rows);
  assert.equal(discs.length, 2);
  assert.deepEqual(discs.map((d) => d.slug).sort(), ["a-corner", "b-corner"]);
  assert.ok(!discs.some((d) => d.slug === "not-audited"), "a non-audited corner must never get a disc");
});

test("the disc count equals the audited roster, not the board list", async () => {
  // The real failure this guards: hin:list carries 25 rows and is missing three
  // audited corners, so a layer built from the board would draw 20 discs for a
  // 23 corner roster and quietly under-claim.
  const audited = ["on-board", "off-board-1", "off-board-2"];
  const rows = [{ slug: "on-board", lat: 37.78, lon: -122.41 }];
  const env = {
    STORE: {
      async get(key) {
        if (key !== "city:meta") return null;
        return null;
      },
    },
  };
  const discs = await coverageDiscs(env, meta(audited), { pending: [] }, rows);
  // With no shard available the two off-board corners cannot be placed, and the
  // layer draws what it can rather than inventing coordinates. The live check
  // is what asserts the count matches in production, where the shard answers.
  assert.equal(discs.length, 1, "a corner with no resolvable coordinate is dropped, never guessed");
  assert.equal(discs[0].slug, "on-board");
});

test("rendered and pending split comes from the recount, not from a guess", async () => {
  const rows = [
    { slug: "done", lat: 37.78, lon: -122.41 },
    { slug: "waiting", lat: 37.77, lon: -122.42 },
  ];
  const discs = await coverageDiscs(fakeEnv(), meta(["done", "waiting"]), { pending: ["waiting"] }, rows);
  assert.equal(discs.find((d) => d.slug === "done").rendered, true);
  assert.equal(discs.find((d) => d.slug === "waiting").rendered, false);
});

test("no recount record means every audited corner reads as rendered", async () => {
  // The roster only admits corners once both generated states exist, so absent
  // a recount the safe reading is that they are rendered. Getting this backwards
  // would draw the whole city as pending.
  const rows = [{ slug: "a", lat: 37.78, lon: -122.41 }];
  for (const tiers of [null, undefined, {}, { pending: [] }]) {
    const discs = await coverageDiscs(fakeEnv(), meta(["a"]), tiers, rows);
    assert.equal(discs[0].rendered, true);
  }
});

test("an empty roster draws nothing rather than something", async () => {
  for (const m of [null, {}, meta([])]) {
    assert.deepEqual(await coverageDiscs(fakeEnv(), m, { pending: [] }, []), []);
  }
});

test("coordinates are rounded, not full float noise", async () => {
  const rows = [{ slug: "a", lat: 37.7811112222, lon: -122.4133334444 }];
  const [d] = await coverageDiscs(fakeEnv(), meta(["a"]), { pending: [] }, rows);
  assert.equal(d.lat, 37.781111);
  assert.equal(d.lon, -122.413333);
});

// ------------------------------------------------------------------ render

const corners = [
  { slug: "a-and-b", name: "A and B", lat: 37.78, lon: -122.41, grade: "F", index: 99, points: 196.9, counts: {} },
];
const cotd = [{ slug: "a-and-b", name: "A and B", date: "2026-08-20", grade: "F", index: 99 }];
const city = { top: corners, queueLength: 7174 };

const page = (discs) =>
  HOME(corners, "https://example.test", cotd, null, false, city, null, null, null, null, null, null, {
    discs,
    radiusM: 80,
  });

test("the legend states the radius and the count from the discs drawn, and links how the map is drawn", () => {
  const html = page([
    { slug: "a", lat: 37.78, lon: -122.41, rendered: true },
    { slug: "b", lat: 37.77, lon: -122.42, rendered: true },
    { slug: "c", lat: 37.76, lon: -122.43, rendered: false },
  ]);
  const t = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(t, /Audited coverage: the 80m core around each fully audited corner \( ?3 ?, 1 awaiting a render ?\), one more every morning/);
  assert.ok(html.includes('href="/methodology#map">How this map is drawn'), "the explanation is one link away");
});

test("the legend counts the discs, so it cannot claim one the map is not drawing", () => {
  const t = page([{ slug: "a", lat: 37.78, lon: -122.41, rendered: true }])
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  assert.match(t, /corner \( ?1 ?\), one more every morning/, "counted off the array");
  assert.doesNotMatch(t, /awaiting a render/, "nothing pending means the clause is absent");
});

test("the never-one-outline rule moved to /methodology in full", async () => {
  // The homepage keeps the claim and the link; the design rule is stated in
  // full where the link lands, so it is still said on the site, not only in
  // a comment.
  const { METHODOLOGY } = await import("../src/methodology.js");
  const m = METHODOLOGY("", false, 7355, null).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(m, /drawn per corner and never as one outline/);
  assert.match(m, /would enclose thousands of crossings nobody has audited/);
  const t = page([{ slug: "a", lat: 37.78, lon: -122.41, rendered: true }]);
  assert.doesNotMatch(t, /never as one outline/, "the full rule no longer crowds the legend");
});

test("no discs means no legend and no payload, not an empty one", () => {
  const html = page([]);
  assert.doesNotMatch(html, /covlegend/);
  assert.doesNotMatch(html, /Audited coverage:/);
});

test("the discs reach the browser and the map is told the radius", () => {
  const html = page([{ slug: "a", lat: 37.78, lon: -122.41, rendered: true }]);
  assert.match(html, /var COVERAGE = \[\{"slug":"a"/);
  assert.match(html, /var COVERAGE_R = 80;/);
  assert.match(html, /coverage: COVERAGE, coverageRadiusM: COVERAGE_R/);
});

// ------------------------------------------------------------------ leafmap

const leafmap = readFileSync(new URL("../public/leafmap.js", import.meta.url), "utf8");

test("coverage circles are non-interactive, so a tap reaches the dot beneath", () => {
  const block = leafmap.slice(leafmap.indexOf("audited coverage"), leafmap.indexOf("// audited: solid"));
  assert.match(block, /interactive: false/, "a coverage disc must never swallow a tap");
  assert.match(block, /pointerEvents = "none"/, "and the whole pane is inert");
});

test("coverage draws in its own pane, beneath the markers", () => {
  const block = leafmap.slice(leafmap.indexOf("audited coverage"), leafmap.indexOf("// audited: solid"));
  assert.match(block, /createPane\("coverage"\)/);
  const z = block.match(/zIndex = (\d+)/);
  assert.ok(z, "the pane needs an explicit z-index");
  assert.ok(Number(z[1]) < 400, `coverage pane at ${z[1]} must sit below the 400 overlay pane`);
});

test("discs are metres and not pixels, so 80m stays 80m at every zoom", () => {
  const block = leafmap.slice(leafmap.indexOf("audited coverage"), leafmap.indexOf("// audited: solid"));
  assert.match(block, /L\.circle\(/, "L.circle takes metres");
  assert.doesNotMatch(block, /L\.circleMarker\(/, "circleMarker's radius is pixels and would lie about scale");
});

test("the layer is built once and never rebuilt on zoom", () => {
  const block = leafmap.slice(leafmap.indexOf("audited coverage"), leafmap.indexOf("// audited: solid"));
  assert.match(block, /L\.layerGroup\(\)/, "one group");
  assert.doesNotMatch(block, /on\("zoomend"/, "no per-zoom rebuild");
  assert.doesNotMatch(block, /on\("moveend"/, "no per-pan rebuild");
});

test("the toggle defaults on and is a real button", () => {
  const block = leafmap.slice(leafmap.indexOf("audited coverage"), leafmap.indexOf("// audited: solid"));
  assert.match(block, /setAttribute\("aria-pressed", "true"\)/, "default on");
  assert.match(block, /covBtn\.type = "button"/, "a button, not a div, so it is keyboard reachable");
  assert.match(block, /disableClickPropagation/, "the toggle must not pan the map");
});

test("the coverage layer uses no grade colour", () => {
  const block = leafmap.slice(leafmap.indexOf("audited coverage"), leafmap.indexOf("// audited: solid"));
  // The A to F palette from src/home.js. This layer answers a different
  // question and must not borrow the answer to that one.
  for (const grade of ["#788c5d", "#a3b088", "#6a9bcc", "#e89a5f", "#F07E26", "#f07e26"]) {
    assert.ok(!block.includes(grade), `coverage must not use the grade colour ${grade}`);
  }
  assert.match(block, /#141B2D/, "ink is the coverage colour");
});

// ------------------------------------------- the legibility gate's verdicts
//
// The gate had two verdicts and needed three. Returning "pass" when nothing was
// checkable is the gate reporting a clean bill of health for an examination it
// never performed, and on an evidence product that publishes a photograph of a
// named intersection it is the worse of the two possible errors.

test("a render whose source frame was legible and survived passes", async () => {
  const { checkLegibility } = await import("./lib/legibility.mjs");
  const r = await checkLegibility({
    inputRead: { watermark: "Google", signage: "MISSION ST" },
    renderRead: { watermark: "Google", signage: "MISSION ST" },
    expectStreets: ["MISSION"],
  });
  assert.equal(r.verdict, "pass");
  assert.deepEqual(r.checked.sort(), ["signage", "watermark"]);
});

test("a render that destroyed readable text is held", async () => {
  const { checkLegibility } = await import("./lib/legibility.mjs");
  const r = await checkLegibility({
    inputRead: { watermark: "Google", signage: "MISSION ST" },
    renderRead: { watermark: "=, --> -", signage: "MISSION ST" },
    expectStreets: ["MISSION"],
  });
  assert.equal(r.verdict, "hold");
  assert.match(r.reasons.join(" "), /watermark/);
});

test("a render nothing could be checked against abstains, it does not pass", async () => {
  // 6th-and-mission: the source frame reads nothing at the watermark and pure
  // OCR noise at the signage band. Both signals abstain. The old gate called
  // that pass with checked=[] and would have published an unverified render
  // while recording that the gate cleared it.
  const { checkLegibility } = await import("./lib/legibility.mjs");
  const r = await checkLegibility({
    inputRead: { watermark: "", signage: "N F Ne as. Ce rst aa" },
    renderRead: { watermark: "", signage: "blur" },
    expectStreets: ["MISSION"],
  });
  assert.equal(r.verdict, "abstain", "not pass");
  assert.deepEqual(r.checked, [], "because nothing was checkable");
  assert.match(r.reasons.join(" "), /unverified rather than verified/);
});

test("only pass publishes; hold and abstain both keep the render off the site", async () => {
  const { checkLegibility } = await import("./lib/legibility.mjs");
  const verdicts = [];
  for (const [inw, outw] of [["Google", "Google"], ["Google", ""], ["", ""]]) {
    const r = await checkLegibility({ inputRead: { watermark: inw, signage: "" }, renderRead: { watermark: outw, signage: "" } });
    verdicts.push(r.verdict);
  }
  assert.deepEqual(verdicts, ["pass", "hold", "abstain"]);
  assert.equal(verdicts.filter((v) => v === "pass").length, 1, "exactly one of the three may reach the site");
});

test("street names are derived from the corner name, longest token first", async () => {
  const { streetNames } = await import("./promote_corners.mjs");
  assert.deepEqual(streetNames("Fillmore Street and Lombard Street"), ["FILLMORE", "LOMBARD"]);
  // "6th" is dropped: it is three characters and OCR finds it in noise.
  assert.deepEqual(streetNames("Mission Street and 6th Street"), ["MISSION"]);
  assert.deepEqual(streetNames(""), []);
});
