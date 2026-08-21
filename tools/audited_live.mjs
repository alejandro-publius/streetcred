// Live guards on every audited corner's served page.
//
// Run against production or a preview:
//   node tools/audited_live.mjs
//   STREETCRED_ORIGIN=https://preview... node tools/audited_live.mjs
//
// Read only. Every request is a GET and none of them can cause a draft, a
// render or a write.
//
// These cells exist because the corner stage used to ship a loading card on
// every corner and let the client fill it, even when the server had already
// read the record naming which states exist. The raw HTML of a fully audited
// corner said "loading" about photographs sitting in KV, so anything reading
// the page without running scripts, including every one of these checks, saw a
// corner with no imagery at all.

import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";

const ORIGIN = (process.env.STREETCRED_ORIGIN || "https://streetcred.thealexschroeder.workers.dev").replace(/\/$/, "");
const ROOT = new URL("..", import.meta.url).pathname;

const kv = (k) => {
  const o = execFileSync("npx", ["wrangler", "kv", "key", "get", k, "--binding", "STORE", "--remote", "--text"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(o.slice(o.indexOf("{")));
};

const meta = kv("city:meta");
const AUDITED = meta.audited || [];
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");

const pages = {};
const imagery = {};
for (const slug of AUDITED) {
  const [p, i] = await Promise.all([
    fetch(`${ORIGIN}/c/${slug}`).then((r) => r.text()),
    fetch(`${ORIGIN}/api/imagery?x=${slug}`).then((r) => r.json()).catch(() => null),
  ]);
  pages[slug] = p;
  imagery[slug] = i;
}

test("every audited corner page serves", async () => {
  for (const slug of AUDITED) {
    assert.ok(pages[slug].length > 20_000, `${slug}: page is ${pages[slug].length} bytes`);
  }
});

// The cell the operator asked for, and it is only assertable because the frames
// are now in the HTML. Before that it would have failed on a healthy site.
test("no audited corner's raw HTML contains the loading fallback", () => {
  for (const slug of AUDITED) {
    assert.doesNotMatch(
      pages[slug],
      /<p class="imgphn" id="imgphn">Loading the Street View photograph/,
      `${slug}: the server had the record and still shipped a loading card`,
    );
  }
});

test("every audited corner serves today and fix img srcs in raw HTML", () => {
  for (const slug of AUDITED) {
    assert.match(pages[slug], new RegExp(`src="/gen/${slug}/today\\.jpg"`), `${slug}: no today src`);
    assert.match(pages[slug], new RegExp(`src="/gen/${slug}/fix\\.jpg"`), `${slug}: no fix src`);
  }
});

test("every img src an audited page names actually serves", async () => {
  for (const slug of AUDITED) {
    for (const m of pages[slug].matchAll(new RegExp(`src="(/gen/${slug}/[a-z]+\\.jpg)"`, "g"))) {
      const r = await fetch(ORIGIN + m[1]);
      assert.equal(r.status, 200, `${slug}: ${m[1]} returned ${r.status}`);
      assert.match(r.headers.get("content-type") || "", /image\/jpeg/, `${slug}: ${m[1]} is not a jpeg`);
    }
  }
});

test("no audited corner claims Street View has nothing unless a probe said so", () => {
  for (const slug of AUDITED) {
    const note = (pages[slug].match(/<p class="imgphn" id="imgphn">([^<]*)</) || [])[1];
    if (!note) continue;
    if (/Street View has no photograph/.test(note)) {
      assert.equal(imagery[slug]?.status, "nocoverage", `${slug}: claims Google has nothing, record says ${imagery[slug]?.status}`);
    }
  }
});

test("every audited corner carries its provenance", () => {
  for (const slug of AUDITED) {
    assert.ok(
      ["audited", "promoted-from-enriched"].includes(imagery[slug]?.provenance),
      `${slug}: provenance is ${JSON.stringify(imagery[slug]?.provenance)}`,
    );
  }
});

test("no section renders a bare header, and no caption is orphaned", () => {
  for (const slug of AUDITED) {
    const t = text(pages[slug]);
    // The precedents caption may not appear without its rows container.
    if (t.includes("Outcomes as reported by SFMTA")) {
      assert.match(pages[slug], /id="precrows"/, `${slug}: precedent caption with no rows container`);
    }
    // The letter panel's foot may not appear without the panel.
    if (pages[slug].includes('class="lfoot"')) {
      assert.match(pages[slug], /class="letter" id="letter"/, `${slug}: letter foot with no letter panel`);
    }
  }
});

test("the stat tiles carry digits or an honest skeleton, never a label alone", () => {
  for (const slug of AUDITED) {
    const block = pages[slug].slice(pages[slug].indexOf('<div class="stats"'), pages[slug].indexOf('<p class="statcap"'));
    assert.ok(block.length > 40, `${slug}: no stats block`);
    const tiles = [...block.matchAll(/<div class="n(?: sk)?"[^>]*>([^<]*)<\/div>\s*<div class="l">/g)];
    assert.equal(tiles.length, 3, `${slug}: expected three tiles, found ${tiles.length}`);
    for (const [whole, shown] of tiles) {
      const isSkeleton = whole.includes('class="n sk"');
      if (isSkeleton) continue;
      assert.match(shown.trim(), /^(\d[\d,]*|n\/a)$/, `${slug}: tile shows ${JSON.stringify(shown)}`);
    }
  }
});
