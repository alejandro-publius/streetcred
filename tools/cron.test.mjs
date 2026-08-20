// The scheduling path.
//
// The watchlist used to run as the last lane of the daily audit, which by then
// had spent most of its fifty external subrequests. Twenty-nine searches
// arrived with about seven left, so seven ran and twenty-two returned "Too many
// subrequests by single Worker invocation" without reaching Exa. Nothing was
// broken; the budget was simply already gone.
//
// The fix is a separate cron trigger, which means a separate invocation and a
// fresh fifty. Everything below is a property of that arrangement that would
// otherwise be invisible until a morning run quietly did half its work.
//
// No network and no key: `node --test tools/cron.test.mjs`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CRON_MORNING, CRON_WATCHLIST, CRON_PRESS_TICK } from "../src/index.js";
import { WATCHLIST_QUERIES, WATCHLIST_PER_RUN, selectQueries, mergeCoverage } from "../src/press.js";

// wrangler.jsonc is JSONC: comments, no trailing commas. Strip the comments
// rather than adding a dependency to read one array.
const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, ""),
);

const crons = config.triggers.crons;

// The bug this catches: a schedule edited in the config and not in the
// dispatch. Nothing fails. The firing falls through to the last branch and runs
// the press batch instead of the job it was scheduled for, every day, forever,
// with nothing red anywhere to say so.
test("every cron in the config has a branch in the dispatch", () => {
  const dispatched = [CRON_MORNING, CRON_WATCHLIST, CRON_PRESS_TICK];
  for (const c of crons) {
    assert.ok(dispatched.includes(c), `cron "${c}" is scheduled but nothing dispatches on it`);
  }
});

test("every branch in the dispatch has a cron in the config", () => {
  for (const c of [CRON_MORNING, CRON_WATCHLIST, CRON_PRESS_TICK]) {
    assert.ok(crons.includes(c), `the dispatch expects "${c}" but it is not scheduled`);
  }
});

test("the watchlist has a firing of its own, not shared with the audit", () => {
  assert.notEqual(
    CRON_WATCHLIST,
    CRON_MORNING,
    "sharing a cron expression means sharing an invocation, which is the bug",
  );
  assert.ok(crons.includes(CRON_WATCHLIST));
});

// The quarter-hourly press tick fires at :00, :15, :30 and :45. A watchlist
// schedule landing on one of those would fire two jobs in the same minute. They
// would still be separate invocations with separate budgets, so this is not a
// correctness bug, but it makes the log unreadable at exactly the moment
// somebody is reading it to find out why a run was short.
test("the watchlist minute does not collide with the quarter-hourly tick", () => {
  const minute = Number(CRON_WATCHLIST.split(" ")[0]);
  assert.ok(Number.isInteger(minute), "the watchlist cron should fire on a fixed minute");
  assert.notEqual(minute % 15, 0, `minute ${minute} collides with the */15 tick`);
});

test("the watchlist runs after the audit starts, on the same morning", () => {
  const [wm, wh] = CRON_WATCHLIST.split(" ");
  const [am, ah] = CRON_MORNING.split(" ");
  assert.equal(wh, ah, "both belong to the morning run");
  assert.ok(Number(wm) > Number(am), "the watchlist should follow the audit in the log");
});

// The sizing claim, which is the whole reason this moved. A Worker on the free
// plan gets 50 external subrequests per invocation. The watchlist costs one
// fetch per query and nothing else external; its KV reads come out of a
// separate allowance of a thousand.
test("one run of the whole query set fits an invocation's external budget", () => {
  const FREE_PLAN_EXTERNAL_SUBREQUESTS = 50;
  assert.ok(
    WATCHLIST_PER_RUN <= FREE_PLAN_EXTERNAL_SUBREQUESTS,
    `a run may attempt ${WATCHLIST_PER_RUN}, which does not fit ${FREE_PLAN_EXTERNAL_SUBREQUESTS}`,
  );
  assert.ok(
    FREE_PLAN_EXTERNAL_SUBREQUESTS - WATCHLIST_PER_RUN >= 10,
    "leave real headroom under the ceiling, not a single spare request",
  );
  assert.ok(
    WATCHLIST_QUERIES.length <= WATCHLIST_PER_RUN,
    `the set is ${WATCHLIST_QUERIES.length} and a run may attempt ${WATCHLIST_PER_RUN}: ` +
      "it no longer completes in one run, so rotation is now load-bearing",
  );
});

test("today every query is attempted every run, so a cycle is one run", () => {
  const selected = selectQueries(WATCHLIST_QUERIES, {}, WATCHLIST_PER_RUN);
  assert.equal(selected.length, WATCHLIST_QUERIES.length, "all 29 should be attempted");
  assert.deepEqual(
    selected.map((q) => q.query),
    WATCHLIST_QUERIES.map((q) => q.query),
    "with no rotation the declared order is preserved",
  );
});

// The rotation is dormant today and must still be correct, because the reason
// it exists is that the set grew from 7 to 29 once already and nothing noticed.
test("a set larger than the ceiling rotates instead of truncating", () => {
  const perRun = 10;
  const first = selectQueries(WATCHLIST_QUERIES, {}, perRun);
  assert.equal(first.length, perRun);

  const afterFirst = mergeCoverage({}, first.map((q) => ({ query: q.query })), "2026-08-20");
  const second = selectQueries(WATCHLIST_QUERIES, afterFirst, perRun);
  assert.equal(second.length, perRun);
  for (const q of second) {
    assert.ok(!afterFirst[q.query], `${q.query} ran in the first slice and repeated in the second`);
  }

  const afterSecond = mergeCoverage(afterFirst, second.map((q) => ({ query: q.query })), "2026-08-21");
  const third = selectQueries(WATCHLIST_QUERIES, afterSecond, perRun);

  // Twenty-nine queries at ten a run leaves nine uncovered by the third run, so
  // that run picks the nine and then one repeat. A repeat once the backlog is
  // exhausted is the rotation working, not starving; what matters is that no
  // query waits longer than a cycle.
  const stillUncovered = WATCHLIST_QUERIES.filter((q) => !afterSecond[q.query]).map((q) => q.query);
  assert.equal(stillUncovered.length, 9);
  for (const q of stillUncovered) {
    assert.ok(
      third.some((x) => x.query === q),
      `${q} was the oldest coverage and the third run skipped it`,
    );
  }

  // Three runs of ten reach all twenty-nine, which is ceil(29 / 10).
  const covered = new Set([...first, ...second, ...third].map((q) => q.query));
  assert.equal(covered.size, WATCHLIST_QUERIES.length, "a full cycle must reach every query");
  assert.equal(Math.ceil(WATCHLIST_QUERIES.length / perRun), 3);
});

// The property that actually matters: nothing can be starved. Run the rotation
// for a full cycle at an awkward slice size and check every query was reached.
test("no query is starved over a full cycle, at any slice size", () => {
  for (const perRun of [1, 4, 7, 10, 28]) {
    let coverage = {};
    const runs = Math.ceil(WATCHLIST_QUERIES.length / perRun);
    for (let day = 0; day < runs; day += 1) {
      const slice = selectQueries(WATCHLIST_QUERIES, coverage, perRun);
      assert.equal(slice.length, Math.min(perRun, WATCHLIST_QUERIES.length));
      coverage = mergeCoverage(coverage, slice.map((q) => ({ query: q.query })), `2026-09-${String(day + 1).padStart(2, "0")}`);
    }
    assert.equal(
      Object.keys(coverage).length,
      WATCHLIST_QUERIES.length,
      `at ${perRun} a run, ${runs} runs did not reach every query`,
    );
  }
});

test("rotation is deterministic, so a rerun on the same day picks the same slice", () => {
  const a = selectQueries(WATCHLIST_QUERIES, {}, 10).map((q) => q.query);
  const b = selectQueries(WATCHLIST_QUERIES, {}, 10).map((q) => q.query);
  assert.deepEqual(a, b);
});

// A query that was attempted and cut off must not be credited with a run, or
// the rotation would starve exactly the queries that keep failing.
test("coverage credits a query only when it actually reached Exa", () => {
  const searches = [
    { query: "ran", results: [] },
    { query: "cut off", results: [], failed: "Too many subrequests by single Worker invocation." },
  ];
  const cov = mergeCoverage({}, searches, "2026-08-20");
  assert.equal(cov.ran, "2026-08-20");
  assert.equal(cov["cut off"], undefined, "a cut-off search must not count as covered");
});

test("coverage carries forward the queries a run did not attempt", () => {
  const previous = { old: "2026-08-01" };
  const cov = mergeCoverage(previous, [{ query: "fresh", results: [] }], "2026-08-20");
  assert.equal(cov.old, "2026-08-01", "an untouched query keeps the date it earned");
  assert.equal(cov.fresh, "2026-08-20");
});

test("selection survives an empty or missing set without throwing", () => {
  assert.deepEqual(selectQueries([], {}, 10), []);
  assert.deepEqual(selectQueries(null, {}, 10), []);
  assert.deepEqual(selectQueries(undefined, undefined, 10), []);
});

// The audit must not build the watchlist any more. If both ran, the move would
// have bought nothing: the audit's invocation would still be spending its
// budget on searches that its own lanes had already crowded out.
test("the daily audit no longer builds the watchlist", () => {
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const start = src.indexOf("async function cornerOfTheDay");
  assert.ok(start > 0, "cornerOfTheDay not found");
  const end = src.indexOf("\nexport const CRON_MORNING", start);
  const body = src.slice(start, end > 0 ? end : undefined);
  assert.doesNotMatch(body, /buildWatchlist\(/, "the audit is building the watchlist again");
  assert.doesNotMatch(body, /putWatchlist\(/, "the audit is writing the watchlist again");
});

test("the watchlist run is the only caller of buildWatchlist", () => {
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const calls = [...src.matchAll(/buildWatchlist\(/g)].length;
  assert.equal(calls, 1, `expected one call site, found ${calls}`);
  const start = src.indexOf("export async function watchlistRun");
  assert.ok(start > 0, "watchlistRun not found");
  const body = src.slice(start, src.indexOf("\nexport default", start));
  assert.match(body, /buildWatchlist\(/, "the call site should be inside watchlistRun");
});
