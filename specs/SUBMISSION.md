# Build Club submission copy

Written 2026-08-20 against the site as it stands. Every figure here is served
by a live page or read from a stored record, and the ones that move name the
reading. Judging closes Monday noon PT.

**Live:** https://streetcred.thealexschroeder.workers.dev
**Source:** https://github.com/alejandro-publius/streetcred

Nothing below promises anything ships by Monday. Where a number is a
projection it says so in the same sentence.

---

## The one paragraph version

StreetCred grades every one of the **7,355** intersections in San Francisco
that carry reported harm, scored against a full census of **8,254** crossings
using the city's own collision and 311 records rather than a sample. Type any
corner and you get its grade, the counts behind it, and a link to the exact
query on data.sfgov.org so you can check the arithmetic yourself. A scheduled
Cloudflare Worker audits one more corner every morning with nobody present, and
publishes the result even when a lane comes back empty. It publishes its own
uptime, its own spend, and the things it threw away.

---

## Criterion 1: working build and progress

**It is live and it is running itself.** Three cron schedules: the morning
audit at 06:10 Pacific, the citywide press watchlist ten minutes later on its
own invocation, and a press batch every quarter hour. Grades for 7,355 corners,
23 fully audited, 107 enriched.

**The trust surfaces are the product, not decoration.** Each is a live page a
judge can open:

- [/methodology](https://streetcred.thealexschroeder.workers.dev/methodology) every source, window, radius, filter and formula, plus the limitations
- [/status](https://streetcred.thealexschroeder.workers.dev/status) synthetic uptime, and the Exa and Apify cost ledgers metered from what the providers themselves report
- [/changes](https://streetcred.thealexschroeder.workers.dev/changes) every stored grade movement with who moved it and why
- [/watchlist](https://streetcred.thealexschroeder.workers.dev/watchlist) the press discovery pass, including every candidate it rejected and every search that did not run
- [/watchdog](https://streetcred.thealexschroeder.workers.dev/watchdog) an adversarial agent's claims against the site, and where it was wrong

**This is the only public repository in the field.** Everything below can be
read as code rather than taken on trust:
https://github.com/alejandro-publius/streetcred

---

## Criterion 2: thoughtful sponsor tool use

The README carries a section per sponsor written to be read on its own: "How
Exa is used" and "How Apify is used".

**Exa** runs three lanes: per corner press coverage framed as corroboration
underneath the city's own records, a date sliced timeline of one search per
year since 2014, and `findSimilar` connections written to both corners so the
claim reads the same from either page. Then the fourth thing, which is the one
worth the credits: **29 semantic citywide sweeps** that run the discovery
backwards, starting from the city's coverage and asking which corners are in
it, with every candidate checked against a 2,219 name street index and the
7,355 corner graded index before it can surface. Spend is metered from Exa's
own `costDollars`: **$21.45 of a $65.00 ceiling** this period across 1,858
searches.

**Apify** is the autonomous half. The morning cron commissions two actors per
corner and does not wait; the next morning ingests what finished. From the
stored record: **14 corners commissioned, 4 currently carrying an account that
clears the relevance filter, 10 recorded as scraped and empty.** A hard ceiling
of 70 actor runs a month is checked before anything starts, **44 used**, and
every run is in the public ledger at $5.10 total.

---

## Criterion 3: side-hustle potential

The honest version. What exists today is a working civic tool with no revenue
and no users beyond the event.

What it is positioned for, **stated as a projection and not as a result**: the
same pipeline retargets to any city with an open collision dataset and a street
index, which is most large US cities. The plausible buyers are the people who
already write these letters by hand: neighbourhood safety groups, walk and bike
advocacy organisations, and district supervisor offices fielding constituent
complaints they have no evidence base for. The unit of value is the ask a
resident can actually send, backed by records that survive a check.

No revenue is claimed and no pipeline is claimed, because there is neither.

---

## What a judge will find if they look hard, said first

Two things on the site right now are worse than they were a week ago, on
purpose. Both are the system working.

**1. Every letter is currently in a pending state.** The drafted letter is the
one artifact on this site a person might actually send to an elected official
with their name on it, so it is the one lane not allowed to be approximately
right. This week the deterministic verifier gained rules it did not have:

- a sentence claiming residents describe the problem requires the voices lane
  to have found something
- a sentence citing press coverage requires a found citation
- magnitude words like "hundreds" must map to a figure the page actually
  displays, checked against what that figure counts
- the official in the salutation must match the sitting representative of the
  corner's resolved district

Re-running those rules found there was nothing stored to re-run them against:
`letter:verified:*` holds zero keys. What had been reaching readers was a
sample paragraph asserting resident accounts, press coverage and "hundreds of
collisions" at whichever corner happened to ask. On 16th and Potrero it claimed
residents describe the problem beside a voices lane reading NONE FOUND, and
hundreds of collisions beside a displayed 65.

That sample now serves nowhere. Every corner with a letter lane shows "A
verified letter for this corner is queued behind generation" until a funded
model key regenerates the fleet. **The verifier that emptied the site is the
same one that guarantees no letter can contradict the page it sits on.** An
empty lane that says it is empty is worth more than a full one that is wrong,
and the regeneration is specced and queued in `specs/BILLING_QUEUE.md` rather
than hand written.

**2. The watchlist was doing a fraction of the work it reported.** It ran as
the last lane inside the daily audit and inherited a nearly spent subrequest
budget, so of 29 searches roughly 7 completed and 22 were cut off before
reaching Exa, every morning, while the page said 29. The failures were stored
with their reasons and rendered nowhere.

That was found, written up in `docs/WATCHLIST_SUBREQUEST_FINDING.md` with four
options and the evidence, published on the page as attempted against completed
against failed, and then fixed at the schedule: the lane now has its own cron
trigger and therefore its own budget. It was not quietly patched and it was not
hidden while it was broken.

---

## The line that ties it together

Every number on this site is either checkable at a link or published with the
reason it is missing. The reject list, the empty lanes, the searches that did
not run and the letters that did not pass are all on the site, because a
pipeline that shows only its hits is indistinguishable from a search box that
got lucky.
