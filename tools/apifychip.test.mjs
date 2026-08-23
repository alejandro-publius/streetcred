// The Apify provenance chip and the funnel links, pinned.
//
// The chip must name the actor that produced the quote and the date the
// record says it was scraped, and must render nothing when the stored record
// cannot support it. The funnel's cleared count must link to the corners that
// actually carry a cleared account, from the stored summary, never a literal.

import test from "node:test";
import assert from "node:assert/strict";
import { clearedLinks } from "../src/home.js";
import { PAGE } from "../src/page.js";
import { CORNERS } from "../src/data.js";

test("clearedLinks links each corner carrying an account and only those", () => {
  const html = clearedLinks({ withQuote: 2, corners: { "24th-and-valencia": 1, "polk-and-willow": 1, "6th-and-mission": 0 } });
  assert.match(html, /^2 \(/);
  assert.match(html, /<a href="\/c\/24th-and-valencia">24th &amp; Valencia<\/a>/);
  assert.match(html, /<a href="\/c\/polk-and-willow">Polk &amp; Willow<\/a>/);
  assert.ok(!html.includes("6th-and-mission"), "a corner whose scrape kept nothing is not linked");
});

test("clearedLinks with no per-corner map is a bare count, not a guessed link", () => {
  assert.equal(clearedLinks({ withQuote: 3 }), "3");
  assert.equal(clearedLinks(null), "0");
});

test("the corner page script carries the chip, gated on stored metadata", () => {
  const html = PAGE(CORNERS["16th-mission"], "");
  assert.ok(html.includes("via Apify, "), "the chip text is built in the page script");
  assert.ok(html.includes("compass/crawler-google-places"), "the Maps actor is named");
  assert.ok(html.includes("trudax/reddit-scraper-lite"), "the Reddit actor is named");
  assert.ok(html.includes("actor && d.collected"), "the chip is gated on the record carrying the metadata");
});
