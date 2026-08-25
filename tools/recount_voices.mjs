// Recount the voices summary against what the site actually serves.
//
//   node tools/recount_voices.mjs --plan
//   node tools/recount_voices.mjs --write
//
// The stored summary counts what each scrape's ingest kept. Since the corner
// check shipped (2026-08-24) that is not what a reader sees: an account naming
// a different crossing is withheld on the way out, and an account naming one of
// the two streets is published labeled as corridor evidence. The homepage was
// therefore publishing 4 cleared where 1 account was visible.
//
// This reads the LIVE payload for every commissioned corner, which is the same
// answer a visitor gets, and writes the counts back. One KV write. It never
// touches a voices:{slug} record: the accounts themselves stay exactly as the
// scrape and the scorer wrote them, and the withholding stays a serving
// decision that can be undone by a deploy rather than a re-scrape.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = (process.env.STREETCRED_ORIGIN || "https://streetcred.thealexschroeder.workers.dev").replace(/\/$/, "");
const WRITE = process.argv.includes("--write");

const kv = (a) => execFileSync("npx", ["wrangler", ...a], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const raw = kv(["kv", "key", "get", "voices:summary", "--binding", "STORE", "--remote", "--text"]);
const summary = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const slugs = Object.keys(summary.corners || {});

const stamp = Date.now();
let crossing = 0, corridor = 0, withheld = 0;
const corners = {};
const rows = [];
for (const slug of slugs) {
  const d = await fetch(`${ORIGIN}/api/voices?x=${slug}&recount=${stamp}`).then((r) => r.json()).catch(() => null);
  const items = d?.items || [];
  const sup = d?.suppressed || 0;
  // An unchecked payload cannot be counted as checked. Refuse rather than
  // publish a number this run could not stand behind.
  if (items.length && d?.crossCheck !== "checked") {
    console.log(`REFUSING: ${slug} served ${items.length} account(s) with crossCheck ${d?.crossCheck}`);
    process.exit(1);
  }
  const x = items.filter((i) => i.match === "crossing").length;
  const c = items.filter((i) => i.match === "corridor").length;
  crossing += x; corridor += c; withheld += sup;
  corners[slug] = items.length;
  if (items.length || sup) rows.push({ slug, crossing: x, corridor: c, withheld: sup });
}

const next = {
  ...summary,
  at: new Date().toISOString(),
  corners,
  commissioned: slugs.length,
  withQuote: slugs.filter((s) => corners[s] > 0).length,
  quotes: Object.values(corners).reduce((a, b) => a + b, 0),
  // The breakdown the homepage renders. Dropped by the next ingest rather than
  // carried forward, because a stale breakdown is worse than none and the
  // homepage falls back to the plain sentence without it.
  check: { at: new Date().toISOString(), crossing, corridor, withheld, origin: ORIGIN },
};

console.log(`commissioned ${slugs.length}`);
for (const r of rows) console.log(`  ${r.slug.padEnd(24)} crossing ${r.crossing}  corridor ${r.corridor}  withheld ${r.withheld}`);
console.log(`\ntotals: crossing ${crossing}, corridor ${corridor}, withheld ${withheld}, scraped empty ${slugs.length - crossing - corridor - withheld}`);
console.log(`withQuote ${summary.withQuote} -> ${next.withQuote}, quotes ${summary.quotes} -> ${next.quotes}`);

if (!WRITE) { console.log("\nplan only, nothing written"); process.exit(0); }
const f = join(ROOT, "scratch", "logs", ".voicesummary.json");
writeFileSync(f, JSON.stringify(next));
kv(["kv", "key", "put", "voices:summary", "--path", f, "--binding", "STORE", "--remote"]);
console.log("\nvoices:summary written, 1 kv write");
