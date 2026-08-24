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
    assert.ok(home.includes(`<a class="cfrow" href="${href}">`), `step link ${href} must render as its row`);
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

test("corner of the day is the newest audit, and its date equals the newest streak chip", async () => {
  // One page must not give two answers to what was audited most recently. The
  // hero used to walk back for a corner carrying both generated frames, which
  // with imagery billing-blocked meant it showed 2026-08-18 above chips
  // showing today.
  const hero = home.slice(home.indexOf('class="herocorner"'), home.indexOf('class="herocorner"') + 1200);
  // The caption varies with the run's status ("this morning, DATE, with some
  // lanes degraded" on a partial), so match the date wherever it sits.
  const heroDate = (hero.match(/Audited autonomously[^<]*?(\d{4}-\d{2}-\d{2})/) || [])[1];
  const chips = [...home.matchAll(/class="cotdi" href="\/c\/([^"]+)" title="[^,]+, (\d{4}-\d{2}-\d{2})"/g)]
    .map((m) => ({ slug: m[1], date: m[2] }));
  assert.ok(chips.length, "the streak chips must render");
  const newest = chips.reduce((a, b) => (b.date > a.date ? b : a), chips[0]);
  assert.ok(heroDate, "the hero must state the date it was audited");
  assert.equal(heroDate, newest.date, `hero says ${heroDate}, newest chip says ${newest.date}`);
  const heroSlug = (hero.match(/href="\/c\/([a-z0-9-]+)"/) || [])[1];
  assert.equal(heroSlug, newest.slug, "and it is that same corner");
  // The hero must not claim a photograph is missing when the corner's own
  // page serves one: the frame index is the shared source of that answer.
  if (hero.includes("No photograph is stored")) {
    const api = await fetch(`${ORIGIN}/api/imagery?x=${heroSlug}`).then((r) => r.json()).catch(() => null);
    assert.ok(!api?.today, `hero says no photograph but /api/imagery serves ${api?.today}`);
  }
});
