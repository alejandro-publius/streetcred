# Methodology sync: the live /methodology page against the code, 2026-08-19

What this file is: a line by line diff between the prose served at
`https://streetcred.thealexschroeder.workers.dev/methodology` and what
`src/` actually does on 2026-08-19. It changes nothing. A feature freeze is in
force until 2026-08-25 and `src/methodology.js` is untouched. Everything below
is written so the post-freeze edit is mechanical: find the line, paste the
replacement.

**How this was measured.** The live page was fetched with
`curl -s https://streetcred.thealexschroeder.workers.dev/methodology`.
`src/methodology.js` was read in full, then `src/score.js`, `src/data.js`,
`src/pressenrich.js`, `src/press.js`, `src/radar.js`, `src/store.js`,
`src/hazards.js`, `src/verify.js`, `src/city.js`, `src/timeline.js`,
`src/imagery.js`, `src/voices.js`, and the routing, cron and letter branches of
`src/index.js`. Counts that live in KV were re-derived locally from the
committed artifacts (`sweep-results.json`, `sweep-distribution.json`,
`data/city/twins.json`, `data/city/meta.json`) using the same
`parseQuery` the builder uses, and cross-checked against the live
`/api/city`, `/api/board`, `/api/watchlist`, `/api/radar` and
`/api/connections`. No paid API was called. For the two-radius derivation at
6th and Mission, see `docs/COUNTS.md` rather than repeating it here.

**Line numbers** are `src/methodology.js` as committed at `f925d0b`. The file is
282 lines; the prose runs 60 to 275.

---

## The single edit that matters most

Line 189: **"Seven citywide semantic searches run each morning through Exa"**.
The code runs **29** (`src/press.js:70-97`, and the live `/api/watchlist`
reports `calls: 29`). This is the sentence a judge at an Exa event reads to find
out how the product uses Exa, and it undersells the discovery pass by a factor
of four while the `/watchlist` page one click away lists all 29 queries by name.
The damage is not the missing 22 searches. It is that the page whose opening
promise is "the file is the authority and this page is the explanation" is
visibly not tracking the file. Fix that sentence first.

---

## The diff

| CLAIM (quoted from the page) | LOCATION | STATUS | WHAT THE CODE ACTUALLY DOES |
|---|---|---|---|
| "Seven citywide semantic searches run each morning through Exa" | 189 | **STALE** | 29 queries: 16 citywide phrasings, 3 restricted to local outlets, 10 neighbourhood-anchored, built at `src/press.js:70-97` from `LOCAL_OUTLETS` (`src/press.js:50-54`) and `NEIGHBOURHOODS` (`src/press.js:59-62`). Evaluated: `WATCHLIST_QUERIES.length === 29`. Live `/api/watchlist` reports `calls: 29`, `queries: 29`, built 2026-08-19T13:11:21Z. |
| "one pass restricted to San Francisco outlets that write at corner resolution" | 190-191 | **STALE** | Three passes carry `includeDomains: LOCAL_OUTLETS` (`src/press.js:89, 90, 91`). Live `/api/watchlist` shows 3 of 29 query records with `local: true`. |
| (nothing on the page about neighbourhood-anchored queries) | 189-193 | **MISSING** | Ten of the 29 are one per neighbourhood with a rotating safety term (`src/press.js:94-96`), which is the half of the query set that finds corner-resolution stories at all. |
| "One KV read against the same 7,353 corner index the site grades from" | 199-200 | **STALE** | 7,355. `data/city/meta.json` `totalScored: 7355`; live `/api/city` returns `"total":7355`. Re-derived locally from `sweep-results.json` (7,353 rows) plus the two crossings split out by `data/city/twins.json`: 7,357 shard rows, 2 of them alias rows, 7,355 distinct places (`tools/build_city_shards.mjs:88-135`). |
| "packs the 7,353 corners with recorded harm into 71 KV bundles ... largest bundle 175 KB" | 131-132 | **STALE in part** | 7,355, not 7,353. The rest is CURRENT: `data/city/meta.json` has `shardCount: 71` and `largestShardBytes: 179643`, which is 175.4 KB, key `c`. |
| "would be 7,353 writes to publish the city and 7,353 more to correct it" | 133-134 | **STALE** | Same figure, same fix: 7,355. |
| "of 23 audited corners, four have a connection" | 218-219 | **CURRENT TODAY, HARDCODED** | Literal text in the template, not interpolated: `METHODOLOGY` takes only `(origin, preview, scored)` (`src/methodology.js:18`). Correct at this hour: live homepage says "23 fully audited", and of the 24 roster slugs on `/api/board`, exactly four return a live non-reciprocal connections record (`16th-mission`, `fulton-and-masonic`, `mission-and-silver`, `19th-and-mission`). It goes wrong at 06:10 Pacific tomorrow, when the daily cron promotes a 24th corner (`src/index.js:1713-1733`). |
| (the count omits reciprocals) | 218-219 | **INCOMPLETE** | Three further corners carry a connection record written from the other end (`grant-and-jackson`, `fulton-and-park-presidio`, `18th-and-potrero`, all `reciprocal: true` on `/api/connections`). They are not audited corners, so the sentence is not false, but seven corners carry a connection, not four. Reciprocal writes are at `src/press.js:475-493` and `src/index.js:1684-1688`. |
| "the connecting article must be dated ... and must be recent" | 216-218 | **INCOMPLETE** | Three bars in code, not two: undated (`src/press.js:419-422`), older than `CONNECTION_MAX_AGE_MS`, which is three years (`src/press.js:144`, checked at `:428`), and a bare-path URL, which is a site homepage (`src/press.js:432-436`). The page folds the third into a parenthetical on the first, and never says how recent "recent" is. |
| "It is implemented directly on Exa's search API, which is what the event credits cover." | 210-211 | **STALE** | Three Exa endpoints are in production: `POST /search` (`src/press.js:32`, `src/pressenrich.js:58`), `POST /findSimilar` (`src/press.js:33`), and `POST /monitors` (`src/index.js:945`). `POST /contents` is a fourth (`src/pressenrich.js:59`). The sentence was true before the radar shipped. |
| (nothing on the page about the press radar) | whole page | **MISSING** | `src/radar.js` (170 lines), the webhook at `src/index.js:992-1049`, monitor creation at `src/index.js:895-977`, the budget rails at `src/store.js:901-990`, and the `/radar` page (`src/radarpage.js`). The only trace on the methodology page is a footer link reading "Press radar". Live `/api/radar`: 29 monitors created, 0 failed, created 2026-08-20T02:08:16Z, feed empty. |
| "AUDITED: every evidence lane has been checked here. Records, press, resident accounts and the visual audit have all run, and the corner has its two generated imagery states." | 139-141 | **OVERCLAIMS** | `tierOf` reads the imagery states and nothing else: AUDITED iff `states` includes both `hazards` and `fix` (`src/city.js:52-62`), and the cron's roster lane promotes on the same test (`src/index.js:1719-1721`). The other lanes running is a fact about the order the cron runs them in, not a condition the tier enforces. `1st-and-bush` is the live proof: every other lane ran on 2026-08-19 and it renders ENRICHED because imagery came back partial. |
| "That is about a dozen paged requests" | 126 | **STALE** | Three. `PAGE = 50000` (`tools/sweep.mjs:38`) and the three pulls returned 14,390 collisions, 45,458 311 reports and 18,546 intersection legs (`sweep-distribution.json` `rows`), each under one page, and the loop breaks when a batch is short of the page size (`tools/sweep.mjs:62`). A fourth pull happens in `tools/sweep_districts.mjs:29`. |
| "instead of the roughly 25,000 API calls one query per corner would cost" | 126-127 | **CURRENT** | Three queries per corner (`src/score.js:124-128`) over 8,254 crossings is 24,762. |
| "buckets every row into a 100 meter grid" | 124-125 | **CURRENT** | `CELL_M = 100` (`tools/sweep.mjs:146-148`). |
| "counts within 80 meters of each of the 8,254 crossings" | 125-126 | **CURRENT** | `SCORE_RADIUS = 80` (`src/score.js:13`); census size 8,254 (`sweep-distribution.json` `rows.crossings`, `src/distribution.js:543`). |
| "sweep_districts.mjs then places each corner in a Supervisor district by the majority of collision rows within 150 meters, using the same vote the live resolver uses" | 128-130 | **CURRENT** | `DISTRICT_RADIUS_M = 150` (`tools/lib/districts.mjs:18`); the live path takes the same grouped majority within `c.radiusMeters` (`src/index.js:216-235`). |
| "18,546 legs collapse to 8,254 crossings" | 71-72 | **CURRENT** | `sweep-distribution.json` `rows: {legs: 18546, crossings: 8254}`; the collapse rule is at `tools/sweep.mjs:104-115`. |
| "Traffic Crashes ... `ubvf-ztfx` ... nothing is copied into our store except computed counts" | 66-68 | **CURRENT** | `DS_CRASHES = "ubvf-ztfx"` (`src/score.js:8`); shard rows carry `counts` and `points` only (`tools/build_city_shards.mjs:62-71`). |
| "311 Cases, DataSF dataset `vw6y-z8j6`" | 69 | **CURRENT** | `src/score.js:9`. |
| "Street View imagery from Google, one photograph per corner" | 73-74 | **CURRENT** | One `maps/api/streetview` fetch per corner (`src/imagery.js:71-76`), plus two derived states written separately (`src/imagery.js:118-125`). |
| "Resident accounts scraped ahead of time by Apify actors from public reviews and forums" | 75-76 | **CURRENT** | Two actors, `compass~crawler-google-places` and `trudax~reddit-scraper-lite` (`src/voices.js:29-30`), started ahead of the page load (`src/voices.js:3-13`). |
| "The displayed statistics count within 150 meters ... The Danger Index grade counts within 80 meters" | 80-82 | **CURRENT** | Live stats use `c.radiusMeters`, which is 150 for every corner (`src/index.js:201`, `src/data.js:13, 99`); the grade uses `SCORE_RADIUS = 80` (`src/score.js:13, 93`). The letter is instructed to state both in the sentence that first cites a count (`src/index.js`, letter prompt). Derivation of the resulting 9 vs 11 gap at 6th and Mission is in `docs/COUNTS.md`. |
| The 311 allow list, rendered verbatim | 88-90 | **CURRENT** | Rendered live from `SERVICE_NAMES` (`src/data.js:51-61`), shared by the score (`src/score.js:96`) and the stats lane (`src/index.js:207`). Nine categories. |
| "inflated one corner's count from 354 to 8,546 ... wrong by a factor of 24" | 92-94 | **HISTORICAL, UNVERIFIED HERE** | The same figures appear in `src/data.js:47-50` and `src/score.js:109-111`. This is a claim about a bug that predates the current code; it cannot be re-measured from the repo, only from those comments. |
| The formula block | 97-99 | **CURRENT** | `WEIGHTS` 10/6/3/1/2 (`src/score.js:22`), `MAINTENANCE_PER_REPORT = 0.05` and `MAINTENANCE_CAP = 8` (`src/score.js:30-31`), summed at `src/score.js:33-46`. |
| "Collisions over five years, filtered 311 over twelve months, within 80 meters" | 100 | **CURRENT** | `yearsAgo(5)` and `yearsAgo(1)` inside `within_circle(..., 80)` (`src/score.js:85-86, 92-116`). |
| "all 8,254 real crossings ... frozen in `src/distribution.js`" and the shape figures | 106-111 | **CURRENT** | All five figures are interpolated from the frozen array, not typed: n 8,254, 629 zeroes, median 3.1, p90 29, max 196.9 (`src/methodology.js:12-16` over `src/distribution.js`). The maximum belongs to 6th and Mission: live `/api/city` returns it first with `points: 196.9`. |
| "A below the 40th percentile, B to the 64th, C to the 79th, D to the 92nd, F at 93 and above" | 112-113 | **CURRENT** | `gradeFor` (`src/score.js:73-79`). |
| "The index is capped at 99 because no corner is worse than itself." | 113-114 | **CURRENT** | `Math.min(99, ...)` (`src/score.js:68`). |
| "It replaced a 600-sample estimate that agreed with it to within a point or two (both medians 3.1)." | 115-116 | **CURRENT** | Same claim, same figure, at `src/score.js:48-53`. Not independently re-measurable: the sampler was deleted with the seed. |
| "The builder refuses to run if the committed census artifact and the frozen array ... have drifted apart" | 134-136 | **CURRENT** | Throws on length mismatch (`tools/build_city_shards.mjs:41-46`). |
| "ENRICHED: records and index checked and stored, no visual audit yet" | 142-143 | **CURRENT** | Matches `TIER_NOTE.enriched` (`src/city.js:41-45`). |
| "SCORED: graded against the citywide census, no lane checked beyond the official record" | 143-144 | **CURRENT** | Matches `TIER_NOTE.scored` (`src/city.js:41-45`). |
| "A SCORED grade uses the identical formula and census as an AUDITED grade" | 145-146 | **CURRENT** | Shard rows are scored by importing `pointsFor`, `percentileOf` and `gradeFor` from `src/score.js` (`tools/build_city_shards.mjs:27, 60-62`). |
| "A SCORED corner's numbers are as of the sweep date, which is printed under its tiles" | 149-151 | **CURRENT** | `source: "sweep"`, `asOf: sweepDate` (`src/city.js:211-214, 238-239, 281-282`), captioned "within {radiusM}m, as of {sweepDate}" (`src/city.js:272`). |
| "a swept corner's tiles count within 80 meters over twelve months of 311, where a live corner's tiles count within 150 meters over three years" | 155-157 | **CURRENT** | Swept: 80m, 12 months of 311 (`tools/sweep.mjs`, `src/score.js:85-116`). Live: `radiusMeters` 150, 311 over 3 years, collisions over 5 (`src/index.js:201-215`, `reports311Window: "3 years"` at `:245`). |
| "The stored citywide sweep first." | 165-167 | **CURRENT** | `getWatchlist` consulted before any call is planned, free (`src/pressenrich.js:130-137`). |
| "One stored entry per street, good for seven days" | 167-168 | **CURRENT** | `SEGMENT_TTL_S = 7 * 24 * 3600` (`src/pressenrich.js:34`), read at `:141-154`. A stored empty segment counts as warm (`src/pressenrich.js:147-151`). |
| "three dated windows ... 2014 to 2019, 2020 to 2023, and 2024 to now" | 169-171 | **CURRENT** | `WINDOWS` exactly, keys `2014-2019`, `2020-2023`, `2024-present` (`src/pressenrich.js:40-44`). |
| "A search per year cost eleven calls to answer a question that reads the same at three." | 171-172 | **HISTORICAL** | The same claim sits in the code comment at `src/pressenrich.js:36-39`. Not re-measurable from the repo. |
| "Page text is bought last and only for what might be published." | 173-178 | **CURRENT** | Searches carry no `contents` (`src/pressenrich.js:172-191`); one `POST /contents` for at most `SHORTLIST = 8` urls (`src/pressenrich.js:54, 200-210`). |
| "Searched and empty is stored and shown as a result" | 179-180 | **CURRENT** | Returns `source: "empty"` with the funnel counts attached rather than nothing (`src/pressenrich.js:266-268`). |
| "A press-checked corner is not an audited corner. It keeps its tier and gains a press section." | 181-183 | **CURRENT** | `lane: "press-checked"` travels with the record (`src/pressenrich.js:240-242`); the roster only moves in the cron's promotion lane (`src/index.js:1713-1733`). |
| "with the news category, a published date window" | 189-190 | **CURRENT** | `category: "news"`, `startPublishedDate` from a 90 day window (`src/press.js:288, 301, 306-309`). Live `/api/watchlist` reports `windowDays: 90`. |
| "lead-generation domains excluded at the API" | 190 | **CURRENT with a caveat** | `EXCLUDE_DOMAINS` is sent on 26 of the 29 (`src/press.js:39-42, 314-316`). The three local passes send `includeDomains` instead, because include and exclude are mutually exclusive at the API, so nothing outside the outlet list can come back anyway. The page's sentence reads as though all 29 carry the deny list. |
| "the same extractor the related-corner lead and the connections pass use" | 191-192 | **CURRENT** | `candidatesFrom` is exported once (`src/press.js:149`) and used by the watchlist (`:335`), the connections pass (`:439`) and the homepage lead (`src/suggest.js:48`). Note the radar is a fourth lane and does not use it: it matches on both street tokens appearing in the text (`src/radar.js:126-135`). |
| "Checked against the 2,219 street names in the graded city index" | 195-196 | **CURRENT** | Re-derived locally from the same `parseQuery` pass the builder runs (`tools/build_city_shards.mjs:287-292`): 2,219 distinct names. Matches the comment at `src/city.js:141`. |
| "Phrases that name no street are counted and discarded rather than listed" | 197-198 | **CURRENT** | `noise` is counted into `discarded` and never published (`src/press.js:346, 372-375`). Live: 25 discarded. |
| "The coverage is confirmed." | 202-204 | **CURRENT** | `isSafetyCoverage` over title and text against the crossing's own tokens (`src/press.js:223-229`). |
| "Rejects are logged and published at /watchlist with the reason each one failed." | 206-208 | **CURRENT** | Up to 40 rejects with reasons (`src/press.js:370`), served at `/watchlist` and `/api/watchlist` (`src/index.js:1963-1970`). Live: 7 rejects. |
| "a surviving link is written to both corners so the claim reads the same from either page" | 214-215 | **CURRENT** | `reciprocal` written to the far end unless that corner owns its own record (`src/press.js:475-493`, `src/index.js:1684-1688`). |
| "The index ranks reported harm, not risk per crossing." | 222 | **CURRENT** | `SCORE_CAVEAT` (`src/score.js:82-83`), attached to every score payload (`src/score.js:165`). |
| "which of four fixed conditions it can actually see" and the four names | 229-231 | **CURRENT** | `HAZARDS` has exactly four keys: `faded_crosswalk`, `turning_conflict`, `lighting`, `curb_sidewalk` (`src/hazards.js:44-70`). |
| "It returns booleans, not prose" | 231-232 | **CURRENT** | Response schema is `{present: BOOLEAN, note: STRING}` per hazard, and only `present` is read (`src/hazards.js:110-138`). |
| CONFIRMED / CANDIDATE / REPORTED definitions | 234-237 | **CURRENT** | `label()` decides all three from counts (`src/hazards.js:188-192`), thresholds `MIN_311 = 3` and `MIN_CRASH = 1` (`src/hazards.js:39-41`). |
| "The audit is advisory context. It never moves the grade." | 238 | **CURRENT** | Nothing in `src/hazards.js` writes to a score, and `pointsFor` takes only collision and 311 counts (`src/score.js:33-46`). |
| The letter verification guarantee | 241-247 | **CURRENT** | One retry with the failing claim named, then the last verified letter served and marked `stale: true`, then a throw if there is none (`src/index.js:781-830`); the same `verifyLetter` runs on agent-submitted letters (`src/verify.js:14-17`). |
| "Most corners have no scraped accounts, and the panel says so" | 251-253 | **CURRENT** | `src/voices.js` funnel counts; not re-measured here. |
| "Police-reported collisions undercount." | 257-258 | **CURRENT** | A statement about the dataset, not about code. |
| "The 80m circle double-counts dense blocks." | 259-261 | **CURRENT** | Inherent to `within_circle`; derived in `docs/COUNTS.md`. |
| "The pages pass an automated audit with zero critical violations" | 262-264 | **UNVERIFIED HERE** | No accessibility audit was run: doing so is outside the freeze and needs a browser. The claim is not contradicted by anything read; it is simply not checked by this pass. |
| Heading: "Press checking at city scale, **and what it costs**" | 159 | **PROMISE NOT KEPT** | The section names no cost anywhere in lines 160 to 183. The numbers exist: `EXA_SEARCH_CENTS = 0.7`, `EXA_CONTENTS_CENTS = 0.1`, `EXA_CAP_CENTS = 6500` (`src/store.js:489-492`), and every enrichment publishes its own measured cost (`src/pressenrich.js:249-257`). |

---

## Exact replacement sentences

Paste-ready, in the page's voice. Each replaces the quoted text at the line
given. Nothing here is a projection; every figure is sourced in the table above.

### 1. Line 189 to 191, the watchlist opening sentence

Replace:

> Seven citywide semantic searches run each morning through Exa, with the news category, a published date window, lead-generation domains excluded at the API, and one pass restricted to San Francisco outlets that write at corner resolution.

With:

> Twenty nine citywide semantic searches run each morning through Exa, with the news category and a ninety day published-date window. Sixteen are different phrasings of the same citywide question, because one phrasing finds one kind of story: a death, a redesign, a campaign, a petition, a meeting, a piece of enforcement news. Ten more are anchored to a single neighbourhood, since a citywide query finds citywide stories and "the Excelsior" finds the story about one corner in the Excelsior. The last three are restricted at the API to the San Francisco outlets that write at corner resolution. The first twenty six exclude lead-generation domains at the API; the three local passes do not need a deny list, because nothing outside their outlet list can come back.

### 2. Line 199 to 200

Replace `same 7,353 corner index` with `same 7,355 corner index`.

### 3. Lines 131 to 134, the shards paragraph

Replace `packs the 7,353 corners with recorded harm` with
`packs the 7,355 corners with recorded harm`, and replace
`would be 7,353 writes to publish the city and 7,353 more to correct it` with
`would be 7,355 writes to publish the city and 7,355 more to correct it`.

Optional added clause, if the twin split is worth naming on this page:

> Two of those 7,355 are crossings the sweep had silently dropped, because two different pairs of streets reduced to one slug; they were split, scored through the same production counter, and the bare slug stayed exactly where it pointed, marked as an alias so nothing is counted twice.

### 4. Lines 218 to 219, the connection count

The count is a literal in the template, so it goes stale on its own every
morning. Two options, and the first is the one that survives a freeze.

Freeze-safe replacement for `Empty stays empty, and nothing fuzzy is shown: of 23 audited corners, four have a connection.`:

> Empty stays empty, and nothing fuzzy is shown. Most audited corners have no connection at all, and the ones that do carry the exact article that links them, on both pages. The current count is on /watchlist rather than here, because a number typed into this paragraph goes wrong the next morning without anybody touching it.

The better fix, which needs plumbing rather than a paste: `METHODOLOGY` takes
only `(origin, preview, scored)` at `src/methodology.js:18`. Give it the
connection tally the way it already takes `scored`, and render the sentence.
Until then, do not restate the number here.

### 5. Line 126, the sweep's request count

Replace `That is about a dozen paged requests` with:

> That is three paged requests, one per dataset, plus one more for the district pass,

### 6. Lines 209 to 211, the Websets paragraph's last sentence

Replace:

> It is implemented directly on Exa's search API, which is what the event credits cover.

With:

> It is implemented directly on Exa's own APIs rather than on the Websets product: search for the discovery pass, contents for the shortlist, findSimilar for the connections, and Monitors for the radar described below. All four are what the event credits cover.

### 7. Lines 139 to 141, the AUDITED bullet

Replace:

> AUDITED: every evidence lane has been checked here. Records, press, resident accounts and the visual audit have all run, and the corner has its two generated imagery states.

With:

> AUDITED: the corner has both of its generated imagery states. That is the whole test the tier reads (`src/city.js`), and it is deliberately the last lane to finish, so in practice the records, press and resident-account lanes have all run before a corner reaches it. When imagery comes back partial the corner stays ENRICHED even though every other lane ran, because claiming an audit that did not happen is worse than a corner sitting one tier down for a day.

### 8. Lines 216 to 218, the connection bars

Replace:

> the connecting article must be dated (a site homepage is not an article) and must be recent, since a blog post from 2007 is not the same breath as anything.

With:

> the connecting article must be dated, must be no more than three years old, since a blog post from 2007 is not the same breath as anything, and must be an article rather than a site homepage. findSimilar returns homepages happily, and a homepage carries whatever was on the front page the day it was read, which is how "Welcome to Westside Observer" once became a citation.

---

## New sections the page needs

### A. The press radar, and what it cannot claim

Insert after the watchlist section, before "The exposure caveat, in full".

> **The press radar.** Every lane above takes a snapshot: it asks what the record says at the moment it runs, stores the answer, and moves on. The radar is the present tense. Twenty nine standing Exa Monitors hold the queries open and push detections to this Worker as coverage appears: twenty five are corridors, derived from the leaderboard by summing each street's corners' points rather than asserted, so a long arterial with many bad crossings outranks one notorious intersection, and four are citywide watches for stories that name no corridor at all. Corridors rather than corners is the same economy the segment cache proved: every corner on Mission shares Mission's coverage, so one standing query serves all of them. Delivery is push and Exa owns the timing. The create API has no cadence, schedule or interval field, so this page does not claim a frequency; what the radar reports instead is the observed lag between an article's publication date and the moment the detection arrived, measured per hit, with hits that carry no publication date excluded from the median and counted separately rather than treated as zero. The webhook is public by necessity and treated as hostile: a shared secret in the path and a monitor id this Worker created are checked before the payload is read at all, and after that nothing in the payload is trusted. Every detection runs the same relevance filter and the same safety-coverage bar the rest of the press lane uses, and a detection that fails is published as a filtered detection with its reason rather than discarded. A detection can never write a citation on a corner page and can never move a grade: a passing hit that names a graded crossing queues that corner for a press re-check by the nightly lane, which is the only thing that writes citations. The radar is capped at 40 cents a day and 900 cents a month, refuses past either, and the feed holds the most recent 120 entries. At the time of writing the feed is empty, which is the honest state of a system that has been listening since it was created and has not yet been pushed anything.

Sources for every figure in that paragraph: `CORRIDOR_LIMIT = 25`
(`src/radar.js:38`), `META_QUERIES` length 4 (`src/radar.js:31-36`),
`worstCorridors` (`src/radar.js:47-66`), the no-cadence note
(`src/radar.js:15-18`), `lagHours` and `medianLag` (`src/radar.js:102-117`),
the two webhook checks (`src/index.js:996-1006`), `judge`
(`src/radar.js:140-170`), the re-check queue (`src/index.js:1039-1047, 1065-1070`),
`RADAR_DAY_CENTS = 40` and `RADAR_MONTH_CENTS = 900` (`src/store.js:901-902`),
`RADAR_FEED_CAP = 120` (`src/store.js:974`). The "empty" state was live at
2026-08-19: `/api/radar` returns `feed: []` with 29 monitors created and none
failed. If the feed is not empty when the edit ships, drop the last sentence
rather than typing a count into it.

### B. What the lanes cost, and what stops them

Insert directly after the press-batch section, which already promises a cost in
its heading and never gives one.

> **What it costs, and what stops it.** Every Exa call is reserved against a cent counter before it is made, not after, because a batch that checks its budget between calls has already overspent by the time it notices. A search is counted at 0.7 cents and a page of contents at 0.1, the month's ceiling is 65 dollars, and a corner whose plan does not fit under the ceiling returns a stored result that says the budget deferred it rather than a blank panel. The radar carries its own separate caps, 40 cents a day and 900 cents a month, so a burst of detections cannot eat the discovery budget. Resident-voice scraping is capped by run count rather than by cents, at seventy actor runs a month, because Apify bills per run and the ceiling that matters there is the account's. Every one of these counters, what has been spent and what is left, is published at /status, and each lane reports its own measured cost with the record it produced rather than an estimate.

Sources: `EXA_SEARCH_CENTS = 0.7`, `EXA_CONTENTS_CENTS = 0.1`,
`EXA_CAP_CENTS = 6500` (`src/store.js:489-492`), reserve-before-spend
(`src/pressenrich.js:156-169`), the `budget-deferred` result
(`src/pressenrich.js:161-168`), radar caps (`src/store.js:901-902, 944`),
`MONTHLY_ACTOR_RUN_CAP = 70` (`src/store.js:1037-1049`), per-record measured
cost (`src/pressenrich.js:243-257`).

### C. The corner timeline, and why an empty year is not a quiet year

Insert after the press-batch section, before the watchlist section.

> **The timeline.** Exa accepts date-bounded searches, so the press lane can be run once per window instead of once, which turns a list of five links into a record of how long a corner has been a problem in public. A collision record says a corner is dangerous now; a year strip says people have been writing about it since 2015 and nothing was done, which is a different argument and a better one to put in front of a Supervisor. Alongside it sits the oldest collision the city has on record at that corner, over the whole dataset rather than the five year window the grade uses, from one keyless DataSF query. The comparison is stated carefully in both directions: coverage that predates the first recorded collision would mean people were saying so before the record agreed, and coverage that trails it means the record was first. Everywhere it appears it is phrased as coverage this search could find, never as a first report, because Exa recall is not ground truth: an empty year means this search found nothing that year, not that nothing happened.

Sources: `src/timeline.js:1-30` for the framing and the recall caveat,
`earliestCollisionYear` at `src/timeline.js:27-30`, `TIMELINE_VERSION`
at `src/timeline.js:23`.

### D. The watchdog, named once and never explained

Low priority, and arguably out of scope for this page, but worth flagging. The
methodology mentions "the autonomous watchdog" once at line 246, in a
subordinate clause, and the site's own top-level switcher offers
`/watchdog` as one of three destinations (`src/methodology.js:53`). A reader who
follows that link gets an agent with its own decision log and no methodology
entry describing what it is allowed to do. If a paragraph is added, it should
say what the agent may write, what it may not, and that its own claim about its
work is recorded and then ignored in favour of the arithmetic, which the letter
section already says at lines 245 to 247. `src/agent.js` and `src/watchdog.js`
are the files to read before drafting it. The companion repo
`streetcred-watchdog` is the other half and is not mentioned on this page at
all.

---

## Ranked by how badly a judge is misled

1. **"Seven citywide semantic searches" (189).** Off by a factor of four, on the
   sentence that describes the product's flagship use of Exa, at an Exa event,
   one click from a `/watchlist` page that lists all 29 queries by name. The
   number is not the damage; the page contradicting the page next to it is.
2. **The press radar is absent (whole page).** A 170-line subsystem, 29 live
   monitors, a webhook, a budget and its own public page, and the methodology
   says nothing. The page's own opening promise is that if the product does not
   do a thing, the page says so; the inverse failure, doing a thing the page
   never mentions, reads to a careful judge as the same kind of gap. The footer
   of this very page links to "Press radar".
3. **"7,353" against the masthead's "7,355" (131, 133, 199).** Two different
   sizes of the same city, on one screen, sixty lines apart. Small in magnitude
   and instant to spot, which is exactly what makes it expensive.
4. **"of 23 audited corners, four have a connection" (218).** True at this hour,
   hardcoded, and wrong by tomorrow morning when the cron promotes the 24th
   corner. A number that goes stale while nobody touches it is the failure mode
   this whole page is written against.
5. **"one pass restricted to San Francisco outlets" (190).** Same sentence as
   finding 1, same fix, listed separately because it is a separate wrong number.
6. **The AUDITED tier definition overclaims (139).** The page says four lanes
   decide the tier; the code reads two imagery states. `1st-and-bush` is a live
   counterexample sitting on the board right now.
7. **"implemented directly on Exa's search API" (210).** Understates the
   integration, which is an unusual direction for a claim to be wrong in, but it
   is still a claim that does not match the code.
8. **"about a dozen paged requests" (126).** Three. Nobody is harmed, but it is
   a number on a page that promises checkable numbers.
9. **The connection bars are described as two and are three (216).** The
   homepage bar is folded into a parenthetical, and "recent" never gets its
   three-year definition.
10. **The heading promises a cost the section never gives (159).** Section B
    above fixes it.

## What this pass did not verify

- **The accessibility claim at lines 262 to 264.** No automated audit was run.
  It needs a browser and is outside the freeze.
- **The historical anecdotes**: the 354 to 8,546 inflation (92), the eleven
  searches a year strip cost (171), the 600-sample distribution (115). Each is
  corroborated only by a comment in the code that states the same figure. They
  are not contradicted by anything, and they are not independently checkable
  from this repo.
- **The parity proof** that the local sweep counter reproduced production's
  `within_circle` counts exactly (127 to 128, 108 to 109). Asserted in
  `tools/sweep.mjs` and `tools/build_city_shards.mjs` comments and in
  `specs/HANDOFF.md`; re-running it is a full sweep and was not attempted.

## Related staleness outside this file

Not this document's job to fix, but the same edit pass should catch it, because
these repeat the sentences corrected above:

- `README.md:66` says "Seven citywide semantic searches" and cites the older
  pass, 104 articles, 4 corners, 7 rejects, 22 discarded. The live pass built
  2026-08-19T13:11Z read 117 articles across 29 queries and produced 5 entries,
  7 rejects and 25 discarded. `README.md:66` also carries "7,353-corner index"
  and "Of 23 audited corners, four have a connection".
- `specs/MAKE_THEM_KNOW.md:81-82` cites 104 articles, 4 corners, 24 discarded,
  and a "7,355-corner index" that happens to be right where the methodology page
  is wrong.
- `src/index.js:1694` and `src/press.js:284-285` carry code comments that say
  "Seven semantic searches" and "the whole watchlist is four searches". Comments
  rather than page copy, so no reader is misled, but they are the reason the
  page sentence was never questioned.
- `docs/COUNTS.md` is the authority on the 80m vs 150m derivation and on the
  7,353 versus 7,355 gap. Cross-reference it from any edit rather than
  restating it.
