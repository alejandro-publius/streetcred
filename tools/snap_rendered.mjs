// Snapshot the five key pages from the live site, normalized.
//
// This writes the baseline that tools/rendered_diff.mjs later checks against.
// It is the only thing in the harness that is allowed to overwrite a fixture,
// which is deliberate: re-baselining should be a decision somebody made, not a
// side effect of running a check.
//
//   node tools/snap_rendered.mjs
//   node tools/snap_rendered.mjs --origin=http://127.0.0.1:8787
//   node tools/snap_rendered.mjs --only=status
//
// Read-only against the site. It issues five GETs and touches nothing else.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES, ORIGIN, normalize, fetchPage, regionHits } from "./lib/rendered_norm.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(HERE, "..", "test", "fixtures", "rendered");

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

async function main() {
  const origin = arg("origin", ORIGIN).replace(/\/$/, "");
  const dir = arg("dir", FIXTURE_DIR);
  const only = arg("only", "");
  const pages = only ? PAGES.filter((p) => p.file.startsWith(only) || p.path === only) : PAGES;
  if (!pages.length) {
    console.error(`no page matches --only=${only}`);
    process.exit(2);
  }

  mkdirSync(dir, { recursive: true });
  const captured = new Date().toISOString();
  const manifest = { captured, origin, pages: [] };

  for (const page of pages) {
    const html = await fetchPage(origin, page.path);
    const text = normalize(html);
    const regions = regionHits(html);
    writeFileSync(join(dir, page.file), text + "\n");
    const lines = text.split("\n").length;
    manifest.pages.push({ file: page.file, path: page.path, label: page.label, lines, rawBytes: html.length, regions });
    const fired = Object.entries(regions).map(([k, n]) => `${k}x${n}`).join(" ") || "no region rule fired";
    console.log(`wrote ${page.file}  ${lines} lines  from ${page.path} (${html.length} raw bytes)`);
    console.log(`      regions collapsed: ${fired}`);
  }

  // The capture time lives here rather than inside a snapshot, because a header
  // stamped into the fixture would itself be a line that changes every run.
  if (!only) writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nbaseline captured ${captured} from ${origin}`);
  console.log("re-run tools/rendered_diff.mjs to check the site against it.");
}

main().catch((err) => {
  console.error(`snap_rendered failed: ${err.message}`);
  process.exit(2);
});
