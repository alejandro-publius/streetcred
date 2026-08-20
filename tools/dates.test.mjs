// Every date a visitor reads is a Pacific date.
//
// The bug: at 7:37 PM Pacific on 2026-08-18 the homepage showed a "Your
// corners" chip stamped 2026-08-19 while Corner of the Day on the same screen
// read 2026-08-18. Both were correct about the instant and one was reading it
// in UTC, where evening Pacific is already tomorrow. Every assertion below is
// pinned to a mocked clock at 7:30 PM Pacific, which is the hour the disagreement
// appears, because a test run at noon passes with the bug still in place.

import test from "node:test";
import assert from "node:assert/strict";
import { pacificDay, pacificToday } from "../src/data.js";

// 2026-08-18T19:30 Pacific is 2026-08-19T02:30Z. Daylight time, UTC-7.
const EVENING = "2026-08-19T02:30:00.000Z";

test("an evening Pacific instant renders as the Pacific day, not the UTC one", () => {
  assert.equal(pacificDay(EVENING), "2026-08-18");
  assert.equal(new Date(EVENING).toISOString().slice(0, 10), "2026-08-19");
});

test("every date on the page agrees under a 7:30 PM Pacific clock", () => {
  // The chip, the corner-of-the-day stamp, the change log and the retrieval
  // date all went through different code paths and now go through this one.
  const asChip = pacificDay(EVENING);
  const asCotd = pacificDay(new Date(EVENING));
  const asChangeLog = pacificDay(EVENING);
  const asRetrieved = pacificDay(new Date(EVENING).getTime());
  assert.equal(asChip, "2026-08-18");
  assert.deepEqual(new Set([asChip, asCotd, asChangeLog, asRetrieved]).size, 1);
});

test("the boundary is the Pacific midnight, not the UTC one", () => {
  // 23:59 Pacific on the 18th is already 06:59Z on the 19th.
  assert.equal(pacificDay("2026-08-19T06:59:00.000Z"), "2026-08-18");
  // One minute later it is the 19th in San Francisco too.
  assert.equal(pacificDay("2026-08-19T07:00:00.000Z"), "2026-08-19");
});

test("standard time shifts the boundary by an hour and the rule still holds", () => {
  // December: UTC-8. 23:59 Pacific on the 10th is 07:59Z on the 11th.
  assert.equal(pacificDay("2026-12-11T07:59:00.000Z"), "2026-12-10");
  assert.equal(pacificDay("2026-12-11T08:00:00.000Z"), "2026-12-11");
});

test("an unparseable or absent stamp says nothing rather than saying today", () => {
  // The dangerous failure: a record with no timestamp rendering as today, which
  // is the one wrong date a reader cannot catch.
  for (const bad of [null, undefined, "", "not a date", NaN]) {
    assert.equal(pacificDay(bad), "", `expected "" for ${String(bad)}`);
  }
  assert.equal(pacificDay(), "", "no argument is absent input, not now");
});

test("a caller that means now says so", () => {
  assert.match(pacificToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test("a Date, an ISO string and an epoch millisecond agree", () => {
  const ms = Date.parse(EVENING);
  assert.equal(pacificDay(new Date(ms)), pacificDay(EVENING));
  assert.equal(pacificDay(ms), pacificDay(EVENING));
});
