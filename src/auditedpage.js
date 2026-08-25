// /audited. Every corner carrying generated imagery, with what was actually
// checked on it.
//
// The audited corners are the product and they had no home: they were reachable
// only through map discs, saved-corner chips and whatever the homepage happened
// to feature that morning. This is the log.
//
// Two sections, and the split is the point. A fully audited corner had every
// evidence lane run on it. A promoted corner was pulled out of the enriched
// pool, given a proposed-fix render, and nothing else, so its remaining lanes
// sit at their enriched state. Those are different claims and the page makes
// them separately rather than presenting a longer list of equals.
//
// Every state on this page is read from a stored record. No lane shows a state
// its record does not hold, which is why each strip cell has an empty form as
// well as a present one: "no press found" is a result and it renders as one.

import { FONT_LINK, BASE_CSS, META, MASTHEAD, FOOTER } from "./page.js";
import { PROMOTED_FROM_ENRICHED } from "./imagery.js";

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const n = (x) => Number(x || 0).toLocaleString("en-US");

// One cell of the lane strip. `on` is what the record says happened, `off` is
// what it says did not, and there is no third form: a lane with no record at
// all is off, because an absent record is not evidence of a lane that ran.
const cell = (ok, onLabel, offLabel) =>
  `<span class="lcell ${ok ? "on" : "off"}">${esc(ok ? onLabel : offLabel)}</span>`;

// A lane with three honest states. "found" and "none" are both results: a
// search ran. "unchecked" is not a result, it is the absence of one, and it
// must not borrow the wording of the empty result. Most audited corners have no
// stored press record at all, and calling that "no press found" would claim an
// outcome for a search nobody ran.
const LANE = {
  found: ["on", "found"],
  none: ["off", "none found"],
  unchecked: ["none", "not checked"],
};
const lane = (state, noun) => {
  const [cls, word] = LANE[state] || LANE.unchecked;
  return `<span class="lcell ${cls}">${esc(noun)} ${esc(word)}</span>`;
};

function row(r) {
  return `<li class="arow">
  <a class="athumb" href="/c/${esc(r.slug)}" aria-hidden="true" tabindex="-1"><img src="/gen/${esc(r.slug)}/today.jpg" alt="" width="112" height="70" loading="lazy"></a>
  <div class="amain">
    <div class="ahead">
      <a class="aname" href="/c/${esc(r.slug)}">${esc(r.name)}</a>
      ${r.grade ? `<span class="agrade g${esc(r.grade)}">${esc(r.grade)}</span>` : ""}
      ${Number.isFinite(r.index) ? `<span class="aindex" title="Danger Index">${n(r.index)}</span>` : ""}
    </div>
    <div class="lstrip">
      ${cell(r.letter, "Letter served", "Letter pending")}
      ${cell(r.fix, "Fix render", "Render held")}
      ${lane(r.press, "Press")}
      ${lane(r.voices, "Voices")}
    </div>
  </div>
  ${
    r.date
      ? `<time class="adate" datetime="${esc(r.date)}"><span class="adk">${r.dateKind === "audited" ? "audited" : "imagery"}</span>${esc(r.date)}</time>`
      : `<span class="adate none">date not recorded</span>`
  }
</li>`;
}

export const AUDITED_PAGE = (data, origin = "", preview = false, scored = 0) => {
  const full = data?.full || [];
  const promoted = data?.promoted || [];
  const title = "The audited corners · StreetCred";
  const description =
    `${full.length} San Francisco intersections with every evidence lane checked, and ` +
    `${promoted.length} promoted from the enriched pool with a proposed-fix render. ` +
    `Each row shows what its own records hold.`;

  const section = (heading, intro, rows, empty) => `
<section class="asec" aria-labelledby="${heading.id}">
  <div class="eyebrow"><span id="${heading.id}">${esc(heading.label)}</span><b class="acount">${n(rows.length)}</b></div>
  <p class="anote">${intro}</p>
  ${rows.length ? `<ul class="alist">${rows.map(row).join("")}</ul>` : `<p class="anote empty">${esc(empty)}</p>`}
</section>`;

  return `<!doctype html>
<html lang="en">
<head>
${META({ title, description, url: `${origin}/audited` })}
${FONT_LINK}
<style>
${BASE_CSS}
.asec{margin:0 0 34px}
.acount{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--ink)}
.anote{margin:0 0 16px;font-size:13.5px;color:var(--dim);line-height:1.6;max-width:74ch}
.anote.empty{font-style:italic}
.alist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.arow{display:flex;align-items:center;gap:14px;padding:12px 14px;background:var(--panel);
  border:1px solid var(--line3);border-radius:12px}
.athumb{flex:0 0 112px;line-height:0;border-radius:8px;overflow:hidden;background:var(--card)}
.athumb img{width:112px;height:70px;object-fit:cover;display:block}
.amain{flex:1;min-width:0}
.ahead{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.aname{font-size:15px;font-weight:600;color:var(--ink);text-decoration:none}
.aname:hover{text-decoration:underline}
.agrade{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:6px;
  color:#fff;font-weight:700;font-size:11px;padding:0 5px}
.aindex{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.lstrip{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
.lcell{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--line2);white-space:nowrap}
.lcell.on{color:var(--ink);background:var(--card)}
.lcell.off{color:var(--dim);background:none;border-style:dashed}
/* Not a result. Dimmer than the empty result and visibly a different kind of
   statement, because "none found" and "not checked" are different facts. */
.lcell.none{color:var(--dimline);background:none;border-style:dotted}
.adk{display:block;font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--dimline)}
.adate{flex:0 0 auto;font-size:12px;text-align:right;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}
.adate.none{font-style:italic}
/* The operator reads this on a phone. Below 620px the thumbnail keeps its place
   but the date moves under the name rather than squeezing the strip into two
   characters a line. */
@media(max-width:620px){
  .arow{flex-wrap:wrap;gap:10px}
  .athumb{flex:0 0 84px}
  .athumb img{width:84px;height:56px}
  .amain{flex:1 1 auto;min-width:0}
  .adate{flex:1 0 100%;order:3;margin-left:98px}
  .lcell{font-size:10.5px;padding:3px 8px}
}
</style>
</head>
<body>
<div class="wrap">
${MASTHEAD({ scored, active: "audited" })}
<header>
  <div class="mark">Street<span>Cred</span></div>
</header>
<h1>The audited corners</h1>
<p class="anote">Every corner on this site that carries generated imagery, and what its own
records hold about it. One corner is audited every morning by a scheduled run, newest first,
so this page reads as a log rather than a leaderboard.${preview ? " Preview build." : ""}</p>

${section(
  { id: "fullhead", label: "Fully audited" },
  "Every evidence lane was run on these corners: the city's collision and 311 records, a " +
    "visual hazard audit of the Street View frame, a press pass, a resident-voices scrape, and " +
    "a letter checked against all of it. A lane that found nothing says so below rather than " +
    "being left off.",
  full,
  "No corner has been fully audited yet.",
)}

${section(
  { id: "promhead", label: "Promoted from enriched" },
  "These corners were pulled out of the enriched pool and given a proposed-fix render. That " +
    "is the only lane that was run on them. Their remaining lanes sit wherever the enriched " +
    "pass left them, they have had no visual hazard audit, and they are not counted in the " +
    "audited coverage layer on the homepage. They are here because they carry a render, not " +
    "because they were audited.",
  promoted,
  "No corner has been promoted from the enriched pool yet.",
)}

<p class="anote">Grades and the Danger Index come from the city's own collision and 311 records.
The proposed-fix images are AI visualizations and are not photographs of anything that exists.</p>
${FOOTER()}
</div>
</body>
</html>`;
};
