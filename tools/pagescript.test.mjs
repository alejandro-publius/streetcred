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

// Structural guard for a bug that was invisible in review and obvious in a
// browser: the chip lived inside the h1 whose only child was a block element,
// so the two boxes overlapped and every corner read "Market StreetAUDITED".
// The chip is a sibling of the name now, and the flex gap owns the spacing.
// Box metrics live outside CI (they need a real engine); this pins the shape.
test("the tier chip is a sibling of the name, never inside the h1", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  const h1 = html.match(/<h1 class="cname">([\s\S]*?)<\/h1>/);
  assert.ok(h1, "the corner name should still be an h1");
  assert.ok(!h1[1].includes("tierchip"), "the chip must not be inside the h1");
  assert.match(html, /<div class="ctitle">/, "name and chip need a flex row to share");
  assert.match(html, /<div class="cmeta">/, "the district line needs its own element to be spaced");
});

// The header is two rows on purpose: one row cannot keep a 24px clear gap
// between the title block and the nearest control at the longest warmed corner
// name, measured at every width from 360 to 1600.
test("the header separates its controls from the title block", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  assert.match(html, /<div class="hctl">/, "controls need their own row");
  const header = html.match(/<header>([\s\S]*?)<\/header>/);
  assert.ok(header, "header present");
  assert.ok(header[1].indexOf('class="hctl"') < header[1].indexOf('class="corner"'), "controls come first");
});

// Every other row in the Powered by strip names its tool in bold.
test("the powered by strip names Exa and Apify", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  for (const name of ["Gemini", "Exa", "Apify", "Google Maps", "Cloudflare", "DataSF"]) {
    assert.match(html, new RegExp(`<b>${name}</b>`), `${name} label missing`);
  }
});
