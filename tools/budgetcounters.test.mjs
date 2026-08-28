// The spend counters, and what they do when they say no.
//
// tools/exabudget.test.mjs already pins the Exa meter's arithmetic: a fresh
// meter, a reservation, the cap refusing, the measurement reconciling, and the
// account-verification gate. This file covers the things that file does not,
// and they are all properties of the counters as a family rather than of one
// meter's numbers:
//
//   - the ORDER of the write and the provider call, proved at the call site
//     rather than assumed from the arithmetic
//   - what a caller sees when it is refused, which has to be a returned refusal
//     and not a throw and not a silently clamped spend
//   - reconciliation in the direction exabudget.test.mjs does not exercise,
//     where the estimate runs ahead of the measurement
//   - what survives a month boundary, for all three counters, including the one
//     place where the old period is genuinely archived and the one place where
//     it is not
//   - that a unit price can never set the attributed flag, tested through
//     recordExaProbe, which is the code path that actually knows a price
//   - the radar's paused state, all the way through to the page that renders it
//
// Nothing here touches a provider. fetch is stubbed for the two tests that need
// a call site, and no key is read: the fake env carries obvious placeholders.
//
// tools/lib/kvenv.mjs does not fit. That module is a Worker-shaped env backed by
// the wrangler CLI against the real remote namespace, which is a network call
// and real production state. A counter test needs the opposite: a store it owns
// completely and can watch. So the double lives here.

import test from "node:test";
import assert from "node:assert/strict";
import {
  exaBudget, reserveExa, recordExaSpend, recordExaProbe, verifyExaAccount,
  EXA_CAP_CENTS, EXA_PERIOD, EXA_SEARCH_CENTS, EXA_CONTENTS_CENTS, EXA_PRIOR_SPEND_USD,
  actorRunBudget, reserveActorRun, MONTHLY_ACTOR_RUN_CAP,
  radarBudget, reserveRadar, countRadarDetection,
  RADAR_DAY_CENTS, RADAR_MONTH_CENTS, utcDay, utcMonth,
} from "../src/store.js";
import { RADAR_PAGE } from "../src/radarpage.js";

// ---------------------------------------------------------------- the double

// A KV double that keeps an ordered log. The log is the point: three of the
// tests below are about what happened before what, and an arithmetic assertion
// cannot tell a reservation written first from one written after the fact.
function fakeEnv(seed = {}, extra = {}) {
  const map = new Map(Object.entries(seed));
  const log = [];
  let seq = 0;
  return {
    // Placeholders. The real values live in .dev.vars and are never read here.
    EXA_API_KEY: "test-key-never-a-real-one",
    APIFY_TOKEN: "test-token-never-a-real-one",
    STORE: {
      get: async (k, type) => {
        log.push({ seq: seq++, op: "get", key: k });
        if (!map.has(k)) return null;
        const v = map.get(k);
        if (type !== "json") return v;
        try { return JSON.parse(v); } catch { return null; }
      },
      put: async (k, v, opts = {}) => {
        log.push({ seq: seq++, op: "put", key: k, value: v, ttl: opts.expirationTtl ?? null });
        map.set(k, v);
      },
    },
    __map: map,
    __log: log,
    // Called by a stubbed provider so the call takes its place in the same log.
    __mark: (what, note = null) => log.push({ seq: seq++, op: "call", key: what, value: note }),
    ...extra,
  };
}

const meterOf = (env) => JSON.parse(env.__map.get("budget:exa"));
const firstIndex = (env, pred) => env.__log.findIndex(pred);
const atCap = () => JSON.stringify({ period: EXA_PERIOD, reservedCents: EXA_CAP_CENTS });
const round4 = (n) => Math.round(n * 10000) / 10000;

// Swap fetch for the duration of one test and always put it back, so a failing
// assertion cannot leave a stub installed for whatever runs next.
async function withFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

// ------------------------------------------------- 1. reserve before the call

test("the exa reservation is durable in the store before the provider is called", async () => {
  const { buildConnections } = await import("../src/press.js");
  const env = fakeEnv();
  let meterSeenByProvider = null;

  await withFetch(
    async () => {
      // Read the store from inside the call, which is the only moment that
      // proves the write landed first rather than merely being scheduled.
      meterSeenByProvider = env.__map.get("budget:exa") ?? null;
      env.__mark("provider:exa");
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    },
    () => buildConnections(env, { slug: "16th-and-mission", name: "16th and Mission" }, { url: "https://example.org/seed" }),
  );

  const put = firstIndex(env, (e) => e.op === "put" && e.key === "budget:exa");
  const call = firstIndex(env, (e) => e.op === "call" && e.key === "provider:exa");
  assert.ok(put >= 0, "the reservation must have been written");
  assert.ok(call >= 0, "the provider must have been called");
  assert.ok(put < call, "the reservation is written before the call, not after it");

  assert.ok(meterSeenByProvider, "the meter was readable from inside the call");
  const seen = JSON.parse(meterSeenByProvider);
  assert.equal(seen.reservedCents, EXA_SEARCH_CENTS, "one search was already charged when the call went out");
  assert.equal(seen.searches, 1);
  assert.equal(seen.spentCents, 0, "the measurement cannot exist yet");
});

test("a crash mid-call leaves the exa estimate charged rather than losing it", async () => {
  const { buildConnections } = await import("../src/press.js");
  const env = fakeEnv();

  await withFetch(
    async () => { env.__mark("provider:exa"); throw new Error("socket hang up"); },
    async () => {
      await assert.rejects(
        () => buildConnections(env, { slug: "16th-and-mission", name: "16th and Mission" }, { url: "https://example.org/seed" }),
        /socket hang up/,
      );
    },
  );

  const b = await exaBudget(env);
  // The call may or may not have cost money. The counter assumes it did, which
  // is the only assumption that cannot overspend.
  assert.equal(b.reservedCents, EXA_SEARCH_CENTS, "the estimate survives the crash");
  assert.equal(b.searches, 1);
  assert.equal(b.spentCents, 0, "no measurement arrived, so none is invented");
  assert.equal(b.usedCents, EXA_SEARCH_CENTS, "the cap is enforced against the estimate");
});

test("the apify run is counted before the actor is started, and a failed start still counts", async () => {
  const { commissionVoices } = await import("../src/voices.js");
  const env = fakeEnv();
  const key = `apifyruns:${utcMonth()}`;
  let countSeenByProvider = null;

  const out = await withFetch(
    async () => {
      countSeenByProvider = env.__map.get(key) ?? null;
      env.__mark("provider:apify");
      throw new Error("connect ETIMEDOUT");
    },
    () => commissionVoices(env, { slug: "16th-and-mission", name: "16th and Mission", lat: 37.765, lon: -122.419 }, { only: "reddit" }),
  );

  const put = firstIndex(env, (e) => e.op === "put" && e.key === key);
  const call = firstIndex(env, (e) => e.op === "call" && e.key === "provider:apify");
  assert.ok(put >= 0 && call >= 0);
  assert.ok(put < call, "the run is counted before it is started");
  assert.equal(countSeenByProvider, "1", "the ceiling already knew about this run when the call went out");

  // The commission does not throw. It runs inside the morning audit and a
  // scraper that will not start must not take the audit down.
  assert.equal(out.ok, false);
  assert.equal(out.started.length, 0);
  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].actor, "reddit");
  assert.match(out.failed[0].reason, /ETIMEDOUT/);

  // A run that was commissioned and then failed to start may still have been
  // created upstream, so it stays on the ledger.
  const budget = await actorRunBudget(env);
  assert.equal(budget.used, 1, "a failed start is not refunded");
});

// ------------------------------------------------------- 2. honest refusals

test("an oversized exa reservation is refused whole, not clamped to what is left", async () => {
  const env = fakeEnv();
  // Ten thousand searches is 7000 cents against a 6500 cent cap.
  const refused = await reserveExa(env, 10000);
  assert.equal(refused, false, "a refusal is a returned false, not a throw");

  const b = await exaBudget(env);
  assert.equal(b.reservedCents, 0, "nothing was part-charged on the way to refusing");
  assert.equal(b.searches, 0);
  assert.equal(b.exhausted, false, "refusing one oversized request does not exhaust the meter");
  assert.equal(b.remainingCents, EXA_CAP_CENTS);
  assert.equal(b.deferrals, 1, "the refusal is recorded, so a deferred batch is visible");

  // And the lane is not latched off. A request that fits still goes through.
  assert.equal(await reserveExa(env, 1), true);
  assert.equal((await exaBudget(env)).reservedCents, EXA_SEARCH_CENTS);
});

test("a refusal at the margin refuses the request that does not fit and allows the one that does", async () => {
  // One cent of headroom left. A ten search plan costs seven cents and cannot
  // fit; a single search costs 0.7 and can.
  const env = fakeEnv({ "budget:exa": JSON.stringify({ period: EXA_PERIOD, reservedCents: EXA_CAP_CENTS - 1 }) });
  assert.equal(await reserveExa(env, 10), false, "the plan that does not fit is refused");
  assert.equal(await reserveExa(env, 1), true, "the one that fits is not refused with it");
  const b = await exaBudget(env);
  assert.equal(b.reservedCents, EXA_CAP_CENTS - 1 + EXA_SEARCH_CENTS);
  assert.ok(b.reservedCents <= b.capCents, "the cap was never crossed");
});

test("the connections lane returns a refusal and makes no call at the cap", async () => {
  const { buildConnections } = await import("../src/press.js");
  const env = fakeEnv({ "budget:exa": atCap() });

  const out = await withFetch(
    async () => { env.__mark("provider:exa"); throw new Error("a call was made past the cap"); },
    () => buildConnections(env, { slug: "16th-and-mission", name: "16th and Mission" }, { url: "https://example.org/seed" }),
  );

  assert.equal(out.source, "unavailable");
  assert.match(out.reason, /budget/);
  assert.ok(!env.__log.some((e) => e.op === "call"), "no provider call was made");
});

test("the watchlist lane returns a refusal and makes no call at the cap", async () => {
  const { buildWatchlist } = await import("../src/press.js");
  const env = fakeEnv({ "budget:exa": atCap() });

  const out = await withFetch(
    async () => { env.__mark("provider:exa"); throw new Error("a call was made past the cap"); },
    () => buildWatchlist(env),
  );

  assert.equal(out.source, "unavailable");
  assert.match(out.reason, /budget/);
  assert.ok(!env.__log.some((e) => e.op === "call"), "no provider call was made");
});

test("the press enrichment lane defers by name rather than returning an empty result", async () => {
  const { enrichPress } = await import("../src/pressenrich.js");
  const env = fakeEnv({ "budget:exa": atCap() });

  const out = await withFetch(
    async () => { env.__mark("provider:exa"); throw new Error("a call was made past the cap"); },
    () => enrichPress(env, { slug: "16th-and-mission", name: "16th and Mission", city: "San Francisco" }),
  );

  // "budget-deferred" and not "empty". A corner with no coverage and a corner
  // nobody could afford to look at are different answers and the page says so.
  assert.equal(out.source, "budget-deferred");
  assert.match(out.reason, /cap/);
  assert.equal(out.cost.searches, 0);
  assert.equal(out.cost.costUsd, 0);
  assert.ok(!env.__log.some((e) => e.op === "call"), "no provider call was made");
});

test("the actor ceiling refuses per run and names the cap instead of throwing", async () => {
  const { commissionVoices } = await import("../src/voices.js");
  const env = fakeEnv({ [`apifyruns:${utcMonth()}`]: String(MONTHLY_ACTOR_RUN_CAP) });

  // reserveActorRun answers with a reason now, because "the month is spent" and
  // "the month is reserved for the cron" need different repairs. See
  // tools/apifyreserve.test.mjs for the second one.
  const refused = await reserveActorRun(env);
  assert.equal(refused.ok, false, "the ceiling refuses");
  assert.equal(refused.why, "cap", "at the ceiling the reason is the ceiling");

  const out = await withFetch(
    async () => { env.__mark("provider:apify"); throw new Error("a run was started past the cap"); },
    () => commissionVoices(env, { slug: "16th-and-mission", name: "16th and Mission", lat: 37.765, lon: -122.419 }),
  );

  assert.equal(out.ok, false);
  assert.equal(out.started.length, 0);
  assert.equal(out.failed.length, 2, "both actors were refused, one at a time");
  for (const f of out.failed) assert.match(f.reason, new RegExp(String(MONTHLY_ACTOR_RUN_CAP)));
  assert.ok(!env.__log.some((e) => e.op === "call"), "no run was started");
  assert.equal((await actorRunBudget(env)).used, MONTHLY_ACTOR_RUN_CAP, "a refusal is not a charge");
});

// ------------------------------------------------------- 3. reconciliation

test("when the estimate runs ahead of the measurement the estimate governs the cap", async () => {
  const env = fakeEnv();
  await reserveExa(env, 100);        // 70 cents estimated
  await recordExaSpend(env, 0.10);   // 10 cents measured, cheaper than estimated

  const b = await exaBudget(env);
  assert.equal(b.reservedCents, 70);
  assert.equal(b.spentCents, 10);
  assert.equal(b.usedCents, 70, "the higher of the two is what the cap sees");
  assert.equal(b.remainingCents, EXA_CAP_CENTS - 70);
  // The measured figure is still the one the provider's balance is drawn
  // against, so it is reported unchanged beside the estimate.
  assert.equal(b.spentUsd, 0.1);
  assert.equal(b.allTimeUsd, round4(EXA_PRIOR_SPEND_USD + 0.1));
});

test("a measurement past the cap stops the lane even though the estimate is small", async () => {
  const env = fakeEnv();
  await reserveExa(env, 1);          // 0.7 cents estimated
  await recordExaSpend(env, 66.0);   // 6600 cents measured, past a 6500 cent cap

  const b = await exaBudget(env);
  assert.equal(b.reservedCents, EXA_SEARCH_CENTS);
  assert.equal(b.spentCents, 6600);
  assert.equal(b.usedCents, 6600, "the cap follows the measurement in this direction too");
  assert.equal(b.exhausted, true);
  assert.equal(b.remainingCents, 0);
  assert.equal(await reserveExa(env, 1), false, "nothing more is reservable");
});

test("a garbage cost figure cannot credit the meter back", async () => {
  const env = fakeEnv();
  await reserveExa(env, 10);
  await recordExaSpend(env, 1.0);
  const before = await exaBudget(env);

  // Exa returns costDollars on every response. A missing, zero, negative or
  // unparseable one is a reading that did not happen, and a counter that
  // subtracts on a bad reading is a counter that can be talked down to zero.
  for (const bad of [undefined, null, 0, -5, NaN, "banana", ""]) await recordExaSpend(env, bad);

  const after = await exaBudget(env);
  assert.equal(after.spentCents, before.spentCents, "the measured total did not move");
  assert.equal(after.allTimeUsd, before.allTimeUsd, "the all time total did not move");
  assert.equal(env.__map.get("exa:spend"), "1", "the all time key is untouched by a bad reading");
});

test("the estimate and the measurement are both kept, not collapsed into one number", async () => {
  const env = fakeEnv();
  await reserveExa(env, 4, 20);  // 2.8 + 2 = 4.8 cents estimated
  await recordExaSpend(env, 0.031);
  const b = await exaBudget(env);
  assert.equal(b.reservedCents, 4 * EXA_SEARCH_CENTS + 20 * EXA_CONTENTS_CENTS);
  assert.equal(b.spentCents, 3.1);
  assert.equal(b.searches, 4);
  assert.equal(b.contentPages, 20);
  assert.equal(b.usedCents, 4.8);
  assert.notEqual(b.reservedCents, b.spentCents, "a reconciliation needs two figures to reconcile");
});

// ------------------------------------------------------ 4. period rollover

test("crossing the month keeps the old exa record on read, and the dollar total keeps only one of its two routes", async () => {
  const env = fakeEnv();
  await reserveExa(env, 20);
  await recordExaSpend(env, 0.4);
  const stale = { ...meterOf(env), period: "1999-01" };
  env.__map.set("budget:exa", JSON.stringify(stale));

  const b = await exaBudget(env);
  assert.equal(b.period, EXA_PERIOD);
  assert.equal(b.spentCents, 0, "the new period counts from zero");
  assert.equal(b.reservedCents, 0);

  // The rollover is lazy. Reading across the boundary hands back a zeroed
  // meter without writing one, so the old period's record is still in the
  // store and is still recoverable at this point.
  const kept = JSON.parse(env.__map.get("budget:exa"));
  assert.equal(kept.period, "1999-01");
  assert.equal(kept.spentCents, 40);
  assert.equal(kept.searches, 20);

  // exa:spend is a separate key and is not a period counter, so the running
  // dollar total does survive the boundary in the store.
  assert.equal(env.__map.get("exa:spend"), "0.4", "the all time key carries across the boundary");

  // But the reported allTimeUsd does not read that key. It is computed as
  // priorSpendUsd plus THIS PERIOD's meter, so the moment the period rolls it
  // drops back to the prior constant and forgets the 40 cents it is still
  // holding one key away. Pinned as it is, not as it reads: the name says all
  // time and the arithmetic says this period plus a constant.
  assert.equal(b.allTimeUsd, EXA_PRIOR_SPEND_USD, "allTimeUsd resets with the period counter");
  assert.notEqual(
    b.allTimeUsd,
    round4(EXA_PRIOR_SPEND_USD + Number(env.__map.get("exa:spend"))),
    "and so it disagrees with exa:spend across a boundary",
  );
});

test("within a period allTimeUsd and the exa:spend key do agree", async () => {
  // Which is why the disagreement above is only visible at a boundary. Inside
  // one period the two are the same number by two routes, and that is the
  // condition the live counter has been read under so far.
  const env = fakeEnv();
  await recordExaSpend(env, 0.4);
  await recordExaSpend(env, 1.25);
  const b = await exaBudget(env);
  assert.equal(env.__map.get("exa:spend"), "1.65");
  assert.equal(b.allTimeUsd, round4(EXA_PRIOR_SPEND_USD + 1.65));
});

test("the first write after the boundary replaces the old exa record, which is not archived anywhere", async () => {
  const env = fakeEnv();
  await reserveExa(env, 20);
  await recordExaSpend(env, 0.4);
  env.__map.set("budget:exa", JSON.stringify({ ...meterOf(env), period: "1999-01" }));

  await reserveExa(env, 1);

  const now = meterOf(env);
  assert.equal(now.period, EXA_PERIOD);
  assert.equal(now.searches, 1, "the old period's call count is gone");
  // This is a limit and not a feature. There is no budget:exa:1999-01 key and
  // nothing else holds that period's searches, contentPages or deferrals. What
  // survives a month boundary is the dollar total in exa:spend plus the
  // EXA_PRIOR_SPEND_USD constant. The per-period detail does not.
  assert.equal([...env.__map.keys()].filter((k) => k.startsWith("budget:exa")).length, 1, "there is exactly one exa meter key");
  assert.equal(env.__map.get("exa:spend"), "0.4", "the dollar total is what carried over");
});

test("the actor ceiling archives by month key, so last month's count is still there", async () => {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const env = fakeEnv({ [`apifyruns:${prev}`]: String(MONTHLY_ACTOR_RUN_CAP) });

  const b = await actorRunBudget(env);
  assert.equal(b.month, utcMonth());
  assert.equal(b.used, 0, "a new month starts at zero");
  assert.equal(b.remaining, MONTHLY_ACTOR_RUN_CAP);
  assert.equal(env.__map.get(`apifyruns:${prev}`), String(MONTHLY_ACTOR_RUN_CAP), "last month's count is intact");

  // Each month is its own key, so the archive is the key naming and the
  // rollover costs nothing. The TTL is what keeps it from being forever.
  assert.equal((await reserveActorRun(env)).ok, true);
  const put = env.__log.find((e) => e.op === "put" && e.key === `apifyruns:${utcMonth()}`);
  assert.ok(put, "the current month's key was written");
  assert.ok(put.ttl >= 60 * 24 * 3600, `a written count should outlive the month, got ttl ${put.ttl}`);
});

test("the radar day counter resets without taking the month counter with it", async () => {
  const env = fakeEnv({
    "budget:radar": JSON.stringify({ day: "1999-01-01", month: utcMonth(), dayCents: RADAR_DAY_CENTS, monthCents: 500, calls: 9, detections: 3 }),
  });

  const b = await radarBudget(env);
  assert.equal(b.day, utcDay());
  assert.equal(b.dayCents, 0, "a new day starts a new daily counter");
  assert.equal(b.monthCents, 500, "the month counter does not roll with the day");
  assert.equal(b.monthRemainingCents, RADAR_MONTH_CENTS - 500);
  assert.equal(b.paused, false);
  // The running totals are not period counters and survive both.
  assert.equal(b.calls, 9);
  assert.equal(b.detections, 3);
});

test("crossing both radar boundaries clears both, and the read does not write", async () => {
  const env = fakeEnv({
    "budget:radar": JSON.stringify({ day: "1999-01-01", month: "1999-01", dayCents: RADAR_DAY_CENTS, monthCents: RADAR_MONTH_CENTS }),
  });
  const b = await radarBudget(env);
  assert.equal(b.dayCents, 0);
  assert.equal(b.monthCents, 0);
  assert.equal(b.paused, false, "a new month is not paused by the old one");

  const kept = JSON.parse(env.__map.get("budget:radar"));
  assert.equal(kept.month, "1999-01", "reading across the boundary did not overwrite the old record");
  assert.equal(kept.monthCents, RADAR_MONTH_CENTS);
  assert.ok(!env.__log.some((e) => e.op === "put"), "radarBudget is a read");
});

// -------------------------------------------- 5. attributed vs unattributed

test("recording a unit price identifies a plan and never sets the attributed flag", async () => {
  const env = fakeEnv();
  // This is the exact reading that once got read as an account. $0.007 a search
  // is a tier, and any number of workspaces sit on that tier.
  const rec = await recordExaProbe(env, { total: 0.007 });
  assert.equal(rec.plan, "7-per-1k", "the plan is identifiable from the price");
  assert.equal(rec.unitUsd, 0.007);

  const b = await exaBudget(env);
  assert.equal(b.account, null, "a price named no workspace");
  assert.equal(b.accountVerified, false);
  assert.equal(b.attributedUsd, null, "with no workspace there is nothing to attribute to");
  assert.equal(b.unattributedUsd, null);
  assert.match(b.reconciliation, /unverified/);
  // And nothing on the probe record claims an account either.
  assert.ok(!("account" in rec), "the probe record does not carry a workspace");
  assert.ok(!("accountVerified" in rec), "the probe record does not carry a verification");
});

test("a probe plus real spend still names no workspace", async () => {
  const env = fakeEnv();
  await recordExaProbe(env, { total: 0.015 });
  await recordExaSpend(env, 2.5);
  const b = await exaBudget(env);
  assert.equal(b.spentCents, 250, "the spend is measured");
  assert.equal(b.accountVerified, false, "the spend is still unaddressed");
  assert.equal(b.attributedUsd, null);
});

test("an unrecognised price is reported as unknown and does not verify anything", async () => {
  const env = fakeEnv();
  const rec = await recordExaProbe(env, { total: 0.05 });
  assert.equal(rec.plan, null, "a price on neither tier is unknown, not rounded into a story");
  assert.equal((await exaBudget(env)).accountVerified, false);
  // A zero or missing cost is not a probe at all.
  assert.equal(await recordExaProbe(env, { total: 0 }), null);
  assert.equal(await recordExaProbe(env, {}), null);
  assert.equal(await recordExaProbe(env, null), null);
});

test("verification splits the total at the moment a human watched the dashboard", async () => {
  const env = fakeEnv();
  await recordExaSpend(env, 0.5);   // spent before anybody confirmed the key
  await verifyExaAccount(env, { workspace: "Alex Schroeder", observedBalanceUsd: 69.93 });
  await recordExaSpend(env, 0.3);   // spent after

  const b = await exaBudget(env);
  assert.equal(b.account, "Alex Schroeder");
  assert.equal(b.attributedUsd, 0.3, "only spend after the observation is this workspace's");
  assert.equal(b.unattributedUsd, round4(0.5 + EXA_PRIOR_SPEND_USD), "the rest was billed somewhere the counter cannot name");
  // The split is a split, so the two halves are the whole.
  assert.equal(round4(b.attributedUsd + b.unattributedUsd), b.allTimeUsd);
  assert.equal(b.spentCents, 80, "attribution does not change what was spent");
});

test("the split boundary can be set explicitly and is not inferred from a price", async () => {
  const env = fakeEnv();
  await recordExaSpend(env, 1.0);
  await recordExaProbe(env, { total: 0.007 });
  // The probe ran between the two spends and changes nothing about the split.
  await verifyExaAccount(env, { workspace: "Alex Schroeder", attributedFromCents: 40 });
  await recordExaSpend(env, 0.2);

  const b = await exaBudget(env);
  assert.equal(b.spentCents, 120);
  assert.equal(b.attributedUsd, 0.8, "everything past the recorded boundary is attributed");
  assert.equal(b.unattributedUsd, round4(0.4 + EXA_PRIOR_SPEND_USD));
  assert.equal(round4(b.attributedUsd + b.unattributedUsd), b.allTimeUsd);
});

// ---------------------------------------------------- 6. radar pause state

test("the radar refuses at the daily cap and reports a paused state rather than going quiet", async () => {
  const env = fakeEnv();
  assert.equal(await reserveRadar(env, RADAR_DAY_CENTS), true, "the cap itself is reservable");
  assert.equal((await radarBudget(env)).paused, true, "spending the day's cap pauses the day");

  assert.equal(await reserveRadar(env, 1), false, "one past the cap is refused, not thrown");
  const b = await radarBudget(env);
  assert.equal(b.dayCents, RADAR_DAY_CENTS, "the refused charge was not part-applied");
  assert.equal(b.dayRemainingCents, 0);
  assert.equal(b.paused, true);
  assert.equal(b.pausedBy, "day");
  assert.equal(b.monthRemainingCents, RADAR_MONTH_CENTS - RADAR_DAY_CENTS, "the month still has room, the day does not");
});

test("the monthly cap pauses the radar even on a fresh day", async () => {
  const env = fakeEnv({
    "budget:radar": JSON.stringify({ day: utcDay(), month: utcMonth(), dayCents: 0, monthCents: RADAR_MONTH_CENTS }),
  });
  const b = await radarBudget(env);
  assert.equal(b.paused, true);
  assert.equal(b.pausedBy, "month");
  assert.equal(b.dayRemainingCents, RADAR_DAY_CENTS, "the day counter is not what stopped it");
  assert.equal(await reserveRadar(env, 1), false);
});

test("a paused radar still counts detections that arrive, it does not drop them", async () => {
  const env = fakeEnv({
    "budget:radar": JSON.stringify({ day: utcDay(), month: utcMonth(), dayCents: RADAR_DAY_CENTS, monthCents: RADAR_DAY_CENTS, detections: 2 }),
  });
  // A monitor is a push delivery. Exa can send one after the budget stopped
  // paying for outbound work, and a delivered detection is evidence either way.
  await countRadarDetection(env, 3);
  const b = await radarBudget(env);
  assert.equal(b.detections, 5);
  assert.equal(b.paused, true, "counting a delivery does not un-pause the lane");
});

test("the radar page renders the paused state and names which cap stopped it", async () => {
  const env = fakeEnv();
  await reserveRadar(env, RADAR_DAY_CENTS);
  const day = await radarBudget(env);

  const paused = RADAR_PAGE({ feed: [], monitors: { list: [{ id: "m1" }] }, budget: day }, "https://example.org", false, 7355);
  assert.match(paused, /<p class="rpaused">/, "the paused block is rendered");
  assert.match(paused, /Paused at the daily budget/);
  assert.match(paused, /it stopped on purpose and said so/);

  const monthEnv = fakeEnv({
    "budget:radar": JSON.stringify({ day: utcDay(), month: utcMonth(), dayCents: 0, monthCents: RADAR_MONTH_CENTS }),
  });
  const monthPaused = RADAR_PAGE(
    { feed: [], monitors: { list: [{ id: "m1" }] }, budget: await radarBudget(monthEnv) },
    "https://example.org", false, 7355,
  );
  assert.match(monthPaused, /Paused at the monthly budget/);
});

test("a radar with room renders no paused block", async () => {
  const env = fakeEnv();
  await reserveRadar(env, 1);
  const html = RADAR_PAGE({ feed: [], monitors: { list: [{ id: "m1" }] }, budget: await radarBudget(env) }, "https://example.org", false, 7355);
  assert.ok(!/<p class="rpaused">/.test(html), "nothing is paused, so nothing says it is");
  assert.match(html, /monitors running/, "the page still rendered");
});

test("a missing radar budget is not read as a paused radar", async () => {
  // A page handed no budget at all must not claim the radar stopped on
  // purpose. Unknown and stopped are different states and only one is a claim.
  const html = RADAR_PAGE({ feed: [], monitors: { list: [] }, budget: null }, "https://example.org", false, 7355);
  assert.ok(!/<p class="rpaused">/.test(html));
});

// -------------------------------------- the status card's model spend block
//
// Two claims the card used to make that the ledger does not support: that every
// held render was held by the legibility check, when most of them were held
// because the API never returned an image; and a bare token total on a ledger
// whose token counts cover only some of its runs.

test("held renders are split by what actually held them", async () => {
  const { STATUS } = await import("../src/status.js");
  const html = STATUS([], [], [], "", null, false, 0, null, null, {
    via: "vertex:us-central1", letters: 116, calls: 246, estUsd: 1.3095,
    promptTokens: 18047, outputTokens: 64360, tokensCover: "1 of 2 generation runs",
    imagery: { model: "gemini-3.1-flash-image", attempted: 7, published: 0, held: 7, heldOnGate: 2, heldOnApi: 5, estUsd: 0.0159 },
  });
  assert.match(html, /2 by the text-legibility check/);
  assert.match(html, /5 because the model never returned an image/);
  assert.doesNotMatch(html, /7 held by the text-legibility check/, "the old claim, which was false for 5 of them");
});

test("a partial token total says which runs it covers", async () => {
  const { STATUS } = await import("../src/status.js");
  const partial = STATUS([], [], [], "", null, false, 0, null, null, {
    via: "vertex:us-central1", letters: 116, calls: 246, estUsd: 1.3, promptTokens: 18047, outputTokens: 64360,
    tokensCover: "1 of 2 generation runs",
  });
  assert.match(partial, /counted over 1 of 2 generation runs/);
  assert.match(partial, /a partial total should not be read as a/);

  // When the token counts cover everything, the caveat is noise and is dropped.
  const whole = STATUS([], [], [], "", null, false, 0, null, null, {
    via: "vertex:us-central1", letters: 10, calls: 12, estUsd: 0.1, promptTokens: 100, outputTokens: 200,
    tokensCover: "2 of 2 generation runs",
  });
  assert.doesNotMatch(whole, /counted over/);
});

test("held renders are named as billed, so the check does not look free", async () => {
  const { STATUS } = await import("../src/status.js");
  const html = STATUS([], [], [], "", null, false, 0, null, null, {
    via: "vertex:us-central1", letters: 1, calls: 1, estUsd: 0.1,
    imagery: { model: "m", attempted: 7, published: 0, held: 7, heldOnGate: 2, heldOnApi: 5, estUsd: 0.0159 },
  });
  assert.match(html, /Held renders are billed and counted here/);
});
