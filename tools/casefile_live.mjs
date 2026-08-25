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

test("the case strip shows all seven steps on the homepage, no interaction", () => {
  // The operator reported this rendering as one line unless you clicked
  // through. Measured in the page's own context at 390, 768 and 1280 on
  // 2026-08-25 it does not: seven list items, seven distinct vertical
  // positions, logo and bold name and description all with non-zero boxes, no
  // display:none and no clipping. This cell exists so that stays true, and so
  // the next report of it has something to contradict.
  const strip = home.slice(home.indexOf('class="caseline"'), home.indexOf("</ol>", home.indexOf('class="caseline"')));
  assert.ok(strip, "the case strip must render on the homepage");

  const rows = [...strip.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 7, `expected seven steps, found ${rows.length}`);

  // Every row carries its three parts. A row that lost its description would
  // still be a row, and the strip would still be seven lines, and it would no
  // longer say what that step does.
  rows.forEach((row, i) => {
    assert.ok(/class="cfmark"/.test(row), `step ${i + 1} has no logo cell`);
    assert.ok(/<b class="cfname">[^<]+<\/b>/.test(row), `step ${i + 1} has no bold name`);
    const desc = (row.match(/class="cfdesc">([^<]+)</) || [])[1];
    assert.ok(desc && desc.trim().length > 8, `step ${i + 1} has no description`);
  });

  // No interaction: the strip is not inside a details, and no row is hidden.
  const panel = home.slice(Math.max(0, home.indexOf('class="caseline"') - 400), home.indexOf("</ol>", home.indexOf('class="caseline"')));
  assert.ok(!/<details/.test(panel), "the strip must not be behind a disclosure");
  assert.ok(!/<li[^>]+hidden/.test(strip), "no step may be hidden");

  // And nothing in the stylesheet collapses it. A one-line state would need one
  // of these, so they are the shapes to refuse rather than a guess at intent.
  const css = (home.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join("");
  const collapsing = [
    /\.caseline[^{}]*\{[^}]*display:\s*(?:flex|inline-flex)[^}]*\}/,
    /\.caseline\s+li[^{}]*\{[^}]*display:\s*(?:none|inline)[^}]*\}/,
    /\.cfrow[^{}]*\{[^}]*display:\s*none[^}]*\}/,
    /\.cfdesc[^{}]*\{[^}]*display:\s*none[^}]*\}/,
    /\.cfname[^{}]*\{[^}]*display:\s*none[^}]*\}/,
  ];
  for (const re of collapsing) {
    assert.ok(!re.test(css), `a stylesheet rule collapses the strip: ${(css.match(re) || [])[0]}`);
  }

  // The narrow layout stacks the description under the name rather than
  // truncating it. Both would fit on one line; only one of them is honest.
  const mobile = (css.match(/@media \(max-width:430px\)\{([\s\S]*?)\n\}/) || [])[1] || "";
  if (mobile.includes(".cfdesc")) {
    assert.ok(
      !/\.cfdesc[^{}]*\{[^}]*text-overflow:\s*ellipsis/.test(mobile),
      "the mobile layout truncates the description instead of stacking it",
    );
  }
});

test("the powered-by card carries both marks, the stripe, and the right links", () => {
  // Presentation, but three of these are load-bearing. The stripe is the site's
  // hazard signal and this is the one card that wears it without meaning it, so
  // if it ever loses the class the card silently becomes an ordinary panel and
  // nobody notices. The links are the only thing on the card that goes
  // anywhere. And the marks are the reason it exists.
  const card = home.slice(home.indexOf('class="tape pby"'), home.indexOf("</section>", home.indexOf('class="tape pby"')));
  assert.ok(card, "the powered-by card must render on the homepage");

  // The stripe is `.tape`, the same class the press card uses, so the treatment
  // cannot drift from the one it was copied from.
  assert.match(card, /class="tape pby"/, "the card must carry the tape stripe class");
  assert.match(card, /class="panel pbycard"/, "and the panel inner card background");

  // One mark per cell, and the wordmark files rather than the icon files: the
  // icons carry no name, and a name beside them would be the doubled label the
  // case strip rules refuse.
  const marks = [...card.matchAll(/class="pbymark"><img src="([^"]+)"[^>]*alt="([^"]*)"/g)];
  assert.equal(marks.length, 2, `expected two marks, found ${marks.length}`);
  assert.deepEqual(
    marks.map((m) => m[1]),
    ["/logos/exa.svg", "/logos/apify.svg"],
    "the wordmark assets, matching the PRESS VIA EXA chip's exa.svg",
  );
  assert.deepEqual(marks.map((m) => m[2]), ["Exa", "Apify"], "each mark names itself to a screen reader");
  // No visible text label beside a mark. The names are said once, in the note.
  assert.ok(
    !/class="pbymark">[\s\S]*?<\/span>\s*<b/.test(card),
    "a mark must not carry a text label beside it",
  );

  assert.match(card, /class="pbylabel">Powered by</, "the small caps label");

  const links = [...card.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => ({ href: m[1], text: m[2] }));
  assert.deepEqual(
    links,
    [
      { href: "/watchlist", text: "Exa" },
      { href: "/c/24th-and-valencia", text: "Apify" },
    ],
    "Exa links to the watchlist and Apify to the voices corner",
  );

  // The card is after the hero card in source order, which is the whole of the
  // mobile rule: below 900px the grid is one column and the card falls after
  // the hero with no reordering at all.
  assert.ok(
    home.indexOf('class="tape pby"') > home.indexOf('class="herocorner"'),
    "the card must follow the hero card in source order, or mobile puts it above",
  );
});

test("the powered-by card does not move the fold at desktop", () => {
  // Measured on preview at 1280 before deploying: .herohead was 635px without
  // the card and 636px with it, a 1px rounding difference against a 16px
  // allowance. This asserts the mechanism that makes that true, because a live
  // HTML check cannot measure layout.
  //
  // The card is a third grid item. Without the span below it would occupy a new
  // row in BOTH columns and push everything under it by its own height plus the
  // 32px gap. The hero spanning rows 1 and 2 puts the card inside the 241px of
  // whitespace the left column already had, so the container stays as tall as
  // the hero and nothing moves.
  const css = (home.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join("");
  assert.match(
    css,
    /\.herohead > \.herocorner\{grid-column:2;grid-row:1 \/ span 2\}/,
    "the hero must span both grid rows, or the card adds a row and moves the fold",
  );
  assert.match(css, /\.pby\{grid-column:1;grid-row:2\}/, "and the card sits in the left column's second row");
  // Both only above the single-column breakpoint, or they would fight the
  // mobile stack.
  const desktop = (css.match(/@media\(min-width:901px\)\{([\s\S]*?)\n\}/) || [])[1] || "";
  assert.ok(desktop.includes("grid-row:1 / span 2"), "the span belongs to the two-column layout only");
});
