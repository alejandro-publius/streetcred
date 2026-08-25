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

test("corner of the day is the newest render-complete audit, and says so when a newer one is pending", async () => {
  // One page must not give two answers to what was audited most recently. This
  // rule has been both of its halves and each was wrong alone: featuring the
  // newest corner with a slider put 2026-08-18 above chips showing today, and
  // featuring the newest audit full stop put a photograph with a handle on it
  // where the product demonstration goes. The card features a corner that can
  // be dragged; a sub-line names the newer audit that cannot be, and links it.
  const hero = home.slice(home.indexOf('class="herocorner"'), home.indexOf('class="herocorner"') + 1600);
  const heroSlug = (hero.match(/href="\/c\/([a-z0-9-]+)"/) || [])[1];
  const heroDate = (hero.match(/Audited autonomously[^<]*?(\d{4}-\d{2}-\d{2})/) || [])[1];
  assert.ok(heroSlug, "the hero must name a corner");
  assert.ok(heroDate, "the hero must state the date it was audited");

  const chips = [...home.matchAll(/class="cotdi" href="\/c\/([^"]+)" title="[^,]+, (\d{4}-\d{2}-\d{2})"/g)]
    .map((m) => ({ slug: m[1], date: m[2] }));
  assert.ok(chips.length, "the streak chips must render");

  // Which chips actually hold a complete visual lane, asked of the same API the
  // corner pages answer from rather than inferred from the roster.
  const lanes = await Promise.all(
    chips.map(async (c) => {
      const api = await fetch(`${ORIGIN}/api/imagery?x=${c.slug}`).then((r) => r.json()).catch(() => null);
      return { ...c, complete: Boolean(api?.fix && api?.hazards) };
    }),
  );
  const complete = lanes.filter((c) => c.complete);
  const newest = lanes.reduce((a, b) => (b.date > a.date ? b : a), lanes[0]);

  if (complete.length) {
    const newestComplete = complete.reduce((a, b) => (b.date > a.date ? b : a), complete[0]);
    assert.equal(
      heroSlug,
      newestComplete.slug,
      `hero features ${heroSlug}, newest render-complete chip is ${newestComplete.slug}`,
    );
    assert.equal(heroDate, newestComplete.date, `hero says ${heroDate}, that corner was audited ${newestComplete.date}`);
  }

  // The sub-line is present exactly when a newer audit exists without imagery,
  // and it names that corner and links to it. Absent when the hero already is
  // the newest audit, because then there is nothing being left unsaid.
  const pendingLine = (hero.match(/class="hcpending">Latest audit[^<]*<a href="\/c\/([a-z0-9-]+)"[^>]*>([^<]+)<\/a>, visual lanes pending/) || []);
  if (newest.slug !== heroSlug) {
    assert.ok(pendingLine[1], `a newer audit (${newest.slug}) is not featured, so the sub-line must name it`);
    assert.equal(pendingLine[1], newest.slug, `sub-line names ${pendingLine[1]}, newest audit is ${newest.slug}`);
  } else {
    assert.ok(!pendingLine[1], "the hero is already the newest audit, so no sub-line should appear");
  }

  // No future dates anywhere on the card, in the timezone the claim is about.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  for (const d of hero.match(/\d{4}-\d{2}-\d{2}/g) || []) {
    assert.ok(d <= today, `hero card carries ${d}, which is after today (${today}) in Pacific`);
  }

  // The hero must not claim a photograph is missing when the corner's own page
  // serves one: the frame index is the shared source of that answer.
  if (hero.includes("No photograph is stored")) {
    const api = await fetch(`${ORIGIN}/api/imagery?x=${heroSlug}`).then((r) => r.json()).catch(() => null);
    assert.ok(!api?.today, `hero says no photograph but /api/imagery serves ${api?.today}`);
  }
});

test("a degraded lane never reads like an outage", () => {
  // "with some lanes degraded" on a hero card describes the site as broken. The
  // corner is not broken and neither is the site: the records lane ran and the
  // visual lane has not. That is what the copy says now.
  const hero = home.slice(home.indexOf('class="herocorner"'), home.indexOf('class="herocorner"') + 1600);
  assert.ok(!hero.includes("lanes degraded"), "the outage phrasing is gone from the hero");
  if (hero.includes("Records audited")) {
    assert.ok(hero.includes("Records audited; visual lanes pending"), "the replacement copy is the agreed sentence");
  }
});
