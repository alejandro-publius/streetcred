// What the watchlist page may claim about a run it has no record of.
//
// The lane moved to its own cron on 2026-08-20T17:05Z. Every deploy carrying
// that change is later than 13:20 UTC that day, so the first firing of the new
// trigger is 2026-08-21T13:20Z and press:watchlistrun does not exist yet. The
// page meanwhile went on rendering the last record the OLD path produced, from
// inside the audit's invocation, and applied the NEW arrangement's reasoning to
// it:
//
//   "On a budget of its own that should not happen, so the 22 that were cut off
//    mean something else spent the invocation first."
//
// That pass was not on a budget of its own. The page was telling readers to
// hunt for a second cause that does not exist, having just explained the real
// one in the paragraph above.
//
//   node --test tools/watchlistcopy.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { WATCHLIST_PAGE } from "../src/watchlistpage.js";

// A pass shaped like the stored one: 29 attempted, 7 completed, 22 cut off.
const stale = {
  builtAt: "2026-08-20T13:11:04.521Z",
  windowDays: 90,
  entries: [],
  rejects: [],
  // runCounts reads `failed`, not `ok`. Using the wrong field made a fixture
  // that reported 29 of 29 complete and quietly tested the wrong branch.
  queries: [
    ...Array.from({ length: 7 }, (_, i) => ({ q: `done-${i}` })),
    ...Array.from({ length: 22 }, (_, i) => ({ q: `cut-${i}`, failed: "Too many subrequests by single Worker invocation." })),
  ],
};

test("with no run record the page does not invent a second cause", () => {
  const html = WATCHLIST_PAGE(stale, "", null, false, 7355, null, null);
  assert.doesNotMatch(
    html,
    /mean something else spent the invocation first/,
    "that inference is only valid for a pass that ran on its own budget",
  );
  assert.match(html, /predates the change above/);
  assert.match(html, /The first pass under the new trigger has not happened yet/);
  assert.match(html, /reports the old numbers rather than pretending to the new ones/);
});

test("with a run record the inference is restored, because it becomes true", () => {
  const html = WATCHLIST_PAGE(stale, "", null, false, 7355, null, { at: "2026-08-21T13:20:04.000Z", ok: false, reason: "cut off" });
  assert.match(html, /mean something else spent the invocation first/);
  assert.doesNotMatch(html, /predates the change above/);
});

test("the page no longer contradicts itself about the schedule", () => {
  const html = WATCHLIST_PAGE(stale, "", null, false, 7355, null, null);
  assert.doesNotMatch(
    html,
    /It runs again every morning with the daily audit/,
    "the lane has its own trigger and both sentences used to render",
  );
  assert.match(html, /own cron trigger at 13:20 UTC/);
});

test("a complete pass says so and claims nothing about budgets", () => {
  const clean = { ...stale, queries: Array.from({ length: 29 }, (_, i) => ({ q: `q-${i}` })) };
  const html = WATCHLIST_PAGE(clean, "", null, false, 7355, null, { at: "2026-08-21T13:20:04.000Z", ok: true });
  assert.match(html, /completed all 29/);
  assert.doesNotMatch(html, /predates the change above/);
  assert.doesNotMatch(html, /mean something else spent the invocation first/);
});
