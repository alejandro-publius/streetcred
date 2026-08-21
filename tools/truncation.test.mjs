// Is the letter finished?
//
// 25 of the 125 letters published on 2026-08-21 stopped mid-sentence, around
// 500 to 600 characters, with no request, no closing and no signoff. One ended
// on the words "No exposure". Every one of them passed every rule the verifier
// had, because not one rule asked whether the letter was over.
//
// The cause was upstream: Gemini 2.5 spends thinking tokens out of
// maxOutputTokens, the draft hit a 3072 ceiling, and vertexDraft returned the
// partial text without ever reading finishReason. Both halves are fixed. This
// file holds the gate half, because the gate should not have depended on the
// vendor half being right.
//
//   node --test tools/truncation.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { buildInputSet, verifyLetter } from "../src/verify.js";

const inputs = (over = {}) =>
  buildInputSet({
    corner: { slug: "polk-and-post", name: "Polk Street and Post Street", fix: { name: "Daylighting", cost: "$120,000", grant: "HSIP" } },
    stats: { crashes: 30, reports311: 44, district: 3 },
    news: { items: [] },
    voices: { items: [] },
    district: 3,
    supervisor: "Danny Sauter",
    signoff: "A resident of District 3",
    ...over,
  });

const OPEN = "Dear Supervisor Danny Sauter,\n\nCity records document 30 injury collisions here.";

test("a letter that stops mid-sentence is caught", () => {
  // 6th-market, verbatim, as it was published.
  const r = verifyLetter(`${OPEN} This intersection shows more reported harm than 99 percent of San Francisco intersections, earning an F grade on the Danger Index. No exposure`, inputs());
  assert.ok(r.failures.some((f) => f.kind === "truncated"));
  assert.equal(r.ok, false);
});

test("a letter that ends on a full stop but never reaches its request is caught too", () => {
  // Four of the 25 ended on punctuation and were still fragments, which is why
  // no punctuation heuristic would have found them.
  const r = verifyLetter(`${OPEN} The Danger Index ranks reported harm, not risk per crossing.`, inputs());
  assert.ok(r.failures.some((f) => f.kind === "truncated"), "clean punctuation is not completeness");
});

test("a finished letter passes", () => {
  const r = verifyLetter(
    `${OPEN}\n\nPlease fund Daylighting, estimated $120,000, through the HSIP.\n\nSincerely,\n\nA resident of District 3`,
    inputs(),
  );
  assert.ok(!r.failures.some((f) => f.kind === "truncated"));
});

test("the citywide signoff works the same way", () => {
  const i = inputs({ district: null, supervisor: null, stats: { crashes: 30, district: null }, signoff: "A resident of San Francisco" });
  const done = verifyLetter(`Dear Mayor Daniel Lurie,\n\nCity records document 30 injury collisions.\n\nA resident of San Francisco`, i);
  assert.ok(!done.failures.some((f) => f.kind === "truncated"));
  const cut = verifyLetter(`Dear Mayor Daniel Lurie,\n\nCity records document 30 injury`, i);
  assert.ok(cut.failures.some((f) => f.kind === "truncated"));
});

test("the rule is disarmed when no signoff is supplied", () => {
  // verifyLetter runs on single-sentence fragments throughout the suite. Only a
  // caller that knows it is handing over a whole letter may arm this.
  const r = verifyLetter("City records document 30 injury collisions here.", inputs({ signoff: undefined }));
  assert.ok(!r.failures.some((f) => f.kind === "truncated"));
});

test("the failure names what it saw, not just that it failed", () => {
  const r = verifyLetter(`${OPEN} No exposure`, inputs());
  const f = r.failures.find((x) => x.kind === "truncated");
  assert.match(f.reason, /does not end with its signoff/);
  assert.match(f.reason, /A resident of District 3/);
  assert.match(f.token, /No exposure$/, "the tail is quoted so the failure is diagnosable");
});
