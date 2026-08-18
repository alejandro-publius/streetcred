// The page's own JavaScript, parsed.
//
// Every line of the corner page's client script lives inside a template
// literal in src/page.js, which means `node --check src/page.js` validates the
// literal and says nothing at all about the script inside it. A backslash
// escape written into that literal is eaten before the browser ever sees it,
// and the result is a syntax error that kills the entire script: no verdict,
// no lanes, no letter, on every corner at once. That has shipped twice.
//
// So this renders the real page and parses what the browser would actually
// receive. new Function is the parser: it compiles the source and throws on a
// syntax error without running a line of it.

import test from "node:test";
import assert from "node:assert/strict";
import { PAGE, NOT_FOUND } from "../src/page.js";
import { HOME } from "../src/home.js";
import { CORNERS } from "../src/data.js";
import { TIERS } from "../src/city.js";

const scripts = (html) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

const parses = (html, label) => {
  const blocks = scripts(html);
  assert.ok(blocks.length > 0, `${label}: no inline script found, the extractor is broken`);
  blocks.forEach((src, i) => {
    try {
      new Function(src);
    } catch (e) {
      assert.fail(`${label}: inline script ${i} does not parse: ${e.message}`);
    }
  });
};

const audited = CORNERS["16th-mission"];

// A corner that exists only in a city shard, in the shape src/city.js builds.
const scored = {
  slug: "34th-and-balboa",
  name: "34th and Balboa",
  short: "34th & Balboa",
  city: "San Francisco",
  lat: 37.775,
  lon: -122.494,
  heading: 0,
  pitch: 0,
  radiusMeters: 150,
  district: 1,
  generated: true,
  fix: { name: "Continental crosswalks", cost: "$250,000", grant: "HSIP" },
};

test("corner page script parses, audited corner", () => {
  parses(PAGE(audited, { origin: "https://example.test", tier: TIERS.AUDITED }), "audited");
});

test("corner page script parses, scored corner", () => {
  parses(PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED }), "scored");
});

// A corner with an apostrophe in its name is the exact shape of the bug this
// file exists to catch: the name is interpolated into the script as a JSON
// string, and any escaping mistake there is a syntax error citywide.
test("corner page script parses with an apostrophe in the name", () => {
  parses(
    PAGE({ ...scored, slug: "geary-and-o-farrell", name: "Geary and O'Farrell", short: "Geary & O'Farrell" },
      { origin: "https://example.test", tier: TIERS.SCORED }),
    "apostrophe",
  );
});

test("homepage script parses", () => {
  parses(HOME([], "https://example.test", [], null, false), "home empty");
});

test("not found page renders", () => {
  const html = NOT_FOUND("nowhere-and-nothing", "https://example.test");
  assert.ok(html.includes("nowhere-and-nothing"));
});

// The tier chip is the one piece of the shell that names the vocabulary, so a
// rename that misses the page would show a corner tagged with nothing.
test("the tier chip renders its label", () => {
  for (const tier of Object.values(TIERS)) {
    const html = PAGE(scored, { origin: "https://example.test", tier });
    assert.match(html, new RegExp(`tierchip t-${tier}`), `${tier} chip missing`);
  }
});
