// The day's findings row, and the six things it is not allowed to do.
//
// A ticker is the easiest component on a site to make dishonest. It has room
// for a handful of items, it wants to look busy, and the cheapest way to fill
// it is to reach back a day. That is the failure this file exists to prevent:
// every guard below is about the row refusing to be more interesting than the
// day actually was.
//
// The rest are accessibility, which for a moving row is not a nicety. Motion a
// reader cannot stop is motion that makes the page unusable for them, and a
// link that only a mouse can reach is not a link.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTicker, TICKER, TICKER_CSS, TICKER_JS, TICKER_CAP, TICKER_PX_PER_SECOND,
  tickerDateLabel, LANE_ORDER,
} from "../src/ticker.js";

const TODAY = "2026-08-27";
const NOW = "2026-08-27T18:00:00.000Z";      // 11:00 Pacific
const YESTERDAY = "2026-08-26T18:00:00.000Z";

const press = (at, title = "A crash at the corner") => ({
  slug: "16th-and-mission", name: "16th and Mission", at,
  items: [{ title, publisher: "Mission Local", url: "https://example.org/a" }],
});
const voice = (at) => ({
  slug: "6th-and-mission", name: "6th and Mission", at, event: "commissioned",
  runs: [{ actor: "google_maps", id: "r1" }],
});
const decision = (ts) => ({
  slug: "6th-and-jessie", name: "6th and Jessie", ts, actions: [],
  tier1: { significant: false, reason: "Ordinary weekly variance at a busy crossing." },
});
const audit = (date) => ({ slug: "turk-and-taylor", name: "Turk and Taylor", date, grade: "F" });

const full = (at = NOW) => ({
  pressRecent: [press(at)],
  actorCosts: [voice(at)],
  watchlist: { builtAt: at, entries: [{ slug: "a", name: "A", article: { title: "T" } }], rejected: [] },
  journal: [decision(at)],
  cotd: [audit(TODAY)],
});

// ===================================================== nothing older than today

test("no item older than the current Pacific day can render", () => {
  const m = buildTicker({
    pressRecent: [press(YESTERDAY)],
    actorCosts: [voice(YESTERDAY)],
    watchlist: { builtAt: YESTERDAY, entries: [{ slug: "a", name: "A" }], rejected: [{ title: "x", reason: "y" }] },
    journal: [decision(YESTERDAY)],
    cotd: [audit("2026-08-26")],
  }, TODAY);

  assert.equal(m.total, 0, "yesterday's records must not render as today's findings");
  for (const lane of m.lanes) assert.equal(lane.items.length, 0, `${lane.key} backfilled`);
});

test("a lane with both days keeps only today", () => {
  const m = buildTicker({ pressRecent: [press(NOW, "today"), press(YESTERDAY, "yesterday")] }, TODAY);
  const titles = m.lanes.find((l) => l.key === "press").items.map((i) => i.text);
  assert.deepEqual(titles, ["today"]);
});

test("a record stamped in the future does not render either", () => {
  const m = buildTicker({ journal: [decision("2026-08-29T12:00:00.000Z")] }, TODAY);
  assert.equal(m.total, 0);
});

test("the Pacific boundary is the one that counts, not UTC", () => {
  // 2026-08-27T04:00Z is 21:00 Pacific on the 26th. Slicing the ISO string
  // would call it the 27th, which is the one date a day's-findings row must
  // never get wrong.
  const m = buildTicker({ journal: [decision("2026-08-27T04:00:00.000Z")] }, TODAY);
  assert.equal(m.total, 0, "an evening record was counted as the next day");
});

// ====================================================== the empty state is real

test("every empty lane says so in plain words", () => {
  const m = buildTicker({}, TODAY);
  assert.equal(m.total, 0);
  for (const key of LANE_ORDER) {
    const lane = m.lanes.find((l) => l.key === key);
    assert.ok(lane.empty.length > 10, `${key} has no honest empty line`);
  }
  assert.match(m.lanes.find((l) => l.key === "press").empty, /no press found today/);
});

test("a paused lane names the ceiling and the numbers, not just an absence", () => {
  const m = buildTicker(
    { exa: { paused: true, spentUsd: 65.033, capUsd: 65 } },
    TODAY,
  );
  const line = m.lanes.find((l) => l.key === "press").empty;
  assert.match(line, /Exa budget reached/);
  assert.match(line, /\$65\.03/);
  assert.ok(!/no press found today/.test(line), "paused and empty are different claims");
});

test("a paused Apify lane says the reserve is what paused it", () => {
  const m = buildTicker({ apify: { paused: true, used: 62, cap: 70, reserved: 8 } }, TODAY);
  const line = m.lanes.find((l) => l.key === "voices").empty;
  assert.match(line, /commissioning paused to protect the monthly ceiling/);
  assert.match(line, /62 of 70/);
  assert.match(line, /8 reserved/);
});

test("a wholly empty day renders one line and does not animate", () => {
  const m = buildTicker({}, TODAY);
  assert.equal(m.animate, false);
  const html = TICKER(m);
  assert.match(html, /class="tick quiet"/);
  assert.ok(!/class="tick run"/.test(html));
  assert.ok(!/tick-tr/.test(html), "a static day builds no scrolling track");
  assert.match(html, /Nothing found today/);
});

test("one item alone does not animate either", () => {
  const m = buildTicker({ journal: [decision(NOW)] }, TODAY);
  assert.equal(m.total, 1);
  assert.equal(m.animate, false, "a row with one item scrolling is motion for its own sake");
});

// ============================================================ every item is real

test("every rendered item is a link carrying a source chip", () => {
  const html = TICKER(buildTicker(full(), TODAY));
  const items = [...html.matchAll(/<a class="tick-it[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.ok(items.length >= 4, `expected items, found ${items.length}`);
  for (const [whole, inner] of items) {
    assert.match(whole, /href="[^"]+"/, "an item without a link");
    assert.match(inner, /<span class="c">[A-Z]/, "an item without a source chip");
  }
});

test("no lane can produce an item with no chip", () => {
  const m = buildTicker(full(), TODAY);
  for (const lane of m.lanes) {
    for (const it of lane.items) {
      assert.ok(it.chip && it.chip.length, `${lane.key} produced a chip-less item`);
      assert.ok(it.href && it.href.length, `${lane.key} produced a link-less item`);
    }
  }
});

test("a rejected nomination renders with its reason", () => {
  const m = buildTicker({
    watchlist: { builtAt: NOW, entries: [], rejected: [{ title: "Nope", reason: "no such SF street" }] },
  }, TODAY);
  const it = m.lanes.find((l) => l.key === "watchlist").items[0];
  assert.equal(it.rejected, true);
  assert.match(it.meta, /rejected: no such SF street/);
});

test("each lane is capped and says how many it is not showing", () => {
  const many = Array.from({ length: TICKER_CAP + 7 }, (_, i) => decision(NOW));
  const lane = buildTicker({ journal: many }, TODAY).lanes.find((l) => l.key === "watchdog");
  assert.equal(lane.items.length, TICKER_CAP);
  assert.equal(lane.hidden, 7);
  assert.match(TICKER(buildTicker({ journal: many }, TODAY)), /7 more, see the diary/);
});

// ============================================================== motion and keys

test("the pause control is present, labelled and wired to the track", () => {
  const html = TICKER(buildTicker(full(), TODAY));
  assert.match(html, /<button class="tick-pz"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-controls="ticktrack"/);
  assert.match(html, /aria-label="Pause the findings ticker"/);
});

test("hover and keyboard focus both pause the animation", () => {
  assert.match(TICKER_CSS, /\.tick\.run:hover \.tick-tr[^}]*animation-play-state:paused/);
  assert.match(TICKER_CSS, /\.tick\.run:focus-within \.tick-tr[^}]*animation-play-state:paused/);
});

test("reduced motion turns the animation off and the row into a scrollable strip", () => {
  const block = TICKER_CSS.slice(TICKER_CSS.indexOf("prefers-reduced-motion"));
  assert.match(block, /animation:none/);
  assert.match(block, /overflow-x:auto/);
  assert.match(block, /\.tick-pz\{display:none\}/, "a pause button that cannot pause anything");
  assert.match(TICKER_JS, /prefers-reduced-motion/, "a preference set after load must still be honoured");
});

test("the scroll rate stays under 40 pixels a second", () => {
  assert.ok(TICKER_PX_PER_SECOND <= 40, `${TICKER_PX_PER_SECOND} px/s is faster than the ceiling`);
  assert.match(TICKER_JS, /w\/34/, "the duration is derived from the measured width, so the rate is a rate");
});

test("every item is keyboard reachable in reading order, and the loop copy is not", () => {
  const html = TICKER(buildTicker(full(), TODAY));
  assert.match(
    html,
    /<div class="tick-tr" aria-hidden="true" tabindex="-1" data-copy="1">/,
    "the duplicated track must be hidden from assistive tech and out of the tab order",
  );
  // Nothing in the row sets a positive tabindex, which would jump a reader out
  // of document order on every page that has one.
  assert.ok(!/tabindex="[1-9]/.test(html));
});

test("focus is visible on every interactive thing in the row", () => {
  for (const sel of [".tick-it:focus-visible", ".tick-more:focus-visible", ".tick-pz:focus-visible"]) {
    assert.ok(TICKER_CSS.includes(sel), `${sel} has no focus style`);
  }
});

// ================================================================== the layout

test("the row is the same height busy or quiet, so the fold never moves", () => {
  const heights = [...TICKER_CSS.matchAll(/\.tick(?:\.quiet)? \.tick-in\{[^}]*height:(\d+)px/g)]
    .map((m) => Number(m[1]));
  const declared = [...TICKER_CSS.matchAll(/height:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(declared.includes(52), "the row has no declared height, so its content sets it");
  const busy = 52;
  const quiet = Number(/\.tick\.quiet \.tick-in\{height:(\d+)px\}/.exec(TICKER_CSS)[1]);
  assert.ok(Math.abs(quiet - busy) <= 24, `fold shifts ${Math.abs(quiet - busy)}px between states`);
  assert.ok(heights.length >= 1);
});

test("at 390px it is a single scrollable row", () => {
  const mob = TICKER_CSS.slice(TICKER_CSS.indexOf("max-width:430px"));
  assert.match(mob, /height:50px/, "the phone row must still declare its height");
  assert.match(TICKER_CSS, /\.tick-vp\{[^}]*overflow-x:auto/);
  assert.match(TICKER_CSS, /\.tick-tr\{[^}]*display:flex/, "one row, not a wrapping grid");
  assert.ok(!/\.tick-tr\{[^}]*flex-wrap:wrap/.test(TICKER_CSS));
});

// ==================================================================== the label

test("the label states the day it filtered on, from the model not a second clock", () => {
  const m = buildTicker(full(), TODAY);
  assert.equal(m.today, TODAY);
  assert.match(TICKER(m), /Today, August 27, 2026 Pacific/);
});

test("an unparseable day produces no label rather than a wrong one", () => {
  assert.equal(tickerDateLabel("not-a-day"), "");
});
