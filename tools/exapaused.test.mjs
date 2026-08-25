// A key refused on balance is a paused lane, not a broken one.
//
// The press lane learned this on 2026-08-22: exaPost throws "exa 402 credits"
// when the provider refuses, a generic catch counted it as a failure, and a key
// at its ceiling read as six corners breaking for unknown reasons. Nothing on
// the site said the word credit.
//
// The watchlist lane never learned it. It caught everything into {ok:false,
// reason} and logged "watchlist run failed", so the same condition described
// itself as a fault in one lane and a pause in the other. Both say the same
// sentence now, and the sentence names the remedy, because "paused" without one
// reads as a state somebody else is responsible for.
//
//   node --test tools/exapaused.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { EXA_CREDITS_SPENT, EXA_PAUSED_NOTE } from "../src/index.js";

// ------------------------------------------------------------- what counts

test("the provider's own refusal shapes are recognised", () => {
  for (const msg of [
    "exa 402 credits",
    "exa 402: credits not redeemed",
    "402 Payment Required",
    "Insufficient credits",
    "credit balance exhausted",
  ]) {
    assert.ok(EXA_CREDITS_SPENT.test(msg), `${msg} must read as a credit refusal`);
  }
});

test("an ordinary fault is not mistaken for a paused lane", () => {
  // The dangerous direction. A lane that calls a real outage "paused" is the
  // same silent degradation in the other direction: nobody goes looking.
  for (const msg of [
    "exa 500 internal error",
    "fetch failed",
    "The operation was aborted due to timeout",
    "exa 401 unauthorized",
    "TypeError: Cannot read properties of undefined",
  ]) {
    assert.ok(!EXA_CREDITS_SPENT.test(msg), `${msg} is a fault, not a pause`);
  }
});

// ------------------------------------------------------------ what it says

test("one sentence, so both lanes describe the condition the same way", () => {
  assert.match(EXA_PAUSED_NOTE, /402/, "it names the status the provider returned");
  assert.match(EXA_PAUSED_NOTE, /paused, not broken/, "it says which of the two this is");
  assert.match(
    EXA_PAUSED_NOTE,
    /wrangler secret put EXA_API_KEY/,
    "it names the remedy, or paused reads as somebody else's problem",
  );
});

test("the note is the one the press lane uses, not a second copy of it", async () => {
  // Before this the press lane carried its own string literal. Two sentences
  // saying the same thing is how they end up saying different things.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8"),
  );
  const literals = src.match(/"the exa key was refused on credit \(402\)/g) || [];
  assert.equal(
    literals.length,
    1,
    `the sentence is defined once and referenced, found ${literals.length} literals`,
  );
});

test("both lanes reference the shared note", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8"),
  );
  // The press lane's pausedReason and the watchlist lane's pausedReason.
  const uses = src.match(/pausedReason: EXA_PAUSED_NOTE|pausedReason = EXA_PAUSED_NOTE/g) || [];
  assert.ok(uses.length >= 2, `expected both lanes to use the shared note, found ${uses.length}`);
});

test("the watchlist lane distinguishes a pause from a failure", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8"),
  );
  const run = src.slice(src.indexOf("export async function watchlistRun"));
  const body = run.slice(0, run.indexOf("\n}\n"));
  assert.ok(
    EXA_CREDITS_SPENT.source && body.includes("EXA_CREDITS_SPENT"),
    "watchlistRun must test for a credit refusal at all",
  );
  assert.ok(body.includes("watchlist run paused"), "and log it as paused rather than failed");
  assert.ok(body.includes("watchlist run failed"), "while still logging real faults as failures");
});
