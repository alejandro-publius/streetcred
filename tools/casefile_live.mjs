// The pipeline strip and the case file, live. Read only, every request a GET.
//
//   node tools/casefile_live.mjs --test-force-exit
//
// The client-settled rows need a browser; what these cells pin from raw HTML
// is the server half: the strip's seven steps, the case file's eight rows in
// order, the pending states for lanes with nothing stored, and that no
// server-rendered date exceeds today in America/Los_Angeles.

import assert from "node:assert/strict";
import test from "node:test";

const ORIGIN = (process.env.STREETCRED_ORIGIN || "https://streetcred.thealexschroeder.workers.dev").replace(/\/$/, "");
const ptToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const home = await fetch(`${ORIGIN}/`).then((r) => r.text());
// One audited (flagship), one enriched (promoted render, no cotd), one scored.
const audited = await fetch(`${ORIGIN}/c/16th-mission`).then((r) => r.text());
const enriched = await fetch(`${ORIGIN}/c/31st-and-lawton`).then((r) => r.text());
const scored = await fetch(`${ORIGIN}/c/10th-and-fell`).then((r) => r.text());

test("the homepage strip renders all seven steps with their proof links", () => {
  const steps = [...home.matchAll(/<span class="cfn">(\d)<\/span>/g)].map((m) => Number(m[1]));
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7]);
  for (const href of ["/methodology", "/c/16th-mission", "/watchlist", "/c/24th-and-valencia", "/audited", "/methodology#gate", "/c/16th-mission#letterpanel"]) {
    assert.ok(home.includes(`<a href="${href}">`), `step link ${href} must render`);
  }
});

for (const [name, html] of [["audited", audited], ["enriched", enriched], ["scored", scored]]) {
  test(`${name} corner: case file rows in order, sent row last`, () => {
    const rows = [...html.matchAll(/<li id="cf-([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(rows, ["scored", "photo", "press", "voices", "audited", "fix", "letter", "sent"]);
    assert.ok(html.includes("Sent: that part is yours"));
  });
  test(`${name} corner: no server-rendered case file date exceeds Pacific today`, () => {
    const seg = html.slice(html.indexOf('id="casefile"'), html.indexOf("</section>", html.indexOf('id="casefile"')));
    for (const m of seg.matchAll(/class="cfdate">(\d{4}-\d{2}-\d{2})</g)) {
      assert.ok(m[1] <= ptToday, `${m[1]} is beyond ${ptToday}`);
    }
  });
}

test("a scored corner's undone lanes are server-marked pending, not dated", () => {
  const seg = scored.slice(scored.indexOf('id="casefile"'));
  for (const row of ["photo", "press", "voices", "audited", "fix", "letter"]) {
    assert.match(seg, new RegExp(`<li id="cf-${row}" class="cfpend"`), `${row} starts pending on a scored corner`);
  }
});

test("the client clamp ships in every corner page script", () => {
  for (const html of [audited, enriched, scored]) {
    assert.ok(html.includes("d <= ptDay(Date.now())"), "cfDate refuses a future date");
  }
});
