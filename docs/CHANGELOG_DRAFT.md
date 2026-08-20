# Changelog draft, week of 2026-08-17 to 2026-08-19

**DRAFT. NOT PUBLISHED. Do not paste before the feature freeze lifts on 2026-08-25.**

Nothing in this file is on the site. It is written to be pasted as a whole once the
freeze is over. Every number in it was read from the live Worker, from `git log`, or
from a commit body in this repository between 22:45 and 23:15 PT on 2026-08-19. Where
a figure was still moving when it was read, the entry says so.

---

## The ambiguity, and how it was resolved

There is no human-facing changelog in this repository, and the site's `/changes` page is
not one. `src/changes.js` renders a grade-movement ledger: each record is a slug, an old
grade and index, a new grade and index, a reason, a source and a date, fed from the
pipeline through KV. It holds two records right now, `ashbury-and-haight` C 72 to C 71
and `19th-and-judah` F 95 to F 96, both with reason "score model v2 replaced by v3",
source "pipeline", both dated 2026-08-18 (`curl /api/changes`).

So "the changelog's house voice" was read as the voice of that page and not as the voice
of a release note. That page is dated, one entry per change, names the reason and names
the source, and it never editorializes. This document is written in that register, with a
date, a reason and a source on every entry, but as prose, because release notes are prose
and the page's record shape has no field that can hold a paragraph. Putting these entries
into `/changes` would mean stuffing them into the `reason` string, where they would render
as one long line inside a `.chg` card next to an arrow pointing nowhere.

**Where this should eventually live: a new file, `CHANGELOG.md` at the repository root,
not a new section of `/changes` and not a new page on the site.** Three reasons. The
`/changes` feed is written by the pipeline into KV and there is no hand-authoring path
into it, so a human entry cannot be added without writing to the store. The page's
contract is narrow on purpose and is stated in its own top-of-file comment, which is that
a reader holding last week's screenshot can find out what moved a grade; prose about a
layout pass does not serve that reader. And the site already carries one narrative surface
that has gone stale, the README, so adding a second published narrative surface adds a
second thing that can go stale unattended. A repository file is read by the people who
would notice.

---

## Entries

### The Exa press burn, at city scale

**Date:** 2026-08-19.
**What changed:** press coverage lookup went from a per-corner lane to a city-scale batch.
`src/pressenrich.js` now spends what is already paid for first: the stored citywide sweep,
then a per-street segment cache with a seven day life shared by every corner on that
street, then three dated windows on the crossing itself. Searches buy no page text at all,
candidates are shortlisted on title and url, and only the shortlist is fetched.
**Why:** running a per-page search on all 7,355 graded corners would have bought the same
corridor coverage once per corner. The dated-window design also replaced eleven calls a
corner with three.
**What it cost:** measured, not projected, on the live account: 4.30c and 4.20c a corner
with both streets cold, 3.50c with one street warm, 2.90c with both warm (commit b8268c2).
As of 22:46 PT on 2026-08-19 the burn had checked 318 corners over 17 chunks and found
coverage on 304 of them, 95.6%, for $10.9920, and `/status` still reported the run as
reporting, so that spend is a running total and not a final one.
**Source:** commits 0eed39b, 7388076, b8268c2, 0e0008d, c5a417a, fce7fe4;
`curl /status`; `curl /api/radar` (`burnChecked` 318, `burnHitRate` 95.6).

### The Exa meter became a ledger denominated in dollars

**Date:** 2026-08-19.
**What changed:** `budget:exa` counts cents rather than calls. Spend is reserved before a
call at 0.7 cents a search and 0.1 cents a page of contents, reconciled afterwards against
the provider's own `costDollars`, and the cap is enforced on whichever of the two is
higher. Every Exa call site records its cost now, not only the two batch lanes.
**Why:** counting calls priced a search and a page of contents identically, which was
wrong in both directions, and the thing that actually runs out is a balance. A counter
that ignored the per-page press lane, the suggestion lane and the timeline lane was a
sample rather than a ledger.
**What it cost:** nothing by itself. It is what makes the numbers below citable. As read
at 22:46 PT on 2026-08-19: $12.5990 of a $65.00 cap for 2026-08, 1,228 searches and 2,552
pages of contents, on the Alex Schroeder workspace, confirmed. All time $13.8680, of which
$1.269 predates the counter and is carried separately for that reason.
**Source:** commits 7388076, 1b6753c; `curl /status`.

### The press radar became standing infrastructure

**Date:** 2026-08-19.
**What changed:** the radar stopped being a batch somebody runs and became something the
deployment maintains. `ensureMonitors` creates Exa Monitors from inside the Worker, in
parallel batches of six, storing after each batch so a killed run costs one batch and
resumes rather than restarts. A public webhook receives detections and is treated as
hostile end to end: a shared secret in the path, a monitor id this Worker created, and
then the same relevance filter and graded-index bar as the rest of the press lane. A
quarter-hourly tick continues the press batch six corners at a time, which is what a
single invocation's 50 subrequest budget allows at up to six Exa calls a corner.
**Why:** the local tool kept halting on Cloudflare's REST API, and it needed the webhook
secret typed into a shell that has no terminal. Inside the Worker, KV is a binding and
that whole layer does not exist.
**What it cost:** 29 of 29 monitors created, 0 failed, at 2026-08-20T02:08Z: 25 corridors
derived from the rank and 4 citywide. The detection feed is empty, no detection has
arrived yet, 0 cents spent against caps of 40 cents a day and 900 cents a month, not
paused. A forged webhook post can at worst waste a filter pass; it cannot invent coverage,
move a grade, or spend on imagery or voices.
**Source:** commits 3e2b49a, e8a753e, 15b9d6a, c942002, cd17e03; `curl /api/radar`.

### The hero became slider-first

**Date:** 2026-08-18 and 2026-08-19.
**What changed:** the homepage hero is search on the left and the corner of the day on the
right, and the corner of the day is the drag slider itself rather than a link to it.
`SLIDER()` in `src/page.js` is one component with two mounts, the corner page and the
homepage embed, keyed on classes so a second mount can exist at all. The hero now features
the newest corner that actually has both frames, found by a bounded walk back through the
audit log, and the date line makes the morning claim only when it is true.
**Why:** the embed exists to demonstrate a before and after drag, and on 2026-08-19 the
featured corner was `1st-and-bush`, whose imagery lane came back partial, so the homepage
was showing a pending placeholder where the demonstration should be. A text-only hero is
worse than an older slider and better than a hole.
**What it cost:** zero provider calls. The embed's only cross-origin request is the Google
Fonts stylesheet the site already loaded. Measured on production at 1280x900 and 390x844:
handle centred at `aria-valuenow="50"`, both panes decoded before any interaction at
natural widths 640 and 1306, mouse and CDP touch drags both landing on 25%, CLS 0.0300
desktop and 0.0000 mobile.
**Source:** commits 602b5c6, 4f85e51, 2630c60, 289592a; `specs/HANDOFF.md`, "The hero:
corner of the day, and the slider inside it".

### Layout and containment passes

**Date:** 2026-08-19.
**What changed:** six render-layer commits, in `src/page.js` and `src/home.js` alone. The
corner page's identity moved into the header of the imagery card so the page opens on the
grade. The record's three stat tiles moved under the voices card so a tall press card no
longer faces a column of nothing. The letter panel's summary row stopped asking the window
how wide it is and started asking the card. The homepage stat band moved below the hero,
above "Powered by", with a rule marking the seam between what is for a visitor and what is
the site accounting for itself. A drawn Golden Gate backdrop and the city label moved under
the search.
**Why:** two of these were containment bugs rather than taste. `.fixrow .cost` is nowrap,
which is right for `$250,000` and wrong for `$250,000 to $350,000, order of magnitude`,
409px of unbreakable text in a 362px column; every corner page on the scored tier scrolled
sideways at phone width. The same string broke the letter panel's two-track row, leaving
the label column 66px.
**What it cost:** no provider call and no data change; the six commits touch `src/page.js`,
`src/home.js` and one test file and nothing else (`git show --stat`). Measured after: corner
page `scrollWidth` 390 against a 390 viewport, down from 554. The bridge artwork sits at 9
percent opacity, chosen by measuring contrast against the darkest pixel actually behind the
glyphs rather than against a nominal background, holding 4.61 desktop and 4.65 mobile.
**Source:** commits 16da90b, d5510f8, 5e38cec, db1917f, 806513f, 7b4116b.

### Honesty fix: the proposed-fix disclaimer no longer stands alone

**Date:** 2026-08-19.
**What changed:** the AI-generation disclaimer now appears when the proposed fix appears,
and follows the view, hidden on the unedited photograph and on the hazard overlay, both of
which carry their own captions.
**Why:** on a corner whose render was never generated it was disclaiming an image that is
not on the page, which reads as a site hedging by reflex rather than telling you something
about what you are looking at. The same commit split one "audited" number into
`fullyAudited` and `textAudited`, because a corner whose records, press, voices and hazard
lanes all ran but whose two frames never landed is not the same thing as a complete corner.
**What it cost:** no provider call. See "What did not change" for the part of that split
that still cannot fire.
**Source:** commit 47adc28.

### Honesty fix: the press card stopped contradicting itself

**Date:** 2026-08-19.
**What changed:** one composer now owns the press card's sentence and waits for both lanes
before writing it. Timeline hits with nothing current now read as historical headlines with
the count of articles read behind the empty current lane, rather than as two claims.
**Why:** the year strip counts what a dated search finds across a decade and the press list
is what passed the relevance filter now. Rendered independently they routinely printed
"First coverage we can find dates to 2018. 2 headlines since." directly above "Searched and
nothing found." Both were true of their own lane and the pair was nonsense.
**What it cost:** nothing. The card is composed in the browser from stored data, so every
corner already stamped renders the corrected copy on its next load, with no Exa call and no
KV rewrite.
**Source:** commit 94818b1.

### Honesty fix: Exa attribution on the press card and the live scan card

**Date:** 2026-08-19.
**What changed:** the press card carries an Exa mark and the label "Press via Exa" in the
same box and placement as the imagery card's Street View and Gemini badge, measured at 25px
against the imagery tag's 25px. The same badge sits on the `/status` scan card.
**Why:** the imagery card named the tools that make it and the press card named nothing.
This is attribution and not a plug: a badge, no link out, the mark capped to the cap height
of the label beside it.
**What it cost:** no provider call, two files touched.
**Source:** commit a9cabf5.

### Honesty fix: the press-citations tile counts what is stored

**Date:** 2026-08-19.
**What changed:** the homepage citations tile is counted by a bounded scan of the stored
records inside the Worker, cached for six hours and refreshed in the background, and a
failed scan writes its error where the reader of the count will find it.
**Why:** the tile read 1,255 all day. Adding a running counter to the roll-up fixed nothing
already written, because the burn had stored 246 corners before the counter existed, so the
tile kept an old snapshot while gaining a fresh as-of. A stale number with a current
timestamp is worse than a stale number, because it looks checked.
**What it cost:** no provider call; KV is a binding inside the Worker. At the time of the
commit the scan measured 277 corners checked, 264 with coverage, 1,149 citations. At 22:48
PT on 2026-08-19 the live tile reads 2,695, with its own as-of stamp.
**Source:** commit 25f2e3d; the live homepage stat band.

### The account-attribution correction

**Date:** 2026-08-19.
**What changed:** the claim that the deployed Exa key was identified by what it charges was
withdrawn. `exaAccountFor` became `exaPlanFor` and returns a plan tier, `/api/health`
reports `exaPlan` and never an account, and `verifyExaAccount()` is now the only thing in
the codebase that may name a workspace. The nightly press batch returns `account-unverified`
and spends nothing while that flag is false, which a test pins. `/api/health` also stopped
making an Exa search on every call unless the workspace is confirmed or a caller asks with
`?probe=exa`.
**Why:** a contents-free search costing $0.007 identifies a plan tier of $7 per thousand.
Any number of workspaces bill identically on that tier. The gate was written as a price
comparison, reported as passed, and the batch ran on it; the human then found no activity
at all on the $70 workspace's Usage page for 2026-08-12 to 2026-08-19. The lesson is stated
in the commit and is worth repeating: a measurement consistent with a hypothesis is not a
confirmation of it.
**What it cost:** the batch halted at 16 corners of that night's 100, and lost nothing,
because the skip rule is the stored record. Two health checks moved the meter by $0.007
each during the correction itself. The workspace was later confirmed by one deliberate
search at 11:00:51 Pacific, $0.007, watched on the dashboard; `/status` has read "Alex
Schroeder workspace, confirmed" since. A separate probe found the Websets endpoint names
the team in its 401 message, which corroborates the dashboard observation without replacing
it. Spend measured before the confirmed key was installed is reported as unattributed
rather than folded into the workspace total, at `src/store.js` lines 596 to 601.
**Source:** commits c2f34b8, 03bd618, 3c0c502, 1b6753c, 8be2d89; `curl /status`;
`src/store.js`.

---

## What did not change

A changelog that lists only additions hides the freeze.

- **StreetCred is feature-frozen until 2026-08-25, breakage only.** The two crons keep
  running by design, and stopping them would count as breakage rather than as a feature.
  The freeze is recorded in commit 9f2a8db, dated 2026-08-19; the record does not state the
  date it began. Source: `specs/HANDOFF.md`, "After the freeze, Aug 25".
- **Deferred past the freeze, item one: showing the cadence gap rather than only the
  count.** `cotd:log` is append-only and the homepage ticker reads "N audited without a
  human so far", which is a count of completed cycles. No consecutive-days counter exists
  anywhere, so nothing can reset and nothing can be erased. What is missing is only the
  display half, something that says "ran 11 of 12 days". Requested 2026-08-20, deferred to
  hold the freeze.
- **Deferred past the freeze, item two: a corner audited from the records with imagery
  pending cannot be counted as such.** The cron puts a corner in `audited` only when both
  frames exist and in `enriched` otherwise, which is right, but `recountAuditTiers` scans
  the audited roster, where every member has both frames by construction. `textAudited` is
  therefore structurally 0 and the "N more with imagery pending" clause in the homepage
  subtitle can never fire. It needs a third state before that sentence can ever be true.
- **Not deferred, and not fixed either: the imagery lane failed on the 2026-08-19 daily
  audit.** `1st-and-bush` came back partial and landed in `enriched`, which is why
  `/api/board` counts 24 while the subtitle says 23 fully audited. The handoff records this
  as the one thing worth unfreezing for if it happens twice.
- **The grade model did not move.** `/changes` still holds exactly two records, both from
  2026-08-18. Nothing this week changed a grade or an index.
- **No dependency was added.** There is still no `package.json` in the repository and none
  is needed.
- **The README and `/methodology` were not brought up to date, and both are wrong about
  the watchlist.** `README.md` line 66 and `src/methodology.js` line 189 both say "Seven
  citywide semantic searches"; the live watchlist configures 29. `README.md` line 68 still
  cites an older pass at 104 articles, 7 searches, 4 corners, 7 rejects and 22 discarded,
  and `specs/MAKE_THEM_KNOW.md` cites 104 articles, 4 corners and 24 discarded. The live
  build of 2026-08-19T13:11Z reads: 29 queries, 117 articles read, 5 verified entries, 7
  rejects, 25 phrases discarded, 90 day window. Those figures supersede every count above.
  The fix is a copy edit and would ordinarily be breakage-class, but it was not made this
  week and this document does not claim it was.

---

## One thing found while writing this, not yet acted on

Of the 29 watchlist queries in the live build of 2026-08-19T13:11Z, 8 returned results and
21 failed with "Too many subrequests by single Worker invocation" (`curl /api/watchlist`).
The published counts, 117 articles read and 5 verified entries, are therefore the product
of 8 successful searches and not of 29. The watchlist page and this document should both
say so. Recorded here rather than fixed, because the freeze is in force and this is a
correctness question about copy rather than an outage.

---

## Where every number above came from

| Figure | Source, read 2026-08-19 between 22:45 and 23:15 PT |
| --- | --- |
| 2 grade-change records, both 2026-08-18 | `curl /api/changes` |
| 7,355 graded, 23 fully audited | homepage masthead and subtitle |
| roster of 24, `1st-and-bush` enriched | `curl /api/board` (`count` 24) |
| burn 318 corners, 17 chunks, 304 with coverage, 95.6%, $10.9920, still reporting | `curl /status`; `curl /api/radar` |
| Exa 2026-08 $12.5990 of $65.00, 1,228 searches, 2,552 pages | `curl /status` |
| Exa all time $13.8680, $1.269 prior to the counter | `curl /status` |
| Apify 42 of 70 runs, $4.829 ledger, $4.6237 invoice of $105 | `curl /status` |
| uptime 97.3%, 37 runs in 7 days, 1 failing | `curl /status` |
| homepage tiles: 2,695 citations, $4.62 this cycle, 7,173 in line | homepage stat band |
| 29 of 29 monitors, 25 corridor and 4 citywide, 0 failed, feed empty, caps 40c/day and 900c/month, 0 spent | `curl /api/radar` |
| watchlist 29 queries, 8 returned, 21 failed, 117 articles, 5 entries, 7 rejects, 25 discarded, 90 days | `curl /api/watchlist` |
| per-corner press cost 4.30c, 4.20c, 3.50c, 2.90c | commit b8268c2 body |
| citations tile 1,255 stale, then 277 checked / 264 with coverage / 1,149 citations | commit 25f2e3d body |
| corner page `scrollWidth` 554 then 390 at a 390 viewport | commit 5e38cec body |
| 409px unbreakable figure, 66px label column, 529px card at a 1280 window | commit db1917f body |
| slider CLS 0.0300 desktop, 0.0000 mobile, panes 640 and 1306 natural width | `specs/HANDOFF.md`, hero section |
| backdrop 9 percent opacity, 4.61 desktop and 4.65 mobile contrast | commit 7b4116b body |
| Exa badge 25px against the imagery tag's 25px | commit a9cabf5 body |
| 19 commits on 2026-08-17, 78 on 2026-08-18, 35 on 2026-08-19 | `git log --date=short --pretty='%ad' \| sort \| uniq -c` |

Collision-count questions, including why the same corner reports 9 severe injuries in one
lane and 11 in another, are derived in `docs/COUNTS.md`. That derivation is not repeated
here.

---

**End of draft. Nothing here is published. Freeze lifts 2026-08-25; judging is 2026-08-24,
which is inside the freeze.**
