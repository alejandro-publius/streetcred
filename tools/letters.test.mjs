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
import { stagedLetterFiles, buildLedger, costOf } from "./generate_letters.mjs";

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
