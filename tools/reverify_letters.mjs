// Re-run the letter check over every stored letter, and say what it finds.
//
// Zero model calls and zero billable calls by construction: this imports the
// verifier directly, which is a pure function over payloads, and reads KV
// through wrangler in remote read-only mode. It never drafts, never edits a
// letter, and never writes anything back. A letter that fails is not repaired
// here, because a hand-edited letter is a letter nobody verified.
//
//   node tools/reverify_letters.mjs
//   node tools/reverify_letters.mjs --json
//   node tools/reverify_letters.mjs --queue     # also append failures to
//                                               # specs/BILLING_QUEUE.md
//
// The lane payloads each letter is checked against are the stored ones for that
// corner: stats, score, news, voices and timeline as the site has them. That is
// deliberately the same data the page displays, because the whole point of the
// rules added in this pass is that the letter and the page beside it have to
// agree.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInputSet, verifyLetter, VERIFY_VERSION } from "../src/verify.js";
import { CORNERS, supervisorFor } from "../src/data.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");
const WRITE_QUEUE = process.argv.includes("--queue");

const log = (...a) => {
  if (!JSON_OUT) console.log(...a);
};

// ---------------------------------------------------------------- KV reads

const kv = (args) =>
  execFileSync("npx", ["wrangler", ...args], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });

function listKeys(prefix) {
  // One list call, filtered here. The namespace is ~2,000 keys, so paging it by
  // prefix costs more round trips than reading it once.
  const out = kv(["kv", "key", "list", "--binding", "STORE", "--remote"]);
  const all = JSON.parse(out.slice(out.indexOf("[")));
  return all.map((k) => k.name).filter((n) => n.startsWith(prefix));
}

function readKey(key) {
  try {
    const out = kv(["kv", "key", "get", key, "--binding", "STORE", "--remote", "--text"]);
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the pass

// CORNERS is keyed by slug and holds only the two flagships; every other
// letter-serving corner lives in KV at corner:{slug}.
function cornerFor(slug) {
  return CORNERS[slug] || readKey(`corner:${slug}`) || { slug, name: slug, short: slug, fix: {} };
}

function checkOne(slug, stored) {
  const corner = cornerFor(slug);
  const stats = readKey(`corner:${slug}`)?.stats ?? readKey(`stats:${slug}`) ?? null;
  const score = readKey(`score:${slug}`) ?? null;
  const news = readKey(`press:${slug}`) ?? null;
  const voices = readKey(`voices:${slug}`) ?? null;
  const timeline = readKey(`timeline:${slug}`) ?? null;

  const inputs = buildInputSet({
    corner,
    stats,
    score,
    news,
    timeline,
    voices,
    supervisor: stats?.district ? supervisorFor(stats.district) : null,
  });
  const result = verifyLetter(stored.text, inputs);
  return { slug, result, inputs, storedVersion: stored.verifyVersion ?? null };
}

// A failure reason a regeneration prompt can be conditioned on, rather than a
// stack of near-identical sentences. One line per rule that fired.
function reasonsFor(result) {
  const byKind = new Map();
  for (const f of result.failures) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, f);
  }
  return [...byKind.values()].map((f) => `${f.kind}: ${f.reason}`);
}

log(`letter check ${VERIFY_VERSION}, over every stored letter\n`);

const keys = listKeys("letter:verified:");
log(`${keys.length} stored letter${keys.length === 1 ? "" : "s"} found at letter:verified:*\n`);

const rows = [];
for (const key of keys) {
  const slug = key.slice("letter:verified:".length);
  const stored = readKey(key);
  if (!stored?.text) {
    log(`  ${slug}: no text on the record, skipped`);
    continue;
  }
  rows.push(checkOne(slug, stored));
}

const passed = rows.filter((r) => r.result.ok);
const failed = rows.filter((r) => !r.result.ok);

// Counts broken out by rule, because "12 failed" and "12 failed the magnitude
// rule" ask for different fixes.
const byKind = {};
for (const r of failed) {
  for (const k of new Set(r.result.failures.map((f) => f.kind))) {
    byKind[k] = (byKind[k] || 0) + 1;
  }
}

if (!JSON_OUT) {
  for (const r of failed) {
    log(`\nFAIL ${r.slug} (stored under ${r.storedVersion || "no recorded version"})`);
    for (const line of reasonsFor(r.result)) log(`   - ${line}`);
  }
  log(`\n${passed.length} pass, ${failed.length} fail, ${rows.length} checked`);
  if (Object.keys(byKind).length) {
    log("failures by rule:");
    for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) log(`  ${k}: ${v}`);
  }
}

// ------------------------------------------------------- the billing queue

if (WRITE_QUEUE && failed.length) {
  const p = join(ROOT, "specs", "BILLING_QUEUE.md");
  const doc = readFileSync(p, "utf8");
  const marker = "<!-- reverify:begin -->";
  const end = "<!-- reverify:end -->";
  const body =
    `${marker}\n` +
    `## Corners whose stored letter fails the ${VERIFY_VERSION} letter check\n\n` +
    `Generated by \`node tools/reverify_letters.mjs --queue\`. Each of these serves\n` +
    `the honest pending state today and gains a letter when a funded key exists.\n` +
    `Regenerate with a lane-conditioned prompt: the reasons below are the exact\n` +
    `lanes the previous draft asserted and could not support.\n\n` +
    failed
      .map((r) => `- \`${r.slug}\`\n${reasonsFor(r.result).map((x) => `  - ${x}`).join("\n")}`)
      .join("\n") +
    `\n${end}`;
  const next =
    doc.includes(marker) && doc.includes(end)
      ? doc.slice(0, doc.indexOf(marker)) + body + doc.slice(doc.indexOf(end) + end.length)
      : `${doc.trimEnd()}\n\n${body}\n`;
  writeFileSync(p, next);
  log(`\nwrote ${failed.length} corner${failed.length === 1 ? "" : "s"} to specs/BILLING_QUEUE.md`);
}

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        version: VERIFY_VERSION,
        checked: rows.length,
        passed: passed.length,
        failed: failed.length,
        byKind,
        failures: failed.map((r) => ({ slug: r.slug, reasons: reasonsFor(r.result) })),
      },
      null,
      2,
    ),
  );
}
