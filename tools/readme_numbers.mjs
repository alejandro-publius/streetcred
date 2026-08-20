#!/usr/bin/env node
// The README's real-numbers block, generated rather than typed.
//
//   node tools/readme_numbers.mjs            rewrite the block in README.md
//   node tools/readme_numbers.mjs --dry      print the block, write nothing
//   node tools/readme_numbers.mjs --origin https://other.example
//
// Every number in the README block below the markers is read from the live
// Worker at the moment this runs. Nothing is estimated, nothing is carried over
// from a previous run, and a figure the site did not carry is written as "not
// known" rather than left at its last value. That last rule is the whole point:
// a hand-maintained number in a README goes stale silently, and a stale number
// in a document about honest measurement is the one mistake this project cannot
// afford.
//
// A press burn is usually running, so several of these move between two runs
// minutes apart. That is why every row carries an as-of, and why the as-of is
// the site's own timestamp wherever the site publishes one rather than the
// fetch time.
//
// No dependencies, no key, no write to anything but README.md. The endpoints
// used are all public.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const README = join(ROOT, "README.md");
const BEGIN = "<!-- BEGIN GENERATED: readme_numbers -->";
const END = "<!-- END GENERATED: readme_numbers -->";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const originArg = argv.indexOf("--origin");
const ORIGIN =
  originArg >= 0 && argv[originArg + 1]
    ? argv[originArg + 1].replace(/\/+$/, "")
    : "https://streetcred.thealexschroeder.workers.dev";

const UNKNOWN = "not known";

// ------------------------------------------------------------------ fetching

async function get(path, kind) {
  const url = `${ORIGIN}${path}`;
  const res = await fetch(url, { headers: { "user-agent": "streetcred-readme-numbers" } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return kind === "json" ? res.json() : res.text();
}

// A fetch that fails must not take the whole block down: the rows it feeds
// become "not known" and every other row is still generated. A README that
// half regenerates is more useful than one that refuses.
async function tryGet(path, kind) {
  try {
    return await get(path, kind);
  } catch (err) {
    process.stderr.write(`  ${path} unavailable: ${err.message}\n`);
    return null;
  }
}

// ------------------------------------------------------------------ scraping
//
// /status and the homepage publish figures that no JSON endpoint carries, so
// they are read out of the HTML. Both use one stable shape apiece, and every
// extractor returns null rather than a guess when the shape is not found.

const unent = (s) =>
  String(s)
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/&rarr;/g, "→")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// /status renders every metered figure as a label span followed by a value
// span. Reading the pairs is stabler than matching each number's own digits.
function statusRows(html) {
  const rows = new Map();
  if (!html) return rows;
  const re = /<span class="ep">([\s\S]*?)<\/span>\s*<span class="ms">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const label = unent(m[1].replace(/<[^>]+>/g, " "));
    const value = unent(m[2].replace(/<[^>]+>/g, " "));
    if (!rows.has(label)) rows.set(label, value);
  }
  return rows;
}

function rowStartingWith(rows, prefix) {
  for (const [label, value] of rows) if (label.startsWith(prefix)) return { label, value };
  return null;
}

// The homepage stat band: number, label, note. The note carries the as-of the
// site itself computed, which is the one to publish for those figures.
function homeTiles(html) {
  const tiles = new Map();
  if (!html) return tiles;
  const re =
    /<span class="sbnum">([\s\S]*?)<\/span><span class="sblabel">([\s\S]*?)<\/span><span class="sbnote">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    tiles.set(unent(m[2]), { value: unent(m[1]), note: unent(m[3]) });
  }
  return tiles;
}

function firstMatch(html, re, fn) {
  if (!html) return null;
  const m = html.match(re);
  return m ? fn(m) : null;
}

// ------------------------------------------------------------------ rendering

const iso = (t) => (t ? String(t).replace(/\.\d+Z$/, "Z") : UNKNOWN);

function row(figure, value, asOf, source) {
  const v = value == null || value === "" ? UNKNOWN : String(value);
  const a = asOf == null || asOf === "" ? UNKNOWN : String(asOf);
  return `| ${figure} | ${v} | ${a} | ${source} |`;
}

async function main() {
  process.stderr.write(`reading ${ORIGIN}\n`);
  const [board, city, watchlist, radar, health, statusHtml, homeHtml, watchlistHtml] = await Promise.all([
    tryGet("/api/board", "json"),
    tryGet("/api/city", "json"),
    tryGet("/api/watchlist", "json"),
    tryGet("/api/radar", "json"),
    tryGet("/api/health", "json"),
    tryGet("/status", "text"),
    tryGet("/", "text"),
    tryGet("/watchlist", "text"),
  ]);

  const fetchedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const rows = statusRows(statusHtml);
  const tiles = homeTiles(homeHtml);

  // Synthetic uptime and its denominator sit together on /status, so they are
  // read together: a percentage without its run count is not a measurement.
  const uptime = firstMatch(
    statusHtml,
    /<div class="big[^"]*">([\d.]+)%<\/div>\s*<p class="note">(\d+) runs in the last 7 days, (\d+) with at least one failing check/,
    (m) => ({ pct: m[1], runs: m[2], failing: m[3] }),
  );

  // The month roll-up on /watchlist, which counts every corner the press lane
  // has checked this month rather than only the run in flight.
  const pressMonth = firstMatch(
    watchlistHtml,
    /<b>([\d,]+) corners press-checked this month, ([\d,]+) with coverage found\.<\/b>/,
    (m) => ({ checked: m[1], covered: m[2] }),
  );
  const pressMonthRate = pressMonth
    ? (() => {
        const c = Number(pressMonth.checked.replace(/,/g, ""));
        const w = Number(pressMonth.covered.replace(/,/g, ""));
        return c > 0 ? `${((w / c) * 100).toFixed(1)}%` : null;
      })()
    : null;

  // A press scan card is only on /status while a burn is checkpointing. No card
  // is a state, not a missing measurement, and it is written as one.
  const noScan = statusHtml && !/Press scan/.test(statusHtml) ? "no press scan reporting at fetch time" : null;
  const scanChecked = rows.get("Corners checked") ?? noScan;
  const scanCoverage = rows.get("Coverage found") ?? noScan;
  const scanSpent = rows.get("Spent by this run") ?? noScan;
  const scanReported = rows.get("Last reported");
  const exaPeriod = rowStartingWith(rows, "Exa press budget");
  const exaAllTime = rowStartingWith(rows, "Exa spend all time");
  const apifyRuns = rowStartingWith(rows, "Apify actor runs");
  const apifyInvoice = rowStartingWith(rows, "Apify invoice");

  const citesTile = tiles.get("press citations found");
  const auditedTile = tiles.get("fully audited");
  const gradedTile = tiles.get("intersections graded");

  const monitors = radar?.monitors?.list?.length ?? null;
  const feed = radar?.feed ? radar.feed.length : null;
  const dayCap = radar?.budget?.dayCapCents ?? null;
  const monthCap = radar?.budget?.monthCapCents ?? null;
  const daySpent = radar?.budget?.dayCents ?? null;

  const out = [];
  out.push(BEGIN);
  out.push("");
  out.push(
    `*Generated by \`node tools/readme_numbers.mjs\`, which reads the live Worker and rewrites only the block between these markers. Fetched ${fetchedAt}. Nothing in this table is typed by hand and nothing is carried over from the previous run: a figure the site did not publish at fetch time reads "${UNKNOWN}" rather than keeping its old value. The as-of column is the site's own timestamp for the figure wherever the site publishes one, because a press burn is usually running and several of these move within the hour.*`,
  );
  out.push("");
  out.push("| Figure | Value | As of | Read from |");
  out.push("| --- | --- | --- | --- |");

  out.push(
    row(
      "Intersections graded citywide",
      city?.total != null ? city.total.toLocaleString("en-US") : gradedTile?.value,
      city?.sweepDate ? `sweep ${city.sweepDate}` : null,
      "`/api/city` `total` and `sweepDate`",
    ),
  );
  out.push(
    row(
      "Corners fully audited, every lane checked",
      auditedTile?.value,
      `read ${fetchedAt}`,
      "homepage stat band, `fully audited`",
    ),
  );
  out.push(
    row(
      "Corners on the board",
      board?.count != null ? String(board.count) : null,
      `read ${fetchedAt}`,
      "`/api/board` `count`",
    ),
  );
  out.push(
    row(
      "Corners press-checked this month",
      pressMonth?.checked,
      `read ${fetchedAt}`,
      "`/watchlist`, the press roll-up line",
    ),
  );
  out.push(
    row(
      "Of those, coverage found",
      pressMonth ? `${pressMonth.covered}, a ${pressMonthRate || UNKNOWN} hit rate` : null,
      `read ${fetchedAt}`,
      "`/watchlist`, hit rate computed from the two counts beside it",
    ),
  );
  out.push(
    row(
      "Press scan in flight, corners checked",
      scanChecked,
      scanReported ? `last reported ${scanReported}` : null,
      "`/status`, press scan card",
    ),
  );
  out.push(
    row("Press scan in flight, coverage found", scanCoverage, scanReported ? `last reported ${scanReported}` : null, "`/status`, press scan card"),
  );
  out.push(
    row("Press scan in flight, spent", scanSpent, scanReported ? `last reported ${scanReported}` : null, "`/status`, press scan card"),
  );
  out.push(
    row(
      "Press citations stored",
      citesTile?.value,
      citesTile?.note ? citesTile.note.replace(/^.*?as of /, "") : null,
      "homepage stat band, counted from the stored records",
    ),
  );
  out.push(
    row(
      "Exa spend this period, against the cap",
      exaPeriod?.value,
      exaPeriod?.label ? exaPeriod.label.replace(/^Exa press budget, /, "") : null,
      "`/status`, metered from Exa's own `costDollars`",
    ),
  );
  out.push(row("Exa spend all time", exaAllTime?.value, `read ${fetchedAt}`, "`/status`, from what the provider charged"));
  out.push(
    row(
      "Apify actor runs, against the monthly ceiling",
      apifyRuns?.value,
      apifyRuns?.label ? apifyRuns.label.replace(/^Apify actor runs, /, "") : null,
      "`/status`, ledger written per run",
    ),
  );
  out.push(
    row(
      "Apify invoice for the cycle",
      apifyInvoice?.value,
      `read ${fetchedAt}`,
      "`/status`, the provider's own figure",
    ),
  );
  out.push(
    row(
      "Exa monitors standing on the radar",
      monitors != null ? String(monitors) : null,
      radar?.monitors?.createdAt ? `created ${iso(radar.monitors.createdAt)}` : null,
      "`/api/radar` `monitors.list`",
    ),
  );
  out.push(
    row(
      "Radar detections in the feed",
      feed != null
        ? feed === 0
          ? "0, the monitors are open and nothing has arrived yet"
          : String(feed)
        : null,
      `read ${fetchedAt}`,
      "`/api/radar` `feed`",
    ),
  );
  out.push(
    row(
      "Radar budget spent, against its caps",
      daySpent != null && dayCap != null && monthCap != null
        ? `${daySpent} of ${dayCap} cents today, ${radar.budget.monthCents} of ${monthCap} cents this month`
        : null,
      `read ${fetchedAt}`,
      "`/api/radar` `budget`",
    ),
  );
  // Attempted and completed are different numbers and the site publishes only
  // the first. The watchlist lane runs last inside the daily-audit cron
  // invocation, so it inherits an already-spent subrequest budget and most of
  // its queries die with "Too many subrequests by single Worker invocation".
  // Each of those carries a `failed` field. Reporting only the attempt would
  // repeat the overstatement rather than measuring it.
  const wq = Array.isArray(watchlist?.queries) ? watchlist.queries : [];
  const wDone = wq.filter((q) => !q.failed).length;
  const wFailed = wq.length - wDone;
  out.push(
    row(
      "Watchlist searches, attempted and completed",
      watchlist?.calls != null
        ? wq.length
          ? `${watchlist.calls} attempted, ${wDone} completed${
              wFailed ? `, ${wFailed} cut off by the Worker subrequest limit` : ""
            }`
          : String(watchlist.calls)
        : null,
      watchlist?.builtAt ? `built ${iso(watchlist.builtAt)}` : null,
      "`/api/watchlist` `calls`, and `queries[].failed`",
    ),
  );
  out.push(
    row(
      "Watchlist articles read",
      watchlist?.articles != null ? String(watchlist.articles) : null,
      watchlist?.builtAt ? `built ${iso(watchlist.builtAt)}` : null,
      "`/api/watchlist` `articles`",
    ),
  );
  out.push(
    row(
      "Watchlist entries verified",
      watchlist?.entries ? String(watchlist.entries.length) : null,
      watchlist?.builtAt ? `built ${iso(watchlist.builtAt)}` : null,
      "`/api/watchlist` `entries`",
    ),
  );
  out.push(
    row(
      "Watchlist rejects published, with reasons",
      watchlist?.rejected != null ? String(watchlist.rejected) : null,
      watchlist?.builtAt ? `built ${iso(watchlist.builtAt)}` : null,
      "`/api/watchlist` `rejected`",
    ),
  );
  out.push(
    row(
      "Watchlist phrases discarded, no such SF street",
      watchlist?.discarded != null ? String(watchlist.discarded) : null,
      watchlist?.builtAt ? `built ${iso(watchlist.builtAt)}` : null,
      "`/api/watchlist` `discarded`",
    ),
  );
  out.push(
    row(
      "Synthetic uptime over 7 days",
      uptime ? `${uptime.pct}%, ${uptime.runs} runs, ${uptime.failing} with a failing check` : null,
      `read ${fetchedAt}`,
      "`/status`, counted from the monitor log",
    ),
  );
  out.push(
    row(
      "Dependencies answering",
      (() => {
        if (!health) return null;
        // Everything on /api/health that is a probe verdict. The other keys are
        // plan metadata and are not dependencies.
        const meta = new Set(["ok", "skipped", "exaUnitUsd", "exaPlan", "lastGoodProbe", "exaAccountVerified"]);
        const probes = Object.entries(health).filter(([k]) => !meta.has(k));
        const good = probes.filter(([, v]) => v === "ok");
        const bad = probes.filter(([, v]) => v !== "ok").map(([k, v]) => `${k} ${v}`);
        return `${good.length} of ${probes.length} answering ok${bad.length ? `, ${bad.join(", ")}` : ""}`;
      })(),
      `read ${fetchedAt}`,
      "`/api/health`",
    ),
  );

  out.push("");
  out.push(END);

  const block = out.join("\n");
  if (DRY) {
    process.stdout.write(block + "\n");
    return;
  }

  const src = readFileSync(README, "utf8");
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a < 0 || b < 0 || b < a) {
    throw new Error(`README.md is missing the ${BEGIN} / ${END} markers, so there is nothing to rewrite.`);
  }
  const next = src.slice(0, a) + block + src.slice(b + END.length);
  writeFileSync(README, next);
  process.stderr.write(`wrote ${out.length - 4} rows into README.md\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
