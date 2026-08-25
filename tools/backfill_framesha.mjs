// Hash every stored frame, record it, and report every incoherent pair.
//
//   node tools/backfill_framesha.mjs --plan
//   node tools/backfill_framesha.mjs --write
//
// A compare slider promises that its two panes are the same photograph before
// and after. Nothing enforced that until 2026-08-25: the frame and the render
// are written by different lanes and either can be replaced without the other.
// london-and-persia was re-fetched at a new heading to pass the legibility gate
// and the page kept serving the pre-refetch photograph beside the new render.
//
// From now on every render records the hash of the frame it was conditioned on
// and every frame records its own. This walks the corners that already have
// renders and fills in what can honestly be filled in.
//
// What it can and cannot know, stated plainly. The current frame's hash is
// computable: the bytes are in KV. The conditioning frame's hash is not, unless
// this machine still holds the exact staged file the render was made from. For
// everything older that file is gone, and there is no way to recover which
// photograph a render was drawn from. Those corners are reported as UNKNOWN
// rather than guessed at, and `coherentPair` treats an absent hash as coherent,
// because taking the slider off thirty corners to fix one would be the wrong
// trade and a claim this tool cannot support.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NS = "6918c07a1e1540f0ac9b6c499c5917b7";
const CITY_FRAMES = join(ROOT, "scratch", "frames");
const STAGE_FRAMES = join(ROOT, "scratch", "imagery", "frames");

const args = process.argv.slice(2);
const WRITE = args.includes("--write");

// Four bytes of SHA-256, the same shape src/imagery.js computes in the Worker.
const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 8);

// This CLI returns 401 and 5xx on calls that succeed a second later, which is
// how a 253 byte error body once got hashed as if it were a JPEG. Every read is
// retried and every read is checked for being a JPEG before it is trusted.
function kv(argv, { binary = false, tries = 4 } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      return execFileSync("npx", ["wrangler", ...argv], {
        cwd: ROOT,
        encoding: binary ? "buffer" : "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const isJpeg = (buf) => buf && buf.length > 1000 && buf[0] === 0xff && buf[1] === 0xd8;

function frameBytes(slug) {
  const out = kv(["kv", "key", "get", `img:${slug}:today`, "--namespace-id", NS, "--remote"], { binary: true });
  return isJpeg(out) ? out : null;
}

function statusOf(slug) {
  try {
    const raw = kv(["kv", "key", "get", `imgstatus:${slug}`, "--namespace-id", NS, "--remote", "--text"]);
    return JSON.parse(raw.slice(raw.indexOf("{")));
  } catch {
    return null;
  }
}

// The staged file this machine still holds, if any. Only a file that is still
// on disk can testify about what a render was conditioned on.
function stagedSha(slug) {
  for (const dir of [STAGE_FRAMES, CITY_FRAMES]) {
    const f = join(dir, `${slug}.jpg`);
    if (existsSync(f)) return { sha: sha(readFileSync(f)), from: dir === CITY_FRAMES ? "scratch/frames" : "scratch/imagery/frames" };
  }
  return null;
}

const meta = JSON.parse(
  kv(["kv", "key", "get", "city:meta", "--namespace-id", NS, "--remote", "--text"]).slice(
    kv(["kv", "key", "get", "city:meta", "--namespace-id", NS, "--remote", "--text"]).indexOf("{"),
  ),
);
const roster = [...new Set([...(meta.audited || []), ...(meta.enriched || [])])].sort();

console.log(`walking ${roster.length} corners on the audited and enriched rosters\n`);

const rows = [];
for (const slug of roster) {
  const st = statusOf(slug);
  if (!st || st.status !== "ready" || !(st.states || []).includes("fix")) continue;
  const bytes = frameBytes(slug);
  if (!bytes) {
    rows.push({ slug, verdict: "NO FRAME", note: "imgstatus says ready but no today frame is stored" });
    continue;
  }
  const now = sha(bytes);
  const staged = stagedSha(slug);
  const recorded = st.render?.fix?.sourceFrameSha || null;

  let verdict;
  let note;
  if (recorded) {
    verdict = recorded === now ? "COHERENT" : "INCOHERENT";
    note = `render conditioned on ${recorded}, frame now ${now}`;
  } else if (staged) {
    verdict = staged.sha === now ? "COHERENT" : "INCOHERENT";
    note = `no hash recorded; ${staged.from} holds ${staged.sha}, frame now ${now}`;
  } else {
    verdict = "UNKNOWN";
    note = `no hash recorded and no staged frame on this machine; frame now ${now}`;
  }
  rows.push({ slug, verdict, note, now, recorded, staged: staged?.sha || null });
}

for (const v of ["INCOHERENT", "UNKNOWN", "COHERENT", "NO FRAME"]) {
  const group = rows.filter((r) => r.verdict === v);
  if (!group.length) continue;
  console.log(`${v}: ${group.length}`);
  for (const r of group) console.log(`  ${r.slug.padEnd(30)} ${r.note}`);
  console.log("");
}

if (WRITE) {
  let wrote = 0;
  for (const r of rows) {
    if (!r.now) continue;
    const st = statusOf(r.slug);
    if (!st) continue;
    const next = { ...st, frameSha: r.now };
    // Only claim a conditioning hash where a file on this machine can testify.
    if (!next.render?.fix?.sourceFrameSha && r.staged) {
      next.render = next.render || {};
      next.render.fix = { ...(next.render.fix || {}), sourceFrameSha: r.staged };
      if (next.render.hazards) next.render.hazards.sourceFrameSha = r.staged;
    }
    const tmp = join(mkdtempSync(join(tmpdir(), "sc-")), "s.json");
    writeFileSync(tmp, JSON.stringify(next));
    try {
      kv(["kv", "key", "put", `imgstatus:${r.slug}`, "--path", tmp, "--namespace-id", NS, "--remote"]);
      wrote += 1;
    } catch (e) {
      console.log(`  ${r.slug}: NOT written, ${String(e.message || e).slice(0, 80)}`);
    }
  }
  console.log(`wrote frameSha to ${wrote} imgstatus records`);
} else {
  console.log("plan only. Pass --write to record the hashes.");
}
