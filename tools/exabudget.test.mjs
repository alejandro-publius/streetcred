// The Exa meter, exercised against a fake KV.
//
// The counter is the only thing standing between an unattended nightly batch
// and a $70 balance, so its refusal has to be provable rather than reviewed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  exaBudget, reserveExa, recordExaSpend,
  EXA_CAP_CENTS, EXA_SEARCH_CENTS, EXA_CONTENTS_CENTS, EXA_PERIOD,
  exaPlanFor, verifyExaAccount,
} from "../src/store.js";

const fakeEnv = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    STORE: {
      get: async (k) => (map.has(k) ? map.get(k) : null),
      put: async (k, v) => void map.set(k, v),
    },
    __map: map,
  };
};
const meter = (env) => JSON.parse(env.__map.get("budget:exa"));

test("a fresh meter starts at zero against the deployed cap", async () => {
  const env = fakeEnv();
  const b = await exaBudget(env);
  assert.equal(b.spentCents, 0);
  assert.equal(b.capCents, EXA_CAP_CENTS);
  assert.equal(b.period, EXA_PERIOD);
  assert.equal(b.exhausted, false);
  // The prior spend is carried, not erased: the provider's balance is drawn
  // against prior plus counter, and nothing reconciles without it.
  assert.ok(b.priorSpendUsd > 0, "prior spend should be stated");
  assert.equal(b.allTimeUsd, b.priorSpendUsd);
});

test("reserving charges the estimate before the call", async () => {
  const env = fakeEnv();
  assert.equal(await reserveExa(env, 5, 3), true);
  const b = await exaBudget(env);
  assert.equal(b.reservedCents, 5 * EXA_SEARCH_CENTS + 3 * EXA_CONTENTS_CENTS);
  assert.equal(b.searches, 5);
  assert.equal(b.contentPages, 3);
  assert.equal(b.spentCents, 0, "nothing is measured until a response arrives");
});

test("the cap refuses and records the deferral instead of overspending", async () => {
  const env = fakeEnv();
  const perSearch = EXA_CAP_CENTS / EXA_SEARCH_CENTS;
  assert.equal(await reserveExa(env, perSearch), true, "the cap itself is reservable");
  assert.equal(await reserveExa(env, 1), false, "one past the cap is refused");
  const b = await exaBudget(env);
  assert.equal(b.deferrals, 1);
  assert.equal(b.exhausted, true);
  assert.equal(b.remainingCents, 0);
  assert.ok(b.reservedCents <= b.capCents, "a refusal must not have been charged");
});

test("the measurement reconciles against the estimate and the higher one caps", async () => {
  const env = fakeEnv();
  await reserveExa(env, 10);                    // 7 cents estimated
  await recordExaSpend(env, 0.12);              // 12 cents measured, worse than estimated
  const b = await exaBudget(env);
  assert.equal(b.reservedCents, 7);
  assert.equal(b.spentCents, 12);
  assert.equal(b.usedCents, 12, "the cap follows the worse of the two");
  assert.equal(b.spentUsd, 0.12);
  // All time is prior plus measured, which is what the dashboard shows.
  assert.equal(b.allTimeUsd, Math.round((b.priorSpendUsd + 0.12) * 10000) / 10000);
});

test("all-time spend survives a period rollover, the period counter does not", async () => {
  const env = fakeEnv();
  await recordExaSpend(env, 0.5);
  const stale = { ...meter(env), period: "1999-01" };
  env.__map.set("budget:exa", JSON.stringify(stale));
  const b = await exaBudget(env);
  assert.equal(b.spentCents, 0, "a new period starts a new counter");
  assert.equal(b.period, EXA_PERIOD);
  assert.equal(env.__map.get("exa:spend"), "0.5", "the all time figure is not a period counter");
});

test("a stored cap never outranks the deployed one", async () => {
  const env = fakeEnv({ "budget:exa": JSON.stringify({ period: EXA_PERIOD, capCents: 999999 }) });
  const b = await exaBudget(env);
  assert.equal(b.capCents, EXA_CAP_CENTS);
});

// Price identifies a plan tier. It identified an account for one afternoon,
// which is how a batch came to spend against a workspace nobody had confirmed.
test("unit price identifies a plan tier, and refuses to guess", () => {
  assert.equal(exaPlanFor(0.007), "7-per-1k");
  assert.equal(exaPlanFor(0.0075), "7-per-1k");
  assert.equal(exaPlanFor(0.015), "15-per-1k");
  assert.equal(exaPlanFor(0.05), null, "a price on neither tier is unknown, not rounded");
  assert.equal(exaPlanFor(0), null);
  assert.equal(exaPlanFor(undefined), null);
});

test("a fresh meter names no workspace and says so", async () => {
  const env = fakeEnv();
  const b = await exaBudget(env);
  assert.equal(b.account, null, "nothing may name a workspace on its own");
  assert.equal(b.accountVerified, false);
  assert.match(b.reconciliation, /unverified/);
});

test("only a recorded human observation names the workspace", async () => {
  const env = fakeEnv();
  await recordExaSpend(env, 0.05);
  await verifyExaAccount(env, { workspace: "Alex Schroeder", observedBalanceUsd: 69.93 });
  const b = await exaBudget(env);
  assert.equal(b.account, "Alex Schroeder");
  assert.equal(b.accountVerified, true);
  assert.equal(b.observedBalanceUsd, 69.93);
  assert.match(b.reconciliation, /observed on Alex Schroeder/);
  // Verifying attributes the spend, it does not erase it.
  assert.equal(b.spentCents, 5);
});

test("verification cannot be recorded without naming a workspace", async () => {
  const env = fakeEnv();
  await assert.rejects(() => verifyExaAccount(env, {}), /workspace name is required/);
  await assert.rejects(() => verifyExaAccount(env, { workspace: "" }), /workspace name is required/);
  assert.equal((await exaBudget(env)).accountVerified, false);
});

test("a period rollover does not silently re-verify the workspace", async () => {
  const env = fakeEnv();
  await verifyExaAccount(env, { workspace: "Alex Schroeder" });
  const stale = { ...meter(env), period: "1999-01" };
  env.__map.set("budget:exa", JSON.stringify(stale));
  const b = await exaBudget(env);
  assert.equal(b.accountVerified, false, "a new period re-asks the question");
});

// The nightly batch is the thing that spends without anybody watching, so its
// refusal is the one that has to be provable.
test("the nightly batch refuses to spend against an unconfirmed workspace", async () => {
  const { pressBatch } = await import("../src/index.js");
  const env = fakeEnv();
  const out = await pressBatch(env, 10);
  assert.equal(out.source, "account-unverified");
  assert.equal(out.checked, 0);
  assert.equal(out.spentUsd, 0);
  assert.match(out.reason, /unverified/);
});

test("the nightly batch runs once the workspace is confirmed", async () => {
  const { pressBatch } = await import("../src/index.js");
  const env = fakeEnv();
  await verifyExaAccount(env, { workspace: "Alex Schroeder" });
  // No rank pages in this fake store, so it finds nothing to do and says so
  // rather than refusing. What matters is that it got past the gate.
  const out = await pressBatch(env, 10);
  assert.equal(out.source, "live");
  assert.equal(out.queued, 0);
});
