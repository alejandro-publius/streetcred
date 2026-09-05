// The metering session, and why it exists.
//
// The Exa meter was three KV writes per call: reserveExa wrote budget:exa, and
// recordExaSpend wrote exa:spend and then wrote budget:exa again. At the
// observed 683 searches a day that is 2,049 writes against a 1,000 a day
// allowance, which is why the press tick consumed the whole day's writes before
// any publish could run. The search volume was never the problem. The write
// amplification was.
//
//   node --test tools/exameter.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { openExaMeter, EXA_PERIOD } from "../src/store.js";

// A KV double that counts writes, so the saving is measured rather than argued.
const fakeEnv = (seed = {}) => {
  const store = new Map(Object.entries(seed));
  const env = {
    writes: 0,
    reads: 0,
    STORE: {
      async get(k) { env.reads += 1; return store.has(k) ? store.get(k) : null; },
      async put(k, v) { env.writes += 1; store.set(k, v); },
    },
    _store: store,
  };
  return env;
};
const meterOf = (env) => JSON.parse(env._store.get("budget:exa") || "{}");
// The meter's period is a deployed constant, not the calendar month:
// readExaMeter discards any stored record whose period differs from it, and
// rolling it is a spending decision made by hand. Seeding with the wall-clock
// month made every test here fail from the first day of the next month.
const period = EXA_PERIOD;
const seeded = (over = {}) =>
  fakeEnv({ "budget:exa": JSON.stringify({ period, spentCents: 0, reservedCents: 0, searches: 0, contentPages: 0, deferrals: 0, capCents: 6500, ...over }) });

test("a session touches KV twice for a whole batch, not three times per call", async () => {
  const env = seeded();
  const m = openExaMeter(env);
  for (let i = 0; i < 6; i++) {
    assert.equal(await m.reserve(5, 20), true);
    await m.record(0.02);
  }
  assert.equal(env.writes, 0, "nothing is written until the flush");
  await m.flush();
  assert.equal(env.writes, 2, "exa:spend and budget:exa, once each");
  // The per-call path would have been 6 x 3 = 18.
});

test("the counts are identical to the per-call path", async () => {
  const env = seeded();
  const m = openExaMeter(env);
  for (let i = 0; i < 6; i++) { await m.reserve(5, 20); await m.record(0.02); }
  await m.flush();
  const rec = meterOf(env);
  assert.equal(rec.searches, 30, "every search is still counted");
  assert.equal(rec.contentPages, 120);
  assert.equal(rec.spentCents, 12, "6 x $0.02 = $0.12");
  assert.equal(env._store.get("exa:spend"), "0.12", "and the all-time figure is exact");
});

test("the cap is still enforced call by call, not at the flush", async () => {
  // A batch that checks its budget only at the end has already overspent.
  //
  // The cap cannot be seeded: readExaMeter deliberately overwrites a stored
  // capCents with the deployed constant, so a stale record can never raise its
  // own ceiling. Spend is seeded to just under it instead.
  const env = seeded({ spentCents: 6499.5 });
  const m = openExaMeter(env);
  const results = [];
  for (let i = 0; i < 6; i++) results.push(await m.reserve(50, 0));
  assert.ok(results.includes(false), "the session must refuse once the cap is reached");
  assert.ok(!results[results.length - 1], "and stay refusing");
  await m.flush();
  assert.ok(meterOf(env).deferrals > 0, "a refusal is recorded as a deferral, not as silence");
});

test("a refusal never reserves", async () => {
  const env = seeded({ spentCents: 6499.9 });
  const m = openExaMeter(env);
  assert.equal(await m.reserve(10_000, 0), false);
  await m.flush();
  assert.equal(meterOf(env).searches, 0, "a refused batch spends nothing and counts nothing");
});

test("deltas are applied to a fresh read, so a concurrent writer is not clobbered", async () => {
  const env = seeded();
  const m = openExaMeter(env);
  await m.reserve(5, 0);
  await m.record(0.01);
  // Another invocation writes between the snapshot and the flush.
  env._store.set("budget:exa", JSON.stringify({ period, spentCents: 50, reservedCents: 50, searches: 99, contentPages: 0, deferrals: 0, capCents: 6500 }));
  await m.flush();
  const rec = meterOf(env);
  assert.equal(rec.searches, 104, "the other invocation's 99 survives and this session's 5 is added");
  assert.equal(rec.spentCents, 51, "and so does its spend");
});

test("the checkpoint bounds what a dead isolate can lose", async () => {
  // Without one, an invocation killed near the end of a long batch loses every
  // measured dollar it accumulated, and this ledger's claim is that it measures.
  const env = seeded();
  const m = openExaMeter(env, { checkpointEvery: 4 });
  for (let i = 0; i < 8; i++) { await m.reserve(1, 0); await m.record(0.01); }
  assert.ok(env.writes >= 2, "a long run checkpoints rather than holding everything to the end");
  await m.flush();
  assert.equal(meterOf(env).searches, 8, "and the total is still exact");
});

test("an empty session writes nothing at all", async () => {
  const env = seeded();
  const m = openExaMeter(env);
  const r = await m.flush();
  assert.equal(env.writes, 0);
  assert.equal(r.writes, 0);
});

test("a session with reserves but no spend writes once, not twice", async () => {
  const env = seeded();
  const m = openExaMeter(env);
  await m.reserve(3, 0);
  await m.flush();
  assert.equal(env.writes, 1, "exa:spend is untouched when nothing was spent");
});

// ------------------------------------- the key running out, said out loud

test("a provider refusal on credit is told apart from our own cap", async () => {
  const { EXA_CREDITS_SPENT } = await import("../src/index.js");
  // exaPost throws this exact string when Exa refuses on balance.
  assert.ok(EXA_CREDITS_SPENT.test("exa 402 credits"));
  assert.ok(EXA_CREDITS_SPENT.test("exa 402"));
  // Our own cap is a different fact needing a different repair, and it never
  // reaches this branch: it returns budget-deferred rather than throwing.
  assert.ok(!EXA_CREDITS_SPENT.test("exa 500"));
  assert.ok(!EXA_CREDITS_SPENT.test("the exa budget is at its cap for this period"));
});

test("the rollup counts paused apart from deferred", async () => {
  const { bumpPressRollupBulk } = await import("../src/store.js");
  const env = fakeEnv();
  await bumpPressRollupBulk(env, [
    { source: "budget-paused", fetchedAt: new Date().toISOString() },
    { source: "budget-deferred", fetchedAt: new Date().toISOString() },
    { source: "live", items: [{}, {}], fetchedAt: new Date().toISOString(), cost: { usd: 0.01 } },
    { source: "empty", items: [], fetchedAt: new Date().toISOString() },
  ]);
  const r = JSON.parse(env._store.get("press:rollup"));
  assert.equal(r.paused, 1, "the key ran out");
  assert.equal(r.deferred, 1, "our cap was reached");
  assert.equal(r.checked, 2, "and neither counts as a corner that was checked");
  assert.equal(r.withCoverage, 1);
  assert.equal(r.empty, 1);
});

test("the whole batch is one rollup write, not one per corner", async () => {
  const { bumpPressRollupBulk } = await import("../src/store.js");
  const env = fakeEnv();
  const recs = Array.from({ length: 6 }, () => ({ source: "empty", items: [], fetchedAt: new Date().toISOString() }));
  await bumpPressRollupBulk(env, recs);
  assert.equal(env.writes, 1, "six corners, one write");
  assert.equal(JSON.parse(env._store.get("press:rollup")).checked, 6, "and all six counted");
});
