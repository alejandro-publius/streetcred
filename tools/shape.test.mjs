// Endpoint shape tests over recorded fixtures. No network, no key, no Worker:
// the fixtures in tools/fixtures/ are real payloads recorded from production,
// and these assertions pin the fields the frontend actually dereferences. A
// refactor that renames or drops one of these fields breaks CI instead of
// breaking the page for whoever loads it first.
//
// Deliberately not a snapshot test. Values drift as the city's data does;
// shapes are a contract.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name) => JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8"));

const hasPath = (obj, path) => {
  let cur = obj;
  for (const key of path.split(".")) {
    if (cur == null || !(key in cur)) return false;
    cur = cur[key];
  }
  return true;
};

const expectPaths = (name, paths) => {
  test(`/api/${name} shape`, () => {
    const d = load(name);
    for (const p of paths) assert.ok(hasPath(d, p), `${name}: missing ${p}`);
  });
};

expectPaths("stats", [
  "crashes", "fatal", "reports311", "district",
  // The provenance receipts. Dropping one silently unlinks a figure.
  "urls.crashes", "urls.fatal", "urls.reports311", "urls.district",
]);

expectPaths("score", [
  "index", "grade", "points", "collisionPoints", "maintenanceSignal",
  "radius", "sampleSize", "caveat",
  "counts.fatal", "counts.severe", "counts.otherVisible", "counts.pain", "counts.ped", "counts.safety311",
  "urls.severity", "urls.ped", "urls.reports",
]);

expectPaths("cred", ["version", "lanes", "score", "verdict"]);

expectPaths("run", ["slug", "trigger", "stages"]);

expectPaths("news", ["items", "heading", "fetchedAt"]);

expectPaths("timeline", ["years", "firstReportedYear", "yearsReported", "totalHeadlines"]);

expectPaths("board", ["count", "corners"]);

test("board corners carry geometry and grade", () => {
  const d = load("board");
  assert.ok(d.corners.length > 0, "board is empty");
  for (const c of d.corners) {
    assert.ok(typeof c.slug === "string" && c.slug, "slug");
    assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lon), `geometry on ${c.slug}`);
    assert.ok(["A", "B", "C", "D", "F"].includes(c.grade), `grade on ${c.slug}`);
  }
});

test("score grade bands hold", () => {
  const d = load("score");
  const bands = { A: [0, 39], B: [40, 64], C: [65, 79], D: [80, 92], F: [93, 99] };
  const [lo, hi] = bands[d.grade];
  assert.ok(d.index >= lo && d.index <= hi, `${d.grade} with index ${d.index}`);
});

test("changes feed is a list", () => {
  const d = load("changes");
  assert.ok(Array.isArray(d.changes), "changes array");
});
