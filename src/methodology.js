// /methodology. Written to survive a reader who does this for a living.
//
// Everything on this page is prose about decisions already made in code, with
// the code named, so a claim here can be checked against the file that
// enforces it. Nothing on this page is aspirational: if the product does not
// do a thing, this page says it does not do it.

import { FONT_LINK, BASE_CSS, META, MASTHEAD, FOOTER } from "./page.js";
import { DISTRIBUTION, DISTRIBUTION_DATE } from "./distribution.js";
import { SERVICE_NAMES } from "./data.js";
import { WATCHLIST_QUERIES, runCounts } from "./press.js";

const n = DISTRIBUTION.length;
const med = DISTRIBUTION[Math.floor(0.5 * (n - 1))];
const p90 = DISTRIBUTION[Math.floor(0.9 * (n - 1))];
const max = DISTRIBUTION[n - 1];
const zeroes = DISTRIBUTION.filter((v) => v === 0).length;

export const METHODOLOGY = (origin = "", preview = false, scored = 0, watchlist = null) => {
// Attempted, completed and the shortfall, from WATCHLIST_QUERIES and the stored
// completion record. This page said "Seven citywide semantic searches" for as
// long as the list has been twenty-nine, because the sentence was typed once and
// the array grew past it. Nothing here is a literal now, so it cannot drift
// again: the split itself moves between runs, 8/21 one morning and 7/22 the
// next.
const wl = runCounts(watchlist);
const attempted = wl.attempted || WATCHLIST_QUERIES.length;
return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/logo.svg">
${META({
  title: "Methodology \u00b7 StreetCred",
  description: "Every data source, window, radius, filter, formula and known limitation behind StreetCred's grades, stated plainly enough to be checked.",
  url: `${origin}/methodology`,
})}
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
${MASTHEAD({ scored, active: "methodology" })}
<header>
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
  ${n.toLocaleString()} crossings, which is the census the grades are measured against.
  ${scored ? `${scored.toLocaleString()} of them have reported harm and carry a published grade` : "The graded subset is smaller than the census"};
  ${zeroes} recorded no harm at all, and the remainder are one crossing counted twice where the city
  splits it into quadrants, which <code>tools/sweep.mjs</code> collapses to the worst of them. That is
  why the masthead's count and this page's census are different numbers and both are right.</li>
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

<h2>How the whole city is graded</h2>
<p><b>Every intersection in San Francisco has a grade, and only some have an audit.</b> Those are
different claims and the site keeps them apart everywhere it makes them.</p>
<p><b>The sweep.</b> <code>tools/sweep.mjs</code> pulls the two datasets in bulk once, buckets every row
into a 100 meter grid, and counts within 80 meters of each of the ${n.toLocaleString()} crossings locally. That is
about a dozen paged requests instead of the roughly 25,000 API calls one query per corner would cost,
and the local counter was proved to reproduce production's own <code>within_circle</code> counts
exactly, corner by corner, before a single number was written down.
<code>tools/sweep_districts.mjs</code> then places each corner in a Supervisor district by the majority
of collision rows within 150 meters, using the same vote the live resolver uses.</p>
<p><b>The shards.</b> <code>tools/build_city_shards.mjs</code> packs the 7,353 corners with recorded
harm into 71 KV bundles keyed by the first character of the slug, largest bundle 175 KB. One KV record
per corner would be 7,353 writes to publish the city and 7,353 more to correct it; a corner page is
instead one read of one bundle. The builder refuses to run if the committed census artifact and the
frozen array in <code>src/distribution.js</code> have drifted apart, because a grade measured against a
different yardstick than the one the code uses is worse than no grade.</p>
<p><b>The three tiers.</b></p>
<ul>
  <li><b>AUDITED</b>: every evidence lane has been checked here. Records, press, resident accounts and
  the visual audit have all run, and the corner has its two generated imagery states.</li>
  <li><b>ENRICHED</b>: records and index checked and stored, no visual audit yet. These are the corners
  the daily cron works through next.</li>
  <li><b>SCORED</b>: graded against the citywide census, no lane checked beyond the official record.</li>
</ul>
<p><b>A SCORED grade uses the identical formula and census as an AUDITED grade; the difference is how
many evidence lanes have been checked, never the math.</b> A scored corner's Cred Check therefore lights
official records and marks the other three lanes not yet checked, rather than counting them as failures:
absence of a check is not a failed check.</p>
<p><b>The freshness rule.</b> A SCORED corner's numbers are as of the sweep date, which is printed under
its tiles, in its verdict sentence and on its source tag. ENRICHED and AUDITED corners show numbers
pulled live at the moment you load them. Any corner promoted by the morning cron or resolved on demand
switches to live numbers from that moment on. The provenance links under a swept number re-run the query
live against data.sfgov.org today, which is why the caption states the as-of date in advance: a reader
who clicks through and finds a slightly different count should already know why.</p>
<p>One more footprint note, because it is easy to trip over: a swept corner's tiles count within
<b>80 meters over twelve months of 311</b>, matching the grade's own footprint, where a live corner's
tiles count within 150 meters over three years. Each tile says which it is.</p>

<h2>Press checking at city scale, and what it costs</h2>
<p>Running the per-page press search on every corner in the city would spend the balance on duplicates:
every corner on Mission Street would run its own Mission Street search and get its own copy of the same
corridor coverage. The batch lane is built around what is already paid for, and only moves to the next
step when the previous one has nothing.</p>
<ol>
  <li><b>The stored citywide sweep first.</b> The watchlist has already read this month's coverage. A
  corner it already found articles for starts with candidates before a single call is planned.</li>
  <li><b>Then the segment cache.</b> One stored entry per street, good for seven days, shared by every
  corner on that street. A corner whose streets are both warm costs no corridor search at all.</li>
  <li><b>Then three dated windows on the crossing itself</b>, which is the only query that is genuinely
  corner specific: <b>2014 to 2019</b>, <b>2020 to 2023</b>, and <b>2024 to now</b>. A search per year
  cost eleven calls to answer a question that reads the same at three.</li>
</ol>
<p><b>Page text is bought last and only for what might be published.</b> A search that asks for text
pays for text on every result, including the ones the filter is about to discard, so these searches ask
for none. Candidates are shortlisted on title and url, the shortlist alone is fetched, and only then is
the corner-level bar applied to real text. The honest cost of that order: a story that names the corner
only in its body, with a title and url that name neither street, can be missed by the shortlist. The
lane errs toward showing less, which is the same direction every other filter here errs in.</p>
<p><b>Searched and empty is stored and shown as a result</b>, not hidden. A corner with no coverage
found says so, the same way the resident-voices funnel does.</p>
<p><b>A press-checked corner is not an audited corner.</b> It keeps its tier and gains a press section.
The imagery panel keeps its honest pending state, and the audited count on the homepage does not move
because a corner was press checked.</p>

<h2>The Press Watchlist, and how a corner gets on it</h2>
<p>Every other lane on this site starts from a corner and asks what is written about it. The watchlist
runs the other way: it starts from the city's coverage and asks which corners are in it. That is an
entity-discovery problem, and it is only worth anything if the entities are verified.</p>
<p>${attempted} citywide semantic searches are attempted each morning through Exa, with the news
category, a published date window, lead-generation domains excluded at the API, and three passes
restricted to San Francisco outlets that write at corner resolution.${
  wl.failed
    ? ` ${wl.completed} of them completed in the last pass; the other ${wl.failed} were cut off before
they reached Exa, and <a href="${origin}/watchlist">the watchlist</a> lists every one of them with its
reason rather than counting the attempt as work done.`
    : wl.completed
    ? ` All ${wl.completed} completed in the last pass. This lane has a cron trigger of its own so that
it gets an invocation's subrequest budget to itself; it used to run as the last lane of the daily audit
and inherited whatever that had left, which was about seven of fifty.`
    : ""
} Every crossing name in every result is pulled out by the same
extractor the related-corner lead and the connections pass use, and then each candidate has to clear
three bars before it can appear:</p>
<ul>
  <li><b>Both names are San Francisco streets.</b> Checked against the 2,219 street names in the graded
  city index. Page text is full of capitalized pairs joined by "and", and "Metro Areas and Our Cities"
  looks exactly like an intersection to a pattern match. Phrases that name no street are counted and
  discarded rather than listed, because a page of them teaches a reader nothing.</li>
  <li><b>The pair is an exact match in the intersections index.</b> One KV read against the same 7,353
  corner index the site grades from. A real pair of San Francisco streets that do not meet at a graded
  crossing is a reject worth reading, and it is published with that reason.</li>
  <li><b>The coverage is confirmed.</b> The article has to be about safety at that crossing, not merely
  mention it. A redesign announcement listing six intersections in passing does not put six corners on
  a safety watchlist.</li>
</ul>
<p><b>Rejects are logged and published</b> at <a href="/watchlist">/watchlist</a> with the reason each
one failed. A discovery pipeline that shows only its hits is indistinguishable from a search box that
got lucky.</p>
<p>This is an entity-discovery workflow of the shape Exa's Websets product is built for: find candidate
entities, verify each against hard criteria, keep the ones that survive. It is implemented directly on
Exa's search API, which is what the event credits cover.</p>
<p><b>Press connections</b> use the same extractor and the same index. For an audited corner with a
best article, <code>findSimilar</code> asks what else is being written in the same breath; every
crossing named in the related coverage is verified the same way, and a surviving link is written to
both corners so the claim reads the same from either page. Two extra bars apply here, because
connecting two corners is a stronger claim than naming one: the connecting article must be dated (a
site homepage is not an article) and must be recent, since a blog post from 2007 is not the same breath
as anything. Empty stays empty, and nothing fuzzy is shown: of 23 audited corners, four have a
connection.</p>

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

<h2 id="gate">The letter verification guarantee</h2>
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
${FOOTER()}
${preview ? '<div class="pvw">Preview</div>' : ''}
</div>
</body>
</html>`;
};
