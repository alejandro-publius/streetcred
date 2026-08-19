// /status. What the synthetic monitor saw, what the verifier caught, what the
// changelog recorded. No self-assessment anywhere on this page: every row is a
// stored record something else wrote, and the page only counts.

import { FONT_LINK, BASE_CSS, META, MASTHEAD } from "./page.js";

const esc = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

const when = (ts) => {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return String(ts || "").slice(0, 16);
  }
};

export const STATUS = (synth = [], incidents = [], changes = [], origin = "", spend = null, preview = false, scored = 0) => {
  const runs = Array.isArray(synth) ? synth : [];
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const week = runs.filter((r) => new Date(r.ts).getTime() > weekAgo);
  const uptime = week.length ? Math.round((1000 * week.filter((r) => r.ok).length) / week.length) / 10 : null;
  const latest = runs[0] || null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/logo.svg">
${META({
  title: "Status \u00b7 StreetCred",
  description: "Synthetic uptime checks, letter verifier incidents, and the running cost ledger for every autonomous run this site commissions, published whether or not anyone is looking.",
  url: `${origin}/status`,
})}
${FONT_LINK}
<style>
${BASE_CSS}
.doc{max-width:720px}
.doc h1{font-size:26px;letter-spacing:-.02em;margin:0 0 8px}
.doc .sub{font-size:13.5px;color:var(--dim);margin:0 0 26px;line-height:1.6}
.doc h2{font-size:15px;margin:26px 0 10px}
.big{font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1}
.big.ok{color:#657850} .big.bad{color:#d96a10} .big.quiet{color:var(--dim);font-size:26px}
.srow{display:flex;gap:10px;align-items:center;font-size:12.5px;padding:7px 0;border-bottom:1px solid var(--line);
  font-variant-numeric:tabular-nums}
.srow i{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 8px}
.srow i.ok{background:var(--green)} .srow i.bad{background:var(--accent)}
.srow .ep{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srow .ms{color:var(--dim)}
.hist{display:flex;gap:2px;margin:10px 0 4px;height:22px;align-items:flex-end}
.hist i{flex:1;max-width:9px;border-radius:2px 2px 0 0;display:block;height:100%}
.hist i.ok{background:rgba(120,140,93,.55)} .hist i.bad{background:var(--accent)}
.note{font-size:12px;color:var(--dim);line-height:1.6}
.doc a{color:var(--ink);font-weight:600;text-decoration:none;border-bottom:1px solid var(--line2)}
</style>
</head>
<body>
<div class="wrap">
${MASTHEAD({ scored, active: "status" })}
<header>
  <div class="switcher">
    <a href="/">The city</a>
    <a href="/methodology">Methodology</a>
    <a href="/status" class="on">Status</a>
  </div>
</header>
<main>
<div class="doc">
<h1>Status</h1>
<p class="sub">An hourly synthetic monitor loads the same pages a visitor would and records what
happened. This page counts those records and adds nothing to them. Target: 99% of checks passing
over any 7 days, which is a modest promise for a civic reference and is stated in the README.</p>

${
  uptime === null
    ? `<div class="big quiet">No synthetic runs recorded yet</div>
       <p class="note">The monitor runs at 7 minutes past each hour. This page fills itself in.</p>`
    : `<div class="big ${uptime >= 99 ? "ok" : "bad"}">${uptime}%</div>
       <p class="note">${week.length} runs in the last 7 days, ${week.filter((r) => !r.ok).length} with at least one failing check.</p>
       <div class="hist">${week
         .slice(0, 84)
         .reverse()
         .map((r) => `<i class="${r.ok ? "ok" : "bad"}" title="${esc(when(r.ts))}"></i>`)
         .join("")}</div>
       <p class="note">Oldest left, one bar per run.</p>`
}

${
  latest
    ? `<h2>Latest run, ${esc(when(latest.ts))}</h2>
${(latest.results || [])
  .map(
    (r) => `<div class="srow"><i class="${r.ok ? "ok" : "bad"}"></i><span class="ep">${esc(r.endpoint)}</span>
  <span class="ms">${r.status} &middot; ${r.ms}ms</span></div>`,
  )
  .join("")}`
    : ""
}

<h2>Letter verifier</h2>
<p class="note">${
    incidents.length
      ? `${incidents.length} incident${incidents.length === 1 ? "" : "s"} on record: drafts that failed
      verification twice and were not served. Most recent at ${esc(when(incidents[0]?.at))} on
      <a href="/c/${esc(incidents[0]?.slug)}">${esc(incidents[0]?.slug)}</a>.`
      : `No incidents on record. Every served letter has passed verification against its corner's own
      records; a draft that fails twice is never shown, and would be counted here.`
  }</p>

<h2>What the autonomous run spends</h2>
<p class="note">The morning run commissions two Apify actor runs per corner and 29 Exa searches for
the citywide watchlist, unattended, against real credit. Both ledgers are written from the numbers the
providers themselves report, because an autonomous system spending money without a ledger is the thing
nobody should ship.</p>
${
  spend
    ? `<div class="srow"><span class="ep">Exa searches, batch lanes</span>
  <span class="ms">${spend.exa.calls} of ${spend.exa.cap} &middot; $${spend.exa.spendUsd.toFixed(3)}</span></div>
<div class="srow"><span class="ep">Apify actor runs, ${esc(spend.apify.month)}</span>
  <span class="ms">${spend.apify.used} of ${spend.apify.cap} &middot; $${spend.apifyUsd.toFixed(3)} ledger</span></div>
${
  spend.invoice
    ? `<div class="srow"><span class="ep">Apify invoice for the cycle, from the provider</span>
  <span class="ms">$${Number(spend.invoice.cycleUsd).toFixed(4)} of $${spend.invoice.cycleCapUsd}</span></div>`
    : ""
}
${(spend.costs || [])
  .slice(0, 8)
  .map(
    (c) => `<div class="srow"><span class="ep"><a href="/c/${esc(c.slug)}">${esc(c.name || c.slug)}</a>
  ${
    c.event === "commissioned"
      ? `${(c.runs || []).length} run${(c.runs || []).length === 1 ? "" : "s"} commissioned, in flight`
      : c.event === "rescored"
      ? `rescored to ${c.kept ?? 0} voice${c.kept === 1 ? "" : "s"} from ${c.candidates ?? 0}, no new spend`
      : `${c.kept ?? 0} voice${c.kept === 1 ? "" : "s"} kept from ${c.candidates ?? 0}`
  }</span>
  <span class="ms">${esc(String(c.at || "").slice(0, 10))} &middot; ${
    c.costUsd == null ? "pending" : `$${Number(c.costUsd).toFixed(4)}`
  }</span></div>`,
  )
  .join("")}`
    : `<p class="note">Ledger unavailable.</p>`
}

${
  spend?.invoice
    ? `<p class="note">The ledger above is written per run from what each run reported; the invoice line
is the provider's own figure for the cycle and is the one that settles. They disagreed once, on
${esc(String(spend.invoice.at).slice(0, 10))}: a corner topped up with a second scraper had its first
run counted twice, overstating the ledger by about $${Number(spend.invoice.overstatedUsd || 0).toFixed(2)}.
The counting was fixed rather than the history rewritten, which is what a ledger is for.</p>`
    : ""
}

<h2>Recent grade changes</h2>
${
  changes.length
    ? changes
        .slice(0, 5)
        .map(
          (c) => `<div class="srow"><span class="ep"><a href="/c/${esc(c.slug)}">${esc(c.name || c.slug)}</a>
  ${esc(c.old?.grade ?? "?")} ${c.old?.index ?? "?"} &rarr; ${esc(c.new?.grade ?? "?")} ${c.new?.index ?? "?"}</span>
  <span class="ms">${esc(String(c.date || "").slice(0, 10))}</span></div>`,
        )
        .join("")
    : `<p class="note">None recorded. The full feed lives at <a href="/changes">/changes</a>.</p>`
}

<p class="note" style="margin-top:22px">Monitor source: <code>synth/</code> in the repo. It reaches the
site through a service binding, so an edge-level outage in front of a healthy Worker would not show
here; that caveat is part of the record too.</p>
</div>
</main>
${preview ? '<div class="pvw">Preview</div>' : ''}
</div>
</body>
</html>`;
};
