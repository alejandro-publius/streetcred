// The audited index, offline.
//
// The page's whole job is to keep two claims apart. A fully audited corner had
// every evidence lane run on it. A promoted corner was pulled out of the
// enriched pool, given a proposed-fix render, and nothing else. Presenting them
// as one list of equals is exactly the confusion the provenance field was added
// to prevent, so a corner appears in one section or the other and never both.
//
//   node --test tools/audited_index.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { AUDITED_PAGE } from "../src/auditedpage.js";
import { PROMOTED_FROM_ENRICHED, AUDITED } from "../src/imagery.js";

const r = (over = {}) => ({
  slug: "16th-mission", name: "16th Street and Mission Street", grade: "F", index: 99,
  date: "2026-08-18", provenance: AUDITED, letter: true, fix: true, press: true, voices: true, ...over,
});
const render = (data) => AUDITED_PAGE(data, "https://x.test", false, 7355);
const counts = (h) => [...h.matchAll(/class="acount">([^<]*)</g)].map((m) => m[1]);
const sectionOf = (h, which) => {
  const i = h.indexOf(which === "full" ? 'id="fullhead"' : 'id="promhead"');
  const j = which === "full" ? h.indexOf('id="promhead"') : h.length;
  return h.slice(i, j);
};

test("section counts render from the rows, not from a literal", () => {
  const h = render({ full: [r(), r({ slug: "a-and-b" })], promoted: [r({ slug: "c-and-d", provenance: PROMOTED_FROM_ENRICHED })] });
  assert.deepEqual(counts(h), ["2", "1"]);
  const h2 = render({ full: [r()], promoted: [] });
  assert.deepEqual(counts(h2), ["1", "0"]);
});

test("a corner appears in exactly one section", () => {
  const h = render({ full: [r()], promoted: [r({ slug: "c-and-d", provenance: PROMOTED_FROM_ENRICHED, name: "C and D" })] });
  assert.equal((h.match(/href="\/c\/16th-mission"/g) || []).length, 2, "thumb and name, one row");
  assert.ok(sectionOf(h, "full").includes("16th-mission"));
  assert.ok(!sectionOf(h, "promoted").includes("16th-mission"));
  assert.ok(sectionOf(h, "promoted").includes("c-and-d"));
});

test("the promoted section says plainly what was not done", () => {
  const h = render({ full: [], promoted: [r({ provenance: PROMOTED_FROM_ENRICHED })] });
  const sec = sectionOf(h, "promoted");
  assert.match(sec, /only lane that was run on them/);
  assert.match(sec, /no visual hazard audit/);
  assert.match(sec, /not counted in the audited coverage layer/);
  assert.match(sec, /because they carry a render, not/);
});

test("every row's thumbnail names that corner's stored frame", () => {
  const h = render({ full: [r(), r({ slug: "oak-and-octavia", name: "Oak and Octavia" })], promoted: [] });
  assert.match(h, /src="\/gen\/16th-mission\/today\.jpg"/);
  assert.match(h, /src="\/gen\/oak-and-octavia\/today\.jpg"/);
  // Never a render, never another corner's frame.
  assert.doesNotMatch(h, /src="\/gen\/[a-z0-9-]+\/(fix|hazards)\.jpg"/);
});

test("a lane shows the state its record holds, both ways", () => {
  const on = render({ full: [r({ letter: true, press: true, voices: true })], promoted: [] });
  assert.match(on, /Letter served/);
  assert.match(on, /Press found/);
  assert.match(on, /Voices kept/);

  const off = render({ full: [r({ letter: false, press: false, voices: false })], promoted: [] });
  assert.match(off, /Letter pending/);
  assert.match(off, /No press found/);
  assert.match(off, /No voices kept/);
  // An empty lane is a result, not an omission: the cell is still rendered.
  assert.equal((off.match(/class="lcell (on|off)"/g) || []).length, 4, "four cells either way");
});

test("a corner with no recorded date says so instead of inventing one", () => {
  const h = render({ full: [r({ date: null })], promoted: [] });
  assert.match(h, /date not recorded/);
  assert.doesNotMatch(h, /<time class="adate"/);
});

test("the page carries its own meta from live counts", () => {
  const h = render({ full: [r(), r({ slug: "a-and-b" })], promoted: [r({ slug: "c-and-d", provenance: PROMOTED_FROM_ENRICHED })] });
  assert.match(h, /<title>The audited corners · StreetCred<\/title>/);
  assert.match(h, /2 San Francisco intersections with every evidence lane checked/);
  assert.match(h, /1 promoted from the enriched pool/);
  assert.match(h, /property="og:title"/);
});

test("empty sections say what is missing rather than rendering a bare header", () => {
  const h = render({ full: [], promoted: [] });
  assert.match(h, /No corner has been fully audited yet\./);
  assert.match(h, /No corner has been promoted from the enriched pool yet\./);
  assert.doesNotMatch(h, /class="alist"/, "no empty list element");
});

test("the page is reachable from the nav and the footer", async () => {
  const { MASTHEAD, FOOTER } = await import("../src/page.js");
  assert.match(MASTHEAD({ scored: 7355, active: "audited" }), /href="\/audited"[^>]*class="on"/);
  assert.match(FOOTER(), /href="\/audited">Audited corners</);
});
