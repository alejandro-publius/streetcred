// What may reach KV as a proposed-fix render, and what may not.
//
// The letter publish path taught this lesson the expensive way. It carried a
// hand-rolled copy of a filter that was already written, exported and tested
// elsewhere, and the copy omitted one clause: on its first real run it wrote 11
// of the tool's own scratch files to KV as letters and reported 127 letters
// where 116 existed. So the render publish path calls one exported filter and
// this file is what holds it shut.
//
//   node --test tools/renderpublish.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { stagedRenderFiles, slugOfRender, promotedStatus, buildRenderLedger } from "./promote_corners.mjs";

// ------------------------------------------------------------- the filter

test("a held render cannot publish, because a held render has no fix.jpg", () => {
  // This is the structural guarantee. A render that passes the gate is written
  // to `{slug}.fix.jpg`. A render that was held leaves only its attempt files
  // behind for diagnosis. Selecting on the suffix means "held cannot publish"
  // does not depend on the loop above getting its branches right.
  const dir = [
    "good-corner.fix.jpg",
    "held-corner.attempt1.jpg",
    "held-corner.attempt2.jpg",
  ];
  const selected = stagedRenderFiles(dir);
  assert.deepEqual(selected, ["good-corner.fix.jpg"]);
  assert.ok(!selected.some((f) => f.includes("attempt")), "a rejected candidate must never be published");
});

test("every scratch file this tool writes into the staging directory is excluded", () => {
  const dir = [
    "good-corner.fix.jpg",
    "_results.json",                 // the run log
    "quota_probe.json",
    "held.attempt1.jpg",
    ".imgkeys-6.json",               // written by this publish phase
    ".imgbulk-6.json",               // written by this publish phase
    ".renderledger.json",            // written by this publish phase
    ".DS_Store",
    "some-corner.meta.json",
  ];
  assert.deepEqual(stagedRenderFiles(dir), ["good-corner.fix.jpg"]);
});

test("the filter survives the empty and the absent case", () => {
  assert.deepEqual(stagedRenderFiles([]), []);
  assert.deepEqual(stagedRenderFiles(null), []);
  assert.deepEqual(stagedRenderFiles(undefined), []);
});

test("a slug round-trips out of its filename", () => {
  assert.equal(slugOfRender("6th-and-mission.fix.jpg"), "6th-and-mission");
  assert.equal(slugOfRender("hwy-101st-northbound-and-mission.fix.jpg"), "hwy-101st-northbound-and-mission");
});

// ------------------------------------------------------- the status record

const opts = { at: 1700000000000, model: "gemini-3.1-flash-image", via: "vertex:global", attempt: 1, usd: 0.0063 };

test("a promoted render is stamped promoted, never audited", () => {
  const r = promotedStatus(null, opts);
  assert.equal(r.provenance, "promoted-from-enriched");
  assert.equal(r.status, "ready");
  assert.deepEqual(r.states, ["fix"]);
});

test("model attribution and provenance are written in the same record", () => {
  // Two records could disagree about one render. One cannot.
  const r = promotedStatus(null, opts);
  assert.equal(r.render.fix.model, "gemini-3.1-flash-image");
  assert.equal(r.render.fix.via, "vertex:global");
  assert.equal(r.render.fix.attempt, 1);
  assert.equal(r.render.fix.usd, 0.0063);
  assert.equal(r.provenance, "promoted-from-enriched");
});

test("the gate's own verdict rides with the image", () => {
  // A render that passed because nothing was checkable is a different fact from
  // one that passed a watermark comparison, and the record says which.
  const r = promotedStatus(null, { ...opts, gate: { verdict: "pass", checked: ["watermark"], unchecked: ["signage"] } });
  assert.equal(r.render.fix.gateVerdict, "pass");
  assert.deepEqual(r.render.fix.gateChecked, ["watermark"]);
  assert.deepEqual(r.render.fix.gateUnchecked, ["signage"]);
});

test("publishing a fix does not drop a state the corner already had", () => {
  const r = promotedStatus({ status: "ready", states: ["hazards"], at: 1, provenance: "audited" }, opts);
  assert.deepEqual(r.states.sort(), ["fix", "hazards"]);
  assert.equal(r.provenance, "promoted-from-enriched", "the newer, weaker claim wins");
});

test("republishing the same render cannot duplicate the state", () => {
  const once = promotedStatus(null, opts);
  const twice = promotedStatus(once, opts);
  assert.deepEqual(twice.states, ["fix"], "states is a set, not a list");
});

// -------------------------------------------------------------- the ledger

test("the render ledger lists held renders too, because they were billed", () => {
  const l = buildRenderLedger([
    { slug: "a", state: "passed", attempt: 1, usd: 0.006, promptTokens: 900, outputTokens: 800 },
    { slug: "b", state: "held", why: "watermark: source reads Google, render reads \"\"", usd: 0.006, promptTokens: 900, outputTokens: 800 },
    { slug: "c", state: "held", why: "render error: Resource has been exhausted (e.g. check quota).", usd: 0 },
  ]);
  assert.equal(l.attempted, 3);
  assert.equal(l.published, 1);
  assert.equal(l.held, 2);
  assert.equal(l.heldOnGate, 1);
  assert.equal(l.heldOnApi, 1);
  assert.equal(l.estUsd, 0.012, "the rejected render is billed, so it is counted");
  assert.equal(l.perRender.length, 3, "a line per render, not a line per published render");
  assert.equal(l.perRender.find((r) => r.slug === "b").why.length > 0, true, "a held line carries its reason");
  assert.equal(l.perRender.find((r) => r.slug === "a").why, undefined, "a published line has nothing to explain");
});

test("an empty render run produces a ledger that claims nothing", () => {
  const l = buildRenderLedger([]);
  assert.equal(l.attempted, 0);
  assert.equal(l.published, 0);
  assert.equal(l.estUsd, 0);
  assert.deepEqual(l.perRender, []);
});

test("the ledger names its own provenance, so nothing reads it as an audit", () => {
  const l = buildRenderLedger([{ slug: "a", state: "passed", usd: 0.001 }]);
  assert.equal(l.provenance, "promoted-from-enriched");
  assert.equal(l.auth, "application default credentials, no api key");
  assert.match(l.basis, /held renders are counted/);
});
