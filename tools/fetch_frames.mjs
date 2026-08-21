// Street View frames for the city, staged to disk.
//
//   node tools/fetch_frames.mjs --plan
//   node tools/fetch_frames.mjs --fetch --set=warmed
//   node tools/fetch_frames.mjs --fetch --set=top500
//   node tools/fetch_frames.mjs --publish
//
// Two endpoints, and the difference between them is the whole cost model.
// The metadata endpoint is free and unmetered, so coverage is established for
// every corner before a single billable request is made. Only a corner that
// metadata says has a panorama is ever fetched as an image.
//
// The absence result is stored, not inferred. A corner Street View genuinely
// does not cover gets a record saying so, which is what lets the page say
// "Street View has no photograph of this corner" as a checked claim rather than
// as a guess about somebody else's coverage. Everything else says the frame is
// not stored yet, because that is our gap.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(ROOT, "scratch", "frames");
const META = join(STAGE, "_probe.json");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argOf = (n, d) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const SET = argOf("set", "warmed");
const LIMIT = Number(argOf("limit", "0")) || 0;
const DO_FETCH = has("--fetch");
const DO_PUBLISH = has("--publish");

// Street View Static, current published rates. 0 to 100,000 requests a month is
// $7.00 per 1,000, and the first 10,000 a month are free. Metadata is its own
// SKU at no charge and no cap.
const USD_PER_1000 = 7.0;
const FREE_PER_MONTH = 10_000;
const usdFor = (n, alreadyUsedThisMonth = 0) => {
  const billable = Math.max(0, n - Math.max(0, FREE_PER_MONTH - alreadyUsedThisMonth));
  return Math.round((billable / 1000) * USD_PER_1000 * 100) / 100;
};

const KEY = (() => {
  const f = join(ROOT, ".dev.vars");
  if (!existsSync(f)) throw new Error(".dev.vars not found, so there is no maps key to read");
  const m = readFileSync(f, "utf8").match(/^GOOGLE_MAPS_API_KEY\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error("GOOGLE_MAPS_API_KEY is not in .dev.vars");
  return m[1].trim();
})();

const kv = (a) =>
  execFileSync("npx", ["wrangler", ...a], { cwd: ROOT, encoding: "utf8", timeout: 600_000, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

const kvJson = (k) => {
  const o = kv(["kv", "key", "get", k, "--binding", "STORE", "--remote", "--text"]);
  return JSON.parse(o.slice(o.indexOf("{")));
};

// ------------------------------------------------------------------ the sets

function fleet() {
  const meta = kvJson("city:meta");
  const keyOut = kv(["kv", "key", "list", "--binding", "STORE", "--remote"]);
  const keys = JSON.parse(keyOut.slice(keyOut.indexOf("["))).map((k) => k.name);
  const haveFrame = new Set(keys.filter((n) => /^img:.+:today$/.test(n)).map((n) => n.split(":")[1]));

  const sweep = JSON.parse(readFileSync(join(ROOT, "sweep-results.json"), "utf8")).corners;
  const all = (Array.isArray(sweep) ? sweep : Object.values(sweep)).filter((r) => r?.slug);
  const bySlug = new Map(all.map((r) => [r.slug, r]));
  const warmedSlugs = [...new Set([...(meta.audited || []), ...(meta.enriched || [])])];
  const warmed = warmedSlugs.map((s) => bySlug.get(s)).filter(Boolean);
  const warmedSet = new Set(warmedSlugs);
  const scored = all.filter((r) => !warmedSet.has(r.slug)).sort((a, b) => (b.points ?? 0) - (a.points ?? 0));

  return { haveFrame, all, warmed, scored, meta };
}

const need = (rows, haveFrame, probed) =>
  rows.filter((r) => !haveFrame.has(r.slug) && !probed.has(r.slug));

function readProbe() {
  try {
    return JSON.parse(readFileSync(META, "utf8"));
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ fetching

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function coverage(row) {
  const u = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${row.lat},${row.lon}&key=${KEY}`;
  const r = await fetch(u);
  const d = await r.json().catch(() => ({}));
  return { status: d.status || `http ${r.status}`, panoId: d.pano_id || null, date: d.date || null };
}

async function frame(row) {
  const u =
    "https://maps.googleapis.com/maps/api/streetview?size=640x400" +
    `&location=${row.lat},${row.lon}&heading=${row.heading ?? 0}&pitch=${row.pitch ?? 0}` +
    `&fov=90&key=${KEY}`;
  const r = await fetch(u);
  const type = r.headers.get("content-type") || "";
  if (!r.ok || !type.startsWith("image/")) throw new Error(`streetview ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ------------------------------------------------------------------ run

const IS_MAIN = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (IS_MAIN) {
  mkdirSync(STAGE, { recursive: true });
  const { haveFrame, all, warmed, scored } = fleet();
  const probed = readProbe();
  const probedSlugs = new Set(Object.keys(probed));

  const SETS = {
    warmed: need(warmed, haveFrame, probedSlugs),
    top500: need(scored.slice(0, 500), haveFrame, probedSlugs),
    city: need(all, haveFrame, probedSlugs),
  };

  console.log("| set | corners | missing a frame | image requests | gross at $7/1000 | after the 10,000 free | kv writes |");
  console.log("|---|---|---|---|---|---|---|");
  for (const [name, rows] of Object.entries({
    "audited + enriched": need(warmed, haveFrame, new Set()),
    "top 500 scored": need(scored.slice(0, 500), haveFrame, new Set()),
    "all 7,353": need(all, haveFrame, new Set()),
  })) {
    const n = rows.length;
    console.log(`| ${name} | ${name === "all 7,353" ? all.length : name === "top 500 scored" ? 500 : warmed.length} | ${n} | ${n} | $${((n / 1000) * USD_PER_1000).toFixed(2)} | $${usdFor(n).toFixed(2)} | ${n} |`);
  }
  console.log(`\nmetadata probes are a separate SKU at no charge and no cap, so coverage is established for every corner before any image is requested.`);

  if (!DO_FETCH && !DO_PUBLISH) {
    console.log(`\nplan only. --fetch --set=${SET} would work on ${SETS[SET]?.length ?? 0} corners.`);
    process.exit(0);
  }

  if (DO_FETCH) {
    const rows = LIMIT ? (SETS[SET] || []).slice(0, LIMIT) : SETS[SET] || [];
    console.log(`\nfetching ${rows.length} corners in set "${SET}"\n`);
    let got = 0, none = 0, failed = 0, requests = 0;
    for (const [i, row] of rows.entries()) {
      try {
        const cov = await coverage(row);
        if (cov.status !== "OK") {
          // The honest absence, recorded. This is the only thing that entitles
          // a page to say Street View has no photograph here.
          probed[row.slug] = { status: cov.status, at: new Date().toISOString(), coverage: false };
          none += 1;
          if (i % 25 === 0) console.log(`  [${i + 1}/${rows.length}] ${row.slug}: no coverage (${cov.status})`);
          continue;
        }
        const bytes = await frame(row);
        requests += 1;
        writeFileSync(join(STAGE, `${row.slug}.jpg`), bytes);
        probed[row.slug] = { status: "OK", at: new Date().toISOString(), coverage: true, panoId: cov.panoId, date: cov.date, bytes: bytes.length };
        got += 1;
        if (i % 25 === 0) console.log(`  [${i + 1}/${rows.length}] ${row.slug}: ${bytes.length} bytes`);
      } catch (e) {
        failed += 1;
        console.log(`  [${i + 1}/${rows.length}] ${row.slug}: FAILED ${String(e.message || e).slice(0, 70)}`);
      }
      if (i % 50 === 49) { writeFileSync(META, JSON.stringify(probed, null, 2)); await sleep(200); }
    }
    writeFileSync(META, JSON.stringify(probed, null, 2));
    console.log(`\n| metric | value |`);
    console.log(`|---|---|`);
    console.log(`| corners attempted | ${rows.length} |`);
    console.log(`| frames staged | ${got} |`);
    console.log(`| no coverage, recorded | ${none} |`);
    console.log(`| failed | ${failed} |`);
    console.log(`| billable image requests | ${requests} |`);
    console.log(`| cost at $7 per 1,000 | $${((requests / 1000) * USD_PER_1000).toFixed(2)} |`);
    console.log(`| against the 10,000 free monthly | $${usdFor(requests).toFixed(2)} |`);
  }

  if (DO_PUBLISH) {
    const files = readdirSync(STAGE).filter((f) => f.endsWith(".jpg") && !f.startsWith(".") && !f.startsWith("_"));
    console.log(`\npublishing ${files.length} frames`);
    let wrote = 0;
    for (const f of files) {
      const slug = f.replace(/\.jpg$/, "");
      try {
        kv(["kv", "key", "put", `img:${slug}:today`, "--path", join(STAGE, f), "--binding", "STORE", "--remote"]);
        wrote += 1;
      } catch (e) {
        const msg = String(e.message || e);
        if (/free usage limit|10048/i.test(msg)) {
          console.log(`  REFUSED at ${wrote}/${files.length}: the daily KV write allowance is spent. The staged frames are correct and a republish after the reset carries them.`);
          break;
        }
        console.log(`  ${slug}: ${msg.slice(0, 80)}`);
      }
    }
    console.log(`  wrote ${wrote} frames`);
    // The index, one key for the whole city. Without it a scored corner whose
    // frame was published here has no stored record saying so, falls through to
    // the live path, reserves against the daily photograph budget and re-fetches
    // bytes already in KV. Merged with whatever is already listed, because this
    // tool publishes a set and the daily cron accumulates its own.
    if (wrote) {
      const listed = files.slice(0, wrote).map((f) => f.replace(/\.jpg$/, ""));
      let existing = [];
      try {
        const o = kv(["kv", "key", "get", "img:index", "--binding", "STORE", "--remote", "--text"]);
        existing = JSON.parse(o.slice(o.indexOf("{"))).slugs || [];
      } catch { /* no index yet */ }
      const merged = [...new Set([...existing, ...listed])].sort();
      const f = join(STAGE, ".index.json");
      writeFileSync(f, JSON.stringify({ updated: new Date().toISOString(), count: merged.length, source: "bulk fetch", slugs: merged }));
      try {
        kv(["kv", "key", "put", "img:index", "--path", f, "--binding", "STORE", "--remote"]);
        console.log(`  img:index now lists ${merged.length} corners with a stored frame`);
      } catch (e) {
        console.log(`  img:index NOT written: ${String(e.message || e).slice(0, 80)}`);
      }
    }
  }
}

export { usdFor, USD_PER_1000, FREE_PER_MONTH, need };
