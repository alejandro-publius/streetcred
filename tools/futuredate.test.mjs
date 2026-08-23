// No displayed or stored audit date may exceed today in America/Los_Angeles.
//
// The stamp itself is pacificToday() at the only writer, so these guards
// cannot fire today; they exist so a future change to UTC stamping, a caller
// passing its own date, or a hand-written record cannot put tomorrow on the
// streak or the audited index. Also pins pacificDay against a UTC evening,
// which is the actual off-by-one risk: 03:00 UTC is yesterday in California.

import test from "node:test";
import assert from "node:assert/strict";
import { appendCotdLog, getCotdLog } from "../src/store.js";
import { visibleRuns } from "../src/home.js";
import { pacificDay, pacificToday } from "../src/data.js";

const tomorrow = () => {
  const [y, m, d] = pacificToday().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 20)).toISOString().slice(0, 10);
};

test("a UTC evening is still the previous day in California", () => {
  assert.equal(pacificDay("2026-08-23T03:00:00Z"), "2026-08-22");
  assert.equal(pacificDay("2026-08-22T13:12:36Z"), "2026-08-22");
});

test("appendCotdLog clamps a future date and keeps the original beside it", async () => {
  const env = {}; // no KV binding: the store's memory fallback
  await appendCotdLog(env, { date: tomorrow(), slug: "future-corner", status: "ok" });
  await appendCotdLog(env, { date: pacificToday(), slug: "today-corner", status: "ok" });
  const log = await getCotdLog(env);
  const future = log.find((e) => e.slug === "future-corner");
  assert.equal(future.date, pacificToday(), "the stored date is clamped to Pacific today");
  assert.equal(future.dateWas, tomorrow(), "the original value is kept beside the correction");
  const today = log.find((e) => e.slug === "today-corner");
  assert.equal(today.dateWas, undefined, "a valid date is stored untouched");
});

test("the streak never renders a chip dated beyond Pacific today", () => {
  const cotd = [
    { slug: "a", date: "2026-08-20" },
    { slug: "b", date: "2026-08-21" },
    { slug: "c", date: "2026-08-22" },
  ];
  assert.deepEqual(visibleRuns(cotd, "2026-08-21").map((e) => e.slug), ["b", "a"]);
  assert.deepEqual(visibleRuns(cotd, "2026-08-22").map((e) => e.slug), ["c", "b", "a"]);
  // An entry with no date is a display decision, not a claim about tomorrow.
  assert.deepEqual(visibleRuns([{ slug: "d" }], "2026-08-20").map((e) => e.slug), ["d"]);
});
