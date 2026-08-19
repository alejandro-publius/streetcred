// The radar, where it decides things.
//
// Two properties matter more than the rest: a corridor match must not become
// a corner citation on its own, and a detection that fails must survive as a
// published failure rather than disappearing.
import test from "node:test";
import assert from "node:assert/strict";
import { worstCorridors, corridorQuery, judge, lagHours, medianLag, resultsFrom, monitorIdFrom, cornersFor } from "../src/radar.js";

const INDEX = [
  { slug: "16th-and-mission", name: "16th and Mission" },
  { slug: "24th-and-mission", name: "24th and Mission" },
  { slug: "eddy-and-mason", name: "Eddy and Mason" },
];

test("corridors are the sum of their corners, and a lone corner is not a corridor", () => {
  const rows = [
    { name: "16th and Mission", points: 50 },
    { name: "24th and Mission", points: 40 },
    { name: "Eddy and Mason", points: 90 },
  ];
  const out = worstCorridors(rows, 5);
  const mission = out.find((c) => c.street.toLowerCase() === "mission");
  assert.ok(mission, "Mission should be a corridor");
  assert.equal(mission.points, 90, "a corridor weighs the sum of its corners");
  assert.equal(mission.corners, 2);
  // Eddy and Mason each appear once, so neither is a corridor however bad.
  assert.ok(!out.some((c) => /^eddy$/i.test(c.street)), "one corner is not a corridor");
  assert.match(corridorQuery("Van Ness"), /Van Ness San Francisco pedestrian OR collision OR crash/);
});

test("a corridor story does not become a citation on every corner of it", () => {
  const article = {
    title: "Mission Street crash injures pedestrian",
    url: "https://sfchronicle.com/a",
    publishedDate: "2026-08-19T00:00:00Z",
    text: "A collision on Mission Street injured a pedestrian.",
  };
  const hit = judge(article, "Mission", INDEX, "2026-08-19T06:00:00Z");
  assert.equal(hit.passed, true, "it is safety coverage of the corridor");
  assert.deepEqual(hit.corners, [], "naming one street attaches to no crossing");
});

test("an article naming both streets attaches to that corner only", () => {
  const corners = cornersFor(
    { title: "Crash at 16th and Mission", url: "https://x.test/a", text: "" },
    "Mission", INDEX,
  );
  assert.deepEqual(corners, ["16th-and-mission"]);
});

test("a filtered detection is a record, not a deletion", () => {
  const hit = judge(
    { title: "Mission District restaurant opens", url: "https://eater.com/a", publishedDate: "2026-08-19T00:00:00Z", text: "A new taqueria on Mission." },
    "Mission", INDEX, "2026-08-19T06:00:00Z",
  );
  assert.equal(hit.passed, false);
  assert.ok(hit.reason, "a failure has to say why");
  assert.equal(hit.title, "Mission District restaurant opens", "and is still shown");
});

test("lag is measured, and refuses to guess when there is no publication date", () => {
  assert.equal(lagHours("2026-08-19T00:00:00Z", "2026-08-19T06:00:00Z"), 6);
  assert.equal(lagHours("", "2026-08-19T06:00:00Z"), null);
  assert.equal(lagHours("2026-08-19T06:00:00Z", "2026-08-19T00:00:00Z"), null, "detection before publication is not a lag");
  // Undated hits are excluded from the median, never counted as zero.
  assert.equal(medianLag([{ lagHours: 2 }, { lagHours: null }, { lagHours: 6 }]), 4);
  assert.equal(medianLag([{ lagHours: null }]), null);
});

test("the webhook reader recognises plausible shapes and refuses to invent one", () => {
  assert.equal(resultsFrom({ results: [{ title: "a" }] }).length, 1);
  assert.equal(resultsFrom({ data: { results: [{ title: "a" }] } }).length, 1);
  assert.equal(resultsFrom({ nothing: true }), null, "an unknown shape is null, not an empty detection");
  assert.equal(monitorIdFrom({ monitorId: "m1" }), "m1");
  assert.equal(monitorIdFrom({ monitor: { id: "m2" } }), "m2");
  assert.equal(monitorIdFrom({}), null);
});
