# How StreetCred uses Exa

StreetCred grades every one of San Francisco's 7,355 scored intersections from city records, then asks
a question no city dataset can answer: has anyone written about this corner. Exa is that lane. This
document is for a judge who wants to check the work rather than read a pitch. The README sells the
lane; this file proves it. Every claim carries a `file:line`. Every number carries the command that
produced it and the time it was true.

**Measurement window.** Everything stamped "live" below was read from
`https://streetcred.thealexschroeder.workers.dev` at **2026-08-20T05:53Z to 05:55Z** (22:53 to 22:55 PT
on 2026-08-19) with `curl`. A press burn was reporting progress during that window, so the burn
figures move. They are stamped individually.

Cross-references: `docs/COUNTS.md` derives the collision counts and the radius question, and is not
repeated here.

---

## 1. The account attribution gate

This is the most interesting thing in the integration, so it goes first.

**A price identifies a plan tier. It does not identify a workspace.**

An earlier version of this code inferred the billed account from the observed per-search price. That
was wrong, and the way it was wrong was silent. The record is in `specs/HANDOFF.md:538-547`: a
contents-free search cost $0.007 on the deployed key, which identifies a $7-per-thousand tier, and the
gate was written as a price comparison, reported as passed, and a batch ran on it. The human then
opened the $70 workspace's own Usage page and found no activity at all for Aug 12 to 19 with the
balance still reading exactly $70.00. The spend had landed somewhere else.

The lesson is written into the source so it is not relearned. `src/store.js:643-657`:

> What plan the deployed Exa key is on, which is NOT the same as what account it belongs to. [...]
> Only a human observing movement on a specific workspace's dashboard identifies the account.

### What each function actually does

**`exaPlanFor(unitUsd)`, `src/store.js:661-672`.** Takes a measured unit price in dollars and returns
a plan tier name or `null`. It compares against `EXA_PLAN_PRICES = { "15-per-1k": 0.015, "7-per-1k":
0.007 }` (`src/store.js:659`) inside a 20 percent relative band (`src/store.js:669`). The band is
deliberately narrow enough that nothing lands in both tiers, and a price matching neither is reported
as unknown rather than rounded into the nearest story. It returns a tier. It has no capacity to return
an account, and `/api/health` exposes `exaPlan` and never an account (`src/index.js:1271-1272`).

**`verifyExaAccount(env, {workspace, observedBalanceUsd, attributedFromCents})`,
`src/store.js:548-573`.** The only function in the codebase permitted to name the workspace being
billed. It throws without a workspace name (`src/store.js:549`). It sets `account`,
`accountVerified: true` and `verifiedAt` together, because those three fields move as one
(`src/store.js:551-553`, and the comment at `src/store.js:506-508` says only this function moves them).
Two details are load bearing:

- `observedBalanceUsd` is normalised so a missing reading stays unknown (`src/store.js:554-561`).
  The comment names the bug it fixes: `Number(null)` is `0` and `0` is finite, so a missing balance
  had been recording itself as an observed balance of zero dollars.
- `attributedFromCents` records the counter's position at the moment the confirmed key was installed
  (`src/store.js:562-571`). Spend before that boundary happened and stays in the total, but it is not
  charged to this workspace's balance. `exaBudget` then reports `attributedUsd` and `unattributedUsd`
  as two separate figures (`src/store.js:596-601`).

**The only caller is `tools/exa_verify.mjs:43-47`**, which is a tool a human runs after watching a
dashboard, not something any automated path can reach.

### The gate has teeth

Nothing spends in bulk while `accountVerified` is false:

- The Worker's nightly batch returns `{ source: "account-unverified", checked: 0, spentUsd: 0 }` and
  makes no call (`src/index.js:1099-1104`).
- The operator tool exits with code 2 and prints the verify command (`tools/press_batch.mjs:73-80`).
- The health check will not even spend a single probe search unless the workspace is confirmed or the
  caller passes `?probe=exa` explicitly (`src/index.js:1190-1199`).

### Spend and balance are not the same event

`src/store.js:587-593` states this on the meter itself and `src/status.js:208-211` states it on the
public page: where a plan grants free monthly credits, those are consumed first, so a real charge can
show as usage while the remaining balance does not move at all. That is why the observation that
counts is **usage moving on a named workspace**, not a balance dropping (`tools/exa_verify.mjs:9-13`).

/status therefore prints the attribution and the caveat as two separate statements. Read live at
**2026-08-20T05:55Z**:

> Exa press budget, 2026-08, **Alex Schroeder workspace, confirmed**
> observed on Alex Schroeder at 2026-08-19. A price identifies a plan tier, not a workspace, so this
> total is only attributable once somebody has watched a specific dashboard move after a known call.

### One corroborating detail

Exa's API has no account or usage endpoint. The Websets endpoint is Pro only, and its refusal message
names the team the key belongs to. `tools/exa_probe.mjs:53-56` reads that string. The comment at
`tools/exa_probe.mjs:48-52` is careful about what it is worth: it corroborates a dashboard
observation and does not replace one, because it names the team a key belongs to and not what any
particular call was billed against.

---

## 2. The three modes

### Mode one: the time machine

**What it is for.** A collision record says a corner is dangerous now. A year strip says people have
been writing about it since 2015 and nothing was done, which is a different argument and a better one
to put in front of a Supervisor. The file says exactly that at `src/timeline.js:1-13`.

| | |
|---|---|
| Endpoint | `POST https://api.exa.ai/search`, `src/timeline.js:47` |
| Query shape | `pedestrian safety OR crash OR traffic {corner name} {city}`, built by `searchQuery()` at `src/newsfilter.js:44-46` |
| Exa parameters | `type: "auto"`, `numResults: 5`, `startPublishedDate: "{year}-01-01T00:00:00.000Z"`, `endPublishedDate: "{year}-12-31T23:59:59.999Z"`, `contents: { text: { maxCharacters: 300 } }`, `src/timeline.js:52-56` |
| Calls per corner | One per year from `TIMELINE_FROM = 2014` (`src/timeline.js:39`) to the current year, issued in parallel (`src/timeline.js:92-102`). In 2026 that is 13 searches. |
| Cost per unit | 13 searches. At the reservation estimate of 0.7 cents a search (`src/store.js:491`) that is an estimated 9.1 cents a corner. The billed figure is whatever `costDollars.total` returns and is recorded at `src/timeline.js:61`. |
| Rails | `DAILY_TIMELINE_CAP = 40` new strips a day, reserved globally in KV before the build (`src/store.js:243`, `src/index.js:338-345`). Stored with no TTL, because a year that had coverage will always have had coverage (`src/store.js:258-263`). A failed build does not get its reservation refunded (`src/index.js:351-356`). |

The same query is re-run in each dated window, which is the whole trick: identical query, moving
`startPublishedDate` and `endPublishedDate`, so the only variable is time. Each year is counted using
the same relevance bar the live panel uses, corner level if any exists and corridor level otherwise
(`src/timeline.js:62-67`), so the strip is not counting a filter nobody can see.

The strip also carries a comparison the press lane cannot make on its own: the earliest collision the
city has on record at that corner, one keyless DataSF query over the whole dataset
(`src/timeline.js:30-38`). `sawItFirst` is set only when both years exist and coverage predates the
collision record, and is `false` rather than `null` when either side is missing, because a chip should
never appear on a maybe (`src/timeline.js:124-131`).

**What that comparison found, live at 2026-08-20T05:55Z from `/watchlist`:** the comparison has run at
**63 corners and none of them carry it**, because at every one the city's collision record already
starts in 2005, the first year the dataset covers (rendered by `src/watchlistpage.js:155`). The
feature reports the answer it found rather than the answer it was hoping for. That is the honest
outcome and it is on the public page.

### Mode two: the segment-cached burn

This is the frugal city-scale lane, `src/pressenrich.js`. It is the part of the integration that shows
engineering judgment rather than API usage, because the naive version of it works and costs roughly
four times as much.

The naive shape is one search per corner per lane. `src/pressenrich.js:3-7` names why that is wrong:
every corner on Mission Street runs its own Mission Street search and gets its own copy of the same
corridor coverage. So the lane escalates, and only moves to the next step when the previous one has
nothing.

**Step 1: the stored citywide sweep. Free.** `src/pressenrich.js:130-137`. The watchlist already read
this month's coverage and stored it. If the watchlist already found articles for this exact slug, the
candidate pool starts non-empty before a single call is planned. It only ever helps and it costs
nothing, so it is consulted first.

**Step 2: the per-street segment cache, seven day life.** `src/pressenrich.js:139-154`. A corner name
is split into its streets by `segmentsOf()` (`src/pressenrich.js:63-68`), so "19th and Mission"
segments to `19th` and to `mission`, and every other corner on either street reuses the stored result.
`SEGMENT_TTL_S = 7 * 24 * 3600` (`src/pressenrich.js:34`), stored per street at `press:segment:{street}`
(`src/store.js:698`). Seven days is long enough that a nightly batch pays for a street once a week and
short enough that a corridor in the news does not stay stale for a month (`src/store.js:695-697`).

One subtlety that matters at scale: a **stored empty segment is a result too** and is treated as warm
(`src/pressenrich.js:147-151`). Re-searching a street that came back empty every single night is
exactly the spend this cache exists to stop.

**Step 3: three dated windows on the crossing itself.** `src/pressenrich.js:182-191`. This is the only
query that is genuinely corner specific, so it is the only one that cannot be shared. Three windows,
not one per year: `2014-2019`, `2020-2023`, `2024-present` (`src/pressenrich.js:40-44`). The comment
at `src/pressenrich.js:36-39` gives the reason: a year strip cost eleven searches to answer a question
that reads the same at three, being the decade before Vision Zero's mid course reset, the pandemic
years, and now.

**Step 4: page contents, bought last, for the shortlist only.** `src/pressenrich.js:193-210`. This is
the other half of the saving and it is the step most integrations skip. **The searches in this lane
request no page text at all** (`src/pressenrich.js:172-174` and `182-188` carry no `contents` key).
A search that asks for text pays for text on every result including the ones the filter is about to
throw away. Instead candidates are ranked on title and url alone by `shortlistRank()`
(`src/pressenrich.js:103-109`), the top `SHORTLIST = 8` (`src/pressenrich.js:54`) are fetched in one
call to `POST https://api.exa.ai/contents` (`src/pressenrich.js:59`, `202-204`) with
`urls: [...]` and `text: { maxCharacters: 600 }`, and only then is the corner-level bar applied to
real text (`src/pressenrich.js:212-218`). `PUBLISH = 5` items are shown (`src/pressenrich.js:55`).

**Reserved as one plan, not one call at a time.** `src/pressenrich.js:156-169`: the whole plan, cold
segments plus three windows plus eight content pages, is reserved before the first call, because a
batch that checks its budget between calls has already overspent by the time it notices. A refusal
returns `source: "budget-deferred"` and is recorded as a deferral rather than as silence.

**Cost per corner, measured.** Four corners from the phase 2 measurement recorded at
`specs/HANDOFF.md:586-589`:

```
fillmore-and-lombard  5 searches + 8 pages  4.30c   both streets cold
eddy-and-mason        5 searches + 8 pages  4.20c   both streets cold
eddy-and-jones        4 searches + 8 pages  3.50c   eddy warm from the run above
eddy-and-mason        3 searches + 8 pages  2.90c   both streets warm
```

The cache is the difference between 4.30 cents and 2.90 cents on the same corner. The live per-corner
average across the whole burn is in section 4 and is lower than all four of these, because most
corners in a citywide sweep arrive with both streets already warm.

**Rails on the batch itself.** `PRESS_BATCH_PER_NIGHT = 100` and `PRESS_BATCH_PER_TICK = 6`
(`src/index.js:1084-1090`). The tick size is bounded by the platform and says so: a Worker invocation
may make 50 subrequests and a corner costs up to six calls to Exa, so six corners is 36. Audited
corners are excluded because their press lane already ran with their audit
(`src/index.js:1082-1083`, `1122`). Resumption is by stored record plus a checkpoint that carries the
reader's place in the rank (`src/index.js:1109-1114`, `1156-1169`).

### Mode three: the standing radar

Modes one and two are snapshots. The radar is the present tense: Exa Monitors hold the queries open
and push detections to the Worker as coverage appears (`src/radar.js:1-10`).

**Creation.** `POST https://api.exa.ai/monitors` (`src/index.js:945`), body
`{ name, search: { query, numResults: 5 }, webhook: { url }, metadata: { corridor, kind } }`
(`src/index.js:948-953`). The query shape is `{street} San Francisco pedestrian OR collision OR crash`
(`src/radar.js:40-41`) for corridors, plus four citywide meta queries (`src/radar.js:31-36`).

**Corridors, not corners, and derived rather than asserted.** `worstCorridors()`
(`src/radar.js:47-63`) sums each street's corners' points from the live rank rows and keeps the top
`CORRIDOR_LIMIT = 25` (`src/radar.js:38`), filtering out any street represented by a single corner,
because that is a corner and not a corridor (`src/radar.js:59`). A street-level query is the efficient
unit and the segment cache already proved it: every corner on Mission shares Mission's coverage
(`src/radar.js:22-24`).

**Creation lives in the Worker, not in a tool, and that is a scar.** `src/index.js:884-894`: the tool
version needed the webhook secret typed into a shell that has no terminal, so `read -rs` hit EOF, the
`&&` chain stopped, and nothing was created with no output to say so. `tools/create_monitors.mjs:6-15`
now marks itself deprecated for creation and useful only for `--dry`. `ensureMonitors()` is idempotent
and writes its outcome every time, success or not, because a run whose reason was thrown away looks
identical from the outside to a run that never happened (`src/index.js:895-902`). Creation proceeds in
parallel batches of 6 with a store after each batch, so a run that dies costs at most the batch it was
in (`src/index.js:923-928`, `937-975`).

**The webhook, treated as hostile input.** `src/index.js:982-991` states the posture and
`radarHook()` implements it:

1. **Shared secret in the path.** The secret is the last path segment of `/api/radar/hook/{secret}`,
   compared against `env.WEBHOOK_SECRET`, and a mismatch returns 404 rather than 403
   (`src/index.js:995-998`). The URL registered with Exa is built from the same variable
   (`src/index.js:935`).
2. **Monitor id this Worker created.** The payload's monitor id must be in the KV list this Worker
   wrote at creation time, or the request is refused with 403 (`src/index.js:1001-1006`,
   `src/store.js:960-966`). The comment at `tools/create_monitors.mjs:17-19` calls the stored list the
   second half of the authentication.
3. **Nothing in the payload is trusted after that.** Every article runs `judge()`
   (`src/radar.js:140-170`), which is the same deny list, the same `classify()` relevance filter and
   the same `isSafetyCoverage()` bar the rest of the press lane uses (`src/cred.js:32-36`).
4. **A detection can never cause an action.** A passing hit that names a graded corner is queued for a
   press re-check, not published on that corner (`src/index.js:1025-1047`). The Danger Index does not
   move because somebody wrote an article (`src/index.js:1062-1064`).
5. **An unrecognised payload shape is recorded, not dropped.** Exa's webhook payload shape is not
   documented anywhere this code can read, so `resultsFrom()` accepts several plausible shapes
   (`src/radar.js:64-88`) and anything else is stored at `radar:unknown` with a seven day TTL
   (`src/index.js:1008-1014`, `src/store.js:992-996`).

**No frequency is claimed.** The create API has no cadence, schedule or interval field, so this code
does not assert one (`src/radar.js:16-19`). What it can state is the observed lag between an article's
publish date and the moment the detection arrived, measured per hit by `lagHours()`
(`src/radar.js:102-108`) and reported as a median that excludes undated hits rather than counting them
as zero, with the exclusion count printed beside it (`src/radar.js:110-118`,
`src/radarpage.js:99-101`).

**`/radar` is the public instrument panel.** `src/radarpage.js:1-8`: the instrument is the argument.
The page shows monitors running, detections this week, how many cleared the filter, the measured
median lag, and cents spent today against the cap (`src/radarpage.js:93-105`). Filtered detections are
rendered in the feed alongside passing ones, each carrying its own rejection reason
(`src/radarpage.js:138-144`), for the same reason the watchlist publishes rejects. The 29 standing
queries are printed verbatim on the page (`src/radarpage.js:166`).

**The honest empty state, live at 2026-08-20T05:53Z from `/api/radar`:**

- 29 of 29 monitors created, 0 failed, `remaining: 0`, created at **2026-08-20T02:08:16.965Z**. That is
  25 corridor monitors plus 4 citywide meta monitors, matching `CORRIDOR_LIMIT = 25` and the four
  entries in `META_QUERIES`.
- **Feed empty. Zero detections.** The page renders "No detections yet. The monitors are running and
  nothing has been published about a watched corridor since they started" (`src/radarpage.js:150-152`).
  The monitors were three hours and forty-five minutes old at the time of measurement.
- Budget: `dayCents 0` of a 40 cent daily cap, `monthCents 0` of a 900 cent monthly cap,
  `paused: false` (`src/store.js:901-902`, `924-937`).

Two things must be said plainly about that zero. First, zero detections after under four hours is not
evidence the radar works or that it does not; it is a young instrument with nothing to show yet.
Second, `reserveRadar()` exists and is tested (`src/store.js:941-951`,
`tools/budgetcounters.test.mjs:531-588`) but **no production code path calls it**. `radarHook()` calls
`countRadarDetection()` and not `reserveRadar()` (`src/index.js:1023`). So `dayCents 0` is a true
reading of a counter that nothing currently charges, and it is not a claim that monitor delivery is
free. The declared caps are real and enforced by the function; the charging site is not yet wired.

### The discovery lane: the watchlist

Every lane above starts from a corner and asks what is written about it. This one runs the other way
(`src/press.js:1-20`). It is an entity-discovery workflow of the shape Exa's Websets product is built
for, implemented directly on the search API, which is what the event credits cover
(`src/press.js:18-20`).

**The queries.** `WATCHLIST_QUERIES` (`src/press.js:70-102`) is built from three groups: 16 citywide
phrasings, 3 restricted to local outlets, and 10 neighbourhood-anchored variants generated from
`NEIGHBOURHOODS` (`src/press.js:59-63`) with the safety term rotated so the set is not ten copies of
one query with the place name swapped. That totals **29**, which matches the live run.

**The call.** `POST https://api.exa.ai/search` with `type: "neural"`, `category: "news"`,
`numResults: 15`, `startPublishedDate` set to a 90 day window, and
`contents: { text: { maxCharacters: 800 } }` (`src/press.js:304-313`). Domain filtering runs in both
directions **at the API**, and the two are mutually exclusive by construction
(`src/press.js:314-316`): a general query carries `excludeDomains: EXCLUDE_DOMAINS`, the eight lead
generation and law firm domains at `src/press.js:39-43`; the local pass carries
`includeDomains: LOCAL_OUTLETS`, the twelve San Francisco outlets at `src/press.js:50-54` that
actually name a crossing. Excluding at the API means the result slots are spent on coverage instead of
on lead generation (`src/press.js:35-38`). The whole pass reserves its 29 searches up front
(`src/press.js:291`).

**Candidate extraction.** One regex, `PAIR` (`src/press.js:105-106`), proposes two street-ish names
joined by "and", "at" or "&". It is deliberately narrow because it only proposes. Two guards sit on
it: a `NOT_A_STREET` stop list (`src/press.js:110-133`) so a headline about "Safety and Enforcement"
is not a corner, and a **street context window** (`src/press.js:135-138`) requiring a road word within
70 characters either side. The comment at `src/press.js:120-132` explains why the second one exists:
page text from a news site is full of "Metro Areas and Our Cities" and "Development and Real Estate",
the index rejects every one, but a reject log full of navigation furniture reads as a broken extractor
rather than a careful one. There is one further trap closed at `src/press.js:159-162`: the pair itself
must not be what satisfies the context test, or a street named "Lane" would vouch for itself.

**Hard verification, in `verifyCandidate()` (`src/press.js:182-240`).** Three bars, each returning the
precise reason it failed:

1. **Both names are San Francisco streets**, checked against the city street index loaded once per
   pass rather than once per candidate (`src/press.js:192-207`, loaded at `src/press.js:298` with the
   reason at `src/press.js:295-297`: a per-candidate read that fails once disables the bar for the
   rest of the pass). `src/methodology.js:195` states that index holds 2,219 street names.
2. **The pair is an exact match in the graded intersections index**, one KV read, no geocoding and no
   external call (`src/press.js:215-218`). A pair of real street names with no graded crossing between
   them is a finding, and the reject says exactly that rather than claiming the street does not exist.
3. **The coverage is confirmed to be about safety at that crossing**, via `isSafetyCoverage()`
   (`src/press.js:220-229`, `src/cred.js:32-36`). Without this a redesign announcement listing six
   intersections in passing would put all six on a safety watchlist.

A corner already audited is rejected with its own reason, because a corner the site has done is not a
lead (`src/press.js:210-212`).

**Rejects are published.** Corner-shaped rejects are returned with their reasons and rendered on
`/watchlist` (`src/press.js:366-371`). Phrases that named no street at all are counted but not listed,
because a page of "Metro Areas and Our Cities" teaches a reader nothing (`src/press.js:372-375`). The
stated principle: a discovery pipeline that publishes only its hits is indistinguishable from a search
box with good luck (`src/press.js:14-17`).

**Live funnel, `/api/watchlist`, built 2026-08-19T13:11:21.576Z, read 2026-08-20T05:53Z:**

| Stage | Count |
|---|---|
| Searches issued | 29 |
| Window | 90 days |
| Articles read | 117 |
| Verified entries surfaced | 5 |
| Corner-shaped rejects published | 7 |
| Phrases discarded before the reject list | 25 |

The seven published rejects, from `/watchlist` at 2026-08-20T05:55Z, are the interesting half:
`Church and Market` was named in an article not about safety there; `Geneva and Mission` is already
audited; and `2nd and 4th`, `16th and 24th`, `8th and 9th`, `Greenwich and Lombard` and
`Hudson and Woodside` are pairs of real San Francisco streets with no graded crossing between them.

### `findSimilar`, for press connections

`buildConnections()` (`src/press.js:386-470`) asks a question no dataset can: given the reporting about
this corner, what else is being written in the same breath. `POST https://api.exa.ai/findSimilar`
(`src/press.js:33`) with `url` set to the corner's own best story, `numResults: 10`,
`excludeSourceDomain: false`, `excludeDomains: EXCLUDE_DOMAINS`, and
`contents: { text: { maxCharacters: 800 } }` (`src/press.js:392-398`). One call, reserved as one
search (`src/press.js:388`).

Connecting two corners is a stronger claim than naming one, so two bars apply that the watchlist does
not need (`src/press.js:411-413`):

- **The result must be a dated article.** An undated result with a bare path is a site homepage, and
  the comment records how that was found: "Welcome to Westside Observer" became a citation
  (`src/press.js:415-422`, homepage path check at `src/press.js:432-437`).
- **The coverage must be recent.** `CONNECTION_MAX_AGE_MS` is three years (`src/press.js:144`), because
  the claim is that the press writes about these two corners in the same breath, and a 2007 blog post
  is not the same breath as anything (`src/press.js:140-143`, `src/press.js:424-431`).

A surviving link is written to **both** corners, so the claim reads the same from either page rather
than existing only where it was found (`src/press.js:473-493`, written by
`tools/build_connections.mjs:103-109`, which only ever overwrites a reciprocal record and never a
corner's own).

A second `findSimilar` lane, `src/suggest.js:29-37`, produces the board's "related corner worth
auditing" lead with `numResults: 10` and `contents: { text: { maxCharacters: 500 } }`. It is labeled a
suggestion everywhere it appears and runs no pipeline, because auto-auditing whatever a headline
mentioned would spend billed generations on a regex's opinion (`src/suggest.js:6-11`). Its arbiter is
DataSF's own intersection table rather than the KV index (`src/suggest.js:56-58`).

### Every Exa capability used, with the parameter that uses it

| Capability | Parameter | Where |
|---|---|---|
| Neural search | `type: "neural"` | `src/press.js:306` |
| Auto search type | `type: "auto"` | `src/pressenrich.js:173`, `src/pressenrich.js:184`, `src/timeline.js:52`, `src/index.js:476` |
| News category | `category: "news"` | `src/press.js:307` |
| Result count control | `numResults` 15 / 8 / 6 / 5 | `src/press.js:308`, `src/index.js:475`, `src/pressenrich.js:56`, `src/timeline.js:44` |
| Date-window search | `startPublishedDate` | `src/press.js:309`, `src/pressenrich.js:185`, `src/timeline.js:54` |
| Date-window search | `endPublishedDate` | `src/pressenrich.js:187`, `src/timeline.js:55` |
| Domain allow list | `includeDomains` | `src/press.js:315` |
| Domain deny list | `excludeDomains` | `src/press.js:316`, `src/press.js:396` |
| Contents inside search | `contents: { text: { maxCharacters } }` 800 / 500 / 400 / 300 | `src/press.js:310`, `src/suggest.js:36`, `src/index.js:477`, `src/timeline.js:56` |
| Standalone contents fetch | `POST /contents` with `urls: [...]`, `text: { maxCharacters: 600 }` | `src/pressenrich.js:59`, `src/pressenrich.js:202-204` |
| Similarity search | `POST /findSimilar` with `url`, `excludeSourceDomain` | `src/press.js:33`, `src/press.js:392-398`, `src/suggest.js:29-37` |
| Standing monitors | `POST /monitors` with `search`, `webhook`, `metadata` | `src/index.js:945-953` |
| Per-response cost reporting | `costDollars.total` | `src/press.js:255`, `src/press.js:268`, `src/pressenrich.js:89`, `src/timeline.js:61`, `src/suggest.js:41`, `src/index.js:486`, `src/index.js:1211` |
| Credit exhaustion signal | HTTP 402 handled distinctly | `src/press.js:252`, `src/press.js:265`, `src/pressenrich.js:86`, `src/index.js:480` |
| Websets refusal as a diagnostic | `GET /websets/v0/websets`, team name parsed from the refusal | `tools/exa_probe.mjs:53-56` |

The nested `contents.text` shape is not cosmetic. A flat `text` field is rejected by the API, which the
README records at `README.md:52`.

---

## 3. One ledger

**Spend is metered, not estimated.** Exa returns `costDollars` on every response, so the spend on this
feature is a measured number (`src/store.js:629-632`). Every call site records it. There is no lane
that spends without writing to the ledger, including the per-page lane, which is metered even though it
is not reserved, because it spends the same balance and a counter that ignores it is not the truth
(`src/index.js:483-486`).

**Reserved before, reconciled after, cap enforced on the higher of the two.** `src/store.js:479-484`
states the rule and `reserveExa()` implements it (`src/store.js:611-627`): `used = Math.max(spentCents,
reservedCents)`, and a request that would push `used + cost` past the cap increments a deferral counter
and returns false rather than throwing. `exaBudget()` reports `usedCents` the same way
(`src/store.js:577`). An estimate running ahead of the measurement can only make the meter more
cautious.

**The counter is cent-denominated.** `src/store.js:474-477`: the thing that runs out is a balance and
not a call count, and a search and a page of contents cost different amounts, so counting calls priced
them the same and was wrong in both directions at once. The constants are `EXA_CAP_CENTS = 6500`,
`EXA_SEARCH_CENTS = 0.7`, `EXA_CONTENTS_CENTS = 0.1`, period `2026-08`
(`src/store.js:489-492`). A stored cap never outranks the deployed one and a new period starts a new
counter rather than inheriting the last (`src/store.js:528-531`).

**Prior spend is carried, not erased.** `EXA_PRIOR_SPEND_USD = 1.269` over `EXA_PRIOR_CALLS = 783`
(`src/store.js:498-499`), because the dashboard's remaining balance is the prior spend plus this
counter, and saying so is the only way the two figures can ever be reconciled
(`src/store.js:494-497`).

### The real figures, read from `/status` at 2026-08-20T05:55Z

| Figure | Value |
|---|---|
| Period | 2026-08 |
| Workspace | Alex Schroeder, confirmed, observed 2026-08-19 |
| Spent this period | **$12.5990** of **$65.00** |
| Reserved units this period | 1,228 searches, 2,552 pages of contents |
| Spend all time | **$13.8680**, of which **$1.2690** predates this counter |

Two checks a judge can do on those numbers without leaving this page:

- `13.8680 - 1.2690 = 12.5990`, so the all-time figure and the period figure agree.
- The reservation estimate implied by the unit counters is
  `1228 * 0.7 + 2552 * 0.1 = 859.6 + 255.2 = 1114.8` cents, or **$11.1480**. Measured spend is
  **$12.5990**, which is higher. That gap is expected and is not a discrepancy: `searches` and
  `contentPages` are incremented only inside `reserveExa()` (`src/store.js:623-624`), while
  `recordExaSpend()` adds measured cents from every lane including the three that meter without
  reserving, being the per-page press lane (`src/index.js:486`), the timeline
  (`src/timeline.js:61`) and the board suggestion (`src/suggest.js:41`). Because the cap binds on the
  higher of the two, the meter is currently governed by the measured figure, which is the correct
  behaviour.
- Remaining against the cap: `6500 - 1259.90 = 5240.10` cents, or **$52.4010**.

---

## 4. The hit-rate curve

The burn reports three things: corners checked, corners where coverage was found, and the rate. All
three are written from the runs themselves, `getBurnCheckpoint` / `putBurnCheckpoint`
(`src/store.js:751-759`) for the run, and `press:rollup` (`src/store.js:727-745`) for the calendar
month.

**The burn was still running at the time of measurement.** `/status` rendered "Press scan, running
now", which the page only shows while a run is actively reporting progress (`src/status.js:151-159`,
liveness note at `src/status.js:174-178`). Figures below are stamped and they will have moved.

### The burn run, read from `/status` at 2026-08-20T05:55Z

| Figure | Value |
|---|---|
| Corners checked | 318, over 17 chunks |
| Coverage found | 304 of 318 |
| Hit rate | 95.6% |
| Searched and nothing found | 14 |
| Spent by this run | $10.9920 |
| Last progress reported | Aug 19, 10:46 PM PT |

The arithmetic, shown rather than asserted:

```
hit rate        304 / 318            = 0.955975  -> 95.6%
empty           318 - 304            = 14
cost per corner $10.9920 / 318       = $0.034566 -> 3.46 cents
```

`/api/radar` reports the same pair independently at the same moment: `burnChecked 318`,
`burnHitRate 95.6`, computed at `src/index.js:2003` and `src/index.js:2025`.

**3.46 cents a corner is a measured average, not an estimate.** It is lower than every one of the four
individually measured corners recorded at `specs/HANDOFF.md:586-589` (4.30c, 4.20c, 3.50c, 2.90c),
which is what the segment cache predicts: in a citywide worst-first sweep most corners arrive with both
of their streets already warm, so they pay for three dated windows and one contents call rather than
five searches.

### The month rollup, read from `/watchlist` at 2026-08-20T05:55Z

| Figure | Value |
|---|---|
| Corners press-checked this month | 346 |
| With coverage found | 330 |
| Searched and nothing found | 16 |

These are deliberately different populations and must not be added together. The burn checkpoint counts
this run (`src/index.js:1159-1169`). The rollup counts every press record written in the calendar month
`2026-08` regardless of which run wrote it (`src/store.js:732-733`), which includes corners checked by
`tools/press_batch.mjs` before this run started. The differences are `346 - 318 = 28` corners and
`330 - 304 = 26` with coverage.

### What the rate does and does not mean

A 95.6% hit rate is not a statement that 95.6% of San Francisco corners are in the news. The burn walks
the citywide rank worst first (`src/index.js:1116-1127`), so it is asking the most-covered end of the
city first, and most of what it finds is corridor level rather than corner level. The operator tool
encodes an expectation that the rate will fall: `DRY_CHUNKS = 3` and `DRY_RATE = 0.05`
(`tools/press_batch.mjs:44-48`) stop the run after three consecutive chunks where almost nothing has
coverage, because the press signal is finite and the honest move is to stop and say where. That stop
condition has not fired as of this measurement.

`/radar` prints the burn rate next to the radar's own rate with an explicit warning not to read them as
one number, because the worst corners in the city and this week's news are not one population
(`src/radarpage.js:107-113`, `src/index.js:1993-1995`).

**One number this document does not have:** the burn's own citation count and per-corner cost
distribution are stored in `press:rollup.costUsd` and `press:rollup.citations`
(`src/store.js:740-742`) but neither is exposed on any public endpoint, so they are not reported here.

---

## 5. The attribution badge

**Where "Press via Exa" renders.** It is a tag in the press lane's panel header on every corner page,
carrying the Exa mark: `src/page.js:1520`. The same tag appears on the press scan card on `/status`
(`src/status.js:160`) and above the detections feed on `/radar` (`src/radarpage.js:116`). Every
headline in the panel renders its outlet domain and publish date and links out
(`README.md:60`), so any claim on the page can be checked in one click.

**The lane tag states which lane produced the record.** A stored batch record carries
`lane: "press-checked"` (`src/pressenrich.js:243`), and the client reads that flag
(`src/page.js:2241`) to set the tag to "press coverage, found and cited" (`src/page.js:2244`).

**The honesty rule: a press-checked corner keeps its tier.** This is enforced in three places that
have to agree:

1. **On the record.** `src/pressenrich.js:241-243`: "Not an audit. This corner keeps its tier and gains
   a press section, and the label travels with the record so no surface can imply otherwise."
2. **On the corner page.** Whenever `lane === "press-checked"`, a note is appended under the panel
   reading "Press checked in a batch run against the city's coverage. This corner keeps its tier: the
   visual audit has not run here, and being press checked does not make a corner audited."
   (`src/page.js:2002-2007`).
3. **On the methodology page.** `src/methodology.js:181-183`: the imagery panel keeps its honest
   pending state, and the audited count on the homepage does not move because a corner was press
   checked.

The counts confirm it. Read live at 2026-08-20T05:53Z: `/api/board` returns **24** corners on the
roster while the masthead reads **7,355 SF intersections scored** and the homepage subtitle reads
**23 fully audited**. 346 corners have been press-checked this month and the audited figure is 23.
Press checking moved neither number.

**Three states, three different sentences.** The lane distinguishes not-checked from checked-and-empty,
which is the distinction most sites collapse:

- Never checked: "Press coverage has not been searched at this corner yet", with the tag set to
  "not yet checked" (`src/page.js:2230-2236`). A lane that has not run is not a lane that found
  nothing.
- Checked and empty: "Searched and nothing found. N articles were read across M searches and none was
  about safety at this crossing" (`src/page.js:1995-1998`), from a stored record with
  `source: "empty"` (`src/pressenrich.js:264-268`).
- Checked with coverage: the panel, plus the tier note above.

The watchlist page states the same rule in aggregate (`src/watchlistpage.js:87-93`), including that
the corners searched with nothing found are "stored and shown as a result rather than as a gap".

---

## 6. Honest limits

**Search recall is not ground truth.** The site says "coverage we can find" and never "first report".
`src/timeline.js:11-13`: an empty year means this search found nothing that year, not that nothing
happened. `sawItFirst` is set only when both a coverage year and a collision year exist
(`src/timeline.js:124-131`). The consequence is visible in public: as of 2026-08-20T05:55Z the
comparison has run at 63 corners and **none** carry the claim, because the city's collision record
starts in 2005 at every one of them, and `/watchlist` says so in those words
(`src/watchlistpage.js:155`).

**The shortlist can miss a story that names the corner only in its body.** The burn lane ranks
candidates on title and url alone (`src/pressenrich.js:105-109`) and buys page text only for the top 8
(`src/pressenrich.js:200-204`). A story that names the crossing solely in paragraph nine may never be
fetched and so can never be verified. This is stated in the source at `src/pressenrich.js:18-24` and on
the methodology page, and it is a deliberate trade: the lane errs toward showing less rather than
toward spending on text it will discard.

**Corridor-level coverage is labeled as such, never claimed as corner-level.** A result counts as
corner level only when its title or url carries every street token (`src/newsfilter.js:59-61`). The
panel claims corner-level precision only when at least three results clear that bar
(`src/pressenrich.js:216-218`, `src/index.js:490-493`), and below that the heading reads "Coverage of
this corridor" (`src/pressenrich.js:273`, `src/index.js:541`). In practice most live headlines are
corridor level, and `README.md:54` says so. The radar applies the same rule: a corridor match is not a
corner match, and a story about Mission Street does not become a citation on forty Mission crossings
(`src/radar.js:119-135`).

**The radar has no measured lag yet, and no frequency can be promised.** The feed is empty as of
2026-08-20T05:53Z, so the median publication-to-detection figure the page is built to show renders as
`n/a` (`src/radarpage.js:99-101`). Exa's create API exposes no cadence field, so the page states that
delivery timing is Exa's and not something this page can promise (`src/radarpage.js:82-84`,
`src/radar.js:16-19`).

**The radar's cent counters are declared but not charged.** `reserveRadar()` exists, enforces both
caps, and is tested (`src/store.js:941-951`, `tools/budgetcounters.test.mjs:531-588`), but no code path
in `src/` calls it. `radarHook()` counts detections and not cents (`src/index.js:1023`). The `0 of 40
cents today` reading on `/radar` is therefore a true reading of an uncharged counter, not a measurement
of what standing monitors cost.

**The per-page press lane is metered but not capped.** `getNews()` records its measured spend
(`src/index.js:486`) but never calls `reserveExa()`, and the comment at `src/store.js:465-470` says
this is deliberate: that lane is bounded by traffic and the edge cache, and it is the lane a visitor is
waiting on. The consequence is that visitor traffic can spend past `EXA_CAP_CENTS`. Only the fan-out
lanes are refused at the cap. Anyone reading the ledger should know which half of it is governed.

**The webhook payload reader is written against an undocumented shape.** `resultsFrom()` guesses among
six plausible payload shapes (`src/radar.js:74-88`). Nothing has yet arrived to confirm which one Exa
sends, because the feed is empty. Unrecognised payloads are stored rather than dropped
(`src/index.js:1008-1014`), which is the right posture and is not the same thing as knowing.

**Documentation that is currently stale, stated so a judge is not misled.** The live system has moved
past three published figures:

| Stale claim | Where | Live truth, as of 2026-08-20T05:55Z |
|---|---|---|
| "Seven citywide semantic searches" | `README.md:66`, `src/methodology.js:189` | 29 searches, from `WATCHLIST_QUERIES` (`src/press.js:70-102`) and confirmed by `/api/watchlist` `calls: 29` |
| "104 articles across 7 searches, 4 corners, 7 rejects, 22 discarded" | `README.md:68`; a related figure at `specs/MAKE_THEM_KNOW.md:67-68` | 117 articles across 29 searches, 5 verified, 7 rejected, 25 discarded |
| "a hard 1,500-call ceiling" | `README.md:72` | The ceiling is cent-denominated: `EXA_CAP_CENTS = 6500`, that is $65.00 (`src/store.js:489`) |

Those files are under a feature freeze and were not edited by this document. The figures in this
document supersede them.

---

## Reproducing every live figure in this file

No credentials are needed. The live Worker is public and these are all reads.

```
curl -s https://streetcred.thealexschroeder.workers.dev/api/radar        # monitors, feed, radar budget, burn rate
curl -s https://streetcred.thealexschroeder.workers.dev/api/watchlist    # the discovery funnel
curl -s https://streetcred.thealexschroeder.workers.dev/api/board        # roster count
curl -s https://streetcred.thealexschroeder.workers.dev/status           # the ledger and the burn scan card
curl -s https://streetcred.thealexschroeder.workers.dev/watchlist        # the month rollup and the reject list
```

One caution for anyone reproducing this: `/api/news?x={slug}` for a corner that has no stored press
record runs a live Exa search and bills it (`src/index.js:2281-2287`, `src/index.js:469-486`). The five
commands above are all free.

The unit tests that pin the budget behaviour described in section 3 run with no credentials and no
`package.json`:

```
node --test tools/budgetcounters.test.mjs tools/exabudget.test.mjs tools/press.test.mjs tools/radar.test.mjs
```

Run from the repository root on 2026-08-20T06:00Z with Node v26: **64 tests, 64 pass, 0 fail**. They
cover the cent meter, the reserve-then-reconcile rule, the cap enforced on the higher of reserved and
spent, the day and month counters rolling independently, the candidate extractor, the verification
bars, and the webhook payload reader.
