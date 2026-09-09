# How Exa is used

*A judge-facing, byte-level proof of this lane — file:line citations and live-fetched numbers — is in [`docs/EXA_INTEGRATION.md`](EXA_INTEGRATION.md).*

Exa answers the question no government dataset can: has anyone actually written
about this corner. It runs three lanes here, and the third one is the one worth
your time.

Every figure below is read from a live constant or a stored record, and every
one is checkable at a URL. Where a number moves, the reading date is named.

**1. Press coverage, per corner, records first.** A corner page opens with the
city's own collision and 311 counts, and press sits underneath as
corroboration rather than as evidence. The search is `POST
https://api.exa.ai/search` with `type: "neural"`, `category: "news"`, and page
text pulled through the nested `contents.text` shape. Lead generation domains
are excluded at the API rather than filtered afterwards, because law firms
republish crash reports to farm clients and that is not coverage. Agency
primary sources are separated out and tagged: an SFMTA project page is the
record the reporting would be written about, so it can never satisfy the press
lane in the Cred Check. Every headline renders with its outlet domain and
publish date and links out, so any claim on the page can be checked in one
click.

Reading the stored rollup at 2026-08-20T17:16Z, this lane has press-checked
**606 corners this period, found coverage at 570, and recorded 36 as searched
and empty**, keeping **1,230 citations**. The 36 matter more than the 570: a
lane that reports nothing when it found nothing is worth more than a lane that
always fills.

**2. The 2014 onward timeline.** For a corner worth the calls, one date-sliced
search per year from `TIMELINE_FROM = 2014` to the current year, which is
thirteen slices in 2026, run in parallel because thirteen sequential searches
would cost most of a minute. That turns "this corner is dangerous" into a year by year
count of how often it has been written about since 2014, which is a different
and much harder claim to wave away.

**3. `findSimilar` connections.** For each audited corner with a best article,
`findSimilar` asks what else is being written in the same breath. Every
crossing named in the related coverage goes through the same extractor and the
same city index, and a surviving link is written to **both** corners, so the
claim reads identically from either page. Connecting two corners is a stronger
claim than naming one, so the connecting article must be dated and recent.
Checked corner by corner against `/api/connections` on 2026-08-20, five of the
23 audited corners carry a connection and eighteen carry none, which is the
honest answer rather than a padded one.

**4. The citywide watchlist: entity discovery, verified, and published with its
failures.** Every lane above starts from a corner and asks what is written
about it. This one runs the other way. **29 semantic sweeps** over a 90 day
window, ten of them anchored to specific neighbourhoods and three restricted at
the API to San Francisco outlets that write at corner resolution. Every
crossing name in every result is extracted, and each candidate clears three
hard bars: both names must be real San Francisco streets, checked against the
2,219 name street index; the pair must be an exact match in the 7,355 crossing
graded index; and the article must be about safety *at* that crossing rather
than merely naming it.

The accounting is published rather than summarised. The stored pass built
2026-08-20T13:11Z reads **29 attempted, 7 completed, 22 failed**, and every one
of the 22 is listed at [/watchlist](https://streetcred.thealexschroeder.workers.dev/watchlist)
with its reason, which was "Too many subrequests by single Worker invocation".
That failure was real and is now fixed at the schedule: the lane used to run as
the last thing inside the daily audit and inherited a nearly spent subrequest
budget, so it now has **its own cron trigger at 13:20 UTC and therefore its own
budget**, with a ceiling of 40 searches a run against a set of 29. All 29 fit
in one run. If the set ever outgrows the ceiling the lane rotates through it
least recently run first and publishes each query's last run date, rather than
silently truncating the way it did before. The first pass under the new
schedule has not run at the time of writing, so the split above is still the
old one; `/watchlist` will show the new one the morning after it fires.

That pass read 101 articles, surfaced 5 corners, published 7 rejects and
discarded 27 phrases that named no crossing in the city. The rejects are the
interesting half: pairs of real streets with no crossing between them, streets
that never meet, an article that named a corner but was not about safety there.

**5. Spend, metered from Exa's own numbers.** Cost is recorded from the
`costDollars` field on every Exa response rather than estimated from a price
list. The period meter reads **$21.45 spent against a $65.00 ceiling** across
**1,858 searches and 3,888 content pages**, all time $23.20, and the batch
lanes reserve cents before they call and refuse past the cap. It is public at
[/status](https://streetcred.thealexschroeder.workers.dev/status), not in a
spreadsheet. The method behind all of it is at
[/methodology](https://streetcred.thealexschroeder.workers.dev/methodology).

This design publishes what it threw away because a discovery pipeline that
shows only its hits is indistinguishable from a search box that got lucky, and
the same is true of a budget that only reports what it meant to spend.
