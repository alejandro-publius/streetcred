// /audited, live. Permanent cells.
//
//   node tools/audited_page_live.mjs
//   STREETCRED_ORIGIN=https://streetcred-preview... node tools/audited_page_live.mjs
//
// Run it through tools/live_suite.sh, or with --test-force-exit. Without that
// flag the runner prints every result and then never exits: undici's connection
// pool holds the process open after the last assertion and these suites open
// dozens of sockets.
//
// Read only. Every request is a GET.

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
const html = await fetch(`${ORIGIN}/audited`).then((r) => r.text());
const FULL_I = html.indexOf('id="fullhead"');
const PROM_I = html.indexOf('id="promhead"');
const fullSeg = html.slice(FULL_I, PROM_I);
const promSeg = html.slice(PROM_I);
const slugsIn = (seg) => [...seg.matchAll(/class="aname" href="\/c\/([^"]+)"/g)].map((m) => m[1]);
const counts = [...html.matchAll(/class="acount">([^<]*)</g)].map((m) => m[1]);

test("the page serves and both sections exist", () => {
  assert.ok(html.length > 20_000, `page is ${html.length} bytes`);
  assert.ok(FULL_I > 0 && PROM_I > FULL_I, "both section headings must render, in order");
});

test("row count per section equals its rendered count", () => {
  assert.equal(slugsIn(fullSeg).length, Number(counts[0]), "fully audited count disagrees with its rows");
  assert.equal(slugsIn(promSeg).length, Number(counts[1]), "promoted count disagrees with its rows");
});

test("no row appears in both sections", () => {
  const both = slugsIn(fullSeg).filter((s) => slugsIn(promSeg).includes(s));
  assert.deepEqual(both, [], `corners in both sections: ${both.join(", ")}`);
});

test("no row for a corner lacking the section's provenance", async () => {
  const check = async (slugs, want) => {
    const bad = [];
    for (const slug of slugs) {
      const i = await fetch(`${ORIGIN}/api/imagery?x=${slug}`).then((r) => r.json()).catch(() => null);
      if (i?.provenance !== want) bad.push(`${slug}: ${JSON.stringify(i?.provenance)} not ${want}`);
      if (!i?.fix) bad.push(`${slug}: on the audited index with no fix render`);
    }
    return bad;
  };
  const bad = [...(await check(slugsIn(fullSeg), "audited")), ...(await check(slugsIn(promSeg), "promoted-from-enriched"))];
  assert.deepEqual(bad, [], bad.join("; "));
});

test("every row's thumbnail serves", async () => {
  const srcs = [...html.matchAll(/class="athumb"[^>]*>\s*<img src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(srcs.length, slugsIn(fullSeg).length + slugsIn(promSeg).length, "one thumbnail per row");
  const bad = [];
  for (let i = 0; i < srcs.length; i += 10) {
    const chunk = await Promise.all(srcs.slice(i, i + 10).map(async (u) => {
      const r = await fetch(ORIGIN + u).catch(() => null);
      return r && r.status === 200 && /image\/jpeg/.test(r.headers.get("content-type") || "") ? null : `${u} -> ${r ? r.status : "unreachable"}`;
    }));
    bad.push(...chunk.filter(Boolean));
  }
  assert.deepEqual(bad, [], `thumbnails that do not serve: ${bad.join("; ")}`);
});

test("lane strip states match stored records on three sampled corners", async () => {
  const sample = slugsIn(fullSeg).slice(0, 3);
  assert.equal(sample.length, 3, "need three corners to sample");
  for (const slug of sample) {
    const seg = fullSeg.slice(fullSeg.indexOf(`href="/c/${slug}"`));
    const row = seg.slice(0, seg.indexOf("</li>"));
    const cells = [...row.matchAll(/class="lcell (?:on|off|none)">([^<]*)</g)].map((m) => m[1]);
    assert.equal(cells.length, 4, `${slug}: expected four lane cells`);

    const letter = await fetch(`${ORIGIN}/api/letter?x=${slug}`).then((r) => r.json()).catch(() => null);
    const servesLetter = letter?.source === "verified-cache" && Boolean(letter?.text);
    assert.equal(
      cells[0],
      servesLetter ? "Letter served" : "Letter pending",
      `${slug}: letter cell says ${cells[0]} but the API says ${letter?.source}`,
    );

    const img = await fetch(`${ORIGIN}/api/imagery?x=${slug}`).then((r) => r.json()).catch(() => null);
    assert.equal(cells[1], "Fix render", `${slug}: on this page every row holds a fix render`);
    assert.ok(img?.fix, `${slug}: fix cell claims a render the imagery record does not hold`);
  }
});

test("the page renders whole: no loading fallbacks, no bare headers", () => {
  assert.doesNotMatch(html, /Loading the Street View photograph/, "no loading fallback belongs on this page");
  // A section heading must be followed by either rows or its designed empty
  // line, never by the next heading.
  for (const seg of [fullSeg, promSeg]) {
    const hasRows = /class="alist"/.test(seg);
    const hasEmpty = /No corner has been/.test(seg);
    assert.ok(hasRows || hasEmpty, "a section rendered neither rows nor its empty state");
  }
});

test("the count the homepage publishes and this page's count agree", async () => {
  // Cache-busted: the homepage is edge cached and this cell must read the
  // deploy under test, not the previous one.
  const home = await fetch(`${ORIGIN}/?cell=covcount`).then((r) => r.text());
  // Keyed to the covcount class but not to the words around the number. The
  // word "corner" was part of the extractor once and the word diet removed
  // it from the legend, which read as a disagreement rather than as a stale
  // regex, the second time this exact cell failed that exact way.
  const legend = (home.match(/class="covcount"[^>]*>(\d+)/) || [])[1];
  assert.equal(Number(counts[0]), Number(legend), `audited index says ${counts[0]}, homepage coverage legend says ${legend}`);
  assert.equal(Number(counts[0]), (meta.audited || []).length, "and both must equal the stored roster");
});

test("a corner with a stored verified letter serves it, always", async () => {
  // The bug this holds shut: the stored-letter fallback lived only inside the
  // model-backoff branch, so a corner served its verified letter only while a
  // backoff record happened to exist. That record has a TTL. When it expired
  // the request fell through to drafting, drafting failed, and the corner
  // served the pending state with its letter sitting in KV the whole time.
  // Corners went dark one at a time as their edge caches expired, which is
  // exactly why it presented as per-corner breakage.
  const slugs = [...fullSeg.matchAll(/class="aname" href="\/c\/([^"]+)"/g)].map((m) => m[1]);
  const withCell = slugs.map((slug) => {
    const seg = fullSeg.slice(fullSeg.indexOf(`href="/c/${slug}"`));
    const row = seg.slice(0, seg.indexOf("</li>"));
    const cells = [...row.matchAll(/class="lcell (?:on|off|none)">([^<]*)</g)].map((m) => m[1]);
    return { slug, saysServed: cells[0] === "Letter served" };
  });
  const bad = [];
  for (let i = 0; i < withCell.length; i += 8) {
    const chunk = await Promise.all(withCell.slice(i, i + 8).map(async ({ slug, saysServed }) => {
      const j = await fetch(`${ORIGIN}/api/letter?x=${slug}`).then((r) => r.json()).catch(() => null);
      const serves = j?.source === "verified-cache" && Boolean(j?.text);
      return serves === saysServed ? null : `${slug}: index says ${saysServed ? "served" : "pending"}, API says ${j?.source}`;
    }));
    bad.push(...chunk.filter(Boolean));
  }
  assert.deepEqual(bad, [], `index and API disagree: ${bad.join("; ")}`);
});
