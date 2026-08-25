// The frame index: one key that says which corners have a stored photograph.
//
// The alternative was an imgstatus record per corner, a second write for every
// frame published. 7,309 frames would have cost 14,618 writes to say something
// one list already says, against a 1,000 a day allowance.
//
//   node --test tools/frameindex.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { getFrameIndex, putFrameIndex } from "../src/store.js";

const fakeEnv = () => {
  const store = new Map();
  const env = { writes: 0, STORE: { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { env.writes += 1; store.set(k, v); } }, _store: store };
  return env;
};

test("the whole city is one write", async () => {
  const env = fakeEnv();
  const slugs = Array.from({ length: 7309 }, (_, i) => `corner-${i}`);
  const n = await putFrameIndex(env, slugs);
  assert.equal(n, 7309);
  assert.equal(env.writes, 1, "7,309 corners, one write");
});

test("it round-trips as a set, deduped and sorted", async () => {
  const env = fakeEnv();
  await putFrameIndex(env, ["b-and-c", "a-and-b", "b-and-c"]);
  const idx = await getFrameIndex(env);
  assert.equal(idx.count, 2, "deduped");
  assert.ok(idx.slugs.has("a-and-b"));
  assert.ok(idx.slugs.has("b-and-c"));
  assert.ok(!idx.slugs.has("nope"));
  assert.deepEqual(JSON.parse(env._store.get("img:index")).slugs, ["a-and-b", "b-and-c"], "sorted, so a diff of the key reads as a diff of the city");
});

test("an absent or unreadable index is null, never a guess", async () => {
  const env = fakeEnv();
  assert.equal(await getFrameIndex(env), null, "no index means no claim");
  env._store.set("img:index", "{not json");
  assert.equal(await getFrameIndex(env), null, "and neither does a corrupt one");
});

test("it records what produced it", async () => {
  const env = fakeEnv();
  await putFrameIndex(env, ["a-and-b"], { source: "daily cron" });
  assert.equal((await getFrameIndex(env)).source, "daily cron");
  await putFrameIndex(env, ["a-and-b"]);
  assert.equal((await getFrameIndex(env)).source, "bulk fetch", "and defaults to the bulk path");
});
