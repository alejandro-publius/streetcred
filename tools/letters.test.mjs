// The offline letter generator's guarantees.
//
// Three things are asserted here and none of them are about the model. What a
// model returns is its business; what this file holds is that the prompt only
// ever describes lanes that actually found something, that the addressee is the
// corner's real representative, and that a draft which failed the verifier
// cannot reach the store no matter what the loop above it did.
//
// No network, no key, no ADC: `node --test tools/letters.test.mjs`.

import test from "node:test";
import assert from "node:assert/strict";
import { buildLetterPrompt } from "../src/letterprompt.js";
import { buildInputSet, verifyLetter } from "../src/verify.js";
import { resolvedDistrict, addresseeFor, SUPERVISORS } from "../src/data.js";
import { stagedLetterFiles, buildLedger, costOf, mergeResults, totalsFromRuns } from "./generate_letters.mjs";

const corner = (over = {}) => ({
  slug: "fillmore-and-lombard",
  name: "Fillmore Street and Lombard Street",
  short: "Fillmore & Lombard",
  lat: 37.8,
  lon: -122.436,
  radiusMeters: 150,
  fix: { name: "Daylighting", cost: "$120,000", grant: "Caltrans HSIP" },
  ...over,
});

const ctx = (over = {}) => ({
  stats: { crashes: 30, fatal: 0, reports311: 44, district: 2 },
  score: null,
  news: { items: [] },
  voices: { items: [] },
  timeline: null,
  hazards: null,
  ...over,
});

// ------------------------------------------------- prompt lane conditioning

test("no resident sentence when the voices lane found nothing", () => {
  const { prompt } = buildLetterPrompt(corner(), ctx({ voices: { items: [] } }));
  assert.match(prompt, /Do not quote or invent any resident testimony/);
  assert.doesNotMatch(prompt, /A resident said:/);
});

test("a resident sentence only when a quote is actually about the street", () => {
  // Transit-station commentary is the common case in this scrape and must not
  // become testimony about a crossing.
  const offTopic = buildLetterPrompt(
    corner(),
    ctx({ voices: { items: [{ text: "The escalators here are always broken and it smells" }] } }),
  ).prompt;
  assert.match(offTopic, /Do not quote or invent any resident testimony/);
  assert.doesNotMatch(offTopic, /A resident said:/);

  const onTopic = buildLetterPrompt(
    corner(),
    ctx({ voices: { items: [{ text: "drivers turn through the crosswalk while people are still in it" }] } }),
  ).prompt;
  assert.match(onTopic, /A resident said: drivers turn through the crosswalk/);
  assert.doesNotMatch(onTopic, /Do not quote or invent any resident testimony/);
});

test("no press sentence when no citations exist, and an explicit prohibition instead", () => {
  const { prompt } = buildLetterPrompt(corner(), ctx({ news: { items: [] } }));
  assert.match(prompt, /No press coverage was found for this corner\. Do not cite or invent any news reporting/);
  assert.doesNotMatch(prompt, /Recent press coverage:/);
});

test("press coverage is named with outlet and date when citations exist", () => {
  const { prompt } = buildLetterPrompt(
    corner(),
    ctx({ news: { items: [{ title: "Pedestrian struck", domain: "sfchronicle.com", date: "2026-03-04" }] } }),
  );
  assert.match(prompt, /Recent press coverage: "Pedestrian struck" \(sfchronicle\.com, 2026-03-04\)/);
  assert.doesNotMatch(prompt, /Do not cite or invent any news reporting/);
});

test("no audit sentence when the hazards lane is empty", () => {
  const { prompt } = buildLetterPrompt(corner(), ctx({ hazards: null }));
  assert.match(prompt, /No visual audit findings are available for this corner\. Do not describe any audit/);
});

test("each hazard verdict gets its own licence in the prompt", () => {
  const { prompt } = buildLetterPrompt(
    corner(),
    ctx({
      hazards: {
        items: [
          { label: "Vehicle turning conflict zone", verdict: "CONFIRMED", detail: "5 collisions in 5 years" },
          { label: "Inadequate street lighting", verdict: "CANDIDATE", detail: "" },
          { label: "Curb in poor condition", verdict: "REPORTED", detail: "3 reports" },
        ],
      },
    }),
  );
  assert.match(prompt, /corroborate it.*You may present this as documented/s);
  assert.match(prompt, /Never state it as established fact/);
  assert.match(prompt, /Attribute this to the records, not to the audit/);
});

test("the figures in the prompt are the corner's stored numbers, not defaults", () => {
  const { prompt } = buildLetterPrompt(corner(), ctx({ stats: { crashes: 65, fatal: 2, reports311: 85, district: 9 } }));
  assert.match(prompt, /65 injury collisions/);
  assert.match(prompt, /2 of them fatal/);
  assert.match(prompt, /85 street-condition 311 reports/);
});

// ------------------------------------------------------------- addressee

test("the addressee is the sitting supervisor for the corner's resolved district", () => {
  const { prompt, supervisor, district } = buildLetterPrompt(corner(), ctx());
  assert.equal(district, 2);
  assert.equal(supervisor, "Stephen Sherrill");
  assert.match(prompt, /San Francisco Supervisor Stephen Sherrill/);
  assert.match(prompt, /in District 2/);
  assert.match(prompt, /Sign off as "A resident of District 2"/);
});

// The exact bug this whole rule exists for: a corner whose own record carries no
// district still resolves through stats, and must not fall through to the
// citywide official.
test("the Fillmore backoff case: district comes from stats when the corner lacks it", () => {
  const shardShaped = corner();
  delete shardShaped.district;
  assert.equal(shardShaped.district, undefined);
  assert.equal(resolvedDistrict(shardShaped, null), null, "with no stats there is nothing to resolve");

  const { supervisor, prompt } = buildLetterPrompt(shardShaped, ctx({ stats: { crashes: 30, district: 2 } }));
  assert.equal(supervisor, "Stephen Sherrill", "must not fall through to the Mayor");
  assert.doesNotMatch(prompt, /Mayor/);
});

test("a corner with no resolvable district addresses the citywide official, untitled", () => {
  const { prompt, supervisor } = buildLetterPrompt(corner(), ctx({ stats: { crashes: 3, district: null } }));
  assert.equal(supervisor, "Mayor Daniel Lurie");
  assert.match(prompt, /San Francisco Mayor Daniel Lurie/);
  assert.doesNotMatch(prompt, /Supervisor Mayor/, "never Dear Supervisor Mayor Daniel Lurie");
  assert.match(prompt, /in San Francisco/);
  assert.match(prompt, /A resident of San Francisco/);
});

test("every district in the table produces its own supervisor in the prompt", () => {
  for (const d of Object.keys(SUPERVISORS)) {
    const { prompt } = buildLetterPrompt(corner(), ctx({ stats: { crashes: 5, district: Number(d) } }));
    assert.match(prompt, new RegExp(`Supervisor ${SUPERVISORS[d]}`), `district ${d}`);
    assert.equal(addresseeFor(d), `Supervisor ${SUPERVISORS[d]}`);
  }
});

// --------------------------------------- the verifier is in the write path

test("a draft that fails the verifier is staged as pending and cannot be selected", () => {
  // The sample paragraph, which fails lane consistency at a corner with empty
  // lanes. Whatever the loop does, the publish filter is what guarantees it
  // never becomes a KV entry.
  const inputs = buildInputSet({
    corner: corner(),
    stats: { crashes: 30, reports311: 44, district: 2 },
    news: { items: [] },
    voices: { items: [] },
    supervisor: "Stephen Sherrill",
  });
  const bad =
    "Dear Supervisor Stephen Sherrill,\n\nCity records show hundreds of collisions here. " +
    "Residents describe the same problem in their own words. Local reporting has covered it.";
  const check = verifyLetter(bad, inputs);
  assert.equal(check.ok, false, "this draft must fail");
  assert.ok(check.failures.some((f) => f.kind === "magnitude"));
  assert.ok(check.failures.some((f) => f.kind === "voices"));
  assert.ok(check.failures.some((f) => f.kind === "press"));

  // A failing draft is staged under .pending.json, and the write set excludes it.
  const staged = ["good-corner.json", "bad-corner.pending.json", "_results.json", ".keys-123.json"];
  const selected = stagedLetterFiles(staged);
  assert.deepEqual(selected, ["good-corner.json"]);
  assert.ok(!selected.some((f) => f.includes(".pending.")), "a pending draft must never reach KV");
  assert.ok(!selected.includes("_results.json"), "the run log is not a letter");
  assert.ok(!selected.includes(".keys-123.json"), "scratch files are not letters");
});

test("an em dash in a draft fails the check, so it cannot be published", () => {
  const inputs = buildInputSet({
    corner: corner(),
    stats: { crashes: 30, reports311: 44, district: 2 },
    news: { items: [] },
    voices: { items: [] },
    supervisor: "Stephen Sherrill",
  });
  const r = verifyLetter("Dear Supervisor Stephen Sherrill,\n\nThis corner is dangerous — fund it.", inputs);
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.kind === "emdash"));
});

// ------------------------------------------------------------- the ledger

test("the ledger is one record with a line per letter, not a record per letter", () => {
  const rows = [
    { slug: "a", state: "passed", attempts: 1, usd: 0.0012, promptTokens: 1500, outputTokens: 300 },
    { slug: "b", state: "passed", attempts: 2, usd: 0.0031, promptTokens: 3000, outputTokens: 700 },
    { slug: "c", state: "pending", attempts: 2, usd: 0.0028, promptTokens: 2900, outputTokens: 650 },
    { slug: "d", state: "skipped" },
  ];
  const l = buildLedger(rows, { now: "2026-08-21T00:30:00.000Z" });

  assert.equal(l.period, "2026-08");
  assert.equal(l.letters, 2, "only passing drafts are letters");
  assert.equal(l.calls, 5, "every attempt is a billed call, including retries");
  assert.equal(l.promptTokens, 7400);
  assert.equal(l.outputTokens, 1650);
  assert.equal(l.estUsd, 0.0071);
  assert.equal(l.perCorner.length, 3, "passed and pending are both recorded, skipped is not");
  assert.equal(l.auth, "application default credentials, no api key");
  assert.match(l.via, /^vertex:/);
});

test("the ledger names itself an estimate, because it is not a provider figure", () => {
  // Exa returns costDollars on every response and that ledger is measured.
  // This one is arithmetic over token counts, and the two must not read as the
  // same kind of number to anyone looking at /status.
  const l = buildLedger([{ slug: "a", state: "passed", attempts: 1, usd: 0.001 }]);
  assert.match(l.basis, /estimated from token counts/);
  assert.match(l.basis, /\$[\d.]+\/M in and \$[\d.]+\/M out/);
});

test("cost is computed from both token directions", () => {
  assert.equal(costOf(1_000_000, 0), 0.3);
  assert.equal(costOf(0, 1_000_000), 2.5);
  assert.equal(costOf(0, 0), 0);
});

test("an empty run produces a ledger that claims nothing", () => {
  const l = buildLedger([]);
  assert.equal(l.letters, 0);
  assert.equal(l.calls, 0);
  assert.equal(l.estUsd, 0);
  assert.deepEqual(l.perCorner, []);
});

// ------------------------------------------- the log accumulates across runs
//
// The bug these hold shut: `--only=` re-runs 18 corners, and the line that
// saved the results wrote those 18 over the 132 the pass before it had
// recorded. The ledger built at publish time then read 18 corners of spend for
// a fleet of 132, and 114 corners with a verified letter on disk vanished from
// the record of how they got there.

test("a subset re-run merges into the log instead of replacing it", () => {
  const first = [
    { slug: "a", state: "passed", attempts: 1 },
    { slug: "b", state: "pending", attempts: 2 },
    { slug: "c", state: "passed", attempts: 1 },
  ];
  const rerun = [{ slug: "b", state: "passed", attempts: 2 }];
  const merged = mergeResults(first, rerun);

  assert.equal(merged.length, 3, "the corners the re-run did not touch survive");
  assert.deepEqual(merged.map((r) => r.slug), ["a", "b", "c"], "sorted by slug");
  assert.equal(merged.find((r) => r.slug === "b").state, "passed", "the re-run's verdict wins");
  assert.equal(merged.find((r) => r.slug === "b").reruns, 1, "and the row records that it was re-run");
  assert.equal(merged.find((r) => r.slug === "a").reruns, undefined, "untouched rows are untouched");
});

test("a re-run adds to the bill rather than replacing it", () => {
  // Both passes called Vertex. The second one does not unspend the first.
  const runs = [
    { label: "full pass", corners: 132, calls: 217, estUsd: 1.1432, promptTokens: null, outputTokens: null },
    { label: "re-run", corners: 18, calls: 29, estUsd: 0.1663, promptTokens: 12000, outputTokens: 55000 },
  ];
  const t = totalsFromRuns(runs);
  assert.equal(t.calls, 246);
  assert.equal(t.estUsd, 1.3095);
  assert.equal(t.tokensCoverRuns, 1, "only one run recorded token counts");
  assert.equal(t.promptTokens, 12000, "and the total is over that run only, not a guess for the other");
});

test("the ledger says how much of itself the token figure covers", () => {
  const l = buildLedger([{ slug: "a", state: "passed", attempts: 1 }], {
    runs: [
      { label: "one", calls: 10, estUsd: 0.5, promptTokens: null, outputTokens: null },
      { label: "two", calls: 5, estUsd: 0.25, promptTokens: 900, outputTokens: 100 },
    ],
  });
  assert.equal(l.calls, 15, "dollars and calls cover every run");
  assert.equal(l.estUsd, 0.75);
  assert.equal(l.tokensCover, "1 of 2 generation runs", "the partial figure names itself partial");
  assert.equal(l.runs.length, 2, "and the runs are itemised rather than only summed");
});

test("the ledger reports the letters that exist, not the rows that passed", () => {
  // At publish time the write set is the staging directory, which carries
  // letters from every pass. Counting only this run's passing rows would report
  // 14 letters on a night that published 116.
  const l = buildLedger([{ slug: "a", state: "passed", attempts: 1 }], { letters: 116 });
  assert.equal(l.letters, 116);
});

// ------------------------------------------------------ the render spend
//
// This was called at publish time and defined nowhere, inside a bare catch
// that turned the ReferenceError into "no render run tonight". The ledger
// would have shown no imagery line on a night that spent money on renders.

test("a held render is still a billed render", async () => {
  const { imagerySpend } = await import("./promote_corners.mjs");
  const r = imagerySpend([
    { slug: "a", state: "passed", usd: 0.006, promptTokens: 900, outputTokens: 800 },
    { slug: "b", state: "held", why: "watermark: source reads Google, render reads \"\"", usd: 0.006, promptTokens: 900, outputTokens: 800 },
    { slug: "c", state: "held", why: "render error: Resource has been exhausted (e.g. check quota).", usd: 0 },
  ]);
  assert.equal(r.attempted, 3);
  assert.equal(r.published, 1, "published is what a visitor can see");
  assert.equal(r.held, 2);
  assert.equal(r.heldOnGate, 1, "the gate rejected one image");
  assert.equal(r.heldOnApi, 1, "and one image was never returned to reject");
  assert.equal(r.estUsd, 0.012, "the rejected render is billed, so it is counted");
});

test("no render run bills nothing rather than zero", async () => {
  const { imagerySpend } = await import("./promote_corners.mjs");
  assert.equal(imagerySpend([]), null, "null is absent; 0 would claim a run happened and cost nothing");
});

// ------------------------------------------ the publish path's own filter
//
// stagedLetterFiles has rejected `.keys-123.json` since the day it was written,
// and the publish path did not call it. It carried a hand-rolled copy of the
// same filter that omitted the leading-dot check, so on the first real publish
// 11 scratch files went to KV as `letter:verified:.keys-1140589900` and the
// ledger reported 127 letters where 116 existed. The test was right. Nothing
// ran the function it was testing.

test("every scratch file this tool writes into the staging directory is excluded", () => {
  const dir = [
    "church-and-duboce.json",
    "6th-market.pending.json",
    "_results.json",
    "_runs.json",
    ".keys-1140589900.json",   // written by bulkGet, one per chunked read
    ".bulk-0.json",            // written by the previous publish, one per batch
    ".DS_Store",
  ];
  assert.deepEqual(stagedLetterFiles(dir), ["church-and-duboce.json"]);
});

test("the ledger counts what the publish path selected, not what the directory holds", () => {
  const dir = ["a.json", "b.json", ".keys-1.json", ".bulk-0.json", "_runs.json", "c.pending.json"];
  const selected = stagedLetterFiles(dir);
  assert.equal(selected.length, 2);
  const l = buildLedger([], { letters: selected.length });
  assert.equal(l.letters, 2, "not 4, which is what counting the raw listing gave");
});
