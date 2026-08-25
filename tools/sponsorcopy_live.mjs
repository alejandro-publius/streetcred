// The sponsor copy adds, live. Read only.
//
// The filter sentence renders client-side from /api/voices, so the live cells
// pin what raw HTTP can pin: the sentence template ships in the served page,
// and on three sampled commissioned corners the payload the sentence reads is
// exactly the stored record, number for number.

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";

const ORIGIN = (process.env.STREETCRED_ORIGIN || "https://streetcred.thealexschroeder.workers.dev").replace(/\/$/, "");
const ROOT = new URL("..", import.meta.url).pathname;
const kv = (k) => {
  const o = execFileSync("npx", ["wrangler", "kv", "key", "get", k, "--binding", "STORE", "--remote", "--text"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(o.slice(o.indexOf("{"), o.lastIndexOf("}") + 1));
};

// One corner with kept quotes, one scraped-and-empty, one freshly commissioned.
const SAMPLE = ["24th-and-valencia", "6th-and-mission", "9th-and-mission"];

for (const slug of SAMPLE) {
  test(`${slug}: the sentence's numbers are the stored record's numbers`, async () => {
    const api = await fetch(`${ORIGIN}/api/voices?x=${slug}`).then((r) => r.json());
    const stored = kv(`voices:${slug}`);
    assert.equal(api.commissioned, true, "sampled corners must be commissioned");
    assert.equal(api.candidates, stored.candidates, "scraped count served equals stored");
    // The accounting, not a bare equality. Since 2026-08-24 the served payload
    // withholds an account that names a different crossing (the stored record
    // is deliberately untouched, so the two can differ by exactly what was
    // withheld and by nothing else). Asserting the sum is stricter than the
    // old equality: it catches an invented number in either direction AND a
    // withheld account that is not declared.
    const served = (api.items || []).length;
    const suppressed = api.suppressed || 0;
    assert.equal(served + suppressed, (stored.items || []).length,
      "served accounts plus withheld accounts must equal what the record holds");
    if (suppressed) {
      assert.equal(api.crossCheck, "checked", "a withheld account means the check actually ran");
      assert.ok(api.suppressedReason, "a withheld account has to say why");
    }
  });
}

test("the sentence template ships on a corner page", async () => {
  const html = await fetch(`${ORIGIN}/c/24th-and-valencia`).then((r) => r.text());
  assert.ok(html.includes("Apify scraped public reviews and forums for this corner."));
  assert.ok(html.includes('id="voicesfilter"'));
});

test("How Exa is used serves on /methodology with its five proofs", async () => {
  const h = await fetch(`${ORIGIN}/methodology`).then((r) => r.text());
  const seg = h.slice(h.indexOf("How Exa is used"), h.indexOf("The Press Watchlist"));
  for (const link of ["/c/16th-mission#presstape", "/c/16th-and-potrero", "/watchlist", "/radar", "/status"]) {
    assert.ok(seg.includes(`href="${link}"`), `${link} must be linked`);
  }
  assert.equal((seg.match(/<li>/g) || []).length, 5);
});
