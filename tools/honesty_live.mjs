// The live honesty regression suite.
//
// Every assertion in here is a bug this project already shipped and already
// fixed. The unit tests protect the functions; nothing protected the rendered
// result, so a refactor could put an orphaned disclaimer back under an image
// that does not exist, or let the masthead and the map alt text disagree about
// how many corners are graded, and the suite would stay green. This file reads
// the deployed HTML and asserts on what a visitor actually sees.
//
// It is deliberately NOT named *.test.mjs. .github/workflows/ci.yml runs
// `node --test tools/*.test.mjs` as the gate that blocks main, and a
// network-dependent suite in that gate turns main red every time a deploy is
// mid-flight or the Worker is briefly cold. Run it by hand or on a schedule:
//
//   node --test tools/honesty_live.mjs
//   STREETCRED_ORIGIN=http://127.0.0.1:8787 node --test tools/honesty_live.mjs
//
// Cost: every request here is to the free Worker. The press probe is
// restricted to corners that hold a stored batch press record (version v1),
// because /api/news falls through to a live Exa search for a corner that has
// none, and a test suite must never be able to spend money. See PRESS_CORNERS.
//
// A failure message names what the site claimed and what it should have
// claimed, so nobody has to open a browser to act on it.

import test from "node:test";
import assert from "node:assert/strict";

const ORIGIN = (process.env.STREETCRED_ORIGIN || "https://streetcred.thealexschroeder.workers.dev").replace(/\/$/, "");

// One fetch per surface, shared by every assertion below. Refetching per
// assertion would make the counter-agreement test meaningless: the press burn
// moves numbers between requests, and two tiles read a second apart could
// disagree for an honest reason and still fail.
const PAGES = {
  home: "/",
  audited: "/c/16th-mission",
  audited2: "/c/19th-and-mission",
  enriched: "/c/1st-and-bush",
  enriched2: "/c/fillmore-and-lombard",
  status: "/status",
  radar: "/radar",
  watchlist: "/watchlist",
  methodology: "/methodology",
  changes: "/changes",
};

// Corner pages, for the invariants that are about a corner rather than a page.
const CORNER_KEYS = ["audited", "audited2", "enriched", "enriched2"];

// Candidates for the press-checked corner. These are not assumed to be press
// checked: the suite probes them and asserts what it finds. They are on the
// list because each one holds a stored batch press record, so /api/news
// answers from KV and cannot reach a provider. If none of them is press
// checked any more, the test says so and tells you to re-run discovery rather
// than quietly passing.
const PRESS_CORNERS = ["fillmore-and-lombard", "1st-and-bush"];

// The disclaimer, copied verbatim from AI_DISCLAIMER in src/page.js. If this
// string stops matching, that is the finding, not a reason to loosen it.
const AI_DISCLAIMER = "The proposed fix is a visualization, not a photograph of anything that exists.";

// The site-wide footer honesty line, which carries the disclaimer on every
// route as a statement about the product. It is not a claim about an image on
// the page it appears on, which is why it is exempted below.
const FOOTER_LINE =
  "Hazard and proposed-fix images are AI generated from the Street View photograph. " +
  AI_DISCLAIMER +
  " Nothing here is sent to any official.";

// The press card's empty-state copy, verbatim from composePress in src/page.js.
const PRESS_NOTHING = "Searched and nothing found.";
const PRESS_NO_COVERAGE = "No coverage found.";
const PRESS_NOT_CHECKED = "Press coverage has not been searched at this corner yet.";
// The guard that makes the two impossible to render together: a card that
// lists citations returns before any sentence about what was not found.
const PRESS_GUARD = "if((n.items || []).length) return;";
const PRESS_NOTHING_EMITTER = `box.innerHTML = '<p class="empty">${PRESS_NOTHING} '`;
const PRESS_NO_COVERAGE_EMITTER = `box.innerHTML = '<div class="m">${PRESS_NO_COVERAGE}</div>'`;
// The not-yet-checked sentence is written by the news loader, not the
// composer, and has a guard of its own.
const PRESS_NOT_CHECKED_GUARD = "if(d.note && !(d.items || []).length){";
const PRESS_NOT_CHECKED_EMITTER = `'<p class="empty">${PRESS_NOT_CHECKED}</p>'`;

// The date shape produced by the when() formatters in src/status.js and the
// press as-of stamp: Intl en-US, short month, numeric day, numeric hour,
// two-digit minute, America/Los_Angeles. "Aug 19, 10:46 PM".
const AS_OF = /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?(?:AM|PM)$/;

const num = (s) => Number(String(s).replace(/,/g, ""));
const one = (html, re, what) => {
  const m = html.match(re);
  assert.ok(m, `${what} was not found in the served HTML. The page no longer renders it, or its markup changed.`);
  return m;
};
const count = (hay, needle) => hay.split(needle).length - 1;

// Every <img> on a page, as { src, alt }.
function images(html) {
  return [...html.matchAll(/<img\b[^>]*>/g)].map((m) => {
    const tag = m[0];
    const src = tag.match(/\ssrc="([^"]*)"/);
    const alt = tag.match(/\salt="([^"]*)"/);
    return { tag, src: src ? src[1] : null, alt: alt ? alt[1] : null };
  });
}

// ---------------------------------------------------------------- the fetch

const P = {};
const HEAD = {};
await Promise.all(
  Object.entries(PAGES).map(async ([key, path]) => {
    const r = await fetch(ORIGIN + path);
    HEAD[key] = { status: r.status, type: r.headers.get("content-type") || "", path };
    P[key] = await r.text();
  }),
);

const boardRes = await fetch(`${ORIGIN}/api/board`);
const board = await boardRes.json();

// The press probe. Stops at the first corner that really is press checked, so
// at most two KV-backed requests happen.
const press = { corner: null, payload: null, empty: null, emptyPayload: null };
for (const slug of PRESS_CORNERS) {
  const d = await (await fetch(`${ORIGIN}/api/news?x=${slug}`)).json();
  if (d.lane !== "press-checked") continue;
  if ((d.items || []).length && !press.corner) {
    press.corner = slug;
    press.payload = d;
  } else if (!(d.items || []).length && !press.empty) {
    press.empty = slug;
    press.emptyPayload = d;
  }
}

// The corner page that belongs to the press-checked corner with headlines, so
// invariant 6 asserts against the page that would render the contradiction.
const pressHtml = press.corner
  ? await (await fetch(`${ORIGIN}/c/${press.corner}`)).text()
  : null;

// The audited corner's record tiles, to check the swept/live as-of contract.
const auditedStats = await (await fetch(`${ORIGIN}/api/stats?x=16th-mission`)).json();

// ------------------------------------------------------- 1. every page is a page

test("every page returns 200 and text/html", () => {
  for (const [key, h] of Object.entries(HEAD)) {
    assert.equal(
      h.status,
      200,
      `${h.path} returned ${h.status}. Every surface in this suite is a public page and must return 200.`,
    );
    assert.match(
      h.type,
      /^text\/html/,
      `${h.path} served content-type "${h.type}". It should have served text/html.`,
    );
    assert.match(
      P[key],
      /<!doctype html>/i,
      `${h.path} returned 200 text/html but no doctype, so it is an error body wearing a page's headers.`,
    );
  }
  assert.equal(boardRes.status, 200, `/api/board returned ${boardRes.status}, so the roster gap cannot be checked.`);
});

// ------------------------------------------------- 2. no orphaned fix disclaimer

test("the homepage hero disclaims its fix render only when it renders one", () => {
  const src = one(P.home, /var SRC=(\{.*?\});/, "the hero corner's frame map (var SRC=...)");
  const frames = JSON.parse(src[1]);
  const disc = P.home.match(/<p class="hcdisclaim"[^>]*>([^<]*)<\/p>/);
  if (frames.fix) {
    assert.ok(
      disc,
      `The homepage hero renders a proposed-fix frame (${frames.fix}) and claimed nothing about it. ` +
        `It should have rendered the hcdisclaim paragraph reading "${AI_DISCLAIMER}".`,
    );
    assert.equal(
      disc[1],
      AI_DISCLAIMER,
      `The homepage hero disclaimer reads "${disc[1]}". It should read "${AI_DISCLAIMER}", verbatim from AI_DISCLAIMER in src/page.js.`,
    );
  } else {
    assert.equal(
      disc,
      null,
      `The homepage hero renders no proposed-fix frame, yet it claimed "${disc && disc[1]}". ` +
        `A disclaimer about an image that is not on the page is an orphan and must not be rendered.`,
    );
    assert.ok(
      P.home.includes("Imagery audit pending"),
      "The homepage hero has no fix frame and neither disclaimed nor said what is missing. " +
        'It should have rendered the "Imagery audit pending" sentence.',
    );
  }
});

test("corner pages carry the fix disclaimer only as the site-wide footer line", () => {
  for (const key of CORNER_KEYS) {
    const html = P[key];
    const n = count(html, AI_DISCLAIMER);
    assert.equal(
      n,
      1,
      `${PAGES[key]} contains the sentence "${AI_DISCLAIMER}" ${n} time(s). ` +
        `It should appear exactly once, inside the footer honesty line, and never as a second standalone claim ` +
        `about an image the page does not render.`,
    );
    assert.ok(
      html.includes(FOOTER_LINE),
      `${PAGES[key]} carries the disclaimer sentence but not the full footer honesty line. ` +
        `It should read "${FOOTER_LINE}".`,
    );
    assert.equal(
      count(html, '<p class="hcdisclaim"'),
      0,
      `${PAGES[key]} renders an hcdisclaim paragraph. That element belongs to the homepage hero, which is the only ` +
        `place a proposed-fix frame is served inline; on a corner page it is an orphaned disclaimer.`,
    );
  }
});

// ------------------------------------------------------- 3. as-of on stored counts

test("the homepage press-citations tile carries an as-of date", () => {
  const cell = one(
    P.home,
    /<span class="sbnum">([\d,]+)<\/span><span class="sblabel">press citations found<\/span><span class="sbnote">([^<]*)<\/span>/,
    "the statband press-citations cell",
  );
  const [, value, note] = cell;
  const m = note.match(/as of (.+)$/);
  assert.ok(
    m,
    `The homepage states "${value} press citations found" with the note "${note}". ` +
      `That figure is a stored count written by a batch run, so the note should end with "as of <date>".`,
  );
  assert.match(
    m[1],
    AS_OF,
    `The homepage press-citations tile stamps its as-of as "${m[1]}". ` +
      `It should carry a formatted local timestamp such as "Aug 19, 4:40 PM".`,
  );
});

test("the /status press scan card carries a last-reported date", () => {
  if (!P.status.includes("<h2>Press scan")) {
    assert.fail(
      "/status renders no press scan card at all. If the scan has never run that is honest, but this suite " +
        "expects the card whenever a scan record exists; check /status by hand before deleting this test.",
    );
  }
  const done = one(
    P.status,
    /<span class="ep">Corners checked<\/span>\s*<span class="ms">([\d,]+) over/,
    "the press scan's corners-checked row",
  );
  const stamp = one(
    P.status,
    /<span class="ep">Last reported<\/span>\s*<span class="ms">([^<]*)<\/span>/,
    "the press scan's last-reported row",
  );
  assert.match(
    stamp[1],
    AS_OF,
    `/status says the press scan has checked ${done[1]} corners and stamps that count "${stamp[1]}". ` +
      `A stored progress figure must carry a formatted timestamp such as "Aug 19, 10:46 PM"; this scan is still ` +
      `running, so a count without a date is a claim that goes stale the moment it is read.`,
  );
});

test("the /status latest run names the run it is reporting", () => {
  const m = one(P.status, /<h2>Latest run, ([^<]*)<\/h2>/, "the /status latest-run heading");
  assert.match(
    m[1],
    AS_OF,
    `/status heads its synthetic-monitor card "Latest run, ${m[1]}". ` +
      `It should name the run's own timestamp, formatted like "Aug 19, 10:07 PM".`,
  );
});

test("corner record tiles are counted live or stamped with the sweep date", () => {
  const html = P.audited;
  if (auditedStats.asOf) {
    assert.ok(
      html.includes('"Counted in the citywide sweep of "'),
      `/api/stats for 16th-mission returns swept figures as of ${auditedStats.asOf}, but /c/16th-mission ships no ` +
        `code that prints the sweep date. A stored count on a tile must say when it was true.`,
    );
  } else {
    assert.equal(
      auditedStats.source,
      "live",
      `/api/stats for 16th-mission reports source "${auditedStats.source}" with no asOf. ` +
        `A figure that is neither counted live nor stamped with a sweep date cannot be dated by the page at all.`,
    );
    assert.ok(
      html.includes('<p class="statcap" id="statcap" hidden>'),
      `/c/16th-mission counts its tiles live, so the sweep caption must ship hidden and stay hidden. ` +
        `It is not rendered hidden in the served HTML.`,
    );
  }
});

// ------------------------------------------------------------ 4. counter agreement

test("every citywide scored count on the homepage names the same number", () => {
  const sites = {
    masthead: one(P.home, /<span class="mastcount">([\d,]+) SF intersections scored<\/span>/, "the masthead count")[1],
    subtitle: one(
      P.home,
      /<p class="scope" id="scope">([\d,]+) intersections graded citywide/,
      "the homepage subtitle",
    )[1],
    "map alt text": one(
      P.home,
      /alt="Map of San Francisco with ([\d,]+) graded intersections marked/,
      "the city map's alt text",
    )[1],
    "city mark ticker": one(P.home, /<span class="csub">([\d,]+) corners graded<\/span>/, "the San Francisco mark")[1],
    "stat band tile": one(
      P.home,
      /<span class="sbnum">([\d,]+)<\/span><span class="sblabel">intersections graded<\/span>/,
      "the statband graded tile",
    )[1],
    "show-all button": one(P.home, /Show all ([\d,]+) graded corners/, "the show-all button")[1],
    "meta description": one(
      P.home,
      /<meta name="description" content="([\d,]+) San Francisco intersections scored/,
      "the homepage meta description",
    )[1],
  };
  const values = Object.entries(sites).map(([k, v]) => [k, num(v)]);
  const [, first] = values[0];
  for (const [where, v] of values) {
    assert.equal(
      v,
      first,
      `The homepage names two different citywide scored counts: ${values
        .map(([k, n]) => `${k} says ${n.toLocaleString("en-US")}`)
        .join(", ")}. ` +
        `The ${where} disagrees. Every one of them reads the same city:meta total, so they must all print the same number.`,
    );
  }
  assert.ok(first > 0, `The homepage prints ${first} as its citywide scored count, which is not a count of anything.`);
});

test("every page's masthead names the same citywide scored count", () => {
  const seen = {};
  for (const key of Object.keys(PAGES)) {
    seen[PAGES[key]] = num(
      one(P[key], /<span class="mastcount">([\d,]+) SF intersections scored<\/span>/, `the masthead on ${PAGES[key]}`)[1],
    );
  }
  const values = [...new Set(Object.values(seen))];
  assert.equal(
    values.length,
    1,
    `The masthead prints different scored counts on different routes: ${Object.entries(seen)
      .map(([p, v]) => `${p} says ${v.toLocaleString("en-US")}`)
      .join(", ")}. Every route passes the same live count into MASTHEAD, so they must agree.`,
  );
});

test("the subtitle, the map alt text and the stat tile name the same fully-audited count", () => {
  const subtitle = one(
    P.home,
    /<p class="scope" id="scope">[\d,]+ intersections graded citywide, ([\d,]+) fully audited/,
    "the homepage subtitle's audited count",
  )[1];
  const alt = one(
    P.home,
    /alt="Map of San Francisco with [\d,]+ graded intersections marked, ([\d,]+) fully audited/,
    "the map alt text's audited count",
  )[1];
  const tile = one(
    P.home,
    /<span class="sbnum">([\d,]+)<\/span><span class="sblabel">fully audited<\/span>/,
    "the statband fully-audited tile",
  )[1];
  const got = { subtitle: num(subtitle), "map alt text": num(alt), "stat tile": num(tile) };
  const values = [...new Set(Object.values(got))];
  assert.equal(
    values.length,
    1,
    `The homepage names different fully-audited counts: ${Object.entries(got)
      .map(([k, v]) => `${k} says ${v}`)
      .join(", ")}. All three read the same tiers.fullyAudited, so they must print the same number.`,
  );
  // The pending clause is the only honest way to name a partially audited
  // corner, and it must appear in both prose sites or in neither.
  const subPending = /(\d[\d,]*) more with imagery pending/.exec(P.home);
  const altPending = /(\d[\d,]*) with imagery pending/.exec(P.home);
  assert.equal(
    Boolean(subPending),
    Boolean(altPending),
    `The homepage mentions corners with imagery pending in one place and not the other: subtitle ${
      subPending ? `says ${subPending[1]}` : "says nothing"
    }, map alt text ${altPending ? `says ${altPending[1]}` : "says nothing"}. ` +
      `Both are written from textAudited, so either both name it or neither does.`,
  );
});

// ------------------------------------------------------ 5. the roster gap is stated

test("the audited roster is at least as large as the fully-audited count", () => {
  const fully = num(
    one(
      P.home,
      /<span class="sbnum">([\d,]+)<\/span><span class="sblabel">fully audited<\/span>/,
      "the statband fully-audited tile",
    )[1],
  );
  const roster = Number(board.count);
  assert.equal(
    roster,
    (board.corners || []).length,
    `/api/board reports count ${roster} but ships ${(board.corners || []).length} corners. ` +
      `The count is the roster's own length and cannot differ from it.`,
  );
  assert.ok(
    roster >= fully,
    `/api/board lists ${roster} audited corners while the homepage claims ${fully} fully audited. ` +
      `The roster holds every corner the pipeline has run, including ones whose imagery lane came back partial, ` +
      `so it can only be larger than or equal to the fully-audited count. A roster smaller than the claim means ` +
      `the homepage is counting corners the board does not have.`,
  );
});

// --------------------------------------------- 6. the press card cannot contradict itself

test("a press-checked corner is discovered, not assumed", () => {
  assert.ok(
    press.corner || press.empty,
    `None of the candidate corners (${PRESS_CORNERS.join(", ")}) reports lane "press-checked" from /api/news any more. ` +
      `Re-run discovery over the board roster and update PRESS_CORNERS with corners that hold a stored v1 press ` +
      `record, so this suite never triggers a paid search.`,
  );
});

test("a press-checked corner listing headlines cannot also say nothing was found", () => {
  if (!press.corner) {
    assert.fail(
      `No candidate corner is press-checked with at least one headline, so the contradiction this test exists to ` +
        `catch cannot be exercised. Candidates probed: ${PRESS_CORNERS.join(", ")}.`,
    );
  }
  const items = press.payload.items || [];
  assert.ok(
    items.length >= 1,
    `/api/news for ${press.corner} was selected as the press-checked corner with headlines but lists ${items.length}.`,
  );
  const guard = pressHtml.indexOf(PRESS_GUARD);
  const emitter = pressHtml.indexOf(PRESS_NOTHING_EMITTER);
  assert.notEqual(
    guard,
    -1,
    `/c/${press.corner} lists ${items.length} headline(s) and no longer ships the composer guard ` +
      `"${PRESS_GUARD}". Without it the card can print "${PRESS_NOTHING}" underneath its own citations, ` +
      `which is the exact contradiction this guard was added to remove.`,
  );
  assert.notEqual(
    emitter,
    -1,
    `/c/${press.corner} no longer ships the empty-state emitter for "${PRESS_NOTHING}", so the guard ordering ` +
      `below cannot be checked. Confirm src/page.js still composes the press card in one place.`,
  );
  assert.ok(
    guard < emitter,
    `/c/${press.corner} lists ${items.length} headline(s), but its press composer reaches the sentence ` +
      `"${PRESS_NOTHING}" before the guard "${PRESS_GUARD}" that is supposed to stop it. ` +
      `A card that cites coverage must return before it says nothing was found.`,
  );
  // The same guard covers the softer sentence. "No coverage found." under a
  // list of citations is the same lie in a quieter voice.
  const noCoverage = pressHtml.indexOf(PRESS_NO_COVERAGE_EMITTER);
  assert.notEqual(
    noCoverage,
    -1,
    `/c/${press.corner} no longer ships the "${PRESS_NO_COVERAGE}" emitter, so its ordering cannot be checked.`,
  );
  assert.ok(
    guard < noCoverage,
    `/c/${press.corner} lists ${items.length} headline(s), but its press composer reaches "${PRESS_NO_COVERAGE}" ` +
      `before the guard "${PRESS_GUARD}". A card that cites coverage must never fall through to the empty state.`,
  );
  // The not-yet-checked sentence lives in the news loader rather than the
  // composer, and carries its own guard. It must sit behind that guard, not
  // beside the citations.
  const notCheckedGuard = pressHtml.indexOf(PRESS_NOT_CHECKED_GUARD);
  const notChecked = pressHtml.indexOf(PRESS_NOT_CHECKED_EMITTER);
  assert.notEqual(
    notChecked,
    -1,
    `/c/${press.corner} no longer ships the "${PRESS_NOT_CHECKED}" emitter, so its guard cannot be checked.`,
  );
  assert.ok(
    notCheckedGuard !== -1 && notCheckedGuard < notChecked,
    `/c/${press.corner} renders "${PRESS_NOT_CHECKED}" without first testing that the lane has not run ` +
      `("${PRESS_NOT_CHECKED_GUARD}"). This corner has been checked and lists ${items.length} headline(s), ` +
      `so an ungated version of that sentence would contradict its own card.`,
  );
});

test("a press-checked corner with no headlines lists none", () => {
  if (!press.empty) {
    assert.fail(
      `No candidate corner is press-checked with zero headlines, so the honest empty state cannot be exercised. ` +
        `Candidates probed: ${PRESS_CORNERS.join(", ")}.`,
    );
  }
  const d = press.emptyPayload;
  assert.equal(
    (d.items || []).length,
    0,
    `/api/news for ${press.empty} was selected as the empty press-checked corner but returns ` +
      `${(d.items || []).length} item(s), so the card would print "${PRESS_NOTHING}" above its own citations.`,
  );
  assert.ok(
    typeof d.found === "number" && d.found >= 0,
    `/api/news for ${press.empty} says nothing was found but reports no read count. The empty sentence names how ` +
      `many articles were read across how many searches, and it cannot name a number the payload does not carry.`,
  );
  assert.ok(
    d.cost && typeof d.cost.searches === "number",
    `/api/news for ${press.empty} says nothing was found but carries no search count. ` +
      `"${PRESS_NOTHING}" is only honest when the page can say how many searches produced it.`,
  );
});

// -------------------------------------------------- 7. the radar is whole or empty

test("/radar renders a feed or the explicit empty sentence, never a half state", () => {
  const monitors = num(
    one(P.radar, /<div class="ricell"><b>([\d,]+)<\/b><span>monitors running/, "the radar's monitor tile")[1],
  );
  const feed = P.radar.includes('<div class="rfeed">');
  const emptyRunning =
    "No detections yet. The monitors are running and nothing has been published about a watched corridor since they started.";
  const emptyNone = "No detections yet. The monitors are not created yet.";
  if (monitors > 0) {
    assert.ok(
      feed || P.radar.includes(emptyRunning),
      `/radar claims ${monitors} monitors running and renders neither a detection feed nor the sentence ` +
        `"${emptyRunning}". A page that claims standing queries must show what they caught or say plainly that ` +
        `they caught nothing.`,
    );
    if (!feed) {
      assert.equal(
        count(P.radar, emptyNone),
        0,
        `/radar claims ${monitors} monitors running and also says "${emptyNone}". Those cannot both be true.`,
      );
    }
    const queries = P.radar.match(/<span class="lanenums">([\d,]+) monitors<\/span>/);
    if (queries) {
      assert.equal(
        num(queries[1]),
        monitors,
        `/radar's tile claims ${monitors} monitors running while its standing-queries heading claims ` +
          `${num(queries[1])}. Both are the length of the same list.`,
      );
    }
  } else {
    assert.equal(
      feed,
      false,
      `/radar claims 0 monitors running and still renders a detection feed. A feed with no monitor behind it is a ` +
        `claim the page cannot support.`,
    );
    assert.ok(
      P.radar.includes(emptyNone),
      `/radar claims 0 monitors running and does not say so plainly. It should render "${emptyNone}".`,
    );
  }
});

// ------------------------------------------------------------ 8. one tier per corner

test("no corner page claims two tiers at once", () => {
  for (const key of CORNER_KEYS) {
    const tiers = [...P[key].matchAll(/class="tierchip t-([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(
      tiers.length > 0,
      `${PAGES[key]} renders no tier chip at all, so a reader cannot tell how much of this corner was checked.`,
    );
    const distinct = [...new Set(tiers)];
    assert.equal(
      distinct.length,
      1,
      `${PAGES[key]} renders ${distinct.length} different tiers at once: ${distinct.join(" and ").toUpperCase()}. ` +
        `A corner is AUDITED or ENRICHED or SCORED, never two of them; the sticky bar and the corner card read the ` +
        `same resolved tier.`,
    );
    assert.ok(
      ["audited", "enriched", "scored"].includes(distinct[0]),
      `${PAGES[key]} renders tier "${distinct[0]}", which is not part of the tier vocabulary ` +
        `(audited, enriched, scored).`,
    );
  }
});

// ------------------------------------------------- 9. AI imagery is labelled as AI

test("every AI-generated image served inline is labelled AI in its alt text", () => {
  for (const [key, html] of Object.entries(P)) {
    for (const img of images(html)) {
      if (!img.src || !img.src.startsWith("/gen/")) continue;
      const isPhotograph = /\/today\.(jpg|jpeg|png|webp)$/.test(img.src);
      if (isPhotograph) {
        assert.match(
          img.alt || "",
          /Street View/,
          `${PAGES[key]} serves the unedited frame ${img.src} with alt "${img.alt}". ` +
            `The real photograph must name its source, Street View, so it is not mistaken for a render.`,
        );
        continue;
      }
      assert.ok(
        img.alt && /AI visualization|Automated hazard audit/.test(img.alt),
        `${PAGES[key]} serves the generated image ${img.src} with alt "${img.alt}". ` +
          `A generated frame must say so in its alt text: "AI visualization ..." for a proposed fix, ` +
          `"Automated hazard audit ..." for an overlay.`,
      );
      if (/\/fix\.(jpg|jpeg|png|webp)$/.test(img.src)) {
        assert.match(
          img.alt,
          /Not a photograph/,
          `${PAGES[key]} serves the proposed-fix render ${img.src} with alt "${img.alt}", which never says it is ` +
            `not a photograph. The alt text is the only disclosure a screen reader gets.`,
        );
      }
    }
  }
});

test("a corner page labels its AI overlays before it can show them", () => {
  for (const key of CORNER_KEYS) {
    const html = P[key];
    // The overlay ships with no src: nothing generated is on screen until the
    // imagery lane answers, and the alt is rewritten per state before the src
    // is set. Assert both halves.
    const overlay = images(html).find((i) => / id="overlay"/.test(i.tag));
    assert.ok(overlay, `${PAGES[key]} ships no comparison overlay element.`);
    assert.equal(
      overlay.src,
      null,
      `${PAGES[key]} ships the overlay with src "${overlay.src}" already set, before any state has named what it is. ` +
        `The overlay must stay empty until render() has written the alt text for the frame it is about to load.`,
    );
    assert.ok(
      html.includes('ovImg.alt = "AI visualization of the proposed fix at "'),
      `${PAGES[key]} no longer sets an AI-naming alt for the proposed-fix overlay. ` +
        `Without it the render loads with whatever alt the previous state left behind.`,
    );
    assert.ok(
      html.includes('ovImg.alt = "Automated hazard audit of "'),
      `${PAGES[key]} no longer sets an alt naming the hazard overlay as an automated audit.`,
    );
    assert.ok(
      html.includes("An AI visualization of continental crosswalks, a protected bike lane, and a corner curb extension. Not a photograph of anything that exists."),
      `${PAGES[key]} no longer carries the proposed-fix caption that says the render is not a photograph of ` +
        `anything that exists. The caption sits under the image where a phone shows it without a scroll.`,
    );
  }
});
