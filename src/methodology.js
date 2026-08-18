// /methodology. Written to survive a reader who does this for a living.
//
// Everything on this page is prose about decisions already made in code, with
// the code named, so a claim here can be checked against the file that
// enforces it. Nothing on this page is aspirational: if the product does not
// do a thing, this page says it does not do it.

import { LOGO, FONT_LINK, BASE_CSS } from "./page.js";
import { DISTRIBUTION, DISTRIBUTION_DATE } from "./distribution.js";
import { SERVICE_NAMES } from "./data.js";

const n = DISTRIBUTION.length;
const med = DISTRIBUTION[Math.floor(0.5 * (n - 1))];
const p90 = DISTRIBUTION[Math.floor(0.9 * (n - 1))];
const max = DISTRIBUTION[n - 1];
const zeroes = DISTRIBUTION.filter((v) => v === 0).length;

export const METHODOLOGY = (origin = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Methodology, StreetCred</title>
<link rel="icon" href="/logo.svg">
<link rel="canonical" href="${origin}/methodology">
<meta name="description" content="Every data source, window, radius, filter, formula and known limitation behind StreetCred's grades, stated plainly.">
${FONT_LINK}
<style>
${BASE_CSS}
.doc{max-width:720px}
.doc h1{font-size:28px;letter-spacing:-.02em;margin:0 0 6px}
.doc .sub{font-size:13.5px;color:var(--dim);margin:0 0 34px}
.doc h2{font-size:17px;margin:34px 0 10px}
.doc p, .doc li{font-size:14px;line-height:1.7;color:var(--ink)}
.doc p{margin:0 0 14px}
.doc ul{padding-left:22px;margin:0 0 14px}
.doc code{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:12.5px}
.doc pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;
  font-size:12.5px;line-height:1.6;overflow-x:auto}
.doc .dim{color:var(--dim)}
.doc a{color:var(--ink);font-weight:600;text-decoration:none;border-bottom:1px solid var(--line2)}
.doc a:hover{border-color:var(--ink)}
</style>
</head>
<body>
<div class="wrap">
<header>
  ${LOGO}
  <div class="mark">Street<span>Cred</span></div>
  <div class="switcher">
    <a href="/">The city</a>
    <a href="/watchdog">The watchdog</a>
    <a href="/methodology" class="on">Methodology</a>
  </div>
</header>
<main>

<div class="doc">
<h1>Methodology</h1>
<p class="sub">Every source, window, radius, filter, formula and known limitation, stated plainly.
Where this page names a file, the file is the authority and this page is the explanation.</p>

<h2>Sources</h2>
<ul>
  <li><b>Traffic Crashes Resulting in Injury</b>, DataSF dataset <code>ubvf-ztfx</code>. Police-reported
  injury collisions, updated by the city on a rolling basis. StreetCred reads it live; nothing is copied
  into our store except computed counts.</li>
  <li><b>311 Cases</b>, DataSF dataset <code>vw6y-z8j6</code>. Resident service requests, updated continuously.</li>
  <li><b>Street Intersections</b>, DataSF dataset <code>gmfx-8h6i</code>. One row per street leg; a real
  crossing is a <code>cnn</code> carrying at least two distinct street names. 18,546 legs collapse to
  8,254 crossings, which is the census the grades are measured against.</li>
  <li><b>Street View imagery</b> from Google, one photograph per corner, taken as the record of what the
  corner looks like, never as evidence of harm.</li>
  <li><b>Press coverage</b> found by Exa search, filtered as described below. <b>Resident accounts</b>
  scraped ahead of time by Apify actors from public reviews and forums.</li>
</ul>

<h2>Two radii, on purpose</h2>
<p>The displayed statistics count within <b>150 meters</b> of the corner: the tiles, the letter's cited
counts, the press context. The <b>Danger Index grade counts within 80 meters</b>, because a grade is a
claim about one intersection, not about a block in every direction. Both surfaces say which radius they
use, and the letter states both in the sentence that first cites a count. The two figures are measured
over different areas and are not expected to reconcile; the silence about that difference was a bug this
page is part of fixing, not the difference itself.</p>

<h2>The 311 filter</h2>
<p>Only these service categories count, verbatim, as an explicit allow list shared by every lane
(<code>src/data.js</code>):</p>
<pre>${SERVICE_NAMES.join("\n")}</pre>
<p>The first version matched any category containing the word "Street", which swept in Street and
Sidewalk Cleaning, a sanitation queue with millions of rows, and inflated one corner's count from 354
to 8,546. An allow list is uglier and correct; a substring match was elegant and wrong by a factor of
24.</p>

<h2>The formula</h2>
<pre>collisionPoints   = 10*fatal + 6*severe + 3*otherVisible + 1*pain + 2*pedInvolved
maintenanceSignal = min(0.05 * safety311, 8)
points            = collisionPoints + maintenanceSignal</pre>
<p>Collisions over five years, filtered 311 over twelve months, within 80 meters. The maintenance signal
is capped at 8 points, less than one fatality, because a 311 report is paperwork and must never outweigh
a person. An earlier uncapped version let 88 street-condition reports outvote a death; the cap is the
correction, kept visibly small.</p>

<h2>The census calibration, and its finality</h2>
<p>A corner's index is a percentile: its position among <b>all ${n.toLocaleString()} real crossings</b>
in the city, each scored with the formula above by <code>tools/sweep.mjs</code> on ${DISTRIBUTION_DATE}
and frozen in <code>src/distribution.js</code>. The local counter behind the sweep was verified to match
the production queries exactly, corner by corner and field by field, before the array was written.
Shape of the city: ${zeroes} crossings with no recorded harm at all, median ${med} points, 90th
percentile ${p90}, maximum ${max} (6th and Mission).</p>
<p>Grades: A below the 40th percentile, B to the 64th, C to the 79th, D to the 92nd, F at 93 and above.
An F literally means more reported harm than 93 percent of San Francisco intersections. The index is
capped at 99 because no corner is worse than itself.</p>
<p><b>This calibration is declared final.</b> It replaced a 600-sample estimate that agreed with it to
within a point or two (both medians ${med}). The array does not float with new data, because a grade
that drifts with nothing changed on the ground is a grade nobody can cite, and people paste these into
public comment. If a recalibration ever becomes genuinely unavoidable, it ships with a version bump, an
entry on every affected corner's grade history, and a plain explanation here.</p>

<h2>The exposure caveat, in full</h2>
<p>The index ranks <b>reported harm, not risk per crossing</b>. A corner ten thousand people cross daily
and a corner a hundred people cross daily are ranked on their raw counts. There is no reliable public
pedestrian-volume dataset at intersection resolution for the whole city; rather than normalize against a
guess, the index does not normalize at all and says so beside every score. Busy corners therefore rank
high partly because they are busy. That is a real limitation, not a footnote.</p>

<h2>What the visual audit is, and is not</h2>
<p>A structured pass asks Gemini which of four fixed conditions it can actually see in the corner's
Street View frame: faded crosswalk markings, turning conflict, lighting, curb or sidewalk issues. It
returns booleans, not prose, and it can and does come back with nothing flagged. Everything after that
is arithmetic over city records (<code>src/hazards.js</code>):</p>
<ul>
  <li><b>CONFIRMED</b>: the model saw it and city records corroborate it. May be stated as documented.</li>
  <li><b>CANDIDATE</b>: the model saw it, records do not yet show it. An observation, never a fact.</li>
  <li><b>REPORTED</b>: records show it, the model did not see it. Belongs to the record, not the photograph.</li>
</ul>
<p>The audit is advisory context. It never moves the grade.</p>

<h2>The letter verification guarantee</h2>
<p>Every letter is checked by <code>src/verify.js</code> before it is shown: every number against the
corner's own records, the addressee against the Supervisor table, every street named against the
intersection and its cited coverage, every cited domain against the sources actually fetched. A draft
that fails is rewritten once with the failing claim named; a draft that fails twice is not shown at all,
and the last verified letter serves instead, marked stale. The same verifier runs on letters submitted
by the autonomous watchdog, whose own claim about its work is recorded and then ignored in favour of
the arithmetic.</p>

<h2>Known limitations, honestly</h2>
<ul>
  <li><b>Resident voices are sparse.</b> Most corners have no scraped accounts, and the panel says so
  rather than borrowing quotes from elsewhere. Where accounts exist, most are about the neighborhood,
  not the street; the funnel counts are shown.</li>
  <li><b>Press coverage is often corridor-level.</b> A story about Mission Street is not a story about
  one crossing. The press panel labels corridor coverage as such, and corner-level filtering errs toward
  showing less.</li>
  <li><b>Police-reported collisions undercount.</b> Crashes that produce no report do not exist in
  <code>ubvf-ztfx</code>, and reporting rates differ by neighborhood and by who was involved.</li>
  <li><b>The 80m circle double-counts dense blocks.</b> Adjacent crossings can share the same crashes;
  6th Street's alley crossings each carry much of 6th Street's harm. That is inherent to counting by
  circle and it matches how the production queries count.</li>
  <li><b>Accessibility floor, not ceiling.</b> The pages pass an automated audit with zero critical
  violations and support keyboard operation including the image slider; screen-reader flow beyond that
  has had less testing than sighted flow, and reports are welcome.</li>
</ul>

<h2>Corrections</h2>
<p>Found a number this page cannot defend? Open an issue at
<a href="https://github.com/alejandro-publius/streetcred">github.com/alejandro-publius/streetcred</a>
with the corner and the receipt link beside the figure. Corrections ship with a grade-history entry when
they move anything, and the <a href="/changes">public changelog</a> keeps the record either way.</p>

<p class="dim" style="margin-top:30px">Grade changes: <a href="/changes">/changes</a> &middot;
Service health: <a href="/status">/status</a> &middot;
The agent's decisions: <a href="/watchdog">/watchdog</a></p>
</div>
</main>
</div>
</body>
</html>`;
