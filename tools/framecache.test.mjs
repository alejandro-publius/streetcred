// A cached frame means the fetch is unnecessary. It does not mean the corner
// gets no visual audit.
//
// Those were the same answer for a week. `imageryFor` returned `scoredonly`,
// a terminal status, for any corner whose slug was in the frame index. The
// block was an optimisation about the photograph budget: a scored corner whose
// bytes were published in the city bulk fetch should not re-fetch them. Its
// return value also said "this corner is records-only", and that is a different
// claim.
//
// The cost was the entire morning audit. The cron strips `corner.tier` before
// its lanes run, precisely so `skipsAudit` cannot decline the corner it woke up
// for, and then this fired anyway because the bulk fetch had staged a frame.
// 2026-08-18 is the last `imagery=ready` in cotd:log and the 586-frame bulk
// fetch is the same week. Every morning after it reads `scoredonly`.
//
//   node --test tools/framecache.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { imageryFor } from "../src/imagery.js";
import { putFrameIndex } from "../src/store.js";

const SLUG = "1st-and-bush";

// A corner the cron would audit: no tier, because the cron strips it.
const auditable = () => ({
  slug: SLUG,
  name: "1st and Bush",
  lat: 37.790991,
  lon: -122.399158,
  radiusMeters: 80,
});

// A corner the imagery lane is meant to decline, by the rule that exists for it.
const recordsOnly = () => ({ ...auditable(), tier: "scored" });

function fakeEnv() {
  const store = new Map();
  const env = {
    fetched: 0,
    STORE: {
      async get(k, type) {
        if (!store.has(k)) return null;
        const v = store.get(k);
        return type === "json" ? JSON.parse(v) : v;
      },
      async put(k, v) { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    },
    _store: store,
  };
  return env;
}

const ctx = () => ({ waitUntil: () => {} });

async function withFrame(env) {
  await putFrameIndex(env, [SLUG]);
}

// ------------------------------------------------------- the records-only branch

test("a records-only corner with a cached frame is still records-only", async () => {
  // The case the early return was written for, and the only one it still
  // serves. Nothing to fetch and nothing it wants generated.
  const env = fakeEnv();
  await withFrame(env);
  const out = await imageryFor(recordsOnly(), env, ctx());
  assert.equal(out.status, "scoredonly", "a scored corner is declined by the rule that exists for it");
  assert.equal(out.source, "cache", "and answered from the index rather than re-fetched");
  assert.ok(out.today, "its real photograph is still shown");
  assert.equal(out.fix, null);
});

// ---------------------------------------------------------- the auditable branch

test("an auditable corner with a cached frame is not declined", async () => {
  // The bug. This corner has a frame in the index and no tier, which is exactly
  // the shape the morning cron hands the lane, and it used to come back
  // scoredonly with no generation ever attempted.
  const env = fakeEnv();
  await withFrame(env);
  const out = await imageryFor(auditable(), env, ctx());
  assert.notEqual(
    out.status,
    "scoredonly",
    "a cached frame must not decide that a corner is records-only",
  );
  // It reaches a decision the generation lanes make: pending when it was
  // queued, atcapacity when the daily ceiling is spent, skipped when the
  // records are empty. Any of those is the lane running. scoredonly is not.
  assert.ok(
    ["pending", "atcapacity", "skipped", "recordsonly"].includes(out.status),
    `expected a generation-lane outcome, got ${out.status}`,
  );
});

test("and it reaches the generation lane without a billed Maps fetch", async () => {
  // The optimisation the early return existed for has to survive the fix: the
  // bytes are already in KV, so nothing may re-fetch them. fetchToday needs
  // GOOGLE_MAPS_API_KEY and a network, so if the lane tried, this would throw
  // or return nocoverage rather than reaching a generation outcome.
  const env = fakeEnv();
  await withFrame(env);
  const out = await imageryFor(auditable(), env, ctx());
  assert.notEqual(out.status, "nocoverage", "the cached frame was re-fetched instead of reused");
});

// ------------------------------------------------------------- no cached frame

test("an auditable corner with no cached frame still takes the live path", async () => {
  // The other side of frameCached. With no index entry and no Maps key the
  // fetch cannot succeed, and the lane says so rather than inventing coverage.
  const env = fakeEnv();
  const out = await imageryFor(auditable(), env, ctx());
  assert.ok(
    ["nocoverage", "scoredonly", "atcapacity"].includes(out.status),
    `expected the live path to report its own failure, got ${out.status}`,
  );
  assert.notEqual(out.source, "cache", "there was no cache to answer from");
});
