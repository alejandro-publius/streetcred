// The press card's sentence, pinned to the exact words it prints.
//
// Two lanes write one card. The year strip counts what a dated search can find
// across a decade; the press list is what passed the relevance filter now.
// Rendered independently they contradicted each other inside a single card:
// "2 historical headlines" sitting directly above "Searched and nothing
// found." Both halves were true of their own lane and the pair was nonsense.
// One composer owns the sentence now, and it waits for both lanes.
//
// The composer lives inside the corner page's client script, which is a
// template literal in src/page.js and is not importable. So this file renders
// the real page, cuts the real composer out of the script the browser would
// receive, and runs that. Nothing here reimplements it. The seam I would have
// preferred is an exported pure function; the feature freeze forbids adding
// one, so the extraction is the seam and it is checked: if the composer is
// renamed or moved, the cut fails loudly rather than silently testing nothing.
//
// The copy strings below are copied verbatim out of src/page.js and out of
// src/pressenrich.js. They are deliberately not read back out of the source at
// runtime: a test that recomputes the sentence from the code it is testing
// agrees with any edit, including the edit that puts the contradiction back.
import test from "node:test";
import assert from "node:assert/strict";
import { PAGE } from "../src/page.js";
import { CORNERS } from "../src/data.js";
import { TIERS } from "../src/city.js";
import { enrichPress } from "../src/pressenrich.js";
import { classify, streetTokens, DENY } from "../src/newsfilter.js";

// ------------------------------------------------------------ the extraction

const PAGE_HTML = PAGE(CORNERS["16th-mission"], { origin: "https://example.test", tier: TIERS.AUDITED });

const scriptWith = (html, needle) => {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const hit = blocks.find((b) => b.includes(needle));
  assert.ok(hit, `no inline script contains ${needle}`);
  return hit;
};

// From `let PRESS_LANES` to the closing brace of composePress, by counting
// braces. Naive counting is safe here only because the composer's own strings
// and comments carry no braces, so the cut is asserted to parse before it is
// used.
const cutComposer = (src) => {
  const start = src.indexOf("let PRESS_LANES");
  const fnAt = src.indexOf("function composePress()");
  assert.ok(start >= 0 && fnAt > start, "the composer is not where this test expects it");
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf("{", fnAt); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > 0, "composePress has no closing brace");
  return src.slice(start, end);
};

const COMPOSER_SRC = cutComposer(scriptWith(PAGE_HTML, "function composePress()"));

// A fresh composer per test, with a DOM small enough to read. PRESS_LANES is
// module state on the page and is reset on a corner swap, so each test gets
// its own instance rather than sharing one.
function composer() {
  const nodes = new Map();
  const make = () => ({
    innerHTML: "", textContent: "", className: "", kids: [],
    appendChild(c) { this.kids.push(c); return c; },
    classList: { add() {}, remove() {} },
  });
  const el = (id) => {
    if (!nodes.has(id)) nodes.set(id, make());
    return nodes.get(id);
  };
  const doc = { createElement: () => make() };
  const api = new Function(
    "el", "document",
    `${COMPOSER_SRC}\nreturn { pressLane: pressLane, composePress: composePress, lanes: function(){ return PRESS_LANES; } };`,
  )(el, doc);
  return { ...api, el, news: () => el("news"), tlnote: () => el("tlnote") };
}

// ------------------------------------------------------------ the exact copy
// Verbatim from src/page.js. Edit one of these only when the copy is meant to
// change, and read the comment above before deciding that it is.

const NOTHING_FOUND_HEAD = "Searched and nothing found.";
const NOT_LOOKED = "Press coverage has not been searched at this corner yet.";
const NO_COVERAGE = '<div class="m">No coverage found.</div>';
const LANE_NOTE =
  "Press checked in a batch run against the city's coverage. This corner keeps its tier: " +
  "the visual audit has not run here, and being press checked does not make a corner audited.";
// From src/pressenrich.js, the two headings that carry the corner-level versus
// corridor-level distinction.
const HEAD_CORNER = "Press coverage";
const HEAD_CORRIDOR = "Coverage of this corridor";

const CHECKED = (over) => ({ lane: "press-checked", found: 25, cost: { searches: 5 }, ...over });

test("the composer says nothing until both lanes have answered", () => {
  const c = composer();
  c.pressLane("news", CHECKED());
  assert.equal(c.news().innerHTML, "", "a claim about what was not found was made before the strip reported");
  c.pressLane("timeline", { years: [], totalHeadlines: 0 });
  assert.ok(c.news().innerHTML.includes(NOTHING_FOUND_HEAD), "and then it does answer");
});

// Branch 1. This is the contradiction the fix was for.
test("historical hits with nothing current reports the history and never says nothing was found", () => {
  const c = composer();
  // The strip writes its own note before the composer runs. That note is the
  // half of the contradiction that used to survive.
  c.tlnote().textContent = "First coverage we can find dates to 2018. 2 headlines since.";
  c.pressLane("news", CHECKED({ found: 25 }));
  c.pressLane("timeline", { totalHeadlines: 2, firstReportedYear: 2018, years: [{ year: 2018, count: 2 }] });
  assert.equal(
    c.news().innerHTML,
    '<p class="empty">2 historical headlines found (earliest 2018); ' +
      'no current safety coverage passed the relevance filter (0 of 25 read).</p>',
  );
  const html = c.news().innerHTML;
  assert.ok(!html.includes(NOTHING_FOUND_HEAD), "the card claims a history and no history in one breath");
  assert.ok(!html.includes("No coverage found"), "the card claims a history and no coverage in one breath");
  // The strip used to say the same thing again, in words that read as a
  // finding rather than as the other half of this sentence.
  assert.equal(c.tlnote().textContent, "", "the strip's note was left to repeat the composer");
});

test("one historical headline is singular, and the year is the earliest one", () => {
  const c = composer();
  c.pressLane("news", CHECKED({ found: 8 }));
  c.pressLane("timeline", { totalHeadlines: 1, firstReportedYear: 2021 });
  assert.equal(
    c.news().innerHTML,
    '<p class="empty">1 historical headline found (earliest 2021); ' +
      'no current safety coverage passed the relevance filter (0 of 8 read).</p>',
  );
});

// Branch 2. Searched and empty is a result, and it has to be distinguishable
// from never having looked.
test("both lanes empty says it searched, with the count that backs the claim", () => {
  const c = composer();
  c.pressLane("news", CHECKED({ found: 25, cost: { searches: 5 } }));
  c.pressLane("timeline", { totalHeadlines: 0, years: [] });
  assert.equal(
    c.news().innerHTML,
    '<p class="empty">Searched and nothing found. 25 articles were read across 5 searches ' +
      'and none was about safety at this crossing.</p>',
  );
});

test("searched and empty is not the same sentence as not yet looked", () => {
  const c = composer();
  c.pressLane("news", CHECKED());
  c.pressLane("timeline", null);
  const searched = c.news().innerHTML;
  assert.ok(searched.includes(NOTHING_FOUND_HEAD));
  assert.ok(!searched.includes(NOT_LOOKED), "the searched state borrowed the not-looked words");
  assert.ok(!searched.includes("has not been searched"));
  // The other sentence exists, on the lane's own not-yet-checked path, and it
  // is the one that carries the words "not been searched".
  assert.ok(PAGE_HTML.includes(NOT_LOOKED), "the not-yet-checked copy is gone from the page");
  assert.notEqual(NOT_LOOKED, NOTHING_FOUND_HEAD);
});

test("a corner with no press-checked lane gets the neutral line, not a search it never ran", () => {
  const c = composer();
  c.pressLane("news", null);
  c.pressLane("timeline", null);
  assert.equal(c.news().innerHTML, NO_COVERAGE);
  assert.ok(!c.news().innerHTML.includes(NOTHING_FOUND_HEAD), "claimed a search that never happened");
  assert.equal(c.news().kids.length, 0, "the batch-run note was appended to a corner no batch ran on");
});

test("one article read is singular", () => {
  const c = composer();
  c.pressLane("news", CHECKED({ found: 1, cost: { searches: 1 } }));
  c.pressLane("timeline", { totalHeadlines: 0 });
  assert.equal(
    c.news().innerHTML,
    '<p class="empty">Searched and nothing found. 1 article was read across 1 searches ' +
      'and none was about safety at this crossing.</p>',
  );
});

test("the press-checked note travels with both empty states and never claims an audit", () => {
  for (const timeline of [{ totalHeadlines: 0 }, { totalHeadlines: 3, firstReportedYear: 2016 }]) {
    const c = composer();
    c.pressLane("news", CHECKED());
    c.pressLane("timeline", timeline);
    assert.equal(c.news().kids.length, 1);
    assert.equal(c.news().kids[0].className, "lanenote");
    assert.equal(c.news().kids[0].textContent, LANE_NOTE);
    assert.ok(!c.news().innerHTML.includes("audited"), "the empty sentence borrowed the word audited");
    assert.ok(c.news().kids[0].textContent.includes("does not make a corner audited"));
  }
});

// Branch 3, first half. Cited results are their own answer, and the composer
// must not write over them.
test("cited results are left alone by the composer", () => {
  const c = composer();
  c.pressLane("news", {
    lane: "press-checked", found: 12, precise: true, heading: HEAD_CORNER,
    items: [{ title: "Pedestrian killed at 16th and Mission", url: "https://missionlocal.org/a", domain: "missionlocal.org" }],
    cost: { searches: 5 },
  });
  c.tlnote().textContent = "First coverage we can find dates to 2018. 2 headlines since.";
  c.pressLane("timeline", { totalHeadlines: 2, firstReportedYear: 2018 });
  assert.equal(c.news().innerHTML, "", "the composer overwrote a list of citations with an empty state");
  assert.equal(
    c.tlnote().textContent,
    "First coverage we can find dates to 2018. 2 headlines since.",
    "the strip's note was blanked on a card that has citations to sit above",
  );
});

test("the card counts its citations against what was found", () => {
  // The lane's own line, pinned because it is the sentence that has to agree
  // with the list underneath it.
  assert.ok(
    PAGE_HTML.includes('kept + " cited from " + d.found + " found"'),
    "the cited-from count no longer reads the kept list and the found total from the same payload",
  );
});

// ------------------------------------------------------------ the lane itself
// enrichPress is imported and run for real against a fake Exa and a fake KV.
// No network, no key, no spend.

const CORNER = { slug: "eddy-and-mason", name: "Eddy and Mason", city: "San Francisco" };

const cornerLevel = (i) => ({
  title: `Pedestrian struck at Eddy and Mason, ${i}`,
  url: `https://sfchronicle.com/corner-${i}`,
  publishedDate: `2026-0${i}-01`,
  text: "A collision at the Eddy and Mason crossing injured a pedestrian.",
});

const corridorLevel = (i) => ({
  title: `Mason Street repaving continues, ${i}`,
  url: `https://sfstandard.com/corridor-${i}`,
  publishedDate: `2026-0${i}-02`,
  text: "Crews continue work along Mason Street this month.",
});

// Every search returns the same slate, which is what the pool dedupes to. Text
// is supplied on the search results so the contents call is never needed and
// the classifier sees exactly the text this test wrote.
const harness = (results) => {
  const kv = new Map();
  const calls = [];
  const env = {
    EXA_API_KEY: "not-a-real-key",
    STORE: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => void kv.set(k, v),
    },
  };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    return { ok: true, status: 200, json: async () => ({ results, costDollars: { total: 0.007 } }) };
  };
  return { env, calls };
};

test("three corner-level results is the threshold: the card claims the corner", async () => {
  const results = [cornerLevel(1), cornerLevel(2), cornerLevel(3), corridorLevel(4)];
  const tight = classify(results, streetTokens(CORNER)).filter((s) => s.corner);
  assert.equal(tight.length, 3, "the fixture is not the threshold this test means to sit on");
  const { env } = harness(results);
  const rec = await enrichPress(env, CORNER);
  assert.equal(rec.precise, true);
  assert.equal(rec.heading, HEAD_CORNER);
  assert.equal(rec.items.length, 3, "only the corner-level results are published once the bar is met");
  assert.ok(rec.items.every((i) => i.corner === true));
});

test("two corner-level results is one under it: the card drops to the corridor", async () => {
  const results = [cornerLevel(1), cornerLevel(2), corridorLevel(3)];
  const tight = classify(results, streetTokens(CORNER)).filter((s) => s.corner);
  assert.equal(tight.length, 2, "the fixture is not one under the threshold");
  const { env } = harness(results);
  const rec = await enrichPress(env, CORNER);
  assert.equal(rec.precise, false, "two results were allowed to claim corner-level precision");
  assert.equal(rec.heading, HEAD_CORRIDOR);
  assert.ok(rec.items.some((i) => i.corner === false), "the corridor item is what the looser heading is for");
  assert.equal(rec.items.length, 3);
});

test("exactly one result is published as corridor coverage, and counted once", async () => {
  const { env } = harness([cornerLevel(1)]);
  const rec = await enrichPress(env, CORNER);
  assert.equal(rec.found, 1, "five searches returning the same url is one article, not five");
  assert.equal(rec.items.length, 1);
  assert.equal(rec.precise, false, "one result cannot carry the corner-level claim");
  assert.equal(rec.heading, HEAD_CORRIDOR);
  assert.equal(rec.source, "live");
  assert.equal(rec.lane, "press-checked");
});

test("the citation count never exceeds what was read", async () => {
  const results = [cornerLevel(1), cornerLevel(2), cornerLevel(3), corridorLevel(4)];
  const { env } = harness(results);
  const rec = await enrichPress(env, CORNER);
  assert.ok(rec.items.length <= rec.afterFilters, "more cited than survived the filter");
  assert.ok(rec.afterFilters <= rec.shortlisted, "more filtered than shortlisted");
  assert.ok(rec.shortlisted <= rec.found, "more shortlisted than found");
  const titles = new Set(results.map((r) => r.title));
  for (const i of rec.items) assert.ok(titles.has(i.title), `invented headline: ${i.title}`);
});

// Branch 5. The deny list and the lead-generation exclusion.
test("a denied domain is never surfaced, however well it names the corner", async () => {
  const lead = {
    title: "Injured at Eddy and Mason? Free consultation",
    url: "https://sfaccidentlawyer.com/eddy-mason",
    publishedDate: "2026-05-01",
    text: "Our attorneys handle pedestrian collisions at Eddy and Mason.",
  };
  const social = {
    title: "Pedestrian hit at Eddy and Mason",
    url: "https://facebook.com/groups/sf/posts/1",
    publishedDate: "2026-05-02",
    text: "Somebody was hit at Eddy and Mason last night.",
  };
  assert.ok(DENY.test(lead.url), "the fixture is not actually on the deny list");
  const { env } = harness([lead, social, cornerLevel(1)]);
  const rec = await enrichPress(env, CORNER);
  const urls = (rec.items || []).map((i) => i.url);
  assert.ok(!urls.some((u) => /lawyer|facebook/.test(u)), `a denied domain was cited: ${urls.join(", ")}`);
  assert.deepEqual(urls, [cornerLevel(1).url]);
  // And it is not counted as read either: the deny happens before the pool.
  assert.equal(rec.found, 1, "denied results were counted into the found total the copy quotes");
});

test("nothing on topic is stored as searched and empty, with the counts the copy needs", async () => {
  const { env } = harness([
    { title: "Warriors win in overtime", url: "https://espn.com/x", publishedDate: "2026-01-01", text: "Basketball." },
  ]);
  const rec = await enrichPress(env, CORNER);
  assert.equal(rec.source, "empty");
  assert.equal(rec.precise, false);
  assert.equal(rec.heading, HEAD_CORNER, "the empty card keeps the plain heading");
  assert.equal(rec.items, undefined);
  assert.ok(rec.cost.searches > 0, "the copy says it searched, so it has to have searched");
  // These are the two numbers the empty sentence quotes. Without them the
  // composer prints "0 articles were read across 0 searches", which is the
  // not-looked claim wearing the searched sentence.
  assert.equal(typeof rec.found, "number");
  assert.equal(typeof rec.cost.searches, "number");
});

test("the lane's empty record drives the composer's empty sentence end to end", async () => {
  const { env } = harness([
    { title: "Warriors win in overtime", url: "https://espn.com/x", publishedDate: "2026-01-01", text: "Basketball." },
  ]);
  const rec = await enrichPress(env, CORNER);
  const c = composer();
  c.pressLane("news", rec);
  c.pressLane("timeline", { totalHeadlines: 0, years: [] });
  assert.equal(
    c.news().innerHTML,
    '<p class="empty">Searched and nothing found. ' + rec.found +
      (rec.found === 1 ? " article was" : " articles were") + " read across " + rec.cost.searches +
      " searches and none was about safety at this crossing.</p>",
  );
  assert.ok(!c.news().innerHTML.includes("historical headline"), "a history was claimed by a lane that found none");
});
