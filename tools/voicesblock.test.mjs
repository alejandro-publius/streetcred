// The voices block: its verdict tag, its grammar, and the bar that a published
// account has to clear before it renders on a corner it is not about.

import test from "node:test";
import assert from "node:assert/strict";
import { PAGE } from "../src/page.js";
import { CORNERS } from "../src/data.js";
import { namesForeignCrossing, cornerTokens } from "../src/voices.js";

const script = PAGE(CORNERS["16th-mission"], "");
const loader = script.slice(script.indexOf("LANE_LOADERS.voices"), script.indexOf("LANE_LOADERS.impact"));

// The real 2,219-name index is lowercase with street types stripped, which is
// the shape cornerTokens produces. This is that shape, not a convenience.
const STREETS = new Set(["4th", "king", "ellis", "polk", "geary", "willow", "9th", "10th", "mission", "valencia", "kirkham", "16th", "market"]);

test("the tag is the kept count, never the fact that a scrape ran", () => {
  assert.ok(loader.includes('tag.textContent = "kept"'), "a surviving account publishes the verdict kept");
  assert.ok(!loader.includes('mark("voicestag"'), "mark() returns early on a live source and left the default in place");
  // Every zero-kept path still owns its own honest tag.
  for (const t of ['"none on topic"', '"not yet checked"', '"none found"', '"none on this corner"']) {
    assert.ok(loader.includes(t), `the zero-kept tag ${t} must survive`);
  }
});

test("the lower sentence does not repeat the section label and reads grammatically", () => {
  assert.ok(loader.includes("'<p class=\"pcauto\">Commissioned autonomously: the morning run started"),
    "the header already says Resident voices");
  assert.ok(!/Resident voices commissioned autonomously: the morning run/.test(loader), "the duplicate label is gone");
  assert.ok(!loader.includes("of which these survived"), "these survived is gone");
  assert.ok(loader.includes("' survived the relevance filter."), "the count agrees with its verb");
  assert.ok(loader.includes('" account" : " accounts"'), "1 account, 2 accounts");
  assert.ok(!/esc\(d\.candidates \|\| 0\) \+ ' accounts/.test(loader), "no unpluralized accounts left");
});

test("a quote naming a different crossing is foreign; a corridor quote is not", () => {
  const t = (name) => cornerTokens({ name });
  assert.equal(namesForeignCrossing("Driver at 4th & King who almost killed several of us", t("4th and Ellis"), STREETS), true);
  assert.equal(namesForeignCrossing("a truck parked in the bike lane at Polk & Geary", t("Polk and Willow"), STREETS), true);
  assert.equal(namesForeignCrossing("a neckdown on Kirkham between 9th and 10th", t("9th and Mission"), STREETS), true);
  // The corridor case scoreText deliberately allows: one street, no other crossing.
  assert.equal(namesForeignCrossing("cyclist struck in Valencia Street center bike lane", t("24th and Valencia"), STREETS), false);
  // This crossing, named in full, is the strongest match and must survive.
  assert.equal(namesForeignCrossing("the crossing at Polk and Willow is dangerous", t("Polk and Willow"), STREETS), false);
  // Ordinary prose is not a crossing.
  assert.equal(namesForeignCrossing("speeding cars and trucks all day", t("9th and Mission"), STREETS), false);
});

test("the bar refuses to pass when it cannot read the street index", () => {
  const tokens = cornerTokens({ name: "4th and Ellis" });
  assert.throws(() => namesForeignCrossing("Driver at 4th & King", tokens, null), /street index/);
  assert.throws(() => namesForeignCrossing("Driver at 4th & King", tokens, new Set()), /street index/);
});

test("a withheld account renders as withheld, not as a scrape that found nothing", () => {
  assert.ok(loader.includes("every surviving account turned out to describe a different crossing"));
  assert.ok(loader.includes("withheld for naming a different crossing."), "the funnel sentence says what was withheld");
  assert.ok(!loader.includes("cleared that filter and then"), "the sentence must not say cleared after reporting a zero-cleared count");
});
