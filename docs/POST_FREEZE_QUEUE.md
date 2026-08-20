# The post-freeze queue

Everything deferred during the week of 2026-08-17, in one prioritized list.

StreetCred is feature-frozen until 2026-08-25, breakage only. This file changes
nothing. It is the list somebody works through on the morning the freeze lifts,
written so that each line can be picked up without rereading the week.

## The rule this list is ordered by

1. **Breakage.** The live site is producing a wrong, missing or degraded result
   right now. A visitor who looked carefully would be misled.
2. **Things a judge would notice.** Visible on a page a judge lands on, or a
   claim the site makes about itself that the code no longer supports.
3. **Things only the owner would notice.** Bookkeeping, tooling, repo hygiene.
   Real work, invisible from outside.
4. **Nice-to-haves.** Would improve the product. Nothing is wrong without them.

Within a band, cheaper first. An item stays in its band even when it is blocked
on somebody else, because the blocker belongs in the item and not in the
ordering. Anything a human must do rather than an assistant is in its own
section at the bottom and is not numbered with the rest.

## How this was measured

Every number below came from a command run while writing this file, on
**2026-08-19 between about 23:05 and 23:25 Pacific** (2026-08-20 06:05 to 06:25
UTC), or from a file read at a line number that is cited. The live Worker and
`data.sfgov.org` are both free and were curled directly. No paid API was called.
Nothing under `src/`, `public/`, `tools/`, `data/`, `specs/`, `synth/`,
`.github/` or `wrangler.jsonc` was modified.

Press and budget figures move while the burn runs. They are readings, not
totals, and each carries the time it was read.

Three sibling documents cover ground this file deliberately does not repeat:
[`docs/METHODOLOGY_SYNC.md`](METHODOLOGY_SYNC.md) for the methodology-page diff,
[`docs/WATCHLIST_SUBREQUEST_FINDING.md`](WATCHLIST_SUBREQUEST_FINDING.md) for
the watchlist subrequest derivation, and [`docs/COUNTS.md`](COUNTS.md) for the
80m against 150m radius reconciliation. Read those for the working. This file
carries the decision and the acceptance test.

---

# Band 1: breakage

## 1. The watchlist runs 8 of its 29 searches

**Spec.** Give the watchlist lane a subrequest budget it fits inside, and until
it has one, print attempted and completed as two numbers instead of one.

**What is measured.** `/api/watchlist`, read 2026-08-19 23:14 PT, carries 29
query records. Twenty-one of them hold `failed: "Too many subrequests by single
Worker invocation"` and `results: 0`. The eight that ran returned 15 results
each, 120 in total, which became 117 articles read, 5 verified entries, 7
rejects and 25 discarded phrases. Three of the 29 are the local-outlet passes.
The cutoff is sequential, so the 21 that never run are the tail of the list,
which is where every neighbourhood query sits.

**Why it was deferred.** The fix is a behavior change and the freeze forbids
one. Four options are written down in
[`docs/WATCHLIST_SUBREQUEST_FINDING.md`](WATCHLIST_SUBREQUEST_FINDING.md) and
none is chosen. Option 1 there, reporting both numbers, is the freeze-compatible
half of every other option and conflicts with none of them.

**What it touches.** The watchlist lane inside the daily-audit cron invocation
(`src/index.js:1695-1702`), the query list in `src/press.js`, the
`/watchlist` page, and `src/methodology.js:189`, which still says seven.

**Effort, ESTIMATE.** Half a day for option 1. One to two days for option 2 or 3,
which are the ones that recover the lost coverage.

**Acceptance test.** Either every record in `/api/watchlist` `queries[]` comes
back without a `failed` key, or `/watchlist` prints the attempted count and the
completed count as separate figures and lists the cut-off queries with their
reason in the same place it already lists rejected candidates. The page whose
whole argument is that it publishes what it threw away has to publish this too.

## 2. The imagery lane failed on the daily audit and nothing says why

**Spec.** Record and surface the imagery lane's own failure reason per corner,
and re-attempt a corner that came back partial instead of leaving it in ENRICHED
for good.

**What is measured.** `/api/imagery?x=1st-and-bush`, read 2026-08-19 23:09 PT,
returns `status: "failed"`, `hazards: null`, `fix: null`, and a `today` frame.
The note reads "The visual audit could not be generated for this corner."
`/api/run?x=1st-and-bush` shows the run at 2026-08-19T13:11:15.162Z with
`trigger: "cron"`: stats ran, timeline ran with 13 searches over 8 covered
years, vision ran with `audited: false` and three REPORTED labels, index ran to
grade F at percentile 99. Every lane except imagery did its job. The corner sits
in ENRICHED, which is `/api/board` entry 7 of 24.

**Why it was deferred.** Freeze, and the success path cannot be tested without a
funded Gemini key, which is a human decision. `specs/HANDOFF.md` calls this the
one item worth unfreezing for if it happens twice.

**What it touches.** The imagery lane and the roster lane of the cron
(`src/index.js:1704-1733`), the imagery status record in `src/store.js`, and the
corner page's imagery panel.

**Effort, ESTIMATE.** Half a day to a day for the reason-and-retry work. The
success path additionally needs a funded key, which is not an engineering
estimate.

**Acceptance test.** A corner whose imagery came back partial states its reason
on its own page rather than only in the generic note, and the next cron run
attempts it again. `1st-and-bush` either reaches both stored states or says, on
the page, which of the two failed and why.

## 3. Every letter on the site is a tagged SAMPLE right now

**Spec.** Fund the Gemini key, then run `specs/BILLING_QUEUE.md` item 1, the
single all-corner letter regeneration with the verifier extended first.

**What is measured.** `/api/letter?x=16th-mission`, read 2026-08-19 23:20 PT,
returns `source: "sample"` with a backoff record stamped 2026-08-20T05:11:10.544Z
and holding until 06:11:10.544Z, reason `gemini quota` and a verbatim HTTP 429
"You exceeded your current quota". Because the response is a sample and not
`verified-cache`, there is no stored verified letter at the flagship for the
fallback to reach. `6th-market`, `1st-and-bush` and `24th-and-valencia` all
return `source: "sample"` as well.

**Why it was deferred.** Blocked on a billing decision, which is a human action.
See the human-only section. `specs/HANDOFF.md` records the gate result at
`gate:gemini` as text fail, image fail, mode blocked.

**What it touches.** `LETTER_VERSION` in `src/index.js:73` (currently v6, the v7
bump was reverted), `buildInputSet` in `src/verify.js`, and the two curated
tables `data/cmf.json` and `data/precedents.json`, which the human approved on
2026-08-18 and which are cleared to run.

**Effort, ESTIMATE.** The verifier extension is half a day. The regeneration
itself is about 25 corners at one call plus a retry allowance, so hours of wall
clock, not days. The billing decision in front of it has no engineering
estimate.

**Acceptance test.** `/api/letter` for both flagships returns `source: "live"`
or `source: "verified-cache"` rather than `sample`, the verifier pass rate is
reported, and a doctored letter citing "CMF 9999" fails verification with the
token named. Do not bump `CACHE_VERSION` to do this: gotcha 13 in
`specs/HANDOFF.md` explains why that turns every letter on the site into a
sample.

## 4. The quota-backoff letter path addresses the wrong official

**Spec.** Resolve the district before choosing an addressee on the backoff
branch, or say the district could not be determined, rather than silently
falling through to the citywide official.

**What is measured.** For `fillmore-and-lombard`, read 2026-08-19 23:18 PT:
`/api/resolve?q=fillmore+and+lombard` returns `district: null`,
`/api/stats?x=fillmore-and-lombard` returns `district: 2`, and
`/api/letter?x=fillmore-and-lombard` opens "Dear Mayor Daniel Lurie" and places
the corner "in San Francisco". District 2 is Stephen Sherrill in
`src/data.js:128-140`. The cause is one argument: the backoff branch calls
`sampleLetter(c, c.district)` at `src/index.js:2429` and never fetches stats,
while the ordinary fallback branch calls `sampleLetter(c, stats.district)` at
`src/index.js:2465` and gets it right.

**Why it was deferred.** Found while checking whether Supervisor routing ships.
It does ship, see the note below. This is a single branch that misses it, and
the freeze forbids touching `src/`.

**What it touches.** `src/index.js:2429`, and one new case in the letter tests.

**Effort, ESTIMATE.** One hour including the test.

**Acceptance test.** A corner whose stored record carries no district but whose
stats resolve one is addressed to that district's Supervisor under the correct
title, on the backoff path as well as the ordinary one, and a test pins it.

**Supervisor routing, checked as instructed.** It ships today. All eleven
districts are in `SUPERVISORS` (`src/data.js:128-140`) including Sherrill, Wong
and Mahmood. `hasSupervisor` (`src/data.js:155-157`) gates the title so the citywide
fallback never renders as "Dear Supervisor Mayor Daniel Lurie". Both the live
letter path (`src/index.js:665-666`) and the sample path (`src/index.js:854-857`)
apply the same rule. The district itself is resolved from the corner's own
configured value, corroborated by a grouped `supervisor_district` count from
DataSF rather than by an arbitrary single row (`src/index.js:222-236`). Verified
live: `16th-mission` and `24th-and-valencia` address Jackie Fielder, District 9;
`6th-market` and `1st-and-bush` address Matt Dorsey, District 6. The only gap is
item 4 above.

---

# Band 2: a judge would notice

## 5. The methodology page no longer describes the code

**Spec.** Apply the replacement sentences in
[`docs/METHODOLOGY_SYNC.md`](METHODOLOGY_SYNC.md), which are written in the
page's own voice with the source line that settles each one.

**Why it was deferred.** `src/methodology.js` is frozen. The sync file was
written so the edit would be mechanical rather than investigative.

**What it touches.** `src/methodology.js` and, for the claims it shares,
`README.md`. The table is in the sync file and is not duplicated here.

**One ordering constraint.** Line 189 says "Seven citywide semantic searches".
The code builds 29. But item 1 above establishes that only 8 of the 29 complete.
The replacement sentence must state what completes, not what is attempted, or
this edit trades one wrong number for another. Fix item 1 first, or write the
sentence to name both figures.

**Effort, ESTIMATE.** One to two hours, mechanical, once item 1 is decided.

**Acceptance test.** Every row marked STALE or MISSING in
`docs/METHODOLOGY_SYNC.md` reads CURRENT when the file is re-derived against the
live page.

## 6. The "imagery pending" clause on the homepage can never fire

**Spec.** Add a third state, a flag or a roster, that the cron writes when a
corner's non-imagery lanes all ran and its imagery did not, and count
`textAudited` from that rather than from the audited roster.

**What is measured.** The homepage subtitle, read 2026-08-19 23:22 PT, is
"7,355 intersections graded citywide, 23 fully audited, one attempted every
morning." The pending clause is absent, and it is structurally unreachable:
`recountAuditTiers` is called with `meta?.audited` (`src/index.js:2239`) and
counts as pending any member of that roster missing a frame
(`src/store.js:868-887`), but the cron only adds a corner to `audited` when both
frames exist (`src/index.js:1719-1721`). The pending list is therefore always
empty and `textAudited` is always 0, so the clause at `src/home.js:131` and the
ticker suffix at `src/home.js:476` never render. `1st-and-bush` is the live
proof: audited in every sense except imagery, and currently indistinguishable
from a corner that was only swept.

**Why it was deferred.** It is a data-model change, not a copy change. The
freeze forbids it. Recorded at commit `9f2a8db`.

**What it touches.** The roster lane in `src/index.js:1713-1733`, `TIERS` in
`src/city.js:33-66`, `recountAuditTiers` in `src/store.js:868-887`, and the
three sentences in `src/home.js` that read the counts.

**Effort, ESTIMATE.** One day, most of it deciding whether the third state is a
tier, a roster or a flag on the corner record. It is a vocabulary decision
before it is a code one.

**Acceptance test.** With `1st-and-bush` in the new state, the homepage subtitle
reads "23 fully audited, 1 more with imagery pending, one attempted every
morning", the map alt text agrees, and the stored `audit:tiers` record reports
`textAudited: 1`. When the imagery lane later backfills the corner, all three
sentences return to the simpler form with no edit.

## 7. Show the cadence gap, not just the count

**Spec.** Compute days with a completed cycle against days elapsed from
`cotd:log`, and print both, so the ticker can say "ran 11 of 12 days" rather
than only a running total.

**What is measured.** The homepage ticker, read 2026-08-19 23:22 PT, reads "2
audited without a human so far" over two chips: 19th and Mission on 2026-08-18,
1st and Bush on 2026-08-19. Two runs across two elapsed days, so there is no gap
to show today, which is exactly why this is a display feature and not a repair.
The ledger is already correct and needs nothing: `cotd:log` is append-only,
trimmed to the last 120 entries (`src/store.js:217-235`), and the ticker counts
completed cycles (`src/home.js:475`). No consecutive-days counter exists
anywhere, so a missed morning cannot reset one and cannot erase history.

**Why it was deferred.** Requested 2026-08-20, held to keep the freeze. Recorded
at commit `9f2a8db`.

**What it touches.** The ticker in `src/home.js:469-478`, plus one helper beside
`getCotdLog` in `src/store.js` if the arithmetic is worth naming.

**Effort, ESTIMATE.** Half a day.

**Acceptance test.** Given a synthetic `cotd:log` with a day missing in the
middle, the ticker reads "ran 11 of 12 days" and the completed count does not
reset. Given today's real log, it reads "ran 2 of 2 days" and the existing
sentence is unchanged in meaning.

## 8. Regenerate the sponsor post's figures before it is posted

**Spec.** Rewrite the numbers in `specs/MAKE_THEM_KNOW.md` post 2 against live
figures, or replace it with `docs/rally_post_final.md`, which was finalized
against live numbers at commit `829a9aa`.

**What is measured.** `specs/MAKE_THEM_KNOW.md:67` still says "read 104 San
Francisco news articles this week and put four corners on a watchlist" with
seven rejects and 24 discarded. Live `/api/watchlist`, built 2026-08-19T13:11:21Z:
117 articles, 5 verified entries, 7 rejects, 25 discarded, 90 day window. The
post also says "104" and "four corners" in a paragraph whose entire point is
that the numbers are checkable at the URL given.

**Why it was deferred.** Nothing in `MAKE_THEM_KNOW.md` has been posted, so this
is a correction to a draft rather than to the site. The posting itself is
human-only and is listed below.

**What it touches.** `specs/MAKE_THEM_KNOW.md` only.

**Effort, ESTIMATE.** Thirty minutes.

**Acceptance test.** No figure in the post disagrees with `/api/watchlist` on
the day it is posted. If item 1 lands first, the post says 8 completed rather
than 29 attempted, or names both.

---

# Band 3: only the owner would notice

## 9. Wire the rendered-baseline differ into CI

**Spec.** Add `node tools/rendered_diff.mjs` to `.github/workflows/ci.yml` as
its own step, so a shape change in what the site renders becomes something a
machine notices.

**Why it was deferred.** The freeze forbids changing the gate. The exact YAML to
add is already written down at `test/fixtures/rendered/README.md:181-187`, and
the same file records the two things to decide first: the step reaches the
public internet, so it fails when GitHub cannot reach the Worker, and it
compares against the deployed site rather than against the commit under test, so
on a deploying branch it diffs new code against an old baseline and is right to.
A week of `continue-on-error: true` is the suggested way to find out how noisy
it is.

**What it touches.** `.github/workflows/ci.yml`, one step.

**Effort, ESTIMATE.** Fifteen minutes to add. A week of watching to decide
whether it stays non-blocking.

**Acceptance test.** CI runs the differ, a deliberate normalizer-visible change
fails the step, and a routine counter rollover does not.

## 10. A JPEG flag for the README hero composite

**Spec.** Add a format flag to `tools/make_readme_hero.py` so the composite can
be written as JPEG, with PNG staying the default and the output extension
following the format.

**What is measured.** `assets/readme_hero_16th_mission.png` is 1,225,534 bytes
at 1600x482. Re-encoding those exact pixels with PIL into the scratchpad, not
into `assets/`: JPEG at quality 85 with `optimize=True` is 191,354 bytes, which
is 15.6 percent of the PNG, and quality 92 is 254,999 bytes, which is 20.8
percent. The build function hardcodes `canvas.save(out, "PNG", optimize=True)`
and the default output path ends in `.png`.

**Why it was deferred.** `tools/` is frozen. Nothing is wrong with the current
PNG except its weight in a repository people clone.

**What it touches.** `tools/make_readme_hero.py`, the `build` function and the
argument parser. The README image reference if the committed asset is replaced.

**Effort, ESTIMATE.** Thirty minutes.

**Acceptance test.** `python3 tools/make_readme_hero.py 16th-and-mission --jpeg`
writes a `.jpg` at 1600x482, the Google attribution strip is still present and
uncropped because the panels are scaled and never cropped, and the README
renders it. The PNG path is unchanged when the flag is absent.

## 11. Decide what `/api/board` is a list of

**Spec.** Either rebuild the city rosters so `/api/board` and `city:meta` agree,
or label the board on the page as the High Injury Network list it actually
serves.

**What is measured.** `/api/board` returned 24 corners on 2026-08-19 23:06 PT.
The `audited` roster in `city:meta` holds 23. They overlap without matching:
per `docs/METHODOLOGY_SYNC.md`, the board omits `19th-and-judah`,
`24th-and-valencia` and `church-and-duboce`, and adds `1st-and-bush`,
`12th-and-moraga`, `31st-and-lawton` and `40th-and-cabrillo`. Gotcha 18 in
`specs/HANDOFF.md` explains the drift: a corner created by an on-demand resolve
is never added to the rosters, so it reads SCORED on the board until the next
`tools/build_city_shards.mjs` run.

**Why it was deferred.** The rebuild is one command and the freeze permits no
command that rewrites artifacts. The labeling half is a copy change, also
frozen.

**What it touches.** `tools/build_city_shards.mjs` for the rebuild, and the
board heading in `src/home.js` for the label.

**Effort, ESTIMATE.** The rebuild is one command. The decision is an hour,
because the real cost of two lists both called "the board" is that a count taken
against the wrong one is wrong by three, which already happened once while the
connections figure was being checked.

**Acceptance test.** Either the two lists agree, or the page names which list it
is showing, and `docs/METHODOLOGY_SYNC.md`'s note about the wrong denominator
becomes unnecessary.

## 12. The rest of the billing queue

Everything in [`specs/BILLING_QUEUE.md`](../specs/BILLING_QUEUE.md) is blocked on
a funded Gemini key and is therefore deferred by definition. Item 1 is item 3 of
this list. The other three, in the execution order that file specifies, each
assuming the ones above it are done:

- **Item 2, the golden corpus wired into CI.** Five frozen-input corners
  asserting the whole letter contract end to end: both flagships, a Tenderloin
  F, a calm Sunset A, and a score-tier corner with empty voices. Deferred
  because the corpus needs live drafts to freeze, and there are no live drafts
  while the key is unfunded. Touches `tools/fixtures/golden/` and
  `.github/workflows/ci.yml`. Effort, ESTIMATE: one to two days after item 1.
  Acceptance: the five assertions run in CI and a deliberately broken letter
  fails them.
- **Item 3, audit-tier imagery warming, then OG composites.** Write
  `tools/warm_imagery.mjs` with a `--max-images` hard cap, a resumable log and a
  skip for anything already stored, warm the audited fleet only, then build
  share cards with `tools/make_og.py`. Deferred: image generation is zero on the
  free tier. Effort, ESTIMATE: half a day to write the tool, plus the run.
  Acceptance: every audited corner has both frames and a real share card, and
  the operator budget is provably separate from the public daily cap rather than
  a bypass of it. This is also the afternoon that would close the item below.
- **Item 4, the Pro thinking upgrade, measured not assumed.** Re-confirm on a
  billed key whether a structured-output call spends thinking tokens at all,
  then A/B five corners flash against Pro-high on verifier pass rate and rule
  adherence. Deferred: unmeasurable without billing. Effort, ESTIMATE: half a
  day. Acceptance: the finding is logged either way and no model is swapped
  without a measured win.

## 13. The 25 worst corners are all ENRICHED

**Spec.** Decide whether to let the cron close this at one corner a day, or to
close it in an afternoon with `tools/warm_imagery.mjs` once a key is funded.

**What is measured.** The homepage scoreboard, read 2026-08-19 23:22 PT: all 25
rows of "Danger Index, worst first" carry the ENRICHED tier chip and none is
AUDITED. The queue line reads "7,173 corners in line, worst first". At one
corner a morning that is 25 days, which lands well after judging on 2026-08-24.

**Why it was deferred.** It is not a defect. It is the consequence of a
deliberate rule: the imagery lane declines to spend on a corner that has not
been promoted out of the score tier, and the cron promotes one a day. Changing
it during a freeze would be a feature.

**What it touches.** Nothing in `src/`. It is a decision about how to spend a
funded key, and it depends on billing-queue item 3.

**Effort, ESTIMATE.** No engineering. One afternoon of supervised spend, or 25
mornings of no spend at all.

**Acceptance test.** Whichever is chosen, the homepage stops being able to show
a board whose top 25 are all unaudited, or the site says out loud in words, and
not only in tier chips, that it is working down the list from the top.

---

# Band 4: nice to have

## 14. A cost-estimation roadmap line, unsourced

**I could not find this in the record and I am not going to invent it.** Grepping
the whole tree outside `.git` for "someday" returns nothing. Grepping `specs/`,
`README.md` and `src/` for "roadmap" returns only two `maptype=roadmap` strings
in the Google Maps calls.

What does exist, so whoever picks this up starts from the true state: the two
flagship corners carry hand-costed fixes, "$265,000 estimated" and "$310,000
estimated" (`src/data.js:19` and `:39`). Every other corner gets `DEFAULT_FIX`,
"$250,000 to $350,000, order of magnitude" (`src/data.js:78-82`), and the
comment above it says the figure is stated as an order of magnitude on the page
rather than dressed up as an engineering figure. `README.md:424` repeats that in
the Honest limits section. `src/page.js:982` records that the cost card's
wrapping rules exist because a range that cannot break is a range that leaves
the card.

So the plausible item is: derive a per-corner cost from the treatments the fix
actually names, instead of serving one order-of-magnitude range citywide. That
is a reconstruction, not a quotation. **Effort: NOT KNOWN**, because the
requirement is not written down anywhere and an estimate against a guessed
requirement would be a number invented into a document.

## 15. A Claude fallback lane for the letter, undecided and unsourced

**Also not in the record.** The only occurrence of the word Claude anywhere in
the tree outside `.git` is `tools/exa_install.sh:44`, "Then tell Claude the
workspace name", which is an instruction to a human operator running an install
script. There is no Anthropic client, no second text provider, and no
provider-selection code anywhere in `src/`.

The true current state, so the decision can be made on it: the only text model
is `GEMINI_TEXT_MODEL` in `src/index.js`, and the letter path's only fallbacks
are the stored verified letter (`src/index.js:814-822`) and then the tagged
sample (`src/index.js:2429` and `:2465`). Item 3 above shows what that looks
like today: a 429 from Gemini, an hour of remembered backoff, and a SAMPLE tag
on every letter on the site.

The open question is therefore whether a second provider should draft the letter
when the first has no allowance, and it has two obvious answers. A funded Gemini
key removes the motivation entirely, which argues for deciding item 3 first. If
a second lane is ever added, it changes nothing about the contract: every draft
still goes through `verifyLetter`, which is one function for both the serving
and the agent paths (gotcha 6), and a letter that fails twice is still never
shown.

**Effort: NOT KNOWN.** The decision precedes the estimate, and the decision has
not been made or written down by anyone.

---

# Carried forward, and found already closed

Three items were on the deferred list at the start of this pass and are no
longer live. They are recorded here so nobody spends an hour rediscovering that.

- **The stale score record at `24th-and-valencia`.** `specs/HANDOFF.md`
  "Deferred from polish pass" records it stored at v1 while the code was at v3,
  so `getScore` returned null and the title rendered without its grade letter.
  It has healed itself exactly as that entry predicted a page load would:
  `/api/score?x=24th-and-valencia`, read 2026-08-19 23:19 PT, returns
  `version: "v3"`, index 88, grade D, and `/status` lists the movement under
  Recent grade changes as "24th & Valencia B 24 to D 88, 2026-08-20". The
  standing behaviour is worth keeping in mind and needs no work: a stored score
  at an older version returns null rather than a padded value, and one page load
  upgrades it.
- **"The first Apify run is yours to start."** `specs/HANDOFF.md:649` still says
  this. It is stale. `specs/MAKE_THEM_KNOW.md` records the first paid run on
  2026-08-18 at $0.2961, and `/status`, read 2026-08-19 23:12 PT, shows 42 of 70
  runs for the cycle, a $4.829 ledger and a provider invoice of $4.6237 against
  $105.
- **"The morning cron has not yet fired with the autonomous-voices code
  deployed."** This caveat closes `specs/MAKE_THEM_KNOW.md`. The evidence now
  runs against it: `/status` shows "1st and Bush, 2 runs commissioned, in
  flight, 2026-08-19, pending", and the homepage reads "Resident voices
  commissioned autonomously at 13 corners. 4 produced an account that cleared
  the relevance filter." The ingest that publishes those quotes has not
  completed for 1st and Bush, so the honest statement today is that the cron has
  fired with the code deployed and one corner's ingest is still outstanding.

---

# HUMAN ONLY

**An assistant must not do any of the following, and this list exists partly so
that no assistant is tempted to try.** Every item here needs an account, a
credential, a payment method or a person's own name behind it. None of them is
blocked on engineering.

### Money

- **The Gemini billing decision.** This is the single blocker in front of
  `specs/BILLING_QUEUE.md` top to bottom, and therefore in front of items 3, 12
  and 13 of this file. Confirm afterwards that the free-tier ceiling is actually
  gone: a `PerDay limit: 20` error means nothing has changed.
- **The Exa and Apify spend decisions.** Readings at 2026-08-19 23:12 PT: Exa
  reports $12.9260 of $65.00 for 2026-08 across 1,238 searches and 2,576 pages
  of contents, and $14.1950 all time with $1.269 of that predating the counter.
  Apify reports 42 of 70 runs, a $4.829 ledger and a $4.6237 invoice against
  $105. The press burn was still reporting when these were read, so they are
  readings and not totals.

### Keys

- **Key rotation.** The procedure is in [`docs/KEY_ROTATION.md`](KEY_ROTATION.md)
  and every step of it ends at a command a human types. No secret value appears
  in this repository and none should.
- **The invalid `GEMINI_API_KEY` in `.dev.vars`.** It answers "400 API key not
  valid" and is not the same key as the deployed secret, so any local tool
  reading it is testing a key the site does not use. Replacing it is a human
  action. `tools/gemini_preflight.mjs` already detects the situation and probes
  the deployed key through the site instead.

### Posting, and anything with a name on it

- **Post 1 into the event WhatsApp thread**, and **post 2 to LinkedIn** tagging
  Exa and Apify with the reject-list screenshot. Both are in
  `specs/MAKE_THEM_KNOW.md`, neither has been sent, and item 8 above is the
  figure correction that has to land first.
- **The Loom URL** into the README placeholder. The script is in
  `docs/demo_loom_script.md`.
- **People's Choice copy.**
- Neither message is addressed to a judge or a mentor by name. That was a
  deliberate decision and it should survive whoever posts them.

### Devices and accounts an assistant cannot reach

- **A real-phone mobile pass.** The city board and its pager have been checked
  at desktop widths only.
- **The Chrome extension account mismatch.** The browser tools could not connect
  during the last run, so the heat-dot tap was verified by driving its exact
  request sequence rather than by clicking a real map. The Leaflet plumbing is
  the one thing on the homepage not exercised end to end by a machine.
- **Watchdog GCP preconditions**, before 2026-08-25. The companion repository is
  `streetcred-watchdog`.

---

# What is not in this file

- Anything already fixed. The burn pass of 2026-08-19 produced nine documents
  under `docs/` and none of them changed the site. Where one of them supersedes
  a number here, it is linked rather than copied.
- The 80m against 150m radius question. It is not a defect and not a deferral.
  Both radii are deliberate and both are labelled, and the derivation is in
  [`docs/COUNTS.md`](COUNTS.md).
- Anything that would need a deploy to verify. The freeze forbids deploying, so
  no item here claims to have been tested against a build that does not exist.
- A schedule. The freeze lifts on 2026-08-25 and judging is on 2026-08-24, so
  nothing on this list is available before judging, which is the point of a
  freeze.
