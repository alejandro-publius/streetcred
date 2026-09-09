// The Cred Check (`credCheck` in src/cred.js) is the verdict every corner
// page leads with: four lanes, each a hit or not, rolled into CORROBORATED /
// SUPPORTED / PARTIAL / REPORTED ONLY. Every other lane test exercises the
// helpers it calls (`isStreetQuote`, `isSafetyCoverage`) indirectly through
// press and voices fixtures, but nothing in this tree called `credCheck`
// itself before this file: the function that actually grades a claim against
// its sources had no direct test. `node --test tools/credcheck.test.mjs`.
//
// What this covers, named the way the brief for this pass named it:
//   - a claim backed by a strong official source (a fatal collision)
//   - a claim backed by only a weak source (one 311 report, below the
//     3-report threshold `credCheck` itself applies) — the records lane must
//     stay closed, not fudge open on a near-miss count
//   - a claim with no source in any of the four lanes at all, which must
//     produce REPORTED ONLY with every lane's `hit` false, never a lane that
//     quietly claims something it has nothing behind
//   - a source that only looks like corroboration and does not count: a
//     police bulletin naming the corner, which `credCheck` excludes by rule
//     because the record reporting on itself is not independent evidence
//   - the weak/strong split inside a resident quote: a "scary" review with no
//     street word is not evidence, the same word beside "crossing" is

import test from "node:test";
import assert from "node:assert/strict";
import { credCheck, isStreetQuote, isReassuring } from "../src/cred.js";

test("a strong official source (a fatal collision) closes the records lane", () => {
  const out = credCheck({
    stats: { crashes: 1, fatal: 1, reports311: 0 },
    news: { items: [] },
    voices: { items: [] },
    hazards: { items: [] },
  });
  const records = out.lanes.find((l) => l.key === "records");
  assert.equal(records.hit, true);
  assert.match(records.detail, /1 fatal/);
  assert.equal(out.score, 1);
  assert.equal(out.verdict, "REPORTED ONLY");
});

test("a weak source (one 311 report, below the 3-report floor) does not open the records lane", () => {
  const out = credCheck({
    stats: { crashes: 0, reports311: 1 },
    news: { items: [] },
    voices: { items: [] },
    hazards: { items: [] },
  });
  const records = out.lanes.find((l) => l.key === "records");
  assert.equal(records.hit, false);
  assert.equal(out.score, 0);
});

test("three 311 reports, right at the floor, does open the records lane", () => {
  const out = credCheck({
    stats: { crashes: 0, reports311: 3 },
    news: { items: [] },
    voices: { items: [] },
    hazards: { items: [] },
  });
  assert.equal(out.lanes.find((l) => l.key === "records").hit, true);
});

test("no source in any lane produces REPORTED ONLY, every lane honestly closed", () => {
  const out = credCheck({
    stats: { crashes: 0, reports311: 0 },
    news: { items: [] },
    voices: { items: [] },
    hazards: { items: [] },
  });
  assert.equal(out.score, 0);
  assert.equal(out.verdict, "REPORTED ONLY");
  for (const lane of out.lanes) {
    assert.equal(lane.hit, false, `${lane.key} lane must be closed with nothing behind it`);
  }
});

test("a police bulletin naming the corner does not open the press lane", () => {
  // credCheck filters news items to `!i.official && i.corroborates`. An
  // official source describing itself is the record, not corroboration of
  // it, so a press item flagged official must not count even though it
  // "found" the corner and even though corroborates is true.
  const out = credCheck({
    stats: { crashes: 0, reports311: 0 },
    news: { items: [{ domain: "sfpd.org", official: true, corroborates: true }] },
    voices: { items: [] },
    hazards: { items: [] },
  });
  assert.equal(out.lanes.find((l) => l.key === "press").hit, false);
});

test("a non-official item that does not corroborate also does not open the press lane", () => {
  const out = credCheck({
    stats: { crashes: 0, reports311: 0 },
    news: { items: [{ domain: "sfchronicle.com", official: false, corroborates: false }] },
    voices: { items: [] },
    hazards: { items: [] },
  });
  assert.equal(out.lanes.find((l) => l.key === "press").hit, false);
});

test("an independent, corroborating article opens the press lane", () => {
  const out = credCheck({
    stats: { crashes: 0, reports311: 0 },
    news: { items: [{ domain: "sfchronicle.com", official: false, corroborates: true, date: "2026-01-01" }] },
    voices: { items: [] },
    hazards: { items: [] },
  });
  assert.equal(out.lanes.find((l) => l.key === "press").hit, true);
});

test("a corroborating item with no url does not open the press lane", () => {
  // The rule this site states is "no source means no claim". A title with no
  // url is not a source a reader can check, whatever `corroborates` says: it
  // is exactly the shape newsfilter.classify() used to let through when a raw
  // Exa result carried a title but an empty url, because that function only
  // required `title`, not `url`. Fixed in newsfilter.js; this is the belt on
  // the grading function itself, which must not take an upstream lane's word
  // for a claim it cannot verify has a link behind it.
  const out = credCheck({
    stats: { crashes: 0, reports311: 0 },
    news: { items: [{ domain: "", url: "", official: false, corroborates: true, date: "2026-01-01" }] },
    voices: { items: [] },
    hazards: { items: [] },
  });
  const press = out.lanes.find((l) => l.key === "press");
  assert.equal(press.hit, false);
  assert.equal(out.score, 0);
  assert.equal(out.verdict, "REPORTED ONLY");
});

test("all four lanes hitting reaches CORROBORATED, the top verdict", () => {
  const out = credCheck({
    stats: { crashes: 1, fatal: 1, reports311: 5 },
    news: { items: [{ domain: "sfchronicle.com", official: false, corroborates: true }] },
    voices: { items: [{ text: "Cars run this crossing every day, it's terrifying.", source: "google_maps" }] },
    hazards: { items: [{ verdict: "CONFIRMED" }] },
  });
  assert.equal(out.score, 4);
  assert.equal(out.verdict, "CORROBORATED");
});

// -------------------------------------------------------- isStreetQuote itself

test("a weak word alone ('scary', no street word) is not a street claim", () => {
  assert.equal(isStreetQuote("This whole block is scary at night."), false);
});

test("the same weak word beside a strong street word is a street claim", () => {
  assert.equal(isStreetQuote("Scary crossing, cars never stop."), true);
});

test("a strong street word alone, no weak word needed, is a street claim", () => {
  assert.equal(isStreetQuote("The crosswalk paint is completely gone here."), true);
});

test("text with neither list is not a street claim", () => {
  assert.equal(isStreetQuote("Great burrito, friendly staff, would come back."), false);
});

// ------------------------------------------------- a source can't contradict

test("a quote reassuring readers the crossing is safe does not count as street testimony", () => {
  // Topically on-topic (it names the crossing and drivers) but it says the
  // opposite of the claim the resident lane exists to corroborate, so it must
  // not be able to raise the Cred Check the way a complaint would.
  assert.equal(
    isStreetQuote("This crossing is very safe, drivers are always careful and I've never had an issue here."),
    false,
  );
  assert.equal(isReassuring("Drivers always stop, it's a safe intersection."), true);
});

test("a reassuring quote does not open the Cred Check's resident lane", () => {
  const out = credCheck({
    stats: { crashes: 0, reports311: 0 },
    news: { items: [] },
    voices: { items: [{ text: "I cross here every day and it feels perfectly safe.", source: "google_maps" }] },
    hazards: { items: [] },
  });
  assert.equal(out.lanes.find((l) => l.key === "voices").hit, false);
});

test("negating the reassurance ('not safe') is still a complaint, not reassurance", () => {
  // The guard must catch explicit reassurance without swallowing an ordinary
  // complaint that happens to use the word "safe" in its negated form.
  assert.equal(isReassuring("It is not safe to cross here, drivers never yield."), false);
  assert.equal(isStreetQuote("It is not safe to cross here, drivers never yield."), true);
});
