// Where a render came from, and whether the page says so.
//
// The ruling of 2026-08-20 was that seven corners promoted out of the enriched
// pool keep the ENRICHED tier and carry a render labelled honestly as promoted
// from enriched. Before this file existed the label had nowhere to live: it was
// written into a local scratch file nothing in src/ read, and the corner page
// decided its tier chip from imagery status alone, so `status === "ready"` read
// as AUDITED. A promoted render would have published indistinguishable from one
// of the 23 audited corners' and relabelled the corner while it was at it.
//
//   node --test tools/provenance.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDITED, PROMOTED_FROM_ENRICHED, provenanceOf, provenanceNote, tierFromImagery, PROMOTED_NOTE,
} from "../src/imagery.js";
import { HERO_CORNER, PAGE } from "../src/page.js";

// ------------------------------------------------------------ resolution

test("both values resolve, and nothing else does", () => {
  assert.equal(provenanceOf({ provenance: AUDITED }), "audited");
  assert.equal(provenanceOf({ provenance: PROMOTED_FROM_ENRICHED }), "promoted-from-enriched");
  assert.equal(provenanceOf({ provenance: "AUDITED" }), null, "case matters, no silent coercion");
  assert.equal(provenanceOf({ provenance: "audited-ish" }), null);
});

test("absent provenance resolves to null, never to audited", () => {
  // Every imgstatus record written before this field existed carries no claim.
  // Resolving that silence into the stronger of the two values is the same
  // mistake as a gate that returns pass when it checked nothing.
  assert.equal(provenanceOf({ status: "ready", states: ["hazards", "fix"] }), null);
  assert.equal(provenanceOf(null), null);
  assert.equal(provenanceOf(undefined), null);
  assert.equal(provenanceOf({}), null);
});

// ------------------------------------------------------------ the tier chip

test("a promoted corner stays enriched no matter what its imagery says", () => {
  assert.equal(tierFromImagery("ready", PROMOTED_FROM_ENRICHED), "enriched");
  assert.equal(tierFromImagery("ready", AUDITED), "audited");
  assert.equal(tierFromImagery("ready", null), "audited", "a record predating the field keeps today's meaning");
  assert.equal(tierFromImagery("pending", PROMOTED_FROM_ENRICHED), "enriched");
  assert.equal(tierFromImagery(null, null), null, "no imagery, no claim");
});

test("the client tier chip reads provenance before status", () => {
  // The rule lives in PAGE's inline script, so it is asserted on the emitted
  // source. Order matters: the promoted branch must be tested BEFORE the
  // status === "ready" branch or it can never be reached.
  const html = PAGE({ slug: "x", name: "X and Y", lat: 37.7, lon: -122.4, fix: { name: "f", cost: "$1", grant: "g" } });
  const iProm = html.indexOf('IMG.provenance === "promoted-from-enriched"');
  const iReady = html.indexOf('IMG.status === "ready") t = "audited"');
  assert.ok(iProm > -1, "the promoted branch must exist");
  assert.ok(iReady > -1, "the audited branch must exist");
  assert.ok(iProm < iReady, "promoted must be checked first or it is unreachable");
});

// ------------------------------------------------------------ the caption

test("the note says the two things a promoted render owes its reader", () => {
  assert.match(PROMOTED_NOTE, /promoted from the enriched pool/);
  assert.match(PROMOTED_NOTE, /not had a full visual audit/);
  assert.match(PROMOTED_NOTE, /not counted in the audited coverage layer/);
  assert.equal(provenanceNote(PROMOTED_FROM_ENRICHED), PROMOTED_NOTE);
  assert.equal(provenanceNote(AUDITED), "", "an audited corner owes no disclaimer");
  assert.equal(provenanceNote(null), "", "and neither does an unlabelled one");
});

test("the client copy of the note is byte-identical to the server's", () => {
  // Two copies of a claim is one copy too many. If PAGE's inline constant ever
  // drifts from src/imagery.js, the page makes a claim nobody is checking.
  const html = PAGE({ slug: "x", name: "X and Y", lat: 37.7, lon: -122.4, fix: { name: "f", cost: "$1", grant: "g" } });
  assert.ok(
    html.includes(`const PROMOTED_NOTE = ${JSON.stringify(PROMOTED_NOTE)};`),
    "the inline constant must be the exported string verbatim",
  );
});

test("the caption appends the note only on the fix frame", () => {
  const html = PAGE({ slug: "x", name: "X and Y", lat: 37.7, lon: -122.4, fix: { name: "f", cost: "$1", grant: "g" } });
  assert.match(
    html,
    /state === "fix" && IMG\.provenance === "promoted-from-enriched"/,
    "the note is a claim about the render, not about the photograph or the hazard overlay",
  );
});

// ------------------------------------------------------- the homepage hero

const hero = (over = {}) => ({
  slug: "6th-and-mission",
  name: "6th Street and Mission Street",
  date: "2026-08-20",
  grade: "F",
  frames: { today: "/gen/6th-and-mission/today.jpg", fix: "/gen/6th-and-mission/fix.jpg" },
  ...over,
});

test("a promoted corner says so under the render", () => {
  const html = HERO_CORNER(hero({ provenance: "promoted-from-enriched" }));
  assert.ok(html.includes(PROMOTED_NOTE), "the note must be on the page");
  assert.match(html, /hcdisclaim/, "and it rides the same element as the AI disclaimer");
});

test("an audited corner says nothing extra", () => {
  const html = HERO_CORNER(hero({ provenance: "audited" }));
  assert.ok(!html.includes(PROMOTED_NOTE), "an audited corner must not disclaim an audit it had");
  assert.match(html, /visualization/, "but it still carries the ordinary AI disclaimer");
});

test("an unlabelled corner says nothing rather than guessing", () => {
  const html = HERO_CORNER(hero({ provenance: null }));
  assert.ok(!html.includes(PROMOTED_NOTE));
});

test("a corner with no render carries no provenance claim at all", () => {
  // Nothing to be promoted, so nothing to disclaim. The note must not appear on
  // a corner that has only its photograph.
  const html = HERO_CORNER(hero({ provenance: "promoted-from-enriched", frames: { today: "/gen/x/today.jpg" } }));
  assert.ok(!html.includes(PROMOTED_NOTE), "no render means no claim about a render");
});
