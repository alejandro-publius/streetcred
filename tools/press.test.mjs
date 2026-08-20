// The press entity-discovery contract.
//
// The extractor proposes corners from prose, and prose is full of capitalized
// pairs joined by "and" that are not corners at all. Every bar that stops one
// from surfacing is pinned here, because the failure mode is not an error: it
// is a plausible-looking corner on a public watchlist that nobody checked.

import test from "node:test";
import assert from "node:assert/strict";
import { candidatesFrom, verifyCandidate, reciprocal, WATCHLIST_QUERIES, runCounts } from "../src/press.js";

const STREETS = new Set(["mission", "norton", "church", "market", "valencia", "sycamore", "16th", "24th"]);

// A shard holding one graded corner, in the shape src/city.js reads.
const env = {
  STORE: {
    get: async (key) => {
      if (key === "city:streets") return [...STREETS];
      if (key === "city:shard:m") {
        return {
          sweepDate: "2026-08-18",
          radiusM: 80,
          rows: [
            {
              slug: "mission-and-norton", name: "Mission and Norton",
              lat: 37.7401, lon: -122.4234, points: 24.6, index: 92, grade: "D",
              counts: { fatal: 0, severe: 1, otherVisible: 3, pain: 4, ped: 2, safety311: 9 },
              district: 11,
            },
          ],
        };
      }
      if (key === "city:shard:c") {
        return {
          sweepDate: "2026-08-18", radiusM: 80,
          rows: [{ slug: "church-and-market", name: "Church and Market", lat: 37.76, lon: -122.42,
            points: 55.5, index: 97, grade: "F",
            counts: { fatal: 0, severe: 2, otherVisible: 6, pain: 9, ped: 4, safety311: 20 }, district: 8 }],
        };
      }
      return null;
    },
  },
};

const article = (title, text) => ({ title, text, url: "https://missionlocal.org/2026/07/x", domain: "missionlocal.org", date: "2026-07-15" });

test("a pair in street context is a candidate", () => {
  assert.deepEqual(
    candidatesFrom("A driver struck a pedestrian at Mission and Norton streets on Tuesday."),
    ["Mission and Norton"],
  );
});

// The bug this bar exists for: news pages are full of navigation menus, and
// every one of them looks like an intersection to a pattern match.
test("a pair with no street context anywhere near it is not a candidate", () => {
  assert.deepEqual(candidatesFrom("Metro Areas and Our Cities. Development and Real Estate."), []);
  assert.deepEqual(candidatesFrom("Crime and Emergencies is our section for breaking news coverage."), []);
});

test("the street context cannot be the pair vouching for itself", () => {
  // "Lane" is a street type. Without excluding the match itself from the
  // window, a pair containing it would always pass its own context test.
  assert.deepEqual(candidatesFrom("Bike Lane and Parking Lane are the two options on the ballot."), []);
});

test("stopwords keep non-streets out even in street context", () => {
  const found = candidatesFrom("The city discussed Safety and Enforcement at the intersection.");
  assert.deepEqual(found, []);
});

test("ordinals survive, in both orders", () => {
  assert.deepEqual(
    candidatesFrom("The crash happened at 16th and Mission, near the crosswalk."),
    ["16th and Mission"],
  );
});

test("a verified candidate carries its census grade", async () => {
  const v = await verifyCandidate(env, "Mission and Norton",
    article("Pedestrian struck at Mission and Norton", "A pedestrian was struck by a driver in the crosswalk at Mission and Norton."),
    { streets: STREETS });
  assert.equal(v.ok, true);
  assert.equal(v.slug, "mission-and-norton");
  assert.equal(v.grade, "D");
  assert.equal(v.index, 92);
  assert.equal(v.district, 11);
});

test("a phrase naming no San Francisco street is noise, not a finding", async () => {
  const v = await verifyCandidate(env, "Metro Areas and Our Cities", article("x", "traffic"), { streets: STREETS });
  assert.equal(v.ok, false);
  assert.equal(v.noise, true, "must be counted rather than published");
  assert.match(v.reason, /neither name is a San Francisco street/);
});

// The informative reject: real SF streets that are not a graded crossing. This
// is the one worth showing a reader, so it must NOT be marked noise.
test("real streets that are not a graded crossing are a published reject", async () => {
  const v = await verifyCandidate(env, "Mission and Valencia", article("x", "crosswalk traffic"), { streets: STREETS });
  assert.equal(v.ok, false);
  assert.ok(!v.noise, "this reject is a finding and must be published");
  assert.match(v.reason, /no graded crossing by that name/);
});

test("an article that names a crossing but is not about safety there is rejected", async () => {
  const v = await verifyCandidate(env, "Church and Market",
    article("New bakery opens at Church and Market", "The bakery at Church and Market opens Friday."),
    { streets: STREETS });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not about safety/);
});

test("a corner already audited is not a lead", async () => {
  const v = await verifyCandidate(env, "Mission and Norton",
    article("Pedestrian struck at Mission and Norton", "struck in the crosswalk at Mission and Norton"),
    { streets: STREETS, skip: new Set(["mission-and-norton"]) });
  assert.equal(v.ok, false);
  assert.match(v.reason, /already audited/);
});

test("the reciprocal record points back with the same article", () => {
  const r = reciprocal(
    { slug: "16th-mission", name: "16th and Mission", grade: "F", index: 99 },
    { slug: "grant-and-jackson", name: "Grant and Jackson", article: { title: "T", url: "u", domain: "d", date: "2026-05-13" } },
  );
  assert.equal(r.slug, "grant-and-jackson");
  assert.equal(r.reciprocal, true);
  assert.equal(r.links[0].slug, "16th-mission");
  assert.equal(r.links[0].article.date, "2026-05-13");
});

test("the watchlist asks the city more than one question", () => {
  assert.ok(WATCHLIST_QUERIES.length >= 4);
  for (const q of WATCHLIST_QUERIES) assert.match(q.query, /San Francisco|SFMTA/);
});

// A national outlet says "a San Francisco intersection"; a neighbourhood
// newsroom names the crossing, which is the only kind of sentence this
// pipeline can verify.
test("some passes are restricted to local outlets at the API", () => {
  const local = WATCHLIST_QUERIES.filter((q) => q.includeDomains);
  assert.ok(local.length >= 1, "at least one local pass");
  for (const q of local) {
    assert.ok(q.includeDomains.includes("missionlocal.org"));
    // Include and exclude are mutually exclusive at the API.
    assert.ok(!q.excludeDomains);
  }
});

// Thirty near-identical phrasings would cost thirty searches and find one
// kind of story. The set has to actually vary.
test("the discovery set is broad and not duplicated", () => {
  assert.ok(WATCHLIST_QUERIES.length >= 25, "expected roughly thirty phrasings");
  const seen = new Set(WATCHLIST_QUERIES.map((q) => q.query.toLowerCase()));
  assert.equal(seen.size, WATCHLIST_QUERIES.length, "duplicate phrasing in the set");
  const hoods = WATCHLIST_QUERIES.filter((q) => /Tenderloin|Excelsior|Bayview|Sunset|Mission|SoMa|Richmond|Chinatown|Castro|Visitacion/.test(q.query));
  assert.ok(hoods.length >= 8, "neighbourhood anchored variants missing");
  const civic = WATCHLIST_QUERIES.filter((q) => /petition|meeting/i.test(q.query));
  assert.ok(civic.length >= 2, "petition and meeting phrasings missing");
});


// Attempted is not completed, and every surface that reports either has to read
// both from the stored record. /methodology said seven for as long as the list
// has been twenty-nine, and /watchlist printed the attempt as if it were work
// done while twenty-two of the searches never reached Exa.
test("runCounts separates what was attempted from what completed", () => {
  const w = {
    calls: 5,
    queries: [
      { query: "a", results: 15 },
      { query: "b", results: 15 },
      { query: "c", results: 0, failed: "Too many subrequests by single Worker invocation." },
      { query: "d", results: 0, failed: "Too many subrequests by single Worker invocation." },
      { query: "e", results: 0, failed: "Too many subrequests by single Worker invocation." },
    ],
  };
  const c = runCounts(w);
  assert.equal(c.attempted, 5);
  assert.equal(c.completed, 2);
  assert.equal(c.failed, 3);
  assert.equal(c.failures.length, 3);
  assert.equal(c.commonReason, "Too many subrequests by single Worker invocation.");
});

test("runCounts survives a record that has not been built yet", () => {
  for (const empty of [null, undefined, {}, { queries: [] }]) {
    const c = runCounts(empty);
    assert.equal(c.attempted, 0);
    assert.equal(c.completed, 0);
    assert.equal(c.failed, 0);
    assert.equal(c.commonReason, null);
  }
});

// Records already in KV carry a 90-character truncation that cuts the error
// mid-URL, so every one of them ends "refer to https:". The page has to read
// correctly against those without waiting for a rebuild.
test("a stored failure reason truncated mid-URL is tidied for display", () => {
  const c = runCounts({
    queries: [
      { query: "a", failed: "Too many subrequests by single Worker invocation. To configure this limit, refer to https:" },
    ],
  });
  assert.equal(c.failures[0].failed, "Too many subrequests by single Worker invocation.");
  assert.doesNotMatch(c.failures[0].failed, /https?:/);
});

test("different reasons do not collapse into one common reason", () => {
  const c = runCounts({
    queries: [
      { query: "a", failed: "Too many subrequests by single Worker invocation." },
      { query: "b", failed: "rate limited" },
    ],
  });
  assert.equal(c.commonReason, null, "two reasons must not be reported as one");
});

// /methodology names this count in prose, so it is pinned rather than left to
// drift the way "seven" did.
test("exactly three queries are restricted to San Francisco outlets", () => {
  const local = WATCHLIST_QUERIES.filter((q) => q.includeDomains);
  assert.equal(local.length, 3, "the methodology page says three passes are outlet-restricted");
});
