// Check the live site against the committed rendered baseline.
//
// Fetches the same five pages, runs the same normalizer, and diffs the result
// against test/fixtures/rendered/. Exits 0 when nothing structural moved and 1
// when something did. During a feature freeze that non-zero is the whole point:
// it says a page is rendering differently than it did when the freeze started.
//
//   node tools/rendered_diff.mjs
//   node tools/rendered_diff.mjs --only=status
//   node tools/rendered_diff.mjs --origin=http://127.0.0.1:8787
//
// A diff is a question, not a verdict. The normalizer hides value drift and
// shows shape change, so a hit means "a human should look", not "someone broke
// the freeze". Read the region name and the two lines and decide.
//
// Not wired into .github/workflows/ci.yml on purpose: the freeze forbids
// changing the gate. The line to add later, after the freeze lifts, is in
// test/fixtures/rendered/README.md.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES, ORIGIN, normalize, fetchPage, sectionsFor, regionHits } from "./lib/rendered_norm.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "..", "test", "fixtures", "rendered");

// Caps, so one structural change cannot print ten thousand lines. A wall of
// diff is the same as no diff.
const MAX_REGIONS = 10;
const MAX_PAIRS_PER_REGION = 4;
const MAX_LINE = 220;

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

// ---------------------------------------------------------------------------
// Diff. Myers greedy with a cap on the edit distance: past the cap the two
// documents are not the same document any more and a line-by-line report would
// be noise, so it says so and stops.
// ---------------------------------------------------------------------------

function myers(A, B, maxD) {
  const N = A.length, M = B.length;
  const MAX = Math.min(maxD, N + M);
  const off = MAX + 1;
  let v = new Int32Array(2 * MAX + 3);
  const trace = [];
  for (let d = 0; d <= MAX; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= N && y >= M) return backtrack(trace, A, B, d, k, off);
    }
  }
  return null;
}

function backtrack(trace, A, B, d, k, off) {
  const ops = [];
  let x = A.length, y = B.length;
  for (let dd = d; dd > 0; dd--) {
    const v = trace[dd];
    const down = k === -dd || (k !== dd && v[off + k - 1] < v[off + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push(["=", A[--x], B[--y]]); }
    if (down) ops.push(["+", null, B[--y]]);
    else ops.push(["-", A[--x], null]);
    k = prevK;
  }
  while (x > 0 && y > 0) ops.push(["=", A[--x], B[--y]]);
  return ops.reverse();
}

function diffLines(base, live, maxD = 500) {
  let s = 0;
  while (s < base.length && s < live.length && base[s] === live[s]) s++;
  let ea = base.length, eb = live.length;
  while (ea > s && eb > s && base[ea - 1] === live[eb - 1]) { ea--; eb--; }
  if (ea === s && eb === s) return { regions: [], changed: 0, capped: false };

  const ops = myers(base.slice(s, ea), live.slice(s, eb), maxD);
  if (!ops) return { regions: [], changed: ea - s + (eb - s), capped: true };

  // Group into regions: a run of edits, ended by three or more matching lines.
  const regions = [];
  let cur = null, gap = 0, bi = s;
  for (const [kind, a, b] of ops) {
    if (kind === "=") {
      gap++;
      if (cur && gap >= 3) { regions.push(cur); cur = null; }
      bi++;
      continue;
    }
    if (!cur) { cur = { at: bi, removed: [], added: [] }; gap = 0; }
    gap = 0;
    if (kind === "-") { cur.removed.push(a); bi++; }
    else cur.added.push(b);
  }
  if (cur) regions.push(cur);
  const changed = regions.reduce((n, r) => n + r.removed.length + r.added.length, 0);
  return { regions, changed, capped: false };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const clip = (line) => (line.length > MAX_LINE ? line.slice(0, MAX_LINE) + ` ...(+${line.length - MAX_LINE} chars)` : line);

// Mark the span that actually moved, so the eye lands on it rather than on a
// hundred identical characters of markup.
function highlight(before, after) {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let sb = before.length, sa = after.length;
  while (sb > p && sa > p && before[sb - 1] === after[sa - 1]) { sb--; sa--; }
  const wrap = (line, from, to) => clip(line.slice(0, from) + "[[" + line.slice(from, to) + "]]" + line.slice(to));
  if (p === 0 && sb === before.length && sa === after.length) return [clip(before), clip(after)];
  return [wrap(before, p, sb), wrap(after, p, sa)];
}

function reportPage(page, baseLines, liveLines) {
  const { regions, changed, capped } = diffLines(baseLines, liveLines);
  if (capped) {
    console.log(`${page.file}  CHANGED  beyond line-level reporting`);
    console.log(`  the two versions differ by more than the diff cap (${baseLines.length} baseline lines, ${liveLines.length} live).`);
    console.log(`  re-run with the raw pages side by side, or re-baseline if the change is intended.`);
    return changed;
  }
  if (!regions.length) {
    console.log(`${page.file}  same  (${baseLines.length} lines)`);
    return 0;
  }
  const sections = sectionsFor(baseLines);
  console.log(`${page.file}  CHANGED  ${changed} lines in ${regions.length} region${regions.length === 1 ? "" : "s"}  ${page.path}`);
  for (const [i, r] of regions.entries()) {
    if (i >= MAX_REGIONS) {
      console.log(`  ...and ${regions.length - MAX_REGIONS} more regions, not shown.`);
      break;
    }
    const where = sections[Math.min(r.at, sections.length - 1)] || "(unknown section)";
    console.log(`  region ${i + 1}  under "${where}"  baseline line ${r.at + 1}`);
    const pairs = Math.max(r.removed.length, r.added.length);
    for (let j = 0; j < Math.min(pairs, MAX_PAIRS_PER_REGION); j++) {
      const before = r.removed[j], after = r.added[j];
      if (before !== undefined && after !== undefined) {
        const [x, y] = highlight(before, after);
        console.log(`    - ${x}`);
        console.log(`    + ${y}`);
      } else if (before !== undefined) {
        console.log(`    - ${clip(before)}`);
      } else {
        console.log(`    + ${clip(after)}`);
      }
    }
    if (pairs > MAX_PAIRS_PER_REGION) console.log(`    ...${pairs - MAX_PAIRS_PER_REGION} more lines in this region, not shown.`);
  }
  return changed;
}

// ---------------------------------------------------------------------------

async function main() {
  const origin = arg("origin", ORIGIN).replace(/\/$/, "");
  const dir = arg("dir", FIXTURE_DIR);
  const only = arg("only", "");
  const pages = only ? PAGES.filter((p) => p.file.startsWith(only) || p.path === only) : PAGES;
  if (!pages.length) {
    console.error(`no page matches --only=${only}`);
    process.exit(2);
  }

  let baselineAge = "unknown";
  let baselineRegions = {};
  const manifestPath = join(dir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      baselineAge = manifest.captured;
      for (const p of manifest.pages || []) baselineRegions[p.file] = p.regions || {};
    } catch { /* keep unknown */ }
  }

  console.log(`streetcred rendered-diff  ${new Date().toISOString()}`);
  console.log(`live:     ${origin}`);
  console.log(`baseline: ${dir}  captured ${baselineAge}\n`);

  let totalChanged = 0, changedPages = 0, missing = 0;
  for (const page of pages) {
    const path = join(dir, page.file);
    if (!existsSync(path)) {
      console.log(`${page.file}  MISSING baseline  run: node tools/snap_rendered.mjs`);
      missing++;
      continue;
    }
    const baseLines = readFileSync(path, "utf8").replace(/\n$/, "").split("\n");
    const html = await fetchPage(origin, page.path);
    const liveLines = normalize(html).split("\n");
    const n = reportPage(page, baseLines, liveLines);
    // A region rule that fired when the baseline was taken and fires no longer
    // has rotted, and the collapse it used to do is now raw markup in the diff.
    const now = regionHits(html);
    for (const name of Object.keys(baselineRegions[page.file] || {})) {
      if (!now[name]) console.log(`  note: region rule "${name}" no longer matches this page. It has rotted, or the region is gone.`);
    }
    totalChanged += n;
    if (n) changedPages++;
  }

  console.log("");
  console.log(`${pages.length} page${pages.length === 1 ? "" : "s"} checked, ${changedPages} changed, ${totalChanged} changed lines${missing ? `, ${missing} baseline missing` : ""}.`);
  if (changedPages || missing) {
    console.log("A diff is a question, not a verdict. Read it, decide whether the change was intended,");
    console.log("and if it was, re-baseline with: node tools/snap_rendered.mjs");
    process.exit(1);
  }
  console.log("No unexpected change. Value drift is normalized away; shape change is not.");
}

main().catch((err) => {
  console.error(`rendered_diff failed: ${err.message}`);
  process.exit(2);
});
