// /watchlist. What the city's own coverage is talking about, verified.
//
// The page exists to show the verification, not just the result. A discovery
// pipeline that publishes only its hits is indistinguishable from a search box
// that got lucky, so the rejects are here with their reasons, and the count of
// phrases that named no street at all is here too.

import { FONT_LINK, BASE_CSS, META, MASTHEAD, FOOTER } from "./page.js";
import { pacificDay } from "./data.js";
import { runCounts } from "./press.js";

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

// The build stamp is this site's own clock, so it renders in this site's city.
const when = (iso) => pacificDay(iso);

export const WATCHLIST_PAGE = (w, origin = "", hub = null, preview = false, scored = 0, press = null) => {
  const entries = w?.entries || [];
  const rejects = w?.rejects || [];
  // Attempted, completed, failed. This page's whole thesis is that a discovery
  // pipeline showing only its hits is indistinguishable from a search box that
  // got lucky, and it was printing its own attempt as if it were work done.
  const run = runCounts(w);
  const title = "Press watchlist \u00b7 StreetCred";
  const desc = entries.length
    ? `${entries.length} San Francisco corners named in current news coverage, each one verified against the graded city index before it appears here, with every rejected candidate published and its reason given.`
    : "Corners named in current San Francisco news coverage, each verified against the graded city index before it appears, with every rejected candidate published and its reason given.";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/logo.svg">
${META({ title, description: desc, url: `${origin}/watchlist` })}
${FONT_LINK}
<style>
${BASE_CSS}
.wl{border-top:1px solid var(--line2);margin:0 0 30px}
.wlrow{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:start;
  padding:16px 4px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
.wlrow:hover{background:var(--card)}
.wlg{font-size:13px;font-weight:700;min-width:28px;height:28px;border-radius:8px;display:grid;
  place-items:center;color:#fff;background:var(--dim)}
.wln{display:block;font-size:15px;font-weight:600;line-height:1.35}
.wla{display:block;font-size:12px;color:var(--dim);margin-top:3px;line-height:1.5}
.wlq{display:block;font-size:11px;color:var(--dim);margin-top:4px;font-style:italic}
.wlidx{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums}
.rj{border-top:1px solid var(--line2);margin:0 0 26px}
.rjrow{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:11px 4px;
  border-bottom:1px solid var(--line);font-size:12.5px;line-height:1.5}
.rjn{font-weight:600}
.rjr{color:var(--dim)}
.wlnote{font-size:13px;color:var(--dim);line-height:1.6;margin:0 0 24px}
.wlstat{display:flex;gap:22px;flex-wrap:wrap;margin:0 0 26px;font-size:12.5px;color:var(--dim)}
.wlstat b{display:block;font-size:24px;font-weight:700;color:var(--ink);line-height:1.2}
.hub{display:grid;gap:10px;margin:0 0 28px}
.hubrow{display:block;padding:14px 16px;border:1px solid var(--line);border-radius:10px;
  background:var(--panel);text-decoration:none;color:inherit}
.hubrow:hover{border-color:var(--ink)}
.hubn{display:block;font-size:14px;font-weight:600;margin-bottom:4px}
.hubd{display:block;font-size:12.5px;color:var(--dim);line-height:1.55}
@media(max-width:600px){.rjrow{grid-template-columns:1fr;gap:2px}}
</style>
</head>
<body>
<div class="wrap">
${MASTHEAD({ scored, active: "watchlist" })}
<header>
  <div class="corner"><b>The Press Watchlist</b><span class="csub">${w?.builtAt ? `Built ${when(w.builtAt)}` : "Not built yet"}</span></div>
</header>
<main>

<p class="lede">Which San Francisco corners the city's own coverage is talking about right now. Every lane on this site starts from a corner and asks what is written about it. This one runs the other way: it starts from the coverage and asks which corners are in it.</p>

<p class="wlnote">Candidates are pulled from citywide semantic searches, then each one has to clear three bars before it appears here: both names have to be San Francisco streets, the pair has to be an exact match in the graded city index, and the article has to actually be about safety at that crossing rather than merely mention it. Everything that fails is below, with the reason. A corner appearing here has not been audited: it is a lead, and the grade beside it is the census grade its records already earned.</p>

${
  w?.source === "unavailable"
    ? `<p class="wlnote"><b>Not built.</b> ${esc(w.reason || "")}</p>`
    : `<div class="wlstat">
  <span><b>${(w?.articles ?? 0).toLocaleString("en-US")}</b>articles read</span>
  <span><b>${run.attempted}</b>searches attempted</span>
  <span><b>${run.completed}</b>completed</span>${run.failed ? `
  <span><b>${run.failed}</b>cut off</span>` : ""}
  <span><b>${entries.length}</b>verified</span>
  <span><b>${w?.rejected ?? 0}</b>rejected</span>
  <span><b>${w?.discarded ?? 0}</b>phrases discarded</span>
</div>`
}
${
  // The batch press lane, counted from what it actually wrote. Separate from
  // the watchlist above: that one finds corners in the news, this one takes
  // the worst corners and goes looking. A corner it checks keeps its tier.
  press?.checked
    ? `<p class="wlnote"><b>${press.checked.toLocaleString("en-US")} corners press-checked this month, ${
        press.withCoverage.toLocaleString("en-US")
      } with coverage found.</b> The other ${(press.checked - press.withCoverage).toLocaleString("en-US")} were
searched and nothing on topic came back, which is stored and shown as a result rather than as a gap.
Press-checked corners keep their tier: this lane adds a press section, not an audit.${
        press.deferred ? ` ${press.deferred} deferred at the budget cap.` : ""
      }</p>`
    : ""
}

<div class="eyebrow"><span>On the watchlist</span><span class="tag">worst first</span></div>
${
  entries.length
    ? `<div class="wl">
${entries
  .map(
    (e) => `  <a class="wlrow" href="/c/${esc(e.slug)}">
    <span class="wlg g${esc(e.grade)}">${esc(e.grade)}</span>
    <span><span class="wln">${esc(e.name)}${e.district ? `, District ${e.district}` : ""}</span>
      <span class="wla">${esc(e.article.title)}<br>${esc(e.article.domain)}${e.article.date ? ` &middot; ${esc(e.article.date)}` : ""}</span>
      <span class="wlq">found by: ${esc(e.query)}</span></span>
    <span class="wlidx">${e.index}</span>
  </a>`,
  )
  .join("\n")}
</div>`
    : `<p class="wlnote">Nothing on the watchlist right now. ${run.completed} of ${run.attempted} searches ran and no crossing named in the results survived verification, which is the honest state most weeks: San Francisco coverage is overwhelmingly corridor level and citywide, and this page only shows corners the city index can confirm.</p>`
}

<div class="eyebrow"><span>Never ran</span><span class="tag">and why</span></div>
${
  run.failed
    ? `<p class="wlnote">These ${run.failed} searches were issued and cut off before they reached Exa. They are listed for the same reason the rejects below are: a discovery pipeline that publishes only what it found, and quietly drops what it never looked for, is making a claim about the city it has not earned. Note what is in this list. The neighbourhood-anchored queries sit at the tail of the set, so they are the ones that never run, and the watchlist has a geographic blind spot that is systematic rather than random.</p>
<div class="rj">
${run.failures
  .map(
    (q) => `  <div class="rjrow"><span class="rjn">${esc(q.query)}${q.local ? ' <span class="tag">SF outlets only</span>' : ""}</span><span class="rjr">${esc(q.failed || "cut off before it ran")}</span></div>`,
  )
  .join("\n")}
</div>`
    : `<p class="wlnote">Every search in the last pass reached Exa. Nothing was cut off.</p>`
}

<div class="eyebrow"><span>Rejected</span><span class="tag">and why</span></div>
${
  rejects.length
    ? `<div class="rj">
${rejects
  .map(
    (r) => `  <div class="rjrow"><span class="rjn">${esc(r.name || r.candidate)}</span><span class="rjr">${esc(r.reason)}</span></div>`,
  )
  .join("\n")}
</div>
<p class="wlnote">A further <b>${w?.discarded ?? 0}</b> phrases were discarded before reaching this list because neither half named a San Francisco street. Page text is full of capitalized pairs joined by "and" (navigation menus, section headings), and every one of them looks like an intersection to a pattern match. They are counted rather than listed, because a page of them teaches a reader nothing.</p>`
    : `<p class="wlnote">Nothing was rejected in the last pass.</p>`
}

<div class="eyebrow"><span>How it runs</span></div>
<p class="wlnote">${run.attempted} citywide semantic searches are attempted over the last ${w?.windowDays ?? 90} days, run through Exa with the news category, a published-date window, and lead-generation domains excluded at the API rather than filtered afterwards. Each result's text is scanned for crossing names, and every name is checked against the same index the site grades from. It runs again every morning with the daily audit.</p>
${
  run.failed
    ? `<p class="wlnote"><b>${run.completed} of the ${run.attempted} completed.</b> This lane runs inside the daily audit's single Worker invocation, near the end of it, and Cloudflare allows fifty subrequests per invocation. The audit has spent most of them by the time the watchlist starts, so the remaining ${run.failed} are cut off before they reach Exa. They cost nothing, and they also found nothing, so the pass costs ${run.completed} searches rather than ${run.attempted}. Every one of them is listed below. The fix is a change to how the lane is scheduled and is recorded in <code>docs/WATCHLIST_SUBREQUEST_FINDING.md</code>, not made quietly here.</p>`
    : `<p class="wlnote">All ${run.attempted} completed, so the pass costs ${run.attempted} searches.</p>`
}
<p class="wlnote">This is an entity-discovery workflow of the shape Exa's Websets product is built for: find candidate entities, verify each against hard criteria, keep the ones that survive. It is implemented directly on the search API, which is what the event credits cover.</p>

<div class="eyebrow"><span>The rest of the press lane</span></div>
<p class="wlnote">Three more things this site does with Exa. Each one is reachable from here rather than only by landing on the right corner.</p>
<div class="hub">
  <a class="hubrow" href="/c/${esc(hub?.timeline?.slug || "16th-mission")}">
    <span class="hubn">Coverage timelines</span>
    <span class="hubd">The same press query, run once per year since 2014, so a corner can show how long it has been written about rather than only what was written this month.${
      hub?.timeline ? ` Example: ${esc(hub.timeline.name)}, ${hub.timeline.headlines} headlines found since ${hub.timeline.from}.` : ""
    }</span>
  </a>
  <a class="hubrow" href="/c/${esc(hub?.connection?.slug || "16th-mission")}">
    <span class="hubn">Press connections</span>
    <span class="hubd">findSimilar on a corner's own best story, every crossing named in the related coverage verified against the city index, and the surviving link written to both corners.${
      hub?.connection ? ` Example: ${esc(hub.connection.name)} links to ${esc(hub.connection.to)}.` : ""
    }</span>
  </a>
  <a class="hubrow" href="/c/${esc(hub?.sawItFirst?.slug || "16th-mission")}">
    <span class="hubn">Press got there first</span>
    <span class="hubd">Corners where the earliest coverage anyone can find predates the earliest collision in the city's own record. A narrow claim on purpose: search recall is not ground truth, so this says what can be found rather than what happened.${
      hub?.sawItFirst
        ? ` ${hub.sawItFirstCount} corner${hub.sawItFirstCount === 1 ? "" : "s"} carry it. Example: ${esc(hub.sawItFirst.name)}, coverage from ${hub.sawItFirst.coverage} against a first recorded collision in ${hub.sawItFirst.crash}.`
        : hub?.compared
        ? ` The comparison has been run at ${hub.compared} corners and <b>none of them carry it</b>: at every one, the city's collision record already starts in 2005, the first year the dataset covers. So the chip these corners show reads the other way, naming the year the record begins. A feature that reports the answer it found rather than the answer it was hoping for is worth more than one that never runs.`
        : ""
    }</span>
  </a>
</div>

</main>
${FOOTER()}
${preview ? '<div class="pvw">Preview</div>' : ''}
</div>
</body>
</html>`;
};
