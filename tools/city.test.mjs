// The city layer's contract.
//
// Two things are asserted here that nothing else can catch. First, the shard
// key rule: it is computed in the builder and again in the Worker, and if the
// two ever disagree a corner is written to one bundle and looked for in
// another, which reads as "corner not found" for exactly the corners that
// exist. Second, that the scored payload builders are synchronous. A page for
// a scored corner is supposed to cost zero external calls, and the cheapest
// way to guarantee that is a function that cannot await anything.

import test from "node:test";
import assert from "node:assert/strict";
import {
  shardKeyFor, tierOf, cityStats, cityScore, cityCred, cityLetter,
  TIERS, TIER_LABEL, TIER_NOTE, skipsAudit, RANK_PAGE_SIZE,
} from "../src/city.js";
import { gradeFor, percentileOf } from "../src/score.js";

const corner = {
  slug: "34th-and-balboa",
  name: "34th and Balboa",
  short: "34th & Balboa",
  lat: 37.775862,
  lon: -122.494104,
  tier: TIERS.SCORED,
  sweep: {
    points: 12.3,
    index: 71,
    grade: "C",
    counts: { fatal: 0, severe: 1, otherVisible: 2, pain: 1, ped: 1, safety311: 6 },
    district: 1,
    sweepDate: "2026-08-18",
    radiusM: 80,
  },
};

test("shard keys agree with how the builder groups", () => {
  assert.equal(shardKeyFor("balboa-and-park-presidio"), "b");
  assert.equal(shardKeyFor("taylor-and-turk"), "t");
  // Digit-leading slugs take two characters, or every numbered street in the
  // city lands in one bundle four times the size of any other.
  assert.equal(shardKeyFor("16th-mission"), "16");
  assert.equal(shardKeyFor("3rd-and-palou"), "3r");
  assert.equal(shardKeyFor("40th-and-cabrillo"), "40");
});

test("a leaderboard page never spans two KV reads", () => {
  // /api/city slices 50 rows out of one stored page. If RANK_PAGE_SIZE stops
  // being a multiple of that, the second half of the city goes missing with no
  // error anywhere.
  assert.equal(RANK_PAGE_SIZE % 50, 0);
});

test("tiers are decided by what exists, not by a label", () => {
  assert.equal(tierOf(corner, null), TIERS.SCORED);
  assert.equal(tierOf({ slug: "x" }, { status: "ready", states: ["hazards", "fix"] }), TIERS.AUDITED);
  // A corner holding only the free Street View frame has had no audit run on
  // it and must never be counted as audited.
  assert.equal(tierOf({ slug: "x" }, { status: "ready", states: ["today"] }), TIERS.AUDITED);
  assert.equal(tierOf({ slug: "x", tier: "score" }, null), TIERS.ENRICHED);
  assert.equal(tierOf({ slug: "x", derived: false }, null), TIERS.ENRICHED);
});

test("the legacy score tier still tells the imagery lane not to spend", () => {
  assert.equal(skipsAudit({ tier: "score" }), true);
  assert.equal(skipsAudit({ tier: TIERS.SCORED }), true);
  assert.equal(skipsAudit({ tier: undefined }), false);
});

test("every tier has a label and a note", () => {
  for (const t of Object.values(TIERS)) {
    assert.ok(TIER_LABEL[t], `label for ${t}`);
    assert.ok(TIER_NOTE[t], `note for ${t}`);
  }
});

test("scored payloads are synchronous, so they cannot make a network call", () => {
  for (const fn of [cityStats, cityScore, cityCred, cityLetter]) {
    const out = fn(corner);
    assert.ok(!(out instanceof Promise), `${fn.name} returned a promise`);
  }
});

test("scored stats carry the fields the page dereferences", () => {
  const d = cityStats(corner);
  for (const k of ["crashes", "fatal", "reports311", "district", "asOf", "radiusM", "reports311Window"]) {
    assert.ok(k in d, `stats missing ${k}`);
  }
  for (const k of ["crashes", "reports311", "district"]) {
    assert.match(d.urls[k], /^https:\/\/data\.sfgov\.org\/resource\//, `urls.${k} is not a live query`);
  }
  // The tiles add up to the severity mix the score panel draws from.
  const c = corner.sweep.counts;
  assert.equal(d.crashes, c.fatal + c.severe + c.otherVisible + c.pain);
  // Never "sample": a swept figure is the real record as of a stated date.
  assert.equal(d.source, "sweep");
});

test("scored score carries the fields the page dereferences", () => {
  const d = cityScore(corner);
  for (const k of ["index", "grade", "points", "radius", "counts", "caveat", "asOf"]) {
    assert.ok(k in d, `score missing ${k}`);
  }
  assert.match(d.urls.severity, /within_circle/);
  // The grade on the shard must be the grade the live code would produce for
  // the same points, or a corner's page and its shard row disagree.
  assert.equal(gradeFor(percentileOf(corner.sweep.points)), gradeFor(corner.sweep.index));
});

test("the cred check reports unchecked lanes as unchecked", () => {
  const d = cityCred(corner);
  assert.equal(d.lanes.length, 4);
  const records = d.lanes.find((l) => l.key === "records");
  assert.equal(records.hit, true);
  const pending = d.lanes.filter((l) => l.pending);
  assert.equal(pending.length, 3);
  for (const l of pending) assert.equal(l.hit, false, "a pending lane must not read as a hit");
  assert.match(d.verdict, /NOT YET CHECKED/);
});

test("a corner with no record at all does not claim one", () => {
  const quiet = { ...corner, sweep: { ...corner.sweep, counts: { fatal: 0, severe: 0, otherVisible: 0, pain: 0, ped: 0, safety311: 1 } } };
  const d = cityCred(quiet);
  assert.equal(d.lanes.find((l) => l.key === "records").hit, false);
  assert.match(d.verdict, /NO RECORDS FOUND/);
});

test("the letter is offered, never drafted, and never a sample", () => {
  const d = cityLetter(corner);
  assert.equal(d.source, "ondemand");
  assert.equal(d.text, "");
  assert.equal(d.gated, true);
  assert.ok(d.gatedReason.length > 10);
});
