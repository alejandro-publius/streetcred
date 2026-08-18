// The Corner Watchdog's diary.
//
// This page renders one thing: what an autonomous agent decided, in the order
// it decided it. That includes, and mostly consists of, the times it decided to
// do nothing. An agent that only publishes its actions is showing you a
// highlight reel; the declines are where the judgment actually lives, so they
// get the same weight, the same styling and their reasoning on tap.
//
// Every number here is counted from the journal in agent.js and nowhere else,
// so a reader who fetches /api/agent/journal can recount all of them by hand.
// When the journal is empty the page says the agent has not run yet, because
// the alternative is a dashboard of zeroes that looks like a working system.

import { LOGO, FONT_LINK, BASE_CSS } from "./page.js";
import { journalStats } from "./agent.js";

const esc = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

const REPO = "https://github.com/thealexschroeder/streetcred-watchdog";

// Pacific, matching the cron and the cotd log, so the diary and the rest of the
// site never disagree about which morning something happened.
function pacific(ts, opts) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", ...opts }).format(
      new Date(ts),
    );
  } catch {
    return "";
  }
}

const timeOf = (ts) => pacific(ts, { hour: "numeric", minute: "2-digit" });
const dayOf = (ts) => pacific(ts, { month: "short", day: "numeric" });
const isoDay = (ts) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(ts));
  } catch {
    return "";
  }
};

const ACTION_WORDS = {
  rescore: "re-scored",
  reaudit_imagery: "queued a fresh visual audit for review",
  regenerate_letter: "redrafted the letter",
  flag: "flagged the corner",
};

// The one-line summary at the top of every entry, written the way a person
// would say it rather than as a field dump.
function headline(e) {
  const where = e.name || e.slug;
  const at = where ? ` at ${esc(where)}` : "";
  if (!e.tier1?.significant) {
    return `Looked at a change${at} and let it go`;
  }
  const acts = (e.actions || []).map((a) => ACTION_WORDS[a] || a);
  if (!acts.length) return `Escalated a change${at}, then decided against acting`;
  const last = acts.pop();
  return `Acted${at}: ${esc(acts.length ? `${acts.join(", ")} and ${last}` : last)}`;
}

function entryHtml(e) {
  const acted = (e.actions || []).length > 0;
  const escalated = Boolean(e.tier1?.significant);

  // Three states, three tags, same vocabulary the corner page uses for its
  // evidence lanes. A decline is not a failure and is not styled like one.
  const tag = acted
    ? `<span class="tag act">Acted</span>`
    : escalated
      ? `<span class="tag decl">Declined</span>`
      : `<span class="tag">No action</span>`;

  // A rule that fired before any model was consulted says so, because crediting
  // a model for a deterministic floor would overstate what the agent decided.
  const tier1 = e.tier1?.byRule
    ? `<b>Rule</b> ${esc(e.tier1.reason)}`
    : `<b>Triage</b> ${esc(e.tier1?.reason || "no reason recorded")}${
        typeof e.tier1?.confidence === "number"
          ? ` <i class="conf">confidence ${e.tier1.confidence.toFixed(2)}</i>`
          : ""
      }`;

  const tier2 = e.tier2
    ? `<p class="reason"><b>Deliberation</b> ${esc(e.tier2.reasoning)}</p>`
    : "";

  const intents = (e.intents || []).length
    ? `<p class="intent">Would have ${esc(e.intents.join("; "))}, but its budget was spent. Journaled instead.</p>`
    : "";

  const degraded = e.degraded
    ? `<p class="intent">Ran degraded: ${esc(e.degraded)}</p>`
    : "";

  const link = e.slug
    ? `<a class="jlink" href="/c/${esc(e.slug)}">See the corner</a>`
    : "";

  return `<article class="jentry${acted ? " on" : ""}">
  <div class="jhead">
    <span class="jtime">${esc(dayOf(e.ts))} <b>${esc(timeOf(e.ts))}</b></span>
    ${tag}
    <span class="jtrig">${esc(e.trigger || "unknown")}</span>
  </div>
  <h3 class="jttl">${headline(e)}</h3>
  ${e.delta ? `<p class="jdelta">${esc(e.delta)}</p>` : ""}
  <details class="jwhy">
    <summary>Why</summary>
    <p class="reason">${tier1}</p>
    ${tier2}
    ${intents}
    ${degraded}
    ${link}
  </details>
</article>`;
}

// Precision per calendar week, oldest to newest. Rendered only when there are
// at least two weeks to compare, because a trend drawn from one point is a
// decoration pretending to be evidence.
function weeklyPrecision(entries) {
  const weeks = new Map();
  for (const e of entries) {
    const d = isoDay(e.ts);
    if (!d) continue;
    const wk = new Date(`${d}T00:00:00Z`);
    wk.setUTCDate(wk.getUTCDate() - wk.getUTCDay());
    const key = wk.toISOString().slice(0, 10);
    if (!weeks.has(key)) weeks.set(key, { escalated: 0, acted: 0 });
    const w = weeks.get(key);
    if (e.tier1?.significant) w.escalated++;
    if ((e.actions || []).length) w.acted++;
  }
  return [...weeks.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, w]) => ({
      week,
      pct: w.escalated ? Math.round((100 * w.acted) / w.escalated) : null,
    }))
    .filter((w) => w.pct !== null);
}

export const WATCHDOG = (journal = [], rejects = 0, origin = "") => {
  const entries = Array.isArray(journal) ? journal : [];
  const s = journalStats(entries);
  const trend = weeklyPrecision(entries);
  const ran = entries.length > 0;

  const days = new Set(entries.map((e) => isoDay(e.ts)).filter(Boolean)).size;

  const title = "The Corner Watchdog";
  const desc = ran
    ? `An autonomous agent watching San Francisco street data. ${s.evaluated} changes evaluated, ${s.acted} acted on.`
    : "An autonomous agent watching San Francisco street data. Its decision journal, published in full.";

  const headlineStat = ran
    ? `<div class="bignum">${s.restraintPct}<i>%</i></div>
       <p class="bigsub">of the changes it evaluated ended in <b>no action at all</b>.
       ${s.evaluated} evaluated, ${s.acted} acted on, ${s.declined} escalated and then declined.</p>`
    : `<div class="bignum quiet">Not yet</div>
       <p class="bigsub">The agent has not run. This page will fill itself in when it does,
       and it will show the declines as prominently as the actions.</p>`;

  const trendHtml =
    trend.length >= 2
      ? `<div class="trend">
    <div class="tbars">${trend
      .map(
        (w) =>
          `<span class="tb" title="Week of ${esc(w.week)}: ${w.pct}%"><i style="height:${Math.max(4, w.pct)}%"></i></span>`,
      )
      .join("")}</div>
    <p class="tfoot">Triage precision by week, oldest left. Of the changes the reflex tier escalated,
    the share the judgment tier agreed were worth acting on. Currently ${s.precisionPct}%.</p>
  </div>`
      : `<p class="tfoot quiet">Triage precision needs two weeks of journal before a trend means anything.
    ${s.escalated ? `So far, ${s.acted} of ${s.escalated} escalations led to an action.` : "Nothing has been escalated yet."}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Corner Watchdog</title>
<link rel="icon" href="/logo.svg">
<link rel="canonical" href="${origin}/watchdog">
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="StreetCred">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${origin}/watchdog">
${FONT_LINK}
<style>
${BASE_CSS}
.bigwrap{background:var(--panel);border:1.5px solid var(--line3);border-top:3px solid var(--accent);
  border-radius:12px;padding:24px 26px;margin:0 0 20px;box-shadow:0 1px 3px rgba(20,27,45,.06)}
/* A panel that is waiting for data has no business wearing the accent edge the
   headline number wears. Same container, quieter claim. */
.bigwrap.soft{border-top:1.5px solid var(--line3);padding:18px 26px}
.bignum{font-size:64px;font-weight:700;letter-spacing:-.03em;line-height:1;color:var(--accent)}
.bignum i{font-size:30px;font-style:normal;margin-left:2px}
.bignum.quiet{color:var(--dim);font-size:40px}
.bigsub{font-size:14px;color:var(--dim);margin:12px 0 0;line-height:1.6;max-width:620px}
.bigsub b{color:var(--ink)}
.trend{margin:0}
.tbars{display:flex;align-items:flex-end;gap:4px;height:44px}
.tb{flex:1;display:flex;align-items:flex-end;height:100%}
.tb i{display:block;width:100%;background:var(--blue);border-radius:2px 2px 0 0;opacity:.7}
.tfoot{font-size:11.5px;color:var(--dim);margin:10px 0 0;line-height:1.55}
.tfoot.quiet{margin:0}
.jentry{background:var(--panel);border:1.5px solid var(--line3);border-radius:12px;
  padding:16px 18px;margin:0 0 12px;box-shadow:0 1px 3px rgba(20,27,45,.06)}
/* Only the entries that changed something get the accent edge. Declines are
   first-class but they are not events. */
.jentry.on{border-left:3px solid var(--accent)}
.jhead{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:7px}
.jtime{font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums}
.jtime b{color:var(--ink);font-weight:600}
.tag.act{background:rgba(240,126,38,.12);color:var(--accent)}
.tag.decl{background:rgba(120,140,93,.14);color:var(--green)}
.jtrig{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);
  margin-left:auto}
.jttl{font-size:14.5px;font-weight:600;margin:0;line-height:1.4}
.jdelta{font-size:13px;color:var(--dim);margin:6px 0 0;line-height:1.55}
.jwhy{margin-top:9px}
.jwhy summary{font-size:11.5px;font-weight:600;color:var(--dim);cursor:pointer;
  list-style:none;display:inline-block;border-bottom:1px dashed var(--line2);padding-bottom:1px}
.jwhy summary::-webkit-details-marker{display:none}
.jwhy summary:hover{color:var(--ink)}
.jwhy[open] summary{margin-bottom:9px}
.reason{font-size:12.5px;color:var(--ink);margin:0 0 7px;line-height:1.6}
.reason b{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--dim);margin-right:6px}
.conf{font-style:normal;color:var(--dim);font-size:11.5px}
.intent{font-size:12.5px;color:var(--dim);margin:0 0 7px;line-height:1.6;
  border-left:2px solid var(--line2);padding-left:9px}
.jlink{font-size:12px;font-weight:600;color:var(--accent);text-decoration:none;
  border-bottom:1px solid rgba(240,126,38,.4)}
.explain{font-size:13.5px;color:var(--dim);line-height:1.65;max-width:660px;margin:0 0 26px}
.explain a{color:var(--ink);font-weight:600}
.meta{font-size:11.5px;color:var(--dim);margin:22px 0 0;line-height:1.6;
  padding-top:16px;border-top:1px solid var(--line)}
</style>
</head>
<body>
<div class="wrap">
<header>
  ${LOGO}
  <div class="mark">Street<span>Cred</span></div>
  <div class="switcher">
    <a href="/">The city</a>
    <a href="/watchdog" class="on">The watchdog</a>
  </div>
</header>

<h1 style="font-size:30px;letter-spacing:-.02em;margin:0 0 12px">The Corner Watchdog</h1>
<p class="explain">
  An autonomous agent that reads San Francisco's street data every morning, compares it to what it
  saw yesterday, and decides on its own whether anything changed enough to be worth acting on.
  Cheap triage looks at every change; expensive deliberation runs only on the ones triage escalates.
  Most mornings it decides to do nothing, and this page shows those mornings too, with the reasoning
  behind them. Nothing here is a summary written after the fact. It is the journal the agent wrote
  while deciding. <a href="${REPO}">Read the source</a>.
</p>

<div class="bigwrap${ran ? "" : " soft"}">
  ${headlineStat}
</div>

<div class="bigwrap${trend.length >= 2 ? "" : " soft"}">
  ${trendHtml}
</div>

${
  ran
    ? `<h2 style="font-size:15px;margin:26px 0 14px">What it decided, newest first</h2>
${entries.map(entryHtml).join("\n")}`
    : ""
}

<p class="meta">
  ${
    ran
      ? `${s.evaluated} entries across ${days} day${days === 1 ? "" : "s"}.
         ${s.byRule} decided by rule before any model was consulted.
         ${s.intents} action${s.intents === 1 ? "" : "s"} converted to a journaled intent by a spent budget.`
      : "No journal entries yet."
  }
  ${rejects ? `${rejects} unauthenticated write${rejects === 1 ? "" : "s"} rejected.` : ""}
  Counted from the journal, which is public at <a href="/api/agent/journal">/api/agent/journal</a>.
  Threshold calibration from logged outcomes is not model retraining, and this page never calls it that.
</p>

</div>
</body>
</html>`;
};
