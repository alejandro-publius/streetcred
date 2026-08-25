// A count butting against the literal 311.
//
// "30 311 reports in 12 months" reads as 30311. It was not a model invention:
// the stored hazard details carry that phrasing and buildLetterPrompt handed
// them to the model verbatim, so 22 of the 124 letters published on 2026-08-21
// reproduced it, 41 times in total. Fixed at the seam so the model is never
// handed the colliding form, and held here so a draft that reaches for it
// anyway is refused.
//
//   node --test tools/collision.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { buildInputSet, verifyLetter } from "../src/verify.js";
import { buildLetterPrompt, decollide311 } from "../src/letterprompt.js";

const corner = () => ({
  slug: "16th-mission", name: "16th Street and Mission Street", short: "16th & Mission",
  lat: 37.765, lon: -122.42, fix: { name: "Daylighting", cost: "$120,000", grant: "Caltrans HSIP" },
});
const inputs = () =>
  buildInputSet({
    corner: corner(), stats: { crashes: 67, reports311: 352, district: 9 },
    news: { items: [] }, voices: { items: [] }, district: 9, supervisor: "Jackie Fielder",
    signoff: "A resident of District 9",
    hazards: { items: [{ label: "Faded crosswalk", verdict: "REPORTED", detail: "30 311 reports in 12 months" }] },
  });

test("the seam rephrases, and leaves separated counts alone", () => {
  assert.equal(decollide311("30 311 reports in 12 months"), "311 reports: 30 in 12 months");
  assert.equal(decollide311("1,204 311 reports"), "311 reports: 1,204");
  assert.equal(decollide311("86 street-condition 311 reports"), "86 street-condition 311 reports");
  assert.equal(decollide311("14 pedestrian crossing collisions in 5 years"), "14 pedestrian crossing collisions in 5 years");
  assert.equal(decollide311(""), "");
  assert.equal(decollide311(null), "");
});

test("the prompt never hands the model a colliding count", () => {
  const { prompt } = buildLetterPrompt(corner(), {
    stats: { crashes: 67, reports311: 352, district: 9 },
    news: { items: [] }, voices: { items: [] }, timeline: null,
    hazards: { items: [
      { label: "Faded crosswalk", verdict: "REPORTED", detail: "30 311 reports in 12 months" },
      { label: "Turning conflict", verdict: "CONFIRMED", detail: "7 311 reports in 12 months, 14 collisions in 5 years" },
    ] },
  });
  assert.doesNotMatch(prompt, /\b\d[\d,]*\s+311\b/, "no bullet may carry the colliding form");
  assert.match(prompt, /311 reports: 30 in 12 months/);
  assert.match(prompt, /never write a count immediately before the literal 311/);
  // The instruction must not demonstrate the bad form while forbidding it: the
  // first wording quoted "30 311 reports" as its own example, which put the
  // exact string it was banning into the prompt.
  assert.doesNotMatch(prompt, /\b\d[\d,]*\s+311\b/, "not even inside the rule that forbids it");
});

test("the stats bullet was already safe and stays safe", () => {
  const { prompt } = buildLetterPrompt(corner(), {
    stats: { crashes: 67, reports311: 352, district: 9 },
    news: { items: [] }, voices: { items: [] }, timeline: null, hazards: null,
  });
  assert.match(prompt, /352 street-condition 311 reports/, "the words between the count and the 311 are the separation");
  assert.doesNotMatch(prompt, /\b\d[\d,]*\s+311\b/);
});

test("a draft that collides is refused", () => {
  const r = verifyLetter(
    "Dear Supervisor Jackie Fielder,\n\nCity records document 30 311 reports in 12 months.\n\nA resident of District 9",
    inputs(),
  );
  assert.equal(r.ok, false);
  const f = r.failures.find((x) => x.kind === "collision");
  assert.ok(f, "the collision must be caught");
  assert.equal(f.token, "30 311");
  assert.match(f.reason, /reads as one number/);
});

test("every occurrence is named, not just the first", () => {
  const r = verifyLetter(
    "Dear Supervisor Jackie Fielder,\n\nRecords show 30 311 reports and 7 311 reports.\n\nA resident of District 9",
    inputs(),
  );
  assert.equal(r.failures.filter((f) => f.kind === "collision").length, 2);
});

test("separated phrasing passes", () => {
  const r = verifyLetter(
    "Dear Supervisor Jackie Fielder,\n\nCity records document 352 street-condition 311 reports, and 311 reports: 30 in 12 months relating to markings.\n\nA resident of District 9",
    inputs(),
  );
  assert.ok(!r.failures.some((f) => f.kind === "collision"), "both safe forms must pass");
});
