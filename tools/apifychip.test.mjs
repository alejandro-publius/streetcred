// The Apify provenance chip and the funnel links, pinned.
//
// The chip must name the actor that produced the quote and the date the
// record says it was scraped, and must render nothing when the stored record
// cannot support it. The funnel's cleared count must link to the corners that
// actually carry a cleared account, from the stored summary, never a literal.

import test from "node:test";
import assert from "node:assert/strict";
import { HOME } from "../src/home.js";
import { PAGE } from "../src/page.js";
import { CORNERS } from "../src/data.js";

test("the funnel line: both counts from the summary, the cleared count linked one tap from the corners", () => {
  const html = HOME([], "", [{ slug: "a", date: "2026-08-20" }], null, false, null, null, { commissioned: 17, withQuote: 4 }, null, null, null, null, null);
  const want = 'commissioned autonomously at <a href="/status">17 corners</a>; <a href="/audited">4</a> cleared the relevance filter';
  assert.ok(html.includes(want), "the funnel line renders both counts as links");
  assert.ok(html.includes("the rest recorded as scraped and empty, a result rather than a gap"));
});

test("the corner page script carries the chip, gated on stored metadata", () => {
  const html = PAGE(CORNERS["16th-mission"], "");
  assert.ok(html.includes("via Apify, "), "the chip text is built in the page script");
  assert.ok(html.includes("compass/crawler-google-places"), "the Maps actor is named");
  assert.ok(html.includes("trudax/reddit-scraper-lite"), "the Reddit actor is named");
  assert.ok(html.includes("actor && d.collected"), "the chip is gated on the record carrying the metadata");
});
