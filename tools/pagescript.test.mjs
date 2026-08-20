// The page's own JavaScript, parsed.
//
// Every line of the corner page's client script lives inside a template
// literal in src/page.js, which means `node --check src/page.js` validates the
// literal and says nothing at all about the script inside it. A backslash
// escape written into that literal is eaten before the browser ever sees it,
// and the result is a syntax error that kills the entire script: no verdict,
// no lanes, no letter, on every corner at once. That has shipped twice.
//
// So this renders the real page and parses what the browser would actually
// receive. new Function is the parser: it compiles the source and throws on a
// syntax error without running a line of it.

import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { PAGE, NOT_FOUND } from "../src/page.js";
import { HOME } from "../src/home.js";
import { WATCHLIST_PAGE } from "../src/watchlistpage.js";
import { CORNERS } from "../src/data.js";
import { TIERS } from "../src/city.js";

const scripts = (html) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

const parses = (html, label) => {
  const blocks = scripts(html);
  assert.ok(blocks.length > 0, `${label}: no inline script found, the extractor is broken`);
  blocks.forEach((src, i) => {
    try {
      new Function(src);
    } catch (e) {
      assert.fail(`${label}: inline script ${i} does not parse: ${e.message}`);
    }
  });
};

const audited = CORNERS["16th-mission"];

// A corner that exists only in a city shard, in the shape src/city.js builds.
const scored = {
  slug: "34th-and-balboa",
  name: "34th and Balboa",
  short: "34th & Balboa",
  city: "San Francisco",
  lat: 37.775,
  lon: -122.494,
  heading: 0,
  pitch: 0,
  radiusMeters: 150,
  district: 1,
  generated: true,
  fix: { name: "Continental crosswalks", cost: "$250,000", grant: "HSIP" },
};

test("corner page script parses, audited corner", () => {
  parses(PAGE(audited, { origin: "https://example.test", tier: TIERS.AUDITED }), "audited");
});

test("corner page script parses, scored corner", () => {
  parses(PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED }), "scored");
});

// A corner with an apostrophe in its name is the exact shape of the bug this
// file exists to catch: the name is interpolated into the script as a JSON
// string, and any escaping mistake there is a syntax error citywide.
test("corner page script parses with an apostrophe in the name", () => {
  parses(
    PAGE({ ...scored, slug: "geary-and-o-farrell", name: "Geary and O'Farrell", short: "Geary & O'Farrell" },
      { origin: "https://example.test", tier: TIERS.SCORED }),
    "apostrophe",
  );
});

test("homepage script parses", () => {
  parses(HOME([], "https://example.test", [], null, false), "home empty");
});

test("not found page renders", () => {
  const html = NOT_FOUND("nowhere-and-nothing", "https://example.test");
  assert.ok(html.includes("nowhere-and-nothing"));
});

// The tier chip is the one piece of the shell that names the vocabulary, so a
// rename that misses the page would show a corner tagged with nothing.
test("the tier chip renders its label", () => {
  for (const tier of Object.values(TIERS)) {
    const html = PAGE(scored, { origin: "https://example.test", tier });
    assert.match(html, new RegExp(`tierchip t-${tier}`), `${tier} chip missing`);
  }
});

// Structural guard for a bug that was invisible in review and obvious in a
// browser: the chip lived inside the h1 whose only child was a block element,
// so the two boxes overlapped and every corner read "Market StreetAUDITED".
// The chip is a sibling of the name now, and the flex gap owns the spacing.
// Box metrics live outside CI (they need a real engine); this pins the shape.
test("the tier chip is a sibling of the name, never inside the h1", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  const h1 = html.match(/<h1 class="cname">([\s\S]*?)<\/h1>/);
  assert.ok(h1, "the corner name should still be an h1");
  assert.ok(!h1[1].includes("tierchip"), "the chip must not be inside the h1");
  assert.match(html, /<div class="ctitle">/, "name and chip need a flex row to share");
  assert.match(html, /<div class="cmeta">/, "the district line needs its own element to be spaced");
});

// The corner page's identity moved into the imagery card, so the header holds
// controls and nothing else. The invariant that replaced the old one: the name
// is still an h1, it is still beside its tier chip rather than inside the h1,
// and it now lives in the card's own header row.
test("the corner identity lives in the imagery card, not the page header", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  assert.match(html, /<div class="hctl">/, "controls keep their row");
  const header = html.match(/<header>([\s\S]*?)<\/header>/);
  assert.ok(header, "header present");
  assert.ok(!header[1].includes('class="corner"'), "the identity block has left the page header");
  const card = html.match(/<div class="phs phs-id">([\s\S]*?)<div class="pbody">/);
  assert.ok(card, "the imagery card needs an identity header row");
  assert.match(card[1], /<h1 class="cname">/, "the name is the h1 and it is in the card");
  assert.match(card[1], /class="tierchip/, "the tier chip travels with the name");
  assert.match(card[1], /class="cardeyebrow">The corner, three ways/, "the card keeps its own title as an eyebrow");
  assert.match(card[1], /id="imgtag"/, "the right side chip stays where it was");
  assert.equal((html.match(/<h1/g) || []).length, 1, "exactly one h1 on the page");
});

// The bug this guards against shipped twice: a header text block whose lines
// are bare text nodes rather than elements. A line without an element cannot
// be given a margin, so the moment a display:block rule moves or is deleted,
// two separate sentences render as one run. On the homepage that read
// "San Francisco7,355 corners graded".
//
// Box metrics catch it in a browser and live outside CI. This catches the
// shape: inside a header text block, every line must be its own element.
// Balanced extraction, because the identity block no longer sits immediately
// before </header> on every page and a lazy regex would silently find nothing,
// which is how a guard stops guarding without failing.
const cornerBlocks = (html) => {
  const out = [];
  const open = /<div class="corner">/g;
  let m;
  while ((m = open.exec(html))) {
    let depth = 1;
    const tag = /<div\b[^>]*>|<\/div>/g;
    tag.lastIndex = m.index + m[0].length;
    let t;
    while (depth > 0 && (t = tag.exec(html))) {
      depth += t[0] === "</div>" ? -1 : 1;
    }
    out.push(html.slice(m.index + m[0].length, t ? t.index : html.length));
  }
  return out;
};

const stripElements = (inner) => {
  let prev = null;
  let cur = inner;
  // Remove balanced elements until nothing but text remains. Any text left
  // over was never inside an element of its own.
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(/<(b|span|div|h1|i|a)\b[^>]*>[\s\S]*?<\/\1>/g, "");
  }
  return cur.replace(/<[^>]*>/g, "").trim();
};

test("no header text block contains a bare line", () => {
  const pages = [
    ["home", HOME([], "https://example.test", [], null, false,
      { meta: { totalScored: 7355, totalAudited: 23 }, top: [], queueLength: 10 }, null, null)],
    ["corner", PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED })],
    ["watchlist", WATCHLIST_PAGE({ source: "live", builtAt: "2026-08-19", entries: [], rejects: [], queries: [] }, "https://example.test", null)],
  ];
  for (const [name, html] of pages) {
    const blocks = cornerBlocks(html);
    assert.ok(blocks.length >= 1, `${name}: no header text block found, the extractor is broken`);
    for (const inner of blocks) {
      const stray = stripElements(inner);
      assert.equal(stray, "", `${name}: header text block has a line with no element of its own: "${stray.slice(0, 60)}"`);
    }
  }
});

// Every other row in the Powered by strip names its tool in bold.
test("the powered by strip names Exa and Apify", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  for (const name of ["Gemini", "Exa", "Apify", "Google Maps", "Cloudflare", "DataSF"]) {
    assert.match(html, new RegExp(`<b>${name}</b>`), `${name} label missing`);
  }
});

// The homepage hero embed. The slider is the point of it: a first-time visitor
// drags the handle without being told to, which is the interaction the corner
// page had and the homepage did not. These lock the shape, not the pixels.
const EMBED = {
  slug: "19th-and-mission",
  name: "19th and Mission",
  date: "2026-08-18",
  auditedToday: true,
  grade: "D",
  evidence: "23 collisions in 5 years, 201 street-condition 311 reports in 3 years. District 9",
  frames: {
    today: "/gen/19th-and-mission/today.jpg",
    hazards: "/gen/19th-and-mission/hazards.jpg",
    fix: "/gen/19th-and-mission/fix.jpg",
  },
  state: "full",
};

const homeWith = (embed) =>
  HOME([], "https://example.test", [{ slug: embed?.slug, name: embed?.name, date: embed?.date, grade: embed?.grade }],
    null, false, { meta: { totalScored: 7355, totalAudited: 23 }, top: [], queueLength: 10 },
    null, null, null, null, embed);

test("the hero embed leads with the comparison slider", () => {
  const html = homeWith(EMBED);
  // The embed ships its own inline script. It is a second place a template
  // literal can be mangled into a syntax error, so it goes through the parser
  // like every other block on the page.
  parses(html, "home with embed");
  const stage = html.match(/<div class="hero[^"]*" id="hchero">([\s\S]*?)<\/div>/);
  assert.ok(stage, "the embed should mount the slider stage");
  assert.ok(!/<div class="hero single" id="hchero"/.test(html), "a corner with both frames is not single");
  assert.match(stage[1], /class="sbase"[^>]*src="\/gen\/19th-and-mission\/today\.jpg"/, "photograph on the left");
  assert.match(stage[1], /class="sov"[^>]*src="\/gen\/19th-and-mission\/fix\.jpg"/, "proposal on the right");
  assert.match(stage[1], /class="shdl"[^>]*aria-valuenow="50"/, "handle centered on load");
  // Both panes carry intrinsic dimensions, which is what keeps the box
  // reserved before the bytes land.
  assert.equal((stage[1].match(/width="640" height="400"/g) || []).length, 2, "both panes sized");
});

test("the hero embed offers compare, hazards and today, compare first", () => {
  const html = homeWith(EMBED);
  const chips = [...html.matchAll(/<button type="button" data-state="(\w+)" aria-pressed="(\w+)">([^<]+)<\/button>/g)];
  assert.deepEqual(
    chips.map((m) => [m[3], m[1], m[2]]),
    [["Compare", "fix", "true"], ["Hazards", "hazards", "false"], ["Today", "today", "false"]],
  );
  assert.match(html, /Drag to compare\./, "the hint a first-time visitor needs");
});

test("the hero embed and the corner page mount one slider, not two", () => {
  const corner = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  const home = homeWith(EMBED);
  for (const [name, html] of [["corner", corner], ["home", home]]) {
    assert.match(html, /class="shdl"/, `${name}: missing the shared handle`);
    assert.match(html, /mountSlider\(/, `${name}: not mounting the shared behavior`);
  }
  // One definition in the codebase. Two would drift, and the drag is the one
  // piece of this page that has to feel identical in both places.
  const src = readFileSync(new URL("../src/page.js", import.meta.url), "utf8");
  assert.equal((src.match(/^function mountSlider\(/gm) || []).length, 1, "mountSlider defined once");
});

test("a corner with no proposed fix shows the photograph and no slider shell", () => {
  const html = homeWith({ ...EMBED, frames: { today: EMBED.frames.today, hazards: null, fix: null }, state: "text-only" });
  assert.match(html, /<div class="hero single" id="hchero">/, "single frame, single stage");
  assert.ok(!/class="sov"/.test(html), "no empty second pane");
  assert.ok(!/class="shdl"/.test(html), "no handle for a slider that cannot exist");
  assert.ok(!/<div class="hctoggle"/.test(html), "one view is not a choice");
  assert.match(html, /Imagery audit pending\./, "says what is missing");
});

test("the hero embed never renders imagery it does not have", () => {
  const html = homeWith({ ...EMBED, frames: { today: null, hazards: null, fix: null }, state: "none" });
  assert.ok(!/id="hchero"/.test(html), "no stage without a photograph");
  assert.match(html, /class="hcnone"/, "the designed pending card instead");
});

// The hero must always be able to show the slider, and the site must always be
// able to say it ran this morning. When those are two different corners, both
// facts belong on the page; when they are the same corner, the second line has
// to disappear on its own.
test("the date line drops the morning claim when the corner is not today's", () => {
  const F = { today: "/t.jpg", hazards: "/h.jpg", fix: "/f.jpg" };
  const today = homeWith({ ...EMBED, frames: F, auditedToday: true, date: "2026-08-20" });
  assert.match(today, /Audited autonomously this morning, 2026-08-20/);
  const older = homeWith({ ...EMBED, frames: F, auditedToday: false, date: "2026-08-18" });
  assert.match(older, /Audited autonomously 2026-08-18/);
  assert.ok(!/this morning, 2026-08-18/.test(older), "an older audit may not claim this morning");
  // Never the old wording, which read as a hedge rather than a date.
  assert.ok(!/Most recent audit/.test(older));
});

// The hero card ends at its buttons. The daily cadence is carried by the
// subtitle and the ticker chips, and a third statement of it inside the card
// read as a stranded row underneath them.
test("the hero card states no second corner under its buttons", () => {
  const F = { today: "/t.jpg", hazards: "/h.jpg", fix: "/f.jpg" };
  const older = homeWith({
    ...EMBED, frames: F, auditedToday: false, date: "2026-08-18",
    alsoToday: { slug: "6th-and-jessie", name: "6th and Jessie" },
  });
  // Passed the field on purpose: even given it, nothing renders.
  assert.ok(!/This morning the machine audited/.test(older), "no drumbeat row");
  assert.ok(!/class="hcalso"/.test(older));
  assert.match(older, /class="shdl"/, "the slider is unaffected");
  assert.match(older, /Audited autonomously 2026-08-18/, "the featured corner still dates itself");
});

// The three stat tiles printed as "0 collisions, 0 reports, 0 district" under
// an F verdict in the operator's PDF. The values were only ever produced by a
// count-up gated on the tiles scrolling into view, and the tiles sit below the
// press and voices cards, so anything that does not scroll got zeros. A zero is
// a claim; a skeleton is not. Neither may be a stand-in for a figure the render
// already has.
test("a scored corner's stat tiles carry their real values in the raw HTML", () => {
  const html = PAGE(scored, {
    origin: "https://example.test",
    tier: TIERS.SCORED,
    stats: {
      source: "sweep",
      asOf: "2026-08-18",
      radiusM: 80,
      crashes: 65,
      fatal: 2,
      reports311: 85,
      reports311Window: "12 months",
      district: 9,
    },
  });
  const block = html.slice(html.indexOf('<div class="stats"'), html.indexOf('<p class="statcap"'));
  assert.match(block, />65</, "the collision count should be in the HTML");
  assert.match(block, />85</, "the 311 count should be in the HTML");
  assert.match(block, />9</, "the district should be in the HTML");
  assert.doesNotMatch(block, />0</, "no tile may render a literal zero it does not mean");
  assert.doesNotMatch(block, /class="n sk"/, "no skeleton where a value is known");
  // data-to stays, because the count-up still replays over the real number.
  assert.match(block, /data-to="65"/);
});

// Without stats in hand the tile says nothing rather than saying zero.
test("a corner with no stats in hand keeps the skeleton, never a zero", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  const block = html.slice(html.indexOf('<div class="stats"'), html.indexOf('<p class="statcap"'));
  assert.match(block, /class="n sk"/, "the loading state is honest, a zero is not");
  assert.doesNotMatch(block, />0</);
});

// There was no print stylesheet on this site at all, which is why the PDF came
// back with the tape, the sticky bar and a half-drawn eyebrow rule.
test("the corner page has a print stylesheet that stops mid-flight animation", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  assert.match(html, /@media print\{/, "a printable document needs print styles");
  assert.match(html, /@media print\{[\s\S]*animation:none !important/);
  assert.match(html, /@media print\{[\s\S]*\.sticky[^}]*display:none/);
});

// The flush is what puts data-to on screen without waiting to be scrolled to.
test("the stats flush runs when the lane lands and again before printing", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  const src = scripts(html).join("\n");
  assert.match(src, /function flushStats\(\)/);
  assert.match(src, /addEventListener\("beforeprint", flushStats\)/);
  assert.match(src, /flushStats\(\);/, "the lane must flush as soon as it lands");
});

// "3 311 reports in 12 months" renders as 3311 to a reader and runs together to
// a screen reader whatever whitespace sits between the two numbers. The buffer
// word is the fix, and it is the wording the rest of the site already uses.
test("a count is never left butting straight against the literal 311", () => {
  // detailFor is private and its caller makes network calls, so this reads the
  // source. The pattern is what matters and it is checkable either way: an
  // interpolated count immediately followed by the digits 311.
  for (const f of ["hazards.js", "city.js", "cred.js", "page.js", "index.js"]) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      src,
      /\$\{[^}]*\}\s*311 report/,
      `${f}: a bare count sits against 311 and reads as one number`,
    );
  }
  const hazards = readFileSync(new URL("../src/hazards.js", import.meta.url), "utf8");
  assert.match(hazards, /street-condition 311 report/, "use the wording the rest of the site uses");
});

// The endpoint labels printed as one garbled line because three spans shared a
// space-between row with no gap and nothing stopping the endpoints shrinking.
test("the percentile scale endpoints are bound to the scale structurally", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  const row = html.slice(html.indexOf('<div class="distax"'), html.indexOf('<div class="sevbar"'));
  assert.match(row, /class="dend"[^>]*>calmer</, "the calm endpoint needs its own class");
  assert.match(row, /class="dend"[^>]*>worst</, "the worst endpoint needs its own class");
  assert.match(row, /class="dmid"/, "the middle label needs its own class");
  assert.match(html, /\.distax\{display:grid/, "space-between with no gap is what collapsed them");
  assert.match(html, /\.distax \.dend\{white-space:nowrap\}/);
});

// The homepage says 7,355 graded and the corner page's scale says 8,254. Both
// are live constants and both are right; nothing on the page said why.
test("the two denominators are reconciled where they meet, from live constants", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED, scored: 7355 });
  assert.match(html, /class="distbridge"/);
  const bridge = html.slice(html.indexOf('class="distbridge"'), html.indexOf("</p>", html.indexOf('class="distbridge"')));
  assert.match(bridge, /8,254 crossings in the census/);
  assert.match(bridge, /7,355 with reported harm, graded/);
  // The remainder is not all zeroes: 629 of the census sit at zero and the rest
  // are quadrant duplicates the sweep collapses. Saying "the rest sit at zero"
  // would be a new wrong number in place of a missing one.
  assert.doesNotMatch(bridge, /rest sit at zero/);
});

test("the bridge says nothing rather than printing a zero denominator", () => {
  const html = PAGE(scored, { origin: "https://example.test", tier: TIERS.SCORED });
  assert.doesNotMatch(html, /0 with reported harm/);
});

// /watchlist printed 29 searches as if all 29 had run, on the page whose stated
// thesis is that publishing only your hits is indistinguishable from a search
// box that got lucky. Twenty-two of them were stored with their failure reason
// and the page rendered none of them.
const wlRecord = {
  source: "live",
  version: "v1",
  builtAt: "2026-08-20T13:11:04.521Z",
  windowDays: 90,
  articles: 101,
  rejected: 7,
  discarded: 27,
  entries: [],
  rejects: [],
  calls: 5,
  queries: [
    { query: "pedestrian struck in San Francisco", results: 15, local: false },
    { query: "crosswalk collision San Francisco", results: 15, local: false },
    { query: "sfchronicle crossing coverage", results: 0, local: true, failed: "Too many subrequests by single Worker invocation. To configure this limit, refer to https:" },
    { query: "crosswalk at an intersection in the Tenderloin, San Francisco", results: 0, local: false, failed: "Too many subrequests by single Worker invocation. To configure this limit, refer to https:" },
    { query: "crash at an intersection in the Excelsior, San Francisco", results: 0, local: false, failed: "Too many subrequests by single Worker invocation. To configure this limit, refer to https:" },
  ],
};

test("the watchlist reports attempted, completed and cut off, never just the attempt", () => {
  const html = WATCHLIST_PAGE(wlRecord, "https://example.test", null);
  const txt = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(txt, /5 searches attempted/);
  assert.match(txt, /2 completed/);
  assert.match(txt, /3 cut off/);
  // The cost claim was the worse half: the three that failed never reached Exa.
  assert.match(txt, /the pass costs 2 searches rather than 5/);
  assert.doesNotMatch(txt, /whole pass costs 5 searches/);
});

test("every cut-off query is a visible entry with its reason", () => {
  const html = WATCHLIST_PAGE(wlRecord, "https://example.test", null);
  for (const q of wlRecord.queries.filter((x) => x.failed)) {
    assert.ok(html.includes(q.query), `the page must list the query it never ran: ${q.query}`);
  }
  assert.match(html, /Too many subrequests by single Worker invocation\./);
  // The stored reason is truncated mid-URL; the page must not print that.
  assert.doesNotMatch(html, /refer to https:/);
});

test("the neighbourhood queries lost in the tail are named, not summarised", () => {
  const html = WATCHLIST_PAGE(wlRecord, "https://example.test", null);
  assert.ok(html.includes("Tenderloin"), "the Tenderloin query never runs and must be visible");
  assert.ok(html.includes("Excelsior"), "the Excelsior query never runs and must be visible");
  const txt = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(txt, /geographic blind spot/, "say that the gap is systematic, not random");
});

test("the empty state does not claim searches ran that did not", () => {
  const html = WATCHLIST_PAGE(wlRecord, "https://example.test", null);
  const txt = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.doesNotMatch(txt, /Nothing on the watchlist right now\. The searches ran/);
  assert.match(txt, /2 of 5 searches ran/);
});

test("a pass with nothing cut off says so plainly", () => {
  const clean = { ...wlRecord, queries: wlRecord.queries.map(({ failed, ...q }) => ({ ...q, results: 15 })) };
  const txt = WATCHLIST_PAGE(clean, "https://example.test", null).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(txt, /All 5 completed/);
  assert.match(txt, /Every search in the last pass reached Exa/);
  // The stat chip is the claim; the sentence "Nothing was cut off" is not.
  assert.doesNotMatch(txt, /\d+ cut off/);
});

// The scheduling fix is the operator's call and must not arrive as a side
// effect of a copy pass.
test("the page names the finding doc rather than fixing the cron quietly", () => {
  const html = WATCHLIST_PAGE(wlRecord, "https://example.test", null);
  assert.match(html, /WATCHLIST_SUBREQUEST_FINDING\.md/);
});
