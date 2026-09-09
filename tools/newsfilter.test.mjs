// classify() in src/newsfilter.js is the one gate both press callers share:
// getNews() in src/index.js runs it directly on raw Exa output, and
// enrichPress() in src/pressenrich.js runs it after its own pool has already
// dropped anything with an empty url. Only the second caller was actually
// protected: classify()'s own filter required a title and checked the deny
// list against the url, but never required the url itself to be non-empty.
//
// A raw Exa result with a title and no url passed straight through, with
// domainOf("") returning "" rather than throwing, and downstream every caller
// of classify() turns "corroborates" on a survivor into a public claim: the
// Cred Check's press lane, the letter verifier's citedPressCount, and the
// citation line on the corner page. `node tools/newsfilter.test.mjs`.

import test from "node:test";
import assert from "node:assert/strict";
import { classify, streetTokens } from "../src/newsfilter.js";

const CORNER = { name: "16th and Mission", city: "San Francisco" };
const TOKENS = streetTokens(CORNER);

test("a result with a title and no url is dropped, not just unofficial", () => {
  const results = [
    {
      title: "Pedestrian struck in crash at 16th Street crossing, SFPD says",
      url: "",
      text: "A pedestrian was struck and injured near the 16th street crossing, police said.",
    },
  ];
  const scored = classify(results, TOKENS);
  assert.equal(scored.length, 0, "a title-only result with no url is not a citation and must not survive");
});

test("a result with url: undefined is dropped the same way", () => {
  const results = [{ title: "Crash reported near 16th and Mission", text: "A collision occurred." }];
  assert.equal(classify(results, TOKENS).length, 0);
});

test("a result carrying a real url still survives", () => {
  const results = [
    {
      title: "Pedestrian struck in crash at 16th Street crossing, SFPD says",
      url: "https://missionlocal.org/2026/05/16th-mission-crash",
      text: "A pedestrian was struck and injured near the 16th street crossing, police said.",
    },
  ];
  const scored = classify(results, TOKENS);
  assert.equal(scored.length, 1, "a result with a real url must not be caught by the same fix");
  assert.equal(scored[0].raw.url, "https://missionlocal.org/2026/05/16th-mission-crash");
});
