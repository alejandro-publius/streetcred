// The frugal press lane, against a fake Exa and a fake KV.
//
// The two things worth pinning are the ones that cost money if they drift:
// what the lane asks for before it pays, and that page text is bought only for
// candidates that could actually be published.
import test from "node:test";
import assert from "node:assert/strict";
import { enrichPress, segmentsOf, segmentQuery, WINDOWS, PRESS_VERSION } from "../src/pressenrich.js";

const CORNER = { slug: "eddy-and-mason", name: "Eddy and Mason", city: "San Francisco" };

const article = (i, both = true) => ({
  title: both ? `Crash at Eddy and Mason leaves cyclist injured ${i}` : `Mason Street repaving begins ${i}`,
  url: `https://sfchronicle.com/story-${i}`,
  publishedDate: "2025-04-0" + ((i % 9) + 1),
});

const harness = ({ segments = {}, results = null } = {}) => {
  const map = new Map(Object.entries(segments));
  const calls = [];
  const env = {
    EXA_API_KEY: "test",
    STORE: {
      get: async (k) => (map.has(k) ? map.get(k) : null),
      put: async (k, v) => void map.set(k, v),
    },
  };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (url.endsWith("/contents")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          results: body.urls.map((u) => ({ url: u, text: "A collision at Eddy and Mason injured a pedestrian." })),
          costDollars: { total: 0.0001 * body.urls.length },
        }),
      };
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        results: results || [article(calls.length), article(calls.length + 10)],
        costDollars: { total: 0.007 },
      }),
    };
  };
  return { env, calls, map };
};

test("a corner splits into its two streets as segment keys", () => {
  assert.deepEqual(segmentsOf({ name: "Eddy and Mason" }), ["eddy", "mason"]);
  assert.deepEqual(segmentsOf({ name: "16th & Mission" }), ["16th", "mission"]);
  assert.deepEqual(segmentsOf({ name: "Van Ness at Geary" }), ["van-ness", "geary"]);
  assert.match(segmentQuery("van-ness"), /van ness San Francisco/);
});

test("a cold corner buys two segment searches and three windows, once each", async () => {
  const { env, calls } = harness();
  const rec = await enrichPress(env, CORNER);
  const searches = calls.filter((c) => c.url.endsWith("/search"));
  assert.equal(searches.length, 2 + WINDOWS.length, "two cold streets plus three windows");
  // Every dated window is asked for, and no search asks for page text.
  const dated = searches.filter((c) => c.body.startPublishedDate);
  assert.equal(dated.length, WINDOWS.length);
  assert.deepEqual(dated.map((c) => c.body.startPublishedDate).sort(), WINDOWS.map((w) => w.start).sort());
  for (const s of searches) assert.equal(s.body.contents, undefined, "searches must not buy text");
  assert.equal(rec.version, PRESS_VERSION);
  assert.equal(rec.lane, "press-checked", "never labelled as an audit");
});

test("a warm segment is not searched again", async () => {
  const { env, calls } = harness({
    segments: {
      "press:segment:eddy": JSON.stringify({ results: [article(1)], fetchedAt: "2026-08-18T00:00:00Z" }),
    },
  });
  const rec = await enrichPress(env, CORNER);
  const searches = calls.filter((c) => c.url.endsWith("/search"));
  assert.equal(searches.length, 1 + WINDOWS.length, "only the cold street is searched");
  assert.deepEqual(rec.cost.segmentsWarm, ["eddy"]);
  assert.deepEqual(rec.cost.segmentsCold, ["mason"]);
});

test("a stored empty segment still counts as warm", async () => {
  const { env, calls } = harness({
    segments: { "press:segment:mason": JSON.stringify({ results: [], fetchedAt: "2026-08-18T00:00:00Z" }) },
  });
  const rec = await enrichPress(env, CORNER);
  assert.deepEqual(rec.cost.segmentsWarm, ["mason"]);
  assert.equal(calls.filter((c) => c.url.endsWith("/search")).length, 1 + WINDOWS.length);
});

test("page text is bought once, for the shortlist only", async () => {
  const { env, calls } = harness();
  const rec = await enrichPress(env, CORNER);
  const contents = calls.filter((c) => c.url.endsWith("/contents"));
  assert.equal(contents.length, 1, "one contents call, not one per result");
  assert.ok(contents[0].body.urls.length <= 8, "the shortlist is capped");
  assert.equal(rec.cost.contentPages, contents[0].body.urls.length);
  assert.ok(rec.cost.contentPages <= rec.found, "never more pages than candidates");
});

test("nothing on topic stores the searched and empty state, not an error", async () => {
  const { env } = harness({ results: [{ title: "Warriors win in overtime", url: "https://espn.com/x", publishedDate: "2025-01-01" }] });
  const rec = await enrichPress(env, CORNER);
  assert.equal(rec.source, "empty");
  assert.equal(rec.lane, "press-checked");
  assert.ok(rec.cost.searches > 0, "it really did search");
  assert.equal(rec.items, undefined);
});

test("the budget refuses before anything is spent", async () => {
  const { env, calls } = harness({
    segments: { "budget:exa": JSON.stringify({ period: "2026-08", spentCents: 99999, reservedCents: 99999 }) },
  });
  const rec = await enrichPress(env, CORNER);
  assert.equal(rec.source, "budget-deferred");
  assert.equal(calls.filter((c) => c.url.endsWith("/search")).length, 0, "no call after a refusal");
});
