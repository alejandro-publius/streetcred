// The two sponsor copy adds, pinned offline.

import test from "node:test";
import assert from "node:assert/strict";
import { PAGE } from "../src/page.js";
import { METHODOLOGY } from "../src/methodology.js";
import { CORNERS } from "../src/data.js";
import { TIMELINE_FROM } from "../src/timeline.js";

test("the voices filter sentence ships, reads the stored funnel, and is gated on a commissioned scrape", () => {
  const html = PAGE(CORNERS["16th-mission"], "");
  assert.ok(html.includes('id="voicesfilter"'), "the element sits beneath the lane header");
  assert.ok(html.includes("Apify scraped public reviews and forums for this corner."));
  assert.ok(html.includes("cleared the filter"));
  const script = html.slice(html.indexOf("voicesfilter\");"));
  assert.ok(script.includes("d.commissioned") && script.includes('typeof d.candidates !== "number"'),
    "no sentence without a commissioned scrape and its stored count");
  assert.ok(script.includes("(d.items || []).length"), "kept comes from the stored items, not a literal");
});

test("How Exa is used: five modes, each with its living proof, and the metering close", () => {
  const h = METHODOLOGY("", false, 7355, null);
  const seg = h.slice(h.indexOf("How Exa is used"), h.indexOf("The Press Watchlist"));
  for (const link of ["/c/16th-mission#presstape", "/c/16th-and-potrero", "/watchlist", "/radar", "/status"]) {
    assert.ok(seg.includes(`href="${link}"`), `${link} must be linked`);
  }
  assert.equal((seg.match(/<li>/g) || []).length, 5, "five one-line entries");
  assert.ok(seg.includes(`from ${TIMELINE_FROM} onward`), "the year comes from the live constant");
  assert.ok(seg.includes("metered from the provider's own costDollars and logged in the"));
});
