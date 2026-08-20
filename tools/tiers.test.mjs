// The audit tier bookkeeping: who counts as fully audited, and who cannot.
//
// Two numbers come out of `recountAuditTiers` and both of them end up in
// English on the homepage: "N fully audited" and "N more with imagery
// pending". The first one is load bearing, the masthead and the map alt text
// and the stat tile all read it. The second one has never once been true, and
// that is the interesting part of this file rather than an omission from it.
//
// What this covers:
//
//   - the predicate, which is both frames or nothing, tested against a corner
//     that has hazards and no fix because that is the case the split exists for
//   - the structural gap, pinned rather than asserted as desirable: the cron
//     only rosters a corner once both frames exist, so the roster the recount
//     scans cannot contain a pending corner and `textAudited` is always 0
//   - promotion, because the whole design argument for counting from the
//     imagery records is that a backfill promotes itself with nobody editing
//     copy
//   - the sentence degrading when the recount has never run, where the failure
//     to avoid is rendering "0 more with imagery pending"
//   - 1st-and-bush, the corner that made the split necessary, as a named
//     regression with its live state written down
//
// The KV double is local and in memory. `tools/lib/kvenv.mjs` talks to the real
// remote namespace through wrangler, which is production state and a network
// call; a bookkeeping test needs a store it owns and can rewrite between
// assertions. Nothing here reaches the network and nothing here reads a key.

import test from "node:test";
import assert from "node:assert/strict";
import {
  recountAuditTiers, getAuditTiers, AUDIT_TIER_CACHE_S, putImageryStatus,
} from "../src/store.js";
import { HOME } from "../src/home.js";

// ---------------------------------------------------------------- the double

// A KV double. store.js falls back to a module-global Map when no STORE
// binding exists, which is shared across every test in the process and would
// leak one test's roster into the next, so every env here carries a STORE of
// its own.
function fakeEnv(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    STORE: {
      get: async (k, type) => {
        if (!map.has(k)) return null;
        const v = map.get(k);
        if (type !== "json") return v;
        try { return JSON.parse(v); } catch { return null; }
      },
      put: async (k, v) => { map.set(k, v); },
    },
    __map: map,
  };
}

// Seed one corner's imagery record through the same function the imagery lane
// writes it with, so this file cannot pass against a key name that has moved.
const seedImagery = (env, slug, states, status = "ready") =>
  putImageryStatus(env, slug, { status, states, at: "2026-08-19T13:00:00.000Z" });

const BOTH = ["today", "hazards", "fix"];
const NO_FIX = ["today", "hazards"];

// The cron's own roster rule, copied from the "city roster" lane in
// src/index.js. Copied deliberately: the point of the pinning test below is
// that this rule and the recount's rule are the same rule, so the test has to
// state it independently rather than call it.
const cronWouldRoster = (states) => states.includes("hazards") && states.includes("fix");

// A corner shaped the way the homepage map wants one.
const pin = (slug, index) => ({
  slug, name: slug.replace(/-and-|-/g, " "), lat: 37.78, lon: -122.41, index, grade: "F",
});

const cityMeta = (totalAudited) => ({
  meta: { totalScored: 7355, totalAudited },
  top: [],
  queueLength: 0,
});

const subtitleOf = (html) => html.match(/intersections graded citywide[^<]*/)?.[0] ?? "";
const mapAltOf = (html) => html.match(/alt="Map of San Francisco[^"]*"/)?.[0] ?? "";

// ---------------------------------------------------------------- 1. the predicate

test("fullyAudited counts only corners holding both a hazards frame and a fix frame", async () => {
  const env = fakeEnv();
  await seedImagery(env, "complete-one", BOTH);
  await seedImagery(env, "complete-two", BOTH);
  await seedImagery(env, "hazards-only", NO_FIX, "failed");
  // "no-status-at-all" is left unseeded on purpose: getImageryStatus returns
  // null for it and the recount has to treat that as pending, not as a throw.

  const rec = await recountAuditTiers(env, [
    "complete-one", "complete-two", "hazards-only", "no-status-at-all",
  ]);

  assert.equal(rec.fullyAudited, 2, "only the two corners with both frames count");
  assert.equal(rec.textAudited, 2);
  assert.equal(rec.total, 4);
  assert.deepEqual(rec.pending, ["hazards-only", "no-status-at-all"]);
  // The split has to add up, or the subtitle prints two numbers that disagree.
  assert.equal(rec.fullyAudited + rec.textAudited, rec.total);
});

test("a fix frame without a hazards frame is not an audit either", async () => {
  const env = fakeEnv();
  await seedImagery(env, "fix-only", ["today", "fix"]);
  const rec = await recountAuditTiers(env, ["fix-only"]);
  assert.equal(rec.fullyAudited, 0);
  assert.deepEqual(rec.pending, ["fix-only"]);
});

test("the recount writes what it counted, and getAuditTiers reads it back", async () => {
  const env = fakeEnv();
  await seedImagery(env, "a-corner", BOTH);
  const written = await recountAuditTiers(env, ["a-corner"]);

  const read = await getAuditTiers(env);
  assert.deepEqual(read, written);

  // The freshness check in src/index.js is Date.parse(at) against
  // AUDIT_TIER_CACHE_S, so `at` has to be something Date.parse understands or
  // the background recount fires on every single homepage request.
  assert.ok(Number.isFinite(Date.parse(written.at)), "at must be parseable");
  assert.equal(AUDIT_TIER_CACHE_S, 6 * 3600);
  const ageOf = (at) => Date.now() - Date.parse(at);
  assert.ok(ageOf(written.at) < AUDIT_TIER_CACHE_S * 1000, "a fresh record reads fresh");
  assert.ok(
    ageOf("2026-08-01T00:00:00.000Z") >= AUDIT_TIER_CACHE_S * 1000,
    "a record older than the window reads stale",
  );
});

test("a corrupt stored record reads as absent rather than throwing", async () => {
  const env = fakeEnv({ "audit:tiers": "{not json" });
  assert.equal(await getAuditTiers(env), null);
});

// ---------------------------------------------------------------- 2. the structural gap

// PINNING A KNOWN STRUCTURAL GAP, NOT A DESIRED PROPERTY.
//
// `textAudited` is the pending count and it is structurally always 0. The cron
// adds a corner to the `audited` roster only when both frames exist and drops
// it into `enriched` otherwise (src/index.js, the "city roster" lane).
// `recountAuditTiers` then scans that same audited roster, where every member
// has both frames by construction. So the pending list is empty for a reason
// that has nothing to do with the imagery lane succeeding, and the "N more with
// imagery pending" clause in the homepage subtitle can never fire.
//
// specs/HANDOFF.md, "After the freeze, Aug 25", carries this as an open item:
// the mechanism works and nothing feeds it. A corner audited from the records
// with imagery pending is currently indistinguishable from one that was only
// swept, and telling them apart needs a third state, a flag or a roster.
//
// This test asserts the gap. If somebody adds that third state and a genuinely
// pending corner starts reaching the roster, THIS TEST FAILING IS THE CORRECT
// SIGNAL and the fix is to delete it, not to make it pass again.
test("PINNED GAP: textAudited is structurally always 0, because the cron rosters only complete corners", async () => {
  const env = fakeEnv();

  // A morning's worth of outcomes, including the one the pending count exists
  // to describe: a corner whose records ran and whose fix frame never landed.
  const morning = [
    { slug: "both-frames-landed", states: BOTH },
    { slug: "also-complete", states: BOTH },
    { slug: "imagery-came-back-partial", states: NO_FIX },
    { slug: "imagery-never-ran", states: ["today"] },
  ];
  for (const m of morning) await seedImagery(env, m.slug, m.states);

  // Build the roster the way the cron builds it, not the way a test wishes it
  // were built.
  const auditedRoster = morning.filter((m) => cronWouldRoster(m.states)).map((m) => m.slug);
  assert.deepEqual(auditedRoster, ["both-frames-landed", "also-complete"]);
  assert.ok(
    !auditedRoster.includes("imagery-came-back-partial"),
    "the partial corner is in enriched, so the recount never sees it",
  );

  const rec = await recountAuditTiers(env, auditedRoster);

  assert.equal(rec.textAudited, 0, "no pending corner can reach the roster today");
  assert.deepEqual(rec.pending, []);
  assert.equal(rec.fullyAudited, rec.total, "roster size and fully audited are the same number");

  // And therefore the sentence the pending count feeds never renders.
  const html = HOME([pin("both-frames-landed", 99)], "https://x", [], null, false, cityMeta(2), null, null, null, null, null, rec);
  assert.ok(!html.includes("imagery pending"), "the clause cannot fire while the gap stands");
});

test("the imagery-pending clause is wired and only lacks an input", async () => {
  // The counterpart to the pinned gap above. Nothing is wrong with the copy
  // path: hand it a non-zero pending count by hand and every sentence says so.
  // What is missing is a producer for that number, not a consumer.
  const tiers = { fullyAudited: 23, textAudited: 3, total: 26, pending: [], at: new Date().toISOString() };
  const html = HOME([pin("a-corner", 99)], "https://x", [], null, false, cityMeta(26), null, null, null, null, null, tiers);

  assert.equal(
    subtitleOf(html),
    "intersections graded citywide, 23 fully audited, 3 more with imagery pending, one attempted every morning.",
  );
  assert.equal(
    mapAltOf(html),
    'alt="Map of San Francisco with 7,355 graded intersections marked, 23 fully audited and 3 with imagery pending"',
  );
});

// ---------------------------------------------------------------- 3. promotion

test("a corner that gains its missing frame is counted as fully audited on the next recount", async () => {
  const env = fakeEnv();
  await seedImagery(env, "already-done", BOTH);
  await seedImagery(env, "waiting-on-fix", NO_FIX, "failed");
  const roster = ["already-done", "waiting-on-fix"];

  const before = await recountAuditTiers(env, roster);
  assert.equal(before.fullyAudited, 1);
  assert.equal(before.textAudited, 1);
  assert.deepEqual(before.pending, ["waiting-on-fix"]);

  // The backfill. Only the imagery record changes; no roster is edited and no
  // copy is touched, which is the whole point of counting from the records.
  await seedImagery(env, "waiting-on-fix", BOTH);

  const after = await recountAuditTiers(env, roster);
  assert.equal(after.fullyAudited, 2, "the backfilled corner promotes itself");
  assert.equal(after.textAudited, 0);
  assert.deepEqual(after.pending, []);
  assert.equal(after.total, before.total, "promotion moves a corner between buckets, it does not add one");

  // The stored record is the new one, so the next page load reads the promotion.
  assert.equal((await getAuditTiers(env)).fullyAudited, 2);

  // And the subtitle falls back to the simpler sentence with nobody editing it.
  const html = HOME([pin("already-done", 99)], "https://x", [], null, false, cityMeta(2), null, null, null, null, null, after);
  assert.ok(!html.includes("imagery pending"));
  assert.ok(subtitleOf(html).includes("2 fully audited, one attempted every morning."));
});

test("the recount is a full rescan, so a lost frame demotes a corner too", async () => {
  // The same mechanism read backwards. Nothing in the product deletes a frame
  // today, but the count is derived rather than incremented, and that is worth
  // pinning: an incrementing counter would have gone one way only.
  const env = fakeEnv();
  await seedImagery(env, "here-then-gone", BOTH);
  assert.equal((await recountAuditTiers(env, ["here-then-gone"])).fullyAudited, 1);
  await seedImagery(env, "here-then-gone", NO_FIX, "failed");
  const after = await recountAuditTiers(env, ["here-then-gone"]);
  assert.equal(after.fullyAudited, 0);
  assert.deepEqual(after.pending, ["here-then-gone"]);
});

// ---------------------------------------------------------------- 4. degrading

test("with no tiers record the subtitle falls back to the roster count and drops the clause", async () => {
  // src/home.js reads tiers?.fullyAudited and tiers?.textAudited. When the
  // recount has never run, or its KV read failed, tiers is null: fullyAudited
  // falls back to city.meta.totalAudited and textAudited falls back to 0. The
  // failure to avoid is a page that renders "0 more with imagery pending",
  // which is worse than saying nothing because it invents a category.
  const corners = [pin("a-corner", 99)];
  const html = HOME(corners, "https://x", [], null, false, cityMeta(24), null, null, null, null, null, null);

  assert.equal(
    subtitleOf(html),
    "intersections graded citywide, 24 fully audited, one attempted every morning.",
  );
  assert.ok(!html.includes("imagery pending"), "the clause disappears rather than rendering zero");
  assert.ok(!html.includes("0 more"));
  assert.equal(
    mapAltOf(html),
    'alt="Map of San Francisco with 7,355 graded intersections marked, 24 fully audited"',
  );
});

test("a tiers record with textAudited 0 renders identically to no record at all", async () => {
  const corners = [pin("a-corner", 99)];
  const tiers = { fullyAudited: 24, textAudited: 0, total: 24, pending: [], at: new Date().toISOString() };
  const withRec = HOME(corners, "https://x", [], null, false, cityMeta(24), null, null, null, null, null, tiers);
  const without = HOME(corners, "https://x", [], null, false, cityMeta(24), null, null, null, null, null, null);
  assert.equal(subtitleOf(withRec), subtitleOf(without));
  assert.equal(mapAltOf(withRec), mapAltOf(without));
});

test("the ticker drops its waiting-on-imagery tail when the pending count is zero", async () => {
  const cotd = [{ date: "2026-08-19", slug: "a-corner", name: "A corner", grade: "F" }];
  const corners = [pin("a-corner", 99)];
  const zero = { fullyAudited: 1, textAudited: 0, total: 1, pending: [], at: new Date().toISOString() };
  const html = HOME(corners, "https://x", cotd, null, false, cityMeta(1), null, null, null, null, null, zero);
  assert.ok(html.includes("audited without a human so far</span>"), "the tail is absent, not zeroed");
  assert.ok(!html.includes("still waiting on imagery"));

  const three = { ...zero, textAudited: 3 };
  const html3 = HOME(corners, "https://x", cotd, null, false, cityMeta(1), null, null, null, null, null, three);
  assert.ok(html3.includes("3 still waiting on imagery"), "and it renders when fed");
});

// ---------------------------------------------------------------- 5. the named regression

// 1st-and-bush, the corner this whole split was written for.
//
// Where it actually sits, verified against the live Worker at 2026-08-19 22:52
// PT (2026-08-20 05:52 UTC). Re-measure before trusting these; the site moves.
//
//   - /api/board returns count 24 and its corner list includes 1st-and-bush.
//     That list is hin:list, the roster of warmed corners the homepage draws
//     pins for.
//   - the homepage subtitle reads "7,355 intersections graded citywide, 23
//     fully audited, one attempted every morning." No pending clause.
//   - /c/1st-and-bush renders the tier chip ENRICHED, titled "records and index
//     checked, no visual audit yet".
//   - /api/imagery?x=1st-and-bush returns status "failed", today
//     "/gen/1st-and-bush/today.jpg", hazards null, fix null. The today frame
//     is a real 200; hazards.jpg and fix.jpg are both 404. So the imagery lane
//     came back partial on the 2026-08-19 daily audit, exactly as
//     specs/HANDOFF.md records it.
//
// So the 24 versus 23 gap is this one corner and nothing else. Two arithmetics
// fall out of that, and they are different arithmetics, which is the part worth
// keeping straight:
//
//   A. If 1st-and-bush were in the roster the recount scans, the recount would
//      report 24 total, 23 fully audited, 1 pending. That is the case this
//      split was designed to describe.
//   B. What actually happened is that the cron put it in `enriched` instead, so
//      the audited roster is the 23 complete corners, the recount reports 23
//      and 23 and 0, and the homepage prints 23 with no pending clause while
//      /api/board still counts 24. The corner is visible in one roster and
//      invisible to the other.
//
// Both are asserted below. B is today's behaviour and is the pinned gap again
// seen from the corner that caused it; A is what B would look like once the
// third state from HANDOFF exists.
test("REGRESSION 1st-and-bush: a roster member with no fix frame makes fullyAudited one less than the roster", async () => {
  const env = fakeEnv();
  const complete = Array.from({ length: 23 }, (_, i) => `complete-${String(i + 1).padStart(2, "0")}`);
  for (const slug of complete) await seedImagery(env, slug, BOTH);
  // The live shape: a today frame and nothing generated.
  await seedImagery(env, "1st-and-bush", ["today"], "failed");

  // A. the corner is in the scanned roster.
  const roster = [...complete, "1st-and-bush"];
  const rec = await recountAuditTiers(env, roster);
  assert.equal(rec.total, 24, "the roster is 24, matching /api/board's count");
  assert.equal(rec.fullyAudited, 23, "and the homepage's 23 is the roster minus this corner");
  assert.equal(rec.textAudited, 1);
  assert.deepEqual(rec.pending, ["1st-and-bush"]);
  assert.equal(rec.total - rec.fullyAudited, 1, "the 24 versus 23 gap is exactly one corner");

  const htmlA = HOME([pin("1st-and-bush", 99)], "https://x", [], null, false, cityMeta(24), null, null, null, null, null, rec);
  assert.ok(subtitleOf(htmlA).includes("23 fully audited, 1 more with imagery pending"));
});

test("REGRESSION 1st-and-bush: as the cron actually rosters it, the corner is invisible to the recount", async () => {
  const env = fakeEnv();
  const complete = Array.from({ length: 23 }, (_, i) => `complete-${String(i + 1).padStart(2, "0")}`);
  for (const slug of complete) await seedImagery(env, slug, BOTH);
  await seedImagery(env, "1st-and-bush", ["today"], "failed");

  // B. the cron saw a partial imagery result and put it in enriched, so it
  // never enters the audited roster the recount scans.
  assert.equal(cronWouldRoster(["today"]), false);
  const rec = await recountAuditTiers(env, complete);

  assert.equal(rec.total, 23);
  assert.equal(rec.fullyAudited, 23);
  assert.equal(rec.textAudited, 0, "the corner that needed the pending bucket is not in it");
  assert.deepEqual(rec.pending, []);

  // The homepage prints 23 and says nothing about the 24th pin it is drawing.
  // hin:list still holds the corner, which is why /api/board reads 24.
  const board = [...complete, "1st-and-bush"];
  assert.equal(board.length, 24);
  const html = HOME(
    board.map((s, i) => pin(s, 99 - i)),
    "https://x", [], null, false, cityMeta(23), null, null, null, null, null, rec,
  );
  assert.equal(
    subtitleOf(html),
    "intersections graded citywide, 23 fully audited, one attempted every morning.",
  );
  assert.ok(!html.includes("imagery pending"));
  assert.ok(html.includes('href="/c/1st-and-bush"'), "the corner is on the map while absent from the count");
});
