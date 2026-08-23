// The pipeline strip and the case file, pinned offline.

import test from "node:test";
import assert from "node:assert/strict";
import { HOME } from "../src/home.js";
import { PAGE } from "../src/page.js";
import { CORNERS, pacificToday } from "../src/data.js";

const home = HOME([], "", [], null, false, null, null, null, null, null, null, null, null);

test("the strip renders all seven steps, numbered, in causal order, each linking its proof surface", () => {
  const steps = [...home.matchAll(/<span class="cfn">(\d)<\/span><span class="lg">(?:[^<]*<img[^>]*>)?<b>([^<]+)<\/b><\/span><a href="([^"]+)">/g)]
    .map((m) => [Number(m[1]), m[2], m[3]]);
  assert.deepEqual(steps, [
    [1, "DataSF", "/methodology"],
    [2, "Google Maps", "/c/16th-mission"],
    [3, "Exa", "/watchlist"],
    [4, "Apify", "/c/24th-and-valencia"],
    [5, "Gemini", "/audited"],
    [6, "The gate", "/methodology#gate"],
    [7, "You", "/c/16th-mission#letterpanel"],
  ]);
});

test("the honesty lines survive the conversion verbatim", () => {
  assert.ok(home.includes("the letter is drafted, never sent by us"));
  assert.ok(home.includes("Workers serve the page, KV holds corners, imagery and grades"), "the Cloudflare credit stays");
});

test("the case file renders on a corner page with all eight rows and the sent row last", () => {
  const html = PAGE(CORNERS["16th-mission"], "");
  const rows = [...html.matchAll(/<li id="cf-([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rows, ["scored", "photo", "press", "voices", "audited", "fix", "letter", "sent"]);
  assert.ok(html.includes("Sent: that part is yours"));
  assert.ok(html.includes("every date read from a stored record, none invented"));
});

test("no server-rendered case file date can exceed Pacific today", () => {
  const future = String(Number(pacificToday().slice(0, 4)) + 1) + "-01-01";
  const c = { ...CORNERS["16th-mission"], cotd: future, sweep: { sweepDate: future } };
  const html = PAGE(c, "");
  // The server renders what the record holds; the stored-side clamp
  // (appendCotdLog) is what prevents a future date from ever being stored.
  // This cell pins the CLIENT clamp shipping in the page script instead:
  const script = html.slice(html.indexOf("function cfDate"));
  assert.ok(script.includes("d <= ptDay(Date.now())"), "the client refuses a date beyond Pacific today");
  assert.ok(html.includes("function cfSet"), "rows settle only through cfSet");
});

test("a corner with no audit date renders the pending state, never an invented date", () => {
  const c = { ...CORNERS["16th-mission"] };
  delete c.cotd;
  const html = PAGE(c, "");
  assert.match(html, /<li id="cf-audited" class="cfpend"/);
  assert.ok(html.includes("checking the stored audit"));
});
