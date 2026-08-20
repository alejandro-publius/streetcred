// The addendum's acceptance criteria, checked against a deployed origin.
//
// Deliberately NOT named *.test.mjs: .github/workflows/ci.yml runs
// `node --test tools/*.test.mjs` as the gate that blocks main, and a
// network-dependent suite there turns main red every time a deploy is mid
// flight. Same reasoning, and the same convention, as tools/honesty_live.mjs.
//
//   node --test tools/addendum_matrix.mjs
//   STREETCRED_ORIGIN=https://streetcred-preview.thealexschroeder.workers.dev \
//     node --test tools/addendum_matrix.mjs
//
// Cost: every request is a read of the free Worker. The letter probe is safe
// because /api/letter serves from the backoff branch or a stored letter and
// never drafts; a suite must never be able to spend money.

import test from "node:test";
import assert from "node:assert/strict";
import { DISTRIBUTION } from "../src/score.js";
import { WATCHLIST_QUERIES, runCounts } from "../src/press.js";
import { CITY_BOUNDS } from "../src/city.js";
import { SUPERVISORS, FALLBACK_OFFICIAL } from "../src/data.js";

const ORIGIN = (process.env.STREETCRED_ORIGIN || "https://streetcred.thealexschroeder.workers.dev").replace(/\/$/, "");

const PATHS = {
  home: "/",
  audited: "/c/16th-mission",
  enriched: "/c/16th-and-potrero",
  enriched2: "/c/fillmore-and-lombard",
  // Shard-only: no stored corner record, so it takes the score-tier path
  // where the figures are already in hand and can be rendered server-side.
  scored: "/c/arleta-and-bay-shore",
  methodology: "/methodology",
  watchlist: "/watchlist",
  status: "/status",
};

const page = {};
const api = {};

// One fetch per surface, shared by every assertion, so two checks a second
// apart cannot disagree for an honest reason and still fail.
before: {
  for (const [k, p] of Object.entries(PATHS)) {
    const r = await fetch(ORIGIN + p);
    assert.equal(r.status, 200, `${p} did not return 200`);
    page[k] = await r.text();
  }
  for (const [k, p] of [
    ["watchlist", "/api/watchlist"],
    ["letterEnriched", "/api/letter?x=16th-and-potrero"],
    ["letterFillmore", "/api/letter?x=fillmore-and-lombard"],
    ["letterAudited", "/api/letter?x=16th-mission"],
    ["letterScored", "/api/letter?x=6th-and-stevenson"],
    ["statsEnriched", "/api/stats?x=16th-and-potrero"],
  ]) {
    api[k] = await fetch(ORIGIN + p).then((r) => r.json());
  }
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// -------------------------------------------------- 7B.1  dates agree
test("no page renders a date by slicing a UTC timestamp", () => {
  for (const [name, html] of Object.entries(page)) {
    assert.doesNotMatch(
      html,
      /toISOString\(\)\.slice\(0, ?10\)/,
      `${name}: a client script still stamps a UTC date`,
    );
  }
});

test("every page that stamps a date in the browser carries the Pacific helper", () => {
  for (const name of ["home", "audited", "enriched"]) {
    assert.match(page[name], /function ptDay\(ts\)/, `${name}: missing the Pacific day helper`);
    assert.match(page[name], /America\/Los_Angeles/, `${name}: helper is not pinned to Pacific`);
  }
});

// -------------------------------------------------- 7B.2  map bounds
test("the homepage map's first paint is bounded to the city", () => {
  assert.match(page.home, /var CITY_BOUNDS = \[/, "the bounds must reach the browser");
  const m = page.home.match(/var CITY_BOUNDS = (\[[^\]]+\])/);
  assert.ok(m, "bounds array not found");
  const [s, w, n, e] = JSON.parse(m[1]);
  assert.deepEqual([s, w, n, e], CITY_BOUNDS, "the page must ship the generated constant");
  assert.ok(n < 37.84, "north edge reaches Sausalito");
  assert.ok(s > 37.69, "south edge reaches South San Francisco");
  assert.match(page.home, /bounds: CITY_BOUNDS/, "the map must be told to fit them");
});

// -------------------------------------------------- 7B.3  leaderboard
test("the leaderboard labels the percentile once and ranks by a distinct index", () => {
  const t = text(page.home);
  assert.match(t, /99th percentile/, "the shared percentile belongs in the header, once");
  const board = page.home.slice(page.home.indexOf('class="board"'), page.home.indexOf('class="opsband"'));
  const vals = [...board.matchAll(/class="ridx"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.ok(vals.length >= 10, `expected a full board, got ${vals.length} rows`);
  assert.ok(new Set(vals).size > 1, "every row shows the same number, so the ranking ranks nothing");
  // The worst corner must lead.
  const nums = vals.map(Number).filter(Number.isFinite);
  assert.deepEqual(nums, [...nums].sort((a, b) => b - a), "the board must read worst first");
});

// -------------------------------------------------- 7B.4  queue copy
test("the queue line says audit queue", () => {
  const t = text(page.home);
  if (/corners in /.test(t)) {
    assert.match(t, /corners in the audit queue, worst first/);
    assert.doesNotMatch(t, /corners in line, worst first/);
  }
});

// -------------------------------------------------- 7B.5  legend chips
test("the A to F legend renders as grade-coloured chips", () => {
  for (const g of ["A", "B", "C", "D", "F"]) {
    assert.match(page.home, new RegExp(`class="gk g${g}">${g}<`), `legend ${g} is not a chip`);
  }
  assert.match(page.home, /\.gk\{/, "the chip has no style");
});

// -------------------------------------------------- 7C.1  letters
test("no served letter fails the lane-consistency rules", () => {
  for (const [k, d] of Object.entries(api).filter(([k]) => k.startsWith("letter"))) {
    if (!d?.text) continue; // pending or not drafted: nothing asserted
    const t = d.text;
    // Magnitude words without a displayed figure behind them.
    if (/\bhundreds\b/i.test(t)) {
      const shown = Number(api.statsEnriched?.crashes ?? 0);
      assert.ok(shown >= 100, `${k}: claims hundreds where the page shows ${shown}`);
    }
    // The three sentences the sample shipped.
    assert.doesNotMatch(t, /Residents describe the same problem in their own words/, `${k}: sample resident claim`);
    assert.doesNotMatch(t, /Local reporting has covered pedestrian safety on this corridor repeatedly/, `${k}: sample press claim`);
    assert.doesNotMatch(t, /City records show hundreds of collisions/, `${k}: sample magnitude claim`);
  }
});

test("the sample letter is served nowhere", () => {
  for (const [k, d] of Object.entries(api).filter(([k]) => k.startsWith("letter"))) {
    assert.notEqual(d?.source, "sample", `${k}: still serving the sample`);
  }
});

test("a corner with no verified letter shows the honest pending state", () => {
  const pending = Object.entries(api)
    .filter(([k]) => k.startsWith("letter"))
    .filter(([, d]) => !d?.text);
  for (const [k, d] of pending) {
    assert.ok(
      d.source === "pending-verification" || d.source === "ondemand",
      `${k}: empty letter with an unexpected source ${d.source}`,
    );
    assert.ok(d.note && d.note.length > 10, `${k}: no note explaining the empty state`);
    if (d.source === "pending-verification") {
      assert.match(d.note, /A verified letter for this corner is queued behind generation\./);
    }
  }
});

// -------------------------------------------------- 7D.1  addressee
test("no served letter names an official who is not the corner's representative", () => {
  const known = new Set(Object.values(SUPERVISORS));
  for (const [k, d] of Object.entries(api).filter(([k]) => k.startsWith("letter"))) {
    if (!d?.text) continue;
    const m = d.text.match(/^\s*Dear\s+([^,\n]+?)\s*[,:]/m);
    if (!m) continue;
    const named = m[1];
    const isSupervisor = /^Supervisor\s/.test(named);
    if (isSupervisor) {
      const surname = named.replace(/^Supervisor\s+/, "").split(" ").slice(-1)[0];
      assert.ok(
        [...known].some((n) => n.split(" ").slice(-1)[0] === surname),
        `${k}: addressed to ${named}, who is not in the Supervisor table`,
      );
    } else {
      assert.equal(named, FALLBACK_OFFICIAL, `${k}: addressed to ${named}, neither a Supervisor nor the citywide official`);
    }
  }
});

// -------------------------------------------------- 7C.2  stat tiles
test("stat tiles carry final values in the raw HTML", () => {
  const html = page.scored;
  const block = html.slice(html.indexOf('<div class="stats"'), html.indexOf('<p class="statcap"'));
  assert.ok(block.length > 40, "stats block not found");
  assert.doesNotMatch(block, /class="n sk"/, "a skeleton where the figure is already in hand");

  // The invariant is that the text a reader sees IS the value, not that the
  // value is nonzero. A corner with no injury collisions in five years shows a
  // 0 and means it; the bug was a 0 standing in for a number the render had.
  const tiles = [...block.matchAll(/<div class="n" data-to="([^"]*)">([^<]*)<\/div>/g)];
  assert.equal(tiles.length, 3, `expected three tiles, found ${tiles.length}`);
  for (const [, to, shown] of tiles) {
    if (to === "") {
      assert.equal(shown, "n/a", "an unknown figure says n/a");
      continue;
    }
    assert.equal(
      shown.replace(/,/g, ""),
      String(Number(to)),
      `tile renders "${shown}" while its value is ${to}`,
    );
  }
});

test("the corner page carries a print stylesheet and a stats flush", () => {
  assert.match(page.audited, /@media print\{/);
  assert.match(page.audited, /function flushStats\(\)/);
  assert.match(page.audited, /beforeprint/);
});

// -------------------------------------------------- 7C.3  copy seams
test("no count is left butting against the literal 311", () => {
  for (const [name, html] of Object.entries(page)) {
    assert.doesNotMatch(text(html), /\b\d+ 311 report/, `${name}: reads as one number`);
  }
});

test("the percentile scale endpoints are separate elements", () => {
  for (const name of ["audited", "enriched", "scored"]) {
    const html = page[name];
    const row = html.slice(html.indexOf('<div class="distax"'), html.indexOf('<div class="sevbar"'));
    assert.match(row, /class="dend"/, `${name}: endpoints are not bound to the scale`);
    assert.match(row, /class="dmid"/, `${name}: middle label is not its own element`);
  }
});

test("the map popup is sized to the map rather than to a fixed 300px", async () => {
  const js = await fetch(ORIGIN + "/leafmap.js").then((r) => r.text());
  assert.match(js, /function popupOpts\(map\)/);
  assert.match(js, /maxWidth: Math\.max\(180/);
  assert.doesNotMatch(js, /window\.L\.popup\(\)\.setLatLng/, "the bare default is what truncated the text");
});

test("the denominator bridge reconciles the census and the graded count", () => {
  const t = text(page.scored);
  const census = DISTRIBUTION.length.toLocaleString("en-US");
  assert.ok(t.includes(`${census} crossings in the census`), "the bridge is missing where 8,254 appears");
  assert.match(t, /with reported harm, graded/);
  assert.doesNotMatch(t, /0 with reported harm/, "a zero denominator must not print");
});

// -------------------------------------------------- 7D.2 and 7D.3  counts
test("no page states a stale watchlist search count", () => {
  for (const [name, html] of Object.entries(page)) {
    assert.doesNotMatch(text(html), /Seven citywide semantic searches/i, `${name}: stale seven`);
  }
});

test("methodology and watchlist counts agree with the stored completion record", () => {
  const run = runCounts(api.watchlist);
  assert.ok(run.attempted > 0, "the watchlist record has no queries in it");

  const meth = text(page.methodology);
  assert.ok(
    meth.includes(`${WATCHLIST_QUERIES.length} citywide semantic searches are attempted`),
    `methodology does not state the live attempt (${WATCHLIST_QUERIES.length})`,
  );
  if (run.failed) {
    assert.ok(meth.includes(`${run.completed} of them completed`), "methodology does not state what completed");
  } else {
    assert.ok(meth.includes(`All ${run.completed} completed`), "methodology does not state that all completed");
  }

  const wl = text(page.watchlist);
  assert.ok(wl.includes(`${run.attempted} searches attempted`), "watchlist does not state the attempt");
  assert.ok(wl.includes(`${run.completed} completed`), "watchlist does not state what completed");
  if (run.failed) {
    assert.ok(wl.includes(`${run.failed} cut off`), "watchlist does not state what was cut off");
  }
  assert.doesNotMatch(wl, /whole pass costs/, "the cost claim must be what ran, not what was attempted");
});

// The decision: the lane gets its own invocation so it stops inheriting the
// audit's spent budget. This is the cell that says whether that worked.
test("the watchlist completes every search it attempts", () => {
  const run = runCounts(api.watchlist);
  assert.equal(
    run.failed,
    0,
    `${run.failed} of ${run.attempted} searches were cut off: ${run.commonReason || "no reason recorded"}`,
  );
  assert.equal(run.completed, run.attempted);
});

test("a full cycle covers the whole query set", () => {
  const cycle = api.watchlist?.cycle;
  assert.ok(cycle, "the record carries no cycle information");
  assert.equal(cycle.size, WATCHLIST_QUERIES.length);
  assert.ok(cycle.perRun >= cycle.size || cycle.rotating, "a set larger than a run must rotate");
  const coverage = api.watchlist?.coverage || {};
  const never = WATCHLIST_QUERIES.filter((q) => !coverage[q.query]).map((q) => q.query);
  assert.deepEqual(never, [], `queries that have never reached Exa: ${never.join(", ")}`);
});

test("the watchlist page lists every query with the date it last ran", () => {
  const coverage = api.watchlist?.coverage || {};
  for (const q of WATCHLIST_QUERIES) {
    assert.ok(page.watchlist.includes(q.query), `the coverage list omits: ${q.query}`);
  }
  // The neighbourhood queries are the ones that never ran for months.
  for (const hood of ["Tenderloin", "Excelsior", "Bayview", "Visitacion Valley"]) {
    assert.ok(page.watchlist.includes(hood), `${hood} is missing from the page`);
    const q = WATCHLIST_QUERIES.find((x) => x.query.includes(hood));
    assert.ok(coverage[q.query], `${hood} still has no last-run date`);
  }
  assert.ok(text(page.watchlist).includes("and when it last ran"));
});

test("the last watchlist run is reported, and it finished", () => {
  const last = api.watchlist?.lastRun;
  assert.ok(last, "no run record: the lane has not run since the change");
  assert.equal(last.ok, true, `last run did not finish: ${last.reason || "no reason recorded"}`);
  assert.equal(last.failed, 0);
  assert.equal(last.attempted, last.completed);
  assert.ok(text(page.watchlist).includes("Last run "), "the page does not report the last run");
});

test("the scheduled crons and the dispatch agree", async () => {
  const { CRON_MORNING, CRON_WATCHLIST, CRON_PRESS_TICK } = await import("../src/index.js");
  assert.notEqual(CRON_WATCHLIST, CRON_MORNING, "the watchlist must not share the audit's firing");
  assert.notEqual(Number(CRON_WATCHLIST.split(" ")[0]) % 15, 0, "collides with the quarter-hourly tick");
  assert.equal(CRON_PRESS_TICK, "*/15 * * * *");
});

test("every cut-off watchlist query is published with its reason", () => {
  const run = runCounts(api.watchlist);
  if (!run.failed) return;
  for (const q of run.failures) {
    assert.ok(page.watchlist.includes(q.query), `the page hides a query it never ran: ${q.query}`);
  }
  assert.doesNotMatch(page.watchlist, /refer to https:/, "the truncated reason must be tidied for display");
});

test("the watchlist states that it runs on its own invocation", () => {
  const t = text(page.watchlist);
  assert.match(t, /own cron trigger at 13:20 UTC/);
  assert.match(t, /own subrequest budget/);
});

test("the status spend page separates searches billed from searches reserved", () => {
  const run = runCounts(api.watchlist);
  const t = text(page.status);
  assert.ok(t.includes(`attempts ${run.attempted} Exa`), "status does not state the attempt from the live constant");
  if (run.failed) {
    assert.ok(t.includes(`${run.completed} of those searches reach Exa`), "status does not say what is actually billed");
  }
});
