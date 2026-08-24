// The voices block: its verdict tag, its grammar, and the bar that a published
// account has to clear before it renders on a corner it is not about.

import test from "node:test";
import assert from "node:assert/strict";
import { PAGE } from "../src/page.js";
import { CORNERS } from "../src/data.js";
import { namesForeignCrossing, cornerTokens, cornerSides, matchLevel } from "../src/voices.js";

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

test("match level is counted per street side, so a multi-word street cannot fake a crossing", () => {
  const lvl = (name, text) => matchLevel(text, cornerSides({ name }));
  // The published account on the one corner that keeps a quote.
  assert.equal(lvl("24th and Valencia", "Another San Francisco cyclist struck in Valencia Street center bike lane"), "corridor");
  assert.equal(lvl("24th and Valencia", "drivers blow the light at 24th and Valencia every day"), "crossing");
  // cornerTokens flattens this to three tokens, so a token count would read
  // "Cyril Magnin" alone as naming both streets. Sides do not.
  assert.equal(lvl("Cyril Magnin and Eddy", "the plaza on Cyril Magnin is a mess"), "corridor");
  assert.equal(lvl("Cyril Magnin and Eddy", "Cyril Magnin at Eddy is dangerous"), "crossing");
  assert.equal(lvl("9th and Mission", "nothing about this place at all"), "none");
});

test("a corridor account renders the qualifier chip and says what it qualifies", () => {
  assert.ok(loader.includes('v.match === "corridor"'), "the chip is gated on the served match level");
  assert.ok(loader.includes(">corridor evidence<"), "the chip names what the account is");
  assert.ok(loader.includes("about this street, not this exact crossing"), "the caption is visible, not tooltip only");
  assert.ok(loader.includes('title="This account names one of the two streets'), "and a tooltip for the chip itself");
  // A crossing-level account must not be labelled corridor.
  const i = loader.indexOf('var corridor = v.match === "corridor"');
  assert.ok(i > 0 && loader.slice(i, i + 420).includes(": \'\'"), "anything not corridor renders no chip");
});

test("the served payload carries the match label even when nothing was withheld", async () => {
  // The annotated copies are the whole point of the pass. An early return of
  // the original payload dropped every label on exactly the corners that have
  // a quote to label, which is the one case this feature exists for.
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8"));
  const fn = src.slice(src.indexOf("async function checkVoiceItems"), src.indexOf("async function getVoices"));
  assert.ok(/if \(!dropped\.length\) return \{ \.\.\.payload, items: kept,/.test(fn),
    "the no-drop path must return the annotated items");
  assert.ok(fn.includes("matchLevel(v.text, sides)"), "each kept account is annotated");
});
