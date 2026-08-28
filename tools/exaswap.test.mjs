// The Exa key swap is one command, and exactly one of the two paused states
// clears when it lands.
//
// This is a readiness check written as a test because the answer has two halves
// and the encouraging half is the one people remember. A funded key clears the
// provider's 402. It does not clear this site's own spending cap, which is a
// separate gate, deliberately, and is genuinely reached. Saying "swap the key
// and everything comes back" would be wrong in a way nobody would notice until
// the lane stayed dark.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { EXA_PERIOD, EXA_CAP_CENTS, exaBudget } from "../src/store.js";
import { EXA_PAUSED_NOTE, EXA_CREDITS_SPENT } from "../src/index.js";

const SRC = new URL("../src/", import.meta.url);
const files = readdirSync(SRC).filter((f) => f.endsWith(".js"));
const read = (f) => readFileSync(new URL(f, SRC), "utf8");

// ============================================================= no code change

test("every lane reads the key off env at call time, so a swap needs no deploy", () => {
  const users = files.filter((f) => read(f).includes("EXA_API_KEY"));
  assert.ok(users.length >= 4, `expected several lanes to use the key, found ${users.length}`);
  // Every mention is either a read off env, or the name quoted as a string,
  // which is the paused note and the config check that lists secret names.
  for (const f of users) {
    for (const line of read(f).split("\n")) {
      if (!line.includes("EXA_API_KEY")) continue;
      assert.ok(
        line.includes("env.EXA_API_KEY") || /"EXA_API_KEY"|EXA_API_KEY(?=[^\w]*$)/.test(line),
        `${f} reads EXA_API_KEY from something a secret swap would not reach: ${line.trim()}`,
      );
    }
  }
});

test("the key is never copied into a module-level binding", () => {
  // A `const KEY = env.EXA_API_KEY` at module scope would survive the swap for
  // the life of the isolate, so the lane would stay dark until a redeploy and
  // the cause would look like a caching bug.
  for (const f of files) {
    const src = read(f);
    assert.ok(
      !/^\s*(const|let|var)\s+\w+\s*=\s*env[?.]*\.EXA_API_KEY/m.test(src),
      `${f} caches the key at module scope`,
    );
  }
});

test("the key is never written to KV, where a swap would not reach it either", () => {
  for (const f of files) {
    const src = read(f);
    assert.ok(!/rawPut\([^)]*EXA_API_KEY/.test(src), `${f} stores the key`);
  }
});

// ========================================================== what actually flips

test("the health lane decides 402 from a live response, not a stored flag", () => {
  const src = read("index.js");
  const lane = src.slice(src.indexOf('ping("exa"'), src.indexOf('ping("apify"'));
  assert.match(lane, /await fetch\("https:\/\/api\.exa\.ai\/search"/, "the lane must call the provider");
  assert.match(lane, /"x-api-key": env\.EXA_API_KEY/);
  assert.match(lane, /r\.status === 402 \? "402 credits not redeemed"/);
  assert.ok(
    !/budget:exa|getExaProbe\(/.test(lane),
    "a stored flag here would outlive the swap and keep reporting the old state",
  );
});

test("the paused note tells the reader the lane is paused rather than broken", () => {
  assert.match(EXA_PAUSED_NOTE, /paused, not broken/);
  assert.match(EXA_PAUSED_NOTE, /npx wrangler secret put EXA_API_KEY/);
  assert.ok(EXA_CREDITS_SPENT.test("exa 402 credits"));
});

// ===================================================== what does NOT flip, and why

test("the spending cap is a second gate that a funded key does not open", async () => {
  const env = {
    STORE: {
      get: async () =>
        JSON.stringify({ period: EXA_PERIOD, spentCents: EXA_CAP_CENTS + 3, reservedCents: 0 }),
      put: async () => {},
    },
  };
  const b = await exaBudget(env);
  assert.equal(b.exhausted, true, "the cap is reached on its own terms");
  // Nothing about the key appears in the meter, which is the point: the two
  // gates are independent and a reader must not be told the swap opens both.
  assert.ok(!("key" in b));
});

test("the cap's period is pinned, so it does not roll into next month by itself", () => {
  // Written down because it is the thing most likely to be assumed. A rolling
  // month would clear this gate on the 1st with no action; a pinned one needs
  // a person. Neither is wrong, but only one of them is true here.
  assert.match(EXA_PERIOD, /^\d{4}-\d{2}$/);
  const src = read("store.js");
  assert.match(src, /export const EXA_PERIOD = "\d{4}-\d{2}"/,
    "the period is a constant, so clearing the cap is an edit and a deploy, not a secret swap");
});
