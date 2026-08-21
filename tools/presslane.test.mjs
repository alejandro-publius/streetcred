// The press rule, and the two ways it was manufacturing failures.
//
// Nine of the 16 letter pendings failed on rule 6. Classifying them found no
// inventions at all: the press lane genuinely held nothing at all nine corners,
// and the two whose rejected drafts were still on disk were both held for
// obeying the prompt.
//
//   31st-and-lawton: "No press coverage has been found for this specific corner."
//   6th-market:      "Press coverage of safety problems at this intersection
//                     goes back at least 12 years, to 2014, representing the
//                     earliest coverage we can find."
//
// The first is a DENIAL, which rule 6 read as a citation because PRESS_MENTION
// matched the words "press coverage" inside it. The prompt instructs the model
// to write that sentence when the lane is empty.
//
// The second is the longevity bullet, verbatim, which the same prompt instructs
// the model to state. Its evidence lives in the timeline lane, which the
// verifier was never shown: 6th-market's timeline holds 25 headlines going back
// to 2014. That is the hazards bug one lane over.
//
//   node --test tools/presslane.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { buildInputSet, verifyLetter } from "../src/verify.js";
import { buildLetterPrompt } from "../src/letterprompt.js";

const corner = () => ({
  slug: "6th-market", name: "6th Street and Market Street", short: "6th & Market",
  lat: 37.78, lon: -122.41, radiusMeters: 150,
  fix: { name: "Daylighting", cost: "$120,000", grant: "Caltrans HSIP" },
});

const inputs = (over = {}) =>
  buildInputSet({
    corner: corner(),
    stats: { crashes: 30, reports311: 44, district: 6 },
    news: { items: [] },
    voices: { items: [] },
    district: 6,
    supervisor: "Matt Dorsey",
    ...over,
  });

const letter = (body) => `Dear Supervisor Matt Dorsey,\n\n${body}`;

// ------------------------------------------------------- denial is not citation

test("a sentence denying coverage is not a citation", () => {
  // The exact string 31st-and-lawton was held on.
  const r = verifyLetter(letter("No press coverage has been found for this specific corner."), inputs());
  assert.ok(!r.failures.some((f) => f.kind === "press"), "the letter was obeying the prompt");
});

test("the other shapes of denial the prompt can produce", () => {
  for (const s of [
    "No press coverage was found for this corner.",
    "No recent news coverage was found for this intersection.",
    "Press coverage has not been found for this crossing.",
    "There is no local reporting on this corner.",
  ]) {
    const r = verifyLetter(letter(s), inputs());
    assert.ok(!r.failures.some((f) => f.kind === "press"), `must not flag: ${s}`);
  }
});

test("an assertion is still caught, and the word no elsewhere does not excuse it", () => {
  // The exemption must be bounded. A sentence that asserts coverage cannot buy
  // its way out by containing a negation somewhere else.
  const bad = verifyLetter(letter("There is no doubt that local reporting has covered this corner extensively."), inputs());
  assert.ok(bad.failures.some((f) => f.kind === "press"), "an assertion with a stray negation must still fail");

  const plain = verifyLetter(letter("This corner has been covered by local news."), inputs());
  assert.ok(plain.failures.some((f) => f.kind === "press"), "the ordinary invention still fails");
});

// ------------------------------------------- the timeline is press evidence

test("the timeline's headline history is press evidence the verifier can see", () => {
  const withHistory = inputs({ timeline: { totalHeadlines: 25, yearsReported: 12, firstReportedYear: 2014 } });
  assert.equal(withHistory.historicalHeadlines, 25);

  // The exact sentence 6th-market was held on.
  const r = verifyLetter(
    letter("Press coverage of safety problems at this intersection goes back at least 12 years, to 2014, representing the earliest coverage we can find."),
    withHistory,
  );
  assert.ok(!r.failures.some((f) => f.kind === "press"), "a sourced history is not an invention");
});

test("with no history and no current coverage, the same sentence still fails", () => {
  const r = verifyLetter(
    letter("Press coverage of safety problems at this intersection goes back at least 12 years."),
    inputs({ timeline: null }),
  );
  assert.ok(r.failures.some((f) => f.kind === "press"), "the gate must still hold when nothing sourced it");
});

test("history does not leak into the magnitude rule's displayed counts", () => {
  // citedPressCount feeds `displayed`, which is about what the PAGE shows. The
  // page shows cited press items, not a historical headline total, so folding
  // one into the other would let "hundreds of stories" pass on a page showing
  // no press at all.
  const i = inputs({ timeline: { totalHeadlines: 25, yearsReported: 12, firstReportedYear: 2014 } });
  assert.equal(i.citedPressCount, 0, "the current window is still empty");
  assert.equal(i.displayed.has("press"), false, "and the page still displays no press count");
});

// ------------------------------------------------ the prompt stops contradicting

test("the prompt no longer forbids and instructs the same claim", () => {
  const ctx = {
    stats: { crashes: 30, district: 6 }, news: { items: [] }, voices: { items: [] },
    timeline: { totalHeadlines: 25, yearsReported: 12, firstReportedYear: 2014 }, hazards: null,
  };
  const { prompt } = buildLetterPrompt(corner(), ctx);
  assert.match(prompt, /goes back at least 12 years/, "the longevity bullet is still emitted");
  assert.doesNotMatch(
    prompt,
    /No press coverage was found for this corner\. Do not cite or invent any news reporting\./,
    "the blanket prohibition must not sit beside it",
  );
  assert.match(prompt, /Do not name, quote or invent any specific article, outlet or headline/);
  assert.match(prompt, /You may state the documented coverage history/);
});

test("with no history at all, the blanket prohibition is unchanged", () => {
  const ctx = { stats: { crashes: 30, district: 6 }, news: { items: [] }, voices: { items: [] }, timeline: null, hazards: null };
  const { prompt } = buildLetterPrompt(corner(), ctx);
  assert.match(prompt, /No press coverage was found for this corner\. Do not cite or invent any news reporting\./);
  assert.doesNotMatch(prompt, /goes back at least/);
});
