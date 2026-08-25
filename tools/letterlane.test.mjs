// The letter lane, run end to end against a mocked model that answers.
//
// This file exists because of a bug that was live for six days and invisible
// for five of them. src/index.js recorded which lanes reached the prompt by
// reading `hz` and `longevityLine`, two variables that live inside
// buildLetterPrompt in src/letterprompt.js and were never returned from it. Any
// morning the model actually answered, the lane threw "hz is not defined" after
// paying for the draft.
//
// It hid because it is downstream of the model call. On 2026-08-19, 20 and 21
// gemini returned 429, on 08-22 and 08-24 it returned 503, and the lane failed
// earlier with a quota message every time. Only 2026-08-23, the one morning the
// model responded, reached that line and recorded `letter: hz is not defined`
// in cotd:log.
//
// So the assertion is about the class of failure rather than about the letter.
// A letter that fails verification is a product outcome and the lane has a
// branch for it. A ReferenceError is a code fault and there is no branch for
// it, which is why it took the whole lane down. The test drives the lane past
// the model with four different contexts and insists the failure is never the
// second kind.

import { test } from "node:test";
import assert from "node:assert/strict";

import { getLetter } from "../src/index.js";
import { buildLetterPrompt } from "../src/letterprompt.js";

const CORNER = {
  slug: "1st-and-bush",
  name: "1st and Bush",
  lat: 37.790991,
  lon: -122.399158,
  radiusMeters: 80,
  district: 3,
  // The prompt asks for the fix by name, so a corner without one throws in the
  // template rather than in the lane. Shape taken from src/data.js.
  fix: {
    name: "Continental crosswalks, corner daylighting, and a leading pedestrian interval",
    cost: "$310,000 estimated",
    grant: "California Active Transportation Program (ATP)",
  },
};

// The shape getStats actually returns, flat rather than nested, so the lane
// under test is the lane that runs in production.
const STATS = {
  source: "live",
  radiusM: 80,
  reports311Window: "3 years",
  crashes: 39,
  fatal: 1,
  reports311: 61,
  district: 3,
};

const FULL = {
  stats: STATS,
  score: { grade: "F", index: 91, version: "v3" },
  news: { items: [{ title: "Two hurt in crash at 1st and Bush", url: "https://example.org/a", source: "Example" }] },
  voices: { items: [{ text: "Cars turn through the crosswalk here every light.", source: "reddit", url: "https://example.org/v" }] },
  timeline: { items: [{ year: 2019, label: "Signal retimed" }], totalHeadlines: 4 },
  hazards: {
    items: [
      { label: "Faded crosswalk", verdict: "CONFIRMED", detail: "12 street-condition reports in 3 years" },
      { label: "Blocked sightline", verdict: "CANDIDATE", detail: "observed in the photograph" },
    ],
  },
};

const LETTER = `Dear Supervisor,

I am writing about 1st and Bush. San Francisco's own collision record holds 39
injury collisions within 80 metres of this corner in the last five years, 1 of
them fatal. The city logged street-condition 311 reports: 61 here in three years.

The automated visual audit flagged a faded crosswalk and city records corroborate
it. Please tell me what is scheduled for this crossing.

A resident of District 3`;

// A model that answers, which is the whole point of the test.
function respondingModel(body = LETTER) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: body }] } }] }),
    text: async () => "",
  });
}

async function runLane(ctx) {
  const original = globalThis.fetch;
  globalThis.fetch = respondingModel();
  try {
    return { ok: true, value: await getLetter(CORNER, { GEMINI_API_KEY: "test-key" }, ctx) };
  } catch (e) {
    return { ok: false, error: e };
  } finally {
    globalThis.fetch = original;
  }
}

function assertNoCodeFault(result, label) {
  if (result.ok) return;
  const e = result.error;
  assert.ok(
    !(e instanceof ReferenceError),
    `${label}: the lane threw a ReferenceError, which is the bug this file exists for: ${e.message}`,
  );
  assert.ok(
    !/is not defined|is not a function|Cannot read propert/.test(e.message),
    `${label}: the lane threw "${e.message}", which is a code fault rather than a lane outcome`,
  );
}

// ------------------------------------------------------------------ the lane

test("the letter lane runs past the model without a code fault", async () => {
  assertNoCodeFault(await runLane(FULL), "full context");
});

test("and with no hazards, which is the branch that read hz", async () => {
  // hz was `ctx.hazards?.items || []`, so the absent case and the present case
  // reached the same undefined variable. Both are driven.
  assertNoCodeFault(await runLane({ ...FULL, hazards: null }), "no hazards");
});

test("and with no timeline, which is the branch that read longevityLine", async () => {
  // The second ReferenceError, one line below the first, and it would have
  // become the next morning's cotd:log reason the moment hz was fixed alone.
  assertNoCodeFault(await runLane({ ...FULL, timeline: null }), "no timeline");
});

test("and with neither, so no ordering of the two can hide the other", async () => {
  assertNoCodeFault(await runLane({ ...FULL, hazards: null, timeline: null }), "neither");
});

// --------------------------------------------------------------- the contract

test("buildLetterPrompt returns the two facts index.js records", () => {
  // Names the contract, so a future edit that drops a key fails here with a
  // clear message rather than as a ReferenceError two files away.
  const built = buildLetterPrompt(CORNER, FULL);
  assert.ok("hazardItems" in built, "hazardItems must be returned, index.js reads it");
  assert.ok("longevityLine" in built, "longevityLine must be returned, index.js reads it");
  assert.ok(Array.isArray(built.hazardItems), "hazardItems is the item array index.js measures");
  assert.equal(built.hazardItems.length, 2, "and it carries the items it was given");
});

test("a corner with no hazards returns an empty item list rather than undefined", () => {
  // index.js does `hazardItems.length`, so undefined here is a fault there.
  const built = buildLetterPrompt(CORNER, { ...FULL, hazards: null });
  assert.ok(Array.isArray(built.hazardItems), "hazardItems must always be an array");
  assert.equal(built.hazardItems.length, 0);
});
