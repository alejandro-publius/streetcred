// What the page may say when there is no photograph.
//
// "Street View has no photograph of this corner" is a claim about Google's
// coverage. It was rendering for every falsy frame: a corner nobody had
// fetched, a generation still running, a probe that errored. Only one stored
// status establishes absence, and that is the one where the probe ran and came
// back empty. Everything else is our storage gap, and our gap must not be
// reported as somebody else's.
//
//   node --test tools/emptystate.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { emptyImageryNote, IMAGERY_ABSENT_CONFIRMED, PAGE } from "../src/page.js";

const corner = { slug: "x-and-y", name: "X Street and Y Street", lat: 37.77, lon: -122.42, fix: { name: "f", cost: "$1", grant: "g" } };

test("only a confirmed probe may claim Street View has nothing", () => {
  assert.equal(emptyImageryNote(IMAGERY_ABSENT_CONFIRMED), "Street View has no photograph of this corner.");
  assert.equal(IMAGERY_ABSENT_CONFIRMED, "nocoverage");
});

test("our own gap says it is ours", () => {
  for (const status of ["scoredonly", "recordsonly", "failed", "skipped", "atcapacity"]) {
    assert.equal(
      emptyImageryNote(status),
      "No photograph stored for this corner yet.",
      `${status} is our gap, not a fact about Google`,
    );
  }
});

test("a generation still running says loading, not absent", () => {
  assert.equal(emptyImageryNote("pending"), "Loading the Street View photograph for this corner.");
  assert.equal(emptyImageryNote(null), "Loading the Street View photograph for this corner.");
  assert.equal(emptyImageryNote(undefined), "Loading the Street View photograph for this corner.");
});

test("no status ever produces a claim about Google by accident", () => {
  const claim = "Street View has no photograph";
  for (const status of [null, undefined, "", "ready", "pending", "failed", "scoredonly", "recordsonly", "skipped", "atcapacity", "weird"]) {
    if (status === IMAGERY_ABSENT_CONFIRMED) continue;
    assert.ok(!emptyImageryNote(status).includes(claim), `${status} must not claim absence`);
  }
});

// -------------------------------------------------- the served page

test("a corner with stored frames ships them in the raw HTML", () => {
  const html = PAGE(corner, {
    frames: { today: "/gen/x-and-y/today.jpg", hazards: "/gen/x-and-y/hazards.jpg", fix: "/gen/x-and-y/fix.jpg" },
    imageryStatus: "ready",
  });
  assert.match(html, /src="\/gen\/x-and-y\/today\.jpg"/, "the photograph belongs in the HTML");
  assert.match(html, /src="\/gen\/x-and-y\/fix\.jpg"/, "and so does the render it is compared against");
  assert.doesNotMatch(html, /Loading the Street View photograph/, "a page that has the frames must not say it is loading them");
  assert.doesNotMatch(html, /id="imgph"/, "and must not ship the placeholder card at all");
});

// The served note, not any occurrence of the words. The client script carries
// both strings on purpose, one per branch, so asserting over the whole document
// tests nothing.
const servedNote = (html) => (html.match(/<p class="imgphn" id="imgphn">([^<]*)</) || [])[1] ?? null;

test("a corner without frames still ships the placeholder, with the honest note", () => {
  const gap = PAGE(corner, { frames: null, imageryStatus: "scoredonly" });
  assert.match(gap, /<div class="imgph" id="imgph">/);
  assert.equal(servedNote(gap), "No photograph stored for this corner yet.");

  const confirmed = PAGE(corner, { frames: null, imageryStatus: "nocoverage" });
  assert.equal(servedNote(confirmed), "Street View has no photograph of this corner.");

  const loading = PAGE(corner, { frames: null, imageryStatus: null });
  assert.equal(servedNote(loading), "Loading the Street View photograph for this corner.");
});

test("a corner with frames ships no placeholder note at all", () => {
  const ready = PAGE(corner, { frames: { today: "/gen/x-and-y/today.jpg", fix: "/gen/x-and-y/fix.jpg" }, imageryStatus: "ready" });
  assert.equal(servedNote(ready), null, "no card, so no note");
});

test("the client mirrors the server rather than contradicting it", () => {
  // Two copies of a claim is one copy too many, and the client copy is the one
  // a reader actually sees after hydration.
  const html = PAGE(corner, { frames: null, imageryStatus: "scoredonly" });
  assert.match(html, /IMG\.status === "nocoverage"/, "the client branches on the same stored status");
  assert.match(html, /No photograph stored for this corner yet\./);
});
