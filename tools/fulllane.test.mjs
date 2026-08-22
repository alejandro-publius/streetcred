// The full lane: what may be called audited, what may not, and who gets picked.
//
// The rule under test is the cron's own (src/index.js cornerOfTheDay): a corner
// joins the audited roster only when both generated states exist. The batch
// adds the visual audit on top, which is stricter. Every test here breaks a
// different one of the three legs and checks the label does not survive it.

import test from "node:test";
import assert from "node:assert/strict";
import {
  fullLaneStatus, partialStatus, statusFor, eligible, stagedHazardFiles, slugOfHazardRender, tierOf,
} from "./promote_corners.mjs";
import { assemble, flagsFrom, HAZARDS, HAZARD_VERSION, AUDIT_SCHEMA } from "../src/hazards.js";
import { mergeResults, hazardsOf } from "./generate_letters.mjs";

const base = { at: 1700000000000, model: "gemini-3.1-flash-image", via: "vertex:global" };
const fix = { attempt: 1, usd: 0.003, gate: { verdict: "pass", checked: ["watermark"], unchecked: ["signage"] } };
const hazards = { attempt: 2, usd: 0.006, gate: { verdict: "pass", checked: ["watermark"], unchecked: [] } };
const audit = { ok: true, model: "gemini-2.5-flash", via: "vertex:us-central1", at: "2026-08-22T04:00:00Z" };

test("all three legs present writes provenance audited with both states and both attributions", () => {
  const r = fullLaneStatus(null, { ...base, fix, hazards, audit });
  assert.equal(r.provenance, "audited");
  assert.equal(r.status, "ready");
  assert.deepEqual([...r.states].sort(), ["fix", "hazards"]);
  assert.equal(r.render.fix.attempt, 1);
  assert.equal(r.render.hazards.attempt, 2);
  assert.equal(r.render.hazards.gateVerdict, "pass");
  assert.equal(r.audit.model, "gemini-2.5-flash");
  assert.equal(r.audit.version, HAZARD_VERSION);
  assert.equal(r.lane, "batch-full");
});

test("fullLaneStatus refuses without the audit, without the hazards render, and without the fix render", () => {
  assert.throws(() => fullLaneStatus(null, { ...base, fix, hazards, audit: { ok: false } }), /completed audit/);
  assert.throws(() => fullLaneStatus(null, { ...base, fix, hazards: null, audit }), /completed audit|hazards render/);
  assert.throws(() => fullLaneStatus(null, { ...base, fix: null, hazards, audit }), /completed audit|fix render/);
});

test("statusFor: the label is decided by the run log AND the staged bytes, never by one alone", () => {
  const row = { state: "passed", attempt: 1, usd: 0.003, gate: fix.gate, hazardsRender: { state: "passed", attempt: 2, usd: 0.006, gate: hazards.gate }, audit };
  assert.equal(statusFor(null, row, { fix: true, hazards: true }, base).kind, "audited");
  // The log says both passed, but the hazards bytes are not staged: promoted.
  assert.equal(statusFor(null, row, { fix: true, hazards: false }, base).kind, "promoted");
  // Bytes are staged, but the log says the hazards render was held: promoted.
  const heldHaz = { ...row, hazardsRender: { state: "held", why: "watermark degraded" } };
  assert.equal(statusFor(null, heldHaz, { fix: true, hazards: true }, base).kind, "promoted");
  assert.deepEqual(statusFor(null, heldHaz, { fix: true, hazards: true }, base).status.states, ["fix"]);
  // The audit failed: promoted, and the record says so by carrying no audit block.
  const noAudit = { ...row, audit: { ok: false, why: "audit error: 429" } };
  const p = statusFor(null, noAudit, { fix: true, hazards: true }, base);
  assert.equal(p.kind, "promoted");
  assert.equal(p.status.provenance, "promoted-from-enriched");
  assert.equal(p.status.audit, undefined);
  // Nothing passed: nothing to publish.
  assert.equal(statusFor(null, { state: "held", why: "x" }, { fix: false, hazards: false }, base).kind, null);
});

test("statusFor on a render-only row (no full lane) is the existing promoted shape", () => {
  const row = { state: "passed", attempt: 1, usd: 0.003, gate: fix.gate };
  const r = statusFor({ status: "ready", states: ["hazards"], at: 1, provenance: "audited" }, row, { fix: true, hazards: false }, base);
  assert.equal(r.kind, "promoted");
  // Merged, never replaced: the prior hazards state survives, and the
  // provenance is overwritten to the honest value.
  assert.deepEqual([...r.status.states].sort(), ["fix", "hazards"]);
  assert.equal(r.status.provenance, "promoted-from-enriched");
});

test("partialStatus never writes audited, whatever the prior record said", () => {
  const r = partialStatus({ provenance: "audited", states: ["hazards"], status: "ready" }, { ...base, fix, hazards: null });
  assert.equal(r.provenance, "promoted-from-enriched");
  assert.throws(() => partialStatus(null, { ...base, fix: null, hazards: null }), /at least one/);
});

test("the framed pool admits scored corners with a frame, ranks worst first across tiers, and excludes decided holds", () => {
  // aud2 is an audited corner with a frame and no fix key, the shape the
  // roster rule alone has to catch: nothing else excludes it.
  const meta = { audited: ["aud", "aud2"], enriched: ["e1", "e2", "held1"] };
  const keys = ["img:e1:today", "img:e2:today", "img:held1:today", "img:s1:today", "img:aud:today", "img:aud:fix", "img:aud2:today"];
  const rows = { e1: { points: 50 }, e2: { points: 90 }, s1: { points: 70 }, held1: { points: 100 }, s2: { points: 95 }, aud2: { points: 999 } };
  // Render-only pool: enriched only, the scored corner is invisible.
  assert.deepEqual(eligible(meta, keys, rows, 10, [], []), ["held1", "e2", "e1"]);
  // Framed pool: the scored corner joins and ranks by its points; a staged
  // frame counts as stored; the audited corner never appears; a decided hold
  // is skipped.
  const picks = eligible(meta, keys, rows, 10, [], [], { pool: "framed", framed: ["s1", "s2", "aud", "aud2"], stagedFrames: ["s2"], decided: ["held1"] });
  assert.deepEqual(picks, ["s2", "e2", "s1", "e1"]);
  // --retry-held is the caller passing no decided set.
  assert.deepEqual(eligible(meta, keys, rows, 2, [], [], { pool: "framed", framed: ["s1"] }), ["held1", "e2"]);
  assert.equal(tierOf(meta, "s1"), "scored");
  assert.equal(tierOf(meta, "e1"), "enriched");
});

test("staged hazards renders select on their own suffix and never a scratch file", () => {
  const dir = ["a.hazards.jpg", "a.fix.jpg", "a.hazards.attempt1.jpg", ".bulk-1.json", "_results.json", "b.hazards.jpg", "_scratch.hazards.jpg", ".hidden.hazards.jpg"];
  assert.deepEqual(stagedHazardFiles(dir), ["a.hazards.jpg", "b.hazards.jpg"]);
  assert.equal(slugOfHazardRender("a.hazards.jpg"), "a");
});

test("assemble is the Worker's labelling arithmetic, and the audit schema names every hazard", () => {
  const ev = Object.fromEntries(HAZARDS.map((h) => [h.key, { reports311: 0, crossingCollisions: 0 }]));
  // Each CONFIRMED leg on its own: faded_crosswalk only through the crossing
  // collision rule, lighting only through the 311 rule (REPORTED, unflagged).
  ev.faded_crosswalk = { reports311: 0, crossingCollisions: 1 };
  ev.lighting = { reports311: 3, crossingCollisions: 0 };
  const flags = flagsFrom({ faded_crosswalk: { present: true, note: "worn" }, turning_conflict: { present: "true" }, lighting: { present: false }, curb_sidewalk: {} });
  assert.deepEqual(flags, { faded_crosswalk: true, turning_conflict: true, lighting: false, curb_sidewalk: false });
  const r = assemble(flags, ev);
  assert.equal(r.audited, true);
  assert.equal(r.version, HAZARD_VERSION);
  assert.deepEqual(r.items.map((i) => [i.key, i.verdict]), [
    ["faded_crosswalk", "CONFIRMED"],
    ["turning_conflict", "CANDIDATE"],
    ["lighting", "REPORTED"],
  ]);
  assert.equal(r.confirmed, 1);
  assert.equal(r.candidates, 1);
  assert.equal(r.reported, 1);
  // A failed audit yields a record that says so, with REPORTED rows only.
  const none = assemble(null, ev);
  assert.equal(none.audited, false);
  assert.deepEqual(none.items.map((i) => [i.key, i.verdict]), [["lighting", "REPORTED"]]);
  assert.deepEqual(AUDIT_SCHEMA.required, HAZARDS.map((h) => h.key));
});

test("the letter is conditioned on the staged hazards record when one exists", () => {
  const stored = { version: "v1", audited: false, items: [] };
  const staged = { version: "v1", audited: true, items: [{ key: "faded_crosswalk", verdict: "CONFIRMED" }] };
  assert.equal(hazardsOf("x", { "hazards:x": stored }, staged), staged);
  assert.equal(hazardsOf("x", { "hazards:x": stored }, null), stored);
  assert.equal(hazardsOf("x", {}, null), null);
});

test("a kept letter does not count as a new run and does not lose its spend", () => {
  const prior = [{ slug: "a", state: "passed", attempts: 2, usd: 0.01 }];
  const merged = mergeResults(prior, [{ slug: "a", state: "kept", attempts: 0, usd: 0 }, { slug: "b", state: "kept", attempts: 0, usd: 0 }]);
  const a = merged.find((r) => r.slug === "a");
  assert.equal(a.state, "passed");
  assert.equal(a.attempts, 2);
  assert.equal(a.usd, 0.01);
  assert.equal(a.reverified, true);
  assert.equal(a.reruns, undefined);
  const b = merged.find((r) => r.slug === "b");
  assert.equal(b.state, "passed");
  assert.equal(b.reverified, true);
});
