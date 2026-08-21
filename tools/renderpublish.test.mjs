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

// -------------------------------------------- refusing to spend on a hold

test("a corner whose source frame is unreadable is refused before spending", async () => {
  const { sourceIsCheckable } = await import("./promote_corners.mjs");
  // 6th-and-mission, verbatim: the watermark band reads nothing and the signage
  // band reads OCR noise off a clean photograph.
  const r = sourceIsCheckable(
    { watermark: "", signage: "N F Ne as. Ce rst aa a aw ap Dp Po I ee 4 aeig cf ns x ics Zu son" },
    ["MISSION"],
  );
  assert.equal(r.checkable, false);
  assert.match(r.why, /re-fetch the Street View frame rather than re-rendering/);
});

test("one readable signal is enough to be worth rendering", async () => {
  const { sourceIsCheckable } = await import("./promote_corners.mjs");
  assert.equal(sourceIsCheckable({ watermark: "Google", signage: "noise" }, ["MISSION"]).checkable, true);
  assert.equal(sourceIsCheckable({ watermark: "", signage: "MISSION ST" }, ["MISSION"]).checkable, true);
  assert.equal(sourceIsCheckable({ watermark: "", signage: "" }, []).checkable, false);
});

test("backoff grows and is capped", async () => {
  const { backoffMs } = await import("./promote_corners.mjs");
  assert.equal(backoffMs(1, 1000, 60_000), 1000);
  assert.equal(backoffMs(2, 1000, 60_000), 2000);
  assert.equal(backoffMs(3, 1000, 60_000), 4000);
  assert.equal(backoffMs(20, 1000, 60_000), 60_000, "capped, never unbounded");
});

test("a named retry cannot overwrite a render that already published", async () => {
  const { eligible } = await import("./promote_corners.mjs");
  const meta = { enriched: ["a", "b", "c"] };
  const keys = ["img:a:today", "img:b:today", "img:c:today", "img:b:fix"];
  // b already has a fix render. Naming it explicitly must not resurrect it:
  // the whole stage is skip-existing and idempotent.
  assert.deepEqual(eligible(meta, keys, {}, 0, ["a", "b"]), ["a"]);
  assert.deepEqual(eligible(meta, keys, {}, 0, ["b"]), [], "naming a published corner selects nothing");
});

test("the render ledger says when the calls happened, not when it was rebuilt", async () => {
  const { imagerySpend } = await import("./promote_corners.mjs");
  // The block used to carry counts and dollars with no timestamp at all, inside
  // a ledger whose period is a calendar month, so nothing on the record said
  // which day the money was spent.
  const r = imagerySpend([
    { slug: "a", state: "passed", usd: 0.006, at: "2026-08-21T00:20:00.000Z" },
    { slug: "b", state: "held", why: "quota", usd: 0, at: "2026-08-21T00:24:00.000Z" },
  ]);
  assert.equal(r.at, "2026-08-21T00:24:00.000Z", "the latest attempt in the run");

  const undated = imagerySpend([{ slug: "a", state: "passed", usd: 0.006 }]);
  assert.equal(undated.at, null, "no stamp is null, not a guess at now");
});

// ------------------------------------ the render log accumulates across runs
//
// Burn 26 in the sibling tool, fixed there and missed here. A `--only=` retry
// of one corner wrote its single row over the six the pass before it recorded,
// and the ledger built from that file reported one render attempted and $0.0095
// for a night that attempted six and spent $0.0222. The perRender lines of the
// already-published ledger were the only surviving copy of the other five.

test("a subset re-render merges into the log instead of replacing it", async () => {
  const { mergeRenderResults } = await import("./promote_corners.mjs");
  const first = [
    { slug: "a", state: "held", usd: 0.003 },
    { slug: "b", state: "passed", usd: 0.009 },
    { slug: "c", state: "held", usd: 0 },
  ];
  const rerun = [{ slug: "a", state: "held", why: "watermark", usd: 0.0095 }];
  const merged = mergeRenderResults(first, rerun);
  assert.equal(merged.length, 3, "the corners the retry did not touch survive");
  assert.deepEqual(merged.map((r) => r.slug), ["a", "b", "c"]);
  assert.equal(merged.find((r) => r.slug === "a").why, "watermark", "the retry's verdict wins");
  assert.equal(merged.find((r) => r.slug === "a").rerenders, 1);
  assert.equal(merged.find((r) => r.slug === "b").rerenders, undefined);
});

test("a re-render adds to the render bill rather than replacing it", async () => {
  const { buildRenderLedger } = await import("./promote_corners.mjs");
  // The merged row for a re-rendered corner holds only the LATEST spend, so a
  // ledger that sums rows loses the first attempt. The run log is what keeps it.
  const rows = [
    { slug: "a", state: "held", usd: 0.0095, promptTokens: 3735, outputTokens: 3360 },
    { slug: "b", state: "passed", usd: 0.0095 },
  ];
  const runs = [
    { at: "2026-08-21T00:20:34.803Z", label: "first pass", corners: 6, estUsd: 0.012697, promptTokens: 4992, outputTokens: 4480 },
    { at: "2026-08-21T05:54:28.577Z", label: "re-render", corners: 1, estUsd: 0.009521, promptTokens: 3735, outputTokens: 3360 },
  ];
  const l = buildRenderLedger(rows, { runs });
  assert.equal(l.estUsd, 0.022218, "both runs are billed");
  assert.equal(l.promptTokens, 8727);
  assert.equal(l.runs.length, 2, "and the runs are itemised rather than only summed");
  // Counts still come from the rows, which are the current state of the fleet.
  assert.equal(l.attempted, 2);
  assert.equal(l.published, 1);
});

test("without a run log the ledger falls back to the rows", async () => {
  const { buildRenderLedger } = await import("./promote_corners.mjs");
  const l = buildRenderLedger([{ slug: "a", state: "passed", usd: 0.006 }]);
  assert.equal(l.estUsd, 0.006);
  assert.equal(l.runs, undefined);
});

test("a spent daily KV allowance is recognised as a condition, not a crash", async () => {
  // Cloudflare's free plan allows 1,000 KV writes a day, account wide,
  // resetting 00:00 UTC. Hitting it is an ordinary operating condition. The
  // publish path used to surface it as an unhandled Node exception with the
  // real message buried inside a stringified stderr dump.
  const { KV_CAP_SPENT } = await import("./promote_corners.mjs");
  assert.ok(KV_CAP_SPENT.test("your account has reached the free usage limit for this operation for today [code: 10048]"));
  assert.ok(KV_CAP_SPENT.test("something failed code: 10048"));
  assert.ok(!KV_CAP_SPENT.test("bulk get keys: 'You can request a maximum of 100 keys' [code: 10029]"), "a different cap is a different message");
  assert.ok(!KV_CAP_SPENT.test("Resource has been exhausted (e.g. check quota)."), "a model quota is not a KV cap");
});
