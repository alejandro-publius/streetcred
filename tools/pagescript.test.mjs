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

test("the drumbeat names today's corner only while it is not the featured one", () => {
  const F = { today: "/t.jpg", hazards: "/h.jpg", fix: "/f.jpg" };
  const split = homeWith({
    ...EMBED, frames: F, auditedToday: false, date: "2026-08-18",
    alsoToday: { slug: "6th-and-jessie", name: "6th and Jessie" },
  });
  assert.match(split, /This morning the machine audited <a href="\/c\/6th-and-jessie">6th and Jessie<\/a>, imagery pending\./);
  // The collapse is the absence of configuration: no alsoToday, no line.
  const merged = homeWith({ ...EMBED, frames: F, auditedToday: true, date: "2026-08-20" });
  // Matched on the markup, not the class name: the stylesheet also contains
  // the string, so a bare /hcalso/ was asserting against BASE_CSS.
  assert.ok(!/class="hcalso"/.test(merged), "one corner means one claim and no extra line");
  assert.match(merged, /class="shdl"/, "and the slider is still there");
});
