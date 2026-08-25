// The word diet, live. Read only.
//
// The homepage keeps its claims and hands the explanations to /methodology.
// These cells pin both directions: every relocated sentence exists in full on
// /methodology, and the homepage's visible word count stays below what it was
// before the diet (1,171 words measured on 2026-08-24, pre-diet).

import assert from "node:assert/strict";
import test from "node:test";

const ORIGIN = (process.env.STREETCRED_ORIGIN || "https://streetcred.thealexschroeder.workers.dev").replace(/\/$/, "");
const BEFORE_WORDS = 1171;

const strip = (html) =>
  html
    .slice(html.indexOf("<body"))
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ");

// Cache-busted (any parameter name but x, which is the legacy corner route):
// the homepage is edge cached, and a cell that reads the cache is a cell that
// verifies the previous deploy.
const home = await fetch(`${ORIGIN}/?cell=worddiet`).then((r) => r.text());
const meth = await fetch(`${ORIGIN}/methodology`).then((r) => r.text());
const flat = (s) => s.replace(/\s+/g, " ");

test("every relocated sentence lives in full on /methodology", () => {
  for (const line of [
    "Past zoom 15 the scored dots are tappable",
    "Unmarked crossings had no reported harm in the record",
    "drawn per corner and never as one outline",
    "ranks reported harm, not risk per crossing",
    "the index is what separates corners inside",
  ]) {
    assert.ok(flat(meth).includes(line), `missing on /methodology: ${line}`);
  }
  assert.ok(meth.includes('id="map"') && meth.includes('id="percentiles"'), "both anchors exist");
});

test("the homepage keeps one short line per claim, linking the explanation", () => {
  assert.ok(home.includes('one more every morning. <a href="/methodology#map">How this map is drawn</a>'));
  assert.ok(home.includes('which is why they all read F. <a href="/methodology#percentiles">Why percentiles</a>'));
  assert.ok(!home.includes("never as one outline"), "the outline explanation moved");
  assert.ok(!home.includes("Past zoom 15"), "the zoom note moved");
  assert.ok(home.includes("Map data: Google."), "the required attribution stays");
});

test("the homepage word count dropped and stays dropped", () => {
  const words = strip(home).split(/\s+/).filter(Boolean).length;
  assert.ok(words < BEFORE_WORDS, `homepage is ${words} words against the pre-diet ${BEFORE_WORDS}`);
});
