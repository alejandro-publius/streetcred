// The daily cron's runs, reserved from everything else that can spend them.
//
// The counter reached 62 of 70 with four cron firings left, which need eight.
// The remainder was exactly the reserve, so the next thing to commission
// anything would have taken a morning's resident voices away from the cron and
// the failure would have surfaced as an ordinary ceiling hit on whichever call
// happened to lose the race.
//
// The fix is not a bigger ceiling. It is that the cron's share is spoken for,
// that everything else is refused by name rather than by silence, and that the
// refusal reads differently from "the month is spent", because those two need
// different repairs.

import test from "node:test";
import assert from "node:assert/strict";
import {
  cronRunsReserved, actorRunBudget, reserveActorRun,
  MONTHLY_ACTOR_RUN_CAP, RUNS_PER_CRON, CRON_UTC_HOUR, CRON_UTC_MINUTE,
} from "../src/store.js";

function fakeEnv(used = 0) {
  const kv = new Map();
  const month = new Date().toISOString().slice(0, 7);
  if (used) kv.set(`apifyruns:${month}`, String(used));
  return {
    STORE: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => void kv.set(k, v),
    },
    _kv: kv,
  };
}

const at = (iso) => new Date(iso);

// ==================================================================== the count

test("the reserve is the remaining firings times two", () => {
  // 2026-08-28T06:10Z is 23:10 Pacific on the 27th. Firings left: the 28th,
  // 29th, 30th and 31st, at two runs each.
  assert.equal(cronRunsReserved(at("2026-08-28T06:10:00Z")), 8);
});

test("a firing still ahead today counts, one already past does not", () => {
  const before = cronRunsReserved(at("2026-08-27T12:00:00Z"));
  const after = cronRunsReserved(at("2026-08-27T14:00:00Z"));
  assert.equal(before - after, RUNS_PER_CRON, "today's firing is counted only until it fires");
  assert.equal(CRON_UTC_HOUR, 13);
  assert.equal(CRON_UTC_MINUTE, 10);
});

test("after the last firing of the month nothing is reserved", () => {
  assert.equal(cronRunsReserved(at("2026-08-31T14:00:00Z")), 0);
});

test("it rolls with the month rather than pinning August", () => {
  // September has 30 days, so the first of the month reserves 30 firings.
  assert.equal(cronRunsReserved(at("2026-09-01T00:00:00Z")), 60);
  assert.equal(cronRunsReserved(at("2026-02-01T00:00:00Z")), 56, "28 days in February 2026");
});

test("an unreadable clock reserves nothing rather than guessing", () => {
  assert.equal(cronRunsReserved(new Date("nonsense")), 0);
});

// =================================================================== the budget

test("the budget reports the reserve and what is left beyond it", async () => {
  const b = await actorRunBudget(fakeEnv(62), at("2026-08-28T06:10:00Z"));
  assert.equal(b.used, 62);
  assert.equal(b.cap, MONTHLY_ACTOR_RUN_CAP);
  assert.equal(b.remaining, 8);
  assert.equal(b.reserved, 8);
  assert.equal(b.availableToOthers, 0);
  assert.equal(b.paused, true, "this is the live state the pass was written for");
  assert.equal(b.cronFirings, 4);
});

test("with room to spare it is not paused", async () => {
  const b = await actorRunBudget(fakeEnv(50), at("2026-08-28T06:10:00Z"));
  assert.equal(b.availableToOthers, 12);
  assert.equal(b.paused, false);
});

test("a spent month is not the same state as a reserved one", async () => {
  const b = await actorRunBudget(fakeEnv(70), at("2026-08-28T06:10:00Z"));
  assert.equal(b.remaining, 0);
  assert.equal(b.paused, false, "paused means spoken for, not spent");
});

// ================================================================== the refusal

test("the cron spends its own reserve", async () => {
  const env = fakeEnv(62);
  const slot = await reserveActorRun(env, { forCron: true, now: at("2026-08-28T06:10:00Z") });
  assert.equal(slot.ok, true);
  assert.equal(slot.used, 63);
});

test("everything else is refused, by name, with the numbers", async () => {
  const env = fakeEnv(62);
  const slot = await reserveActorRun(env, { now: at("2026-08-28T06:10:00Z") });
  assert.equal(slot.ok, false);
  assert.equal(slot.why, "reserved", "a reserved month must not read as a spent one");
  assert.equal(slot.used, 62);
  assert.equal(slot.reserved, 8);
  assert.equal(slot.remaining, 8);
});

test("a refusal spends nothing", async () => {
  const env = fakeEnv(62);
  const month = new Date().toISOString().slice(0, 7);
  await reserveActorRun(env, { now: at("2026-08-28T06:10:00Z") });
  assert.equal(env._kv.get(`apifyruns:${month}`), "62", "a refused call incremented the counter");
});

test("the ceiling still refuses the cron itself, and says cap not reserved", async () => {
  const slot = await reserveActorRun(fakeEnv(70), { forCron: true, now: at("2026-08-28T06:10:00Z") });
  assert.equal(slot.ok, false);
  assert.equal(slot.why, "cap", "the reserve is not a way around the ceiling");
});

test("with spare capacity an ordinary caller is allowed through", async () => {
  const slot = await reserveActorRun(fakeEnv(50), { now: at("2026-08-28T06:10:00Z") });
  assert.equal(slot.ok, true);
});

// ============================================================ nothing is silent

test("a refused commission journals itself in the same ledger the runs use", async () => {
  const { commissionVoices } = await import("../src/voices.js");
  const env = fakeEnv(62);
  env.APIFY_TOKEN = "t";
  const out = await commissionVoices(env, { slug: "a", name: "A", lat: 37.7, lon: -122.4 },
    { now: at("2026-08-28T06:10:00Z") });
  assert.equal(out.ok, false);
  assert.ok(out.failed.length, "a refusal with no reason is a silent failure");
  assert.equal(out.failed[0].why, "reserved");
  assert.match(out.failed[0].reason, /commissioning paused to protect the monthly ceiling/);
  assert.match(out.failed[0].reason, /62 of 70/);

  const ledger = JSON.parse(env._kv.get("apify:costs") || "[]");
  assert.equal(ledger.length, 1, "the refusal left no record");
  assert.equal(ledger[0].event, "refused");
  assert.equal(ledger[0].why, "reserved");
});

test("the ceiling is never raised to make the reserve fit", async () => {
  const before = MONTHLY_ACTOR_RUN_CAP;
  const env = fakeEnv(62);
  await reserveActorRun(env, { now: at("2026-08-28T06:10:00Z") });
  const b = await actorRunBudget(env, at("2026-08-28T06:10:00Z"));
  assert.equal(b.cap, before);
  assert.equal(b.cap, 70);
});
