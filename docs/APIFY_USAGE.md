# How Apify is used

Apify is the resident voices lane: what people say about a corner in the places
they actually say it, which is the one thing no government database records.
The part worth your attention is that **nobody asks for these scrapes and
nobody is present when they run**.

**The site commissions its own scrapes, unattended.** When the 06:10 Pacific
cron promotes a corner it starts both actors for that corner over the Apify
API, writes down the run ids, and does not wait. An actor run takes minutes and
a cron handler must not sit on one, so the *next* morning's run ingests
whatever finished, scores it, and publishes what survives. A resident voices
lane that only covers corners somebody scraped by hand before a demo covers two
corners.

**Two actors, and each needed a different trick.**

[`compass/crawler-google-places`](https://apify.com/compass/crawler-google-places) for Google Maps reviews. An intersection is not
a place: geocoding "16th and Mission" resolves to a road junction, which has no
reviews attached, so the obvious query returns nothing. The working approach
treats the corner as a **geographic circle of roughly 350m** and collects
reviews from the real businesses and transit stops standing inside it. The
corner gets a voice by borrowing the voices of everything on it.

[`trudax/reddit-scraper-lite`](https://apify.com/trudax/reddit-scraper-lite) for Reddit. Driven by **explicit `startUrls`**
rather than the actor's search builder, which in this configuration enqueued
zero requests and returned an empty dataset. Pointing it at specific threads is
less elegant and completely reliable.

The two output shapes have nothing in common. Google Maps nests `reviews[]`
with `text`, `stars` and `publishedAtDate`; Reddit returns flat records with
`title`, `body` and `createdAt` and no rating at all. Both are flattened into
one contract, `{source, stars, text, when}`. Reviewer names are dropped on
purpose, quotes are truncated, and boilerplate is stripped.

**The real funnel, from the stored record at 2026-08-23T13:10:10Z.** **17
corners commissioned. 4 currently carry an account that clears the relevance
filter. The other 13 are recorded as scraped and empty**, which is a result and
not a gap: the corner page says so in those words, and the drafted letter for
such a corner quotes no resident rather than inventing testimony. The four
carrying live scraper output, one click each:
[24th and Valencia](https://streetcred.thealexschroeder.workers.dev/c/24th-and-valencia),
[4th and Ellis](https://streetcred.thealexschroeder.workers.dev/c/4th-and-ellis),
[9th and Mission](https://streetcred.thealexschroeder.workers.dev/c/9th-and-mission),
[Polk and Willow](https://streetcred.thealexschroeder.workers.dev/c/polk-and-willow).
Every published quote carries a provenance chip naming the Apify actor that
scraped it and the date it was scraped. Three more corners were commissioned on
2026-08-23 and ingest on the next morning cycle.

Those numbers went **down** rather than up, and that is the point. The ledger
shows earlier ingests keeping 15 quotes across 9 corners; the filter was then
tightened, every stored scrape was re-scored against the stricter rule, and the
published count fell to 4. A review of a BART escalator is not testimony about
a crossing. It is easier to ship the larger number and never look again.

**Autonomous means budgeted, or it means nothing.** A hard ceiling of
**`MONTHLY_ACTOR_RUN_CAP = 70` actor runs** is checked before anything starts,
which sits just above two runs a morning and far below the credit. **54 of
those 70 are used this month**, after an operator-authorized burst of two extra
corners on 2026-08-23 that left the morning cron its full share through Aug 31.
Every run is written to a public cost ledger from the number Apify itself
reports: both actors are pay per event, the inputs cap at 12 places and 25
Reddit results, a corner with both actors costs about **24 cents** measured
over 25 settled corners, and the ledger stands at **$5.91 across 54 actor
runs** against the provider's own cycle invoice of **$6.41 of $105**. Both
figures sit side by side in the
[Apify ledger block on /status](https://streetcred.thealexschroeder.workers.dev/status),
which also states, in both directions, which one is reading high.
An autonomous system spending real credit without a ledger is the thing nobody
should ship.

**The honest limit.** Reviews near a station skew toward escalators, cleanliness
and policing rather than crossing conditions. That is why the filter is strict
and why thirteen of seventeen corners show an empty lane. The fix is better
targeting, not a looser filter.
