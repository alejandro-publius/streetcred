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
  date: "2026-08-18", dateKind: "audited", provenance: AUDITED, letter: true, fix: true, press: "found", voices: "found", ...over,
});
const render = (data) => AUDITED_PAGE(data, "https://x.test", false, 7355);
// The lane cells only. Assertions over the whole document catch BASE_CSS, which
// carries these words in a comment.
const cells = (h) => [...h.matchAll(/class="lcell (?:on|off|none)">([^<]*)</g)].map((m) => m[1]);
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

test("a lane shows the state its record holds, all three ways", () => {
  const found = render({ full: [r({ letter: true, press: "found", voices: "found" })], promoted: [] });
  assert.match(found, /Letter served/);
  assert.match(found, /Press found/);
  assert.match(found, /Voices found/);

  const none = render({ full: [r({ letter: false, press: "none", voices: "none" })], promoted: [] });
  assert.match(none, /Letter pending/);
  assert.match(none, /Press none found/);
  assert.match(none, /Voices none found/);

  // The distinction the third state exists for. Most audited corners have no
  // stored press record at all, and /api/news answers those with a live search
  // at read time, so the corner page shows items the store does not hold.
  // Calling that "none found" would claim an outcome for a search nobody ran.
  const unchecked = render({ full: [r({ press: "unchecked", voices: "unchecked" })], promoted: [] });
  assert.match(unchecked, /Press not checked/);
  assert.match(unchecked, /Voices not checked/);
  // Scoped to the cells. BASE_CSS carries a comment containing the words
  // "none found", so asserting over the whole document tests the stylesheet.
  assert.deepEqual(
    cells(unchecked).filter((c) => /none found/.test(c)),
    [],
    "not checked is not a result",
  );

  // The cell is always rendered, whichever state it is in.
  for (const h of [found, none, unchecked]) {
    assert.equal((h.match(/class="lcell (?:on|off|none)"/g) || []).length, 4, "four cells in every state");
  }
});

test("an unknown or missing lane state falls back to not checked", () => {
  // Never to a result. A shape this page has not seen must not be reported as
  // a search that ran.
  const weird = render({ full: [r({ press: undefined, voices: "banana" })], promoted: [] });
  assert.match(weird, /Press not checked/);
  assert.match(weird, /Voices not checked/);
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

test("the date label says which fact it is showing", () => {
  const audited = render({ full: [r({ date: "2026-08-18", dateKind: "audited" })], promoted: [] });
  assert.match(audited, /<span class="adk">audited<\/span>2026-08-18/);

  // cotd:log only reaches back three mornings. Without a fallback, 22 of 23
  // rows would carry no date and the sort would be alphabetical wearing a
  // chronological caption. The fallback is the imagery generation time, which
  // is a different fact and carries a different word.
  const generated = render({ full: [r({ date: "2026-08-17", dateKind: "generated" })], promoted: [] });
  assert.match(generated, /<span class="adk">imagery<\/span>2026-08-17/);
  assert.doesNotMatch(generated, /<span class="adk">audited<\/span>/, "a generation time is not an audit date");
});

test("rows sort most recent first and undated rows sort last", async () => {
  // The sort itself lives in auditedIndex; this pins the contract the page
  // depends on, which is that the array arrives ordered and is rendered in
  // order rather than re-sorted here.
  const h = render({
    full: [r({ slug: "newest", name: "Newest", date: "2026-08-21" }),
           r({ slug: "older", name: "Older", date: "2026-08-17" }),
           r({ slug: "undated", name: "Undated", date: null })],
    promoted: [],
  });
  const order = [...h.matchAll(/class="aname" href="\/c\/([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["newest", "older", "undated"], "the page renders the order it is given");
});
