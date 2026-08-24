# Handoff for a fresh session

Written 2026-08-18, after the city-scale run. Read this before touching
anything; the gotchas at the bottom are each a bug that already happened once.

## What changed in this run

The whole city ships. Before this run 123 corners had pages and the other
7,200 did not exist as far as the product was concerned. Now every graded
intersection in San Francisco has one.

```
6d40905 cron commissions voices   apify actors started and ingested by the morning run
716dfbb press connections         findSimilar links corners, both ends, verified
68b47fb press watchlist           entity discovery over citywide coverage, rejects published
f067f17 city scale handoff        cron keeps the tier rosters current
b4d6e97 city scale honesty        /methodology section, grade share cards, city contract test
1310d81 city scale surfaces       homepage counter, citywide board, tappable dots, typeahead, queue
52afa33 composed corners          resolver reads shards first, three tiers, honest lanes
388c7e0 city shards               71 KV bundles, rank pages, meta, dots
663b11f citywide sweep artifacts  the district backfill the sweep never did
```

Plus one uncommitted-at-the-time follow-up folded into the final commit: the
cron now moves a corner between the city tier rosters when it audits it, so
the homepage counter actually gains one every morning.

## Deployed state: what a visitor sees today

Production is `streetcred` at https://streetcred.thealexschroeder.workers.dev,
deployed from main, health all nine probes green.

- **Homepage**: "7,353 intersections graded citywide, 23 fully audited, one
  more every morning." Corner of the day with "7,174 corners in line, worst
  first". The scoreboard is the whole city, worst first, top 25 in the HTML
  with a Show all that pages through 148 pages of 50. Every row carries its
  tier tag, which is how you can now see at a glance that the 25 worst corners
  in San Francisco are all ENRICHED and none of them audited.
- **Any corner page**: type or tap any of the 7,353 and it resolves from one
  KV read with zero external calls. Verdict block, index, distribution strip,
  severity mix, stat tiles with both radii labeled and an as-of caption, live
  provenance links, honest empty lanes, Street View frame, interactive map.
- **Three tiers, named everywhere**: AUDITED (23), ENRICHED (106), SCORED (the
  rest). The chip beside the corner name, the row tags on the board, the map
  legend, the typeahead badges and /methodology all use the same three words.
- **Map**: heat dots for the whole census, tappable from zoom 15 through the
  same two-tap confirm popup as tapping the map itself.

## The city layer, in one page

**Artifacts.** `sweep-results.json` (7,353 nonzero corners, counts, points and
now `district`), `sweep-distribution.json` (all 8,254 values), both committed.
`data/city/meta.json` is the shape of `city:meta`. `public/data/city/dots.json`
is the heat layer the browser reads.

**Tools, in the order you would run them.**

```
tools/sweep.mjs             the census (do not rerun casually, see gotcha 13)
tools/sweep_districts.mjs   backfills district into sweep-results.json
tools/build_city_shards.mjs shards + rank pages + meta + dots, then bulk KV
tools/build_suggest_index.mjs typeahead index, grades for the whole city
tools/seed_cotd_city.mjs    reseeds cotd:queue worst-first from the city
tools/make_grade_cards.py   the five fallback share cards (offline, PIL)
```

**KV, new families.** `city:shard:{key}` (71, largest 175.4 KB),
`city:rank:{0..73}` (100 rows each, the precomputed worst-first order),
`city:meta` (counts plus the audited and enriched rosters), `city:dots`,
`photo:{day}` (the new Street View ceiling).

**Reading it.** `src/city.js` holds the shard key rule, the readers, the tier
vocabulary and every shard-derived payload. The payload builders are
deliberately synchronous, which is the cheapest possible guarantee that a
scored page cannot make a network call; `tools/city.test.mjs` asserts it.

**The read order that matters**, in `corner()` and in `resolveCorner()`:
registry, then stored corner record, then city shard, then external. A shard
row that shadowed a stored record would roll an audited corner back to the
sweep date silently.

## Measured, not assumed

- **KV reads for a SCORED page load: 2.** `corner:{slug}` (miss) plus
  `city:shard:{key}`. `ogFor` returns without reading anything for a scored
  corner, and the background cred warm is skipped because the payload is
  already there. Repeat lane calls in the same isolate reuse a parsed shard.
- **External calls on a SCORED page: zero.** Every lane returns at the network
  floor (119 to 157ms TTFB, against 131ms for `/logo.svg` over the same link).
  For contrast the live path on a non-shard corner costs 297ms for stats and
  1,021ms for press.
- **Largest shard: 175.4 KB** (`city:shard:c`), against KV's 25 MiB ceiling.
  The builder refuses to run if any shard passes a tenth of the limit.
- **Leaderboard walk**: all 148 pages return 7,353 rows and 7,353 distinct
  slugs, matching `city:meta.totalScored` exactly.

## Billing: still blocked, nothing here spent a model call

Key #2 is still free-tier: 20 text calls a day, zero image generations, zero
Pro. `specs/BILLING_QUEUE.md` is unchanged and still correct, in order. This
entire run made zero model calls of any kind.

## The press and voices layer, added last

**Press Watchlist** (`src/press.js`, `/watchlist`). Seven citywide semantic Exa
searches, every crossing name extracted, three bars before anything surfaces:
both names are SF streets (against the 2,219-name `city:streets` index), the
pair is an exact match in the graded-city index, and the coverage is confirmed
to be about safety there. Rejects published with reasons; phrases naming no
street are counted and discarded. Rebuild with
`node tools/build_watchlist.mjs [--dry]`. The cron refreshes it every morning.

**Press connections** (`src/press.js`, `/api/connections`). findSimilar per
audited corner, same extractor, same index, plus two extra bars: the connecting
article must be dated with a real path and must be recent. Written to BOTH
corners; a corner that ran its own search owns its record and is never
overwritten by a reciprocal one. Rebuild with
`node tools/build_connections.mjs [--dry] [--limit N]`.

**Autonomous voices** (`src/voices.js`). The cron commissions both Apify actors
for the corner it promotes and ingests them on the NEXT cycle. Hard ceiling of
70 actor runs a month; per-run cost ledger at `/status`. Operator path:
`node tools/commission_voices.mjs "24th and Valencia" --dry` prints the exact
inputs and spends nothing, without `--dry` it commissions, `--ingest` picks up
what finished.

**Budgets, both real and both published at /status.** Exa: cumulative
`exa:calls` against `EXA_CALL_BUDGET` 1500, plus `exa:spend` in dollars taken
from Exa's own `costDollars` field. Currently 103 calls, $0.85. Apify:
`apifyruns:{YYYY-MM}` against `MONTHLY_ACTOR_RUN_CAP` 70, plus the `apify:costs`
ledger. Currently 0 runs, $0. The Apify account is FREE plan with a $105 cycle
limit and about $104 left, cycle ending 2026-09-16.

**New KV keys.** `press:watchlist`, `press:conn:{slug}`, `city:streets`,
`exa:calls`, `exa:spend`, `apifyruns:{month}`, `apify:costs`, `voicerun:{slug}`,
`voicerun:pending`, `voices:{slug}`.

## Slug collisions: audited, and mostly a non-issue

`tools/audit_slugs.mjs` pulls the intersections table WITH `st_type`, which the
sweep never selected, and asks whether two different pairs of streets ever land
on one slug. Verdict over all 8,254 crossings and 7,926 slugs:

- **267 slugs are shared by cnns with identical street types.** These are the
  quadrants of one big crossing and are expected, not collisions.
- **5 are true collisions**, one slug from two different pairs of streets.
- **2 of the 5 are actually two different places** and are now split:
  `funston-and-lincoln` was a Presidio crossing on Lincoln Blvd and a Sunset
  crossing on Lincoln Way **4.1km apart**, and the sweep kept the higher scoring
  one and silently dropped the other. `14th-and-ortega` was two crossings 243m
  apart. Both now have suffixed slugs, both scored through the production
  `countsFor`, and both pages name the other.
- **3 are one junction under two labels** (36 to 63m apart: Clipper St vs
  Clipper Ter, Clover St vs Clover Ln, Jennings St vs Jennings Ct). They stay
  merged, because two pages forty metres apart would be a worse answer than one.

**The 19th Street vs 19th Avenue case is a verified non-issue as a slug
collision.** It never produces one, because the two streets never cross the
same street. What it does produce is a *press connection* precision problem,
which is what the recency bar in `src/press.js` exists for (gotcha 23).

Every bare slug still resolves and still points where it pointed, marked
`alias: true` in its shard row so it is not counted, ranked or drawn twice.
The city counter went from 7,353 to **7,355**: two crossings that had no page
now have one. Re-run the audit with `node tools/audit_slugs.mjs`, which rewrites
`data/city/twins.json`, then rebuild the shards.

## The sponsor depth run, and what it measured

**Exa.** Discovery is 29 phrasings over 90 days (neighbourhood anchored,
petition and meeting phrasings, three local-outlet passes). It reads ~150
articles and verifies about three corners. Broadening the net did not broaden
the result: the constraint is that most crossings named in SF coverage are
either not a graded crossing or are named in articles that are not about safety
there. Both are published as rejects. Timelines went 40 to 84 corners, 63 of
them carrying the earliest-collision comparison. **Zero corners have coverage
predating their first recorded collision**, because the collision dataset
begins in 2005 and every corner measured has a 2005 record; the chip therefore
reads "Records first, 2005" and /watchlist says the flag is unclaimed.
Connections: 5 corners linked, 16 with a recorded empty check.

Cumulative Exa: 754 of the 1500 ceiling, $1.25 recorded.

**Apify.** 13 corners commissioned, 4 with a surviving quote. $3.63 this
session, $4.62 for the cycle against a $105 limit, confirmed against the
provider's invoice rather than our arithmetic.

**The relevance filter took three corrections, each from real returned data.**
Naming the corner used to qualify a quote (restaurant reviews). Harm words used
to qualify one ("San Francisco Killed 8th-Grade Algebra", a shooting, a fatal
crash on I-280). And a Reddit search for a corner returns everything mentioning
either street. It now requires all three: a word that can only mean a street, a
safety word, and the corner named. Yield is low and every surviving quote is
real. `--rescore` re-applies a filter change to datasets already paid for.

**The letter circuit breaker.** /api/letter measured 43.9s; a 429 naming a
spent quota now throws instead of being retried, raises `letter:backoff` for an
hour, and every request after serves the corner's last verified letter in
150-280ms. `letter:verified` still holds zero keys, so today it serves a fast
tagged sample instead of a slow one.

**Uptime.** The 83.3% was one synthetic run at 2026-08-18T18:59:22Z that 404'd
on all six endpoints in 1-31ms, with a passing run 51 seconds later. That is a
deploy window, not the letter latency and not a real outage.

## Gotchas a fresh session must not rediscover

The first twelve are inherited and all still true. 13 onward are new.

1. **The page's JS lives inside a template literal.** `node --check
   src/page.js` validates the template, NOT the page. `\/` or `\'` written
   into it are EATEN and serve as syntax errors that kill the whole script.
   This is now covered: `tools/pagescript.test.mjs` renders the page and
   parses the script the browser would actually receive, including a corner
   with an apostrophe in its name. Run `node --test tools/*.test.mjs`.
2. **Radius labeling is a decision, not a bug.** The grade counts 80m, live
   displayed stats count 150m. Both deliberate, both labeled. A swept corner's
   tiles count 80m over twelve months of 311, and say so; the window and the
   radius now travel in the payload rather than being baked into the page.
3. **There is no per-corner cache invalidation.** Version bumps invalidate
   EVERYTHING.
4. **Samples and empty payloads are never edge-cached**, so a failing lane
   retries on every request.
5. **The cron and the caps are untouchable.** 06:10 PT cotd cron,
   DAILY_GENERATION_CAP 25, DAILY_TIMELINE_CAP 40. This run added a new,
   separate ceiling (gotcha 15) and changed none of the existing ones.
6. **The verifier is `src/verify.js`**, one function for both the serving and
   the agent paths.
7. **Flagship slugs are legacy**: `16th-mission`, `6th-market`. Never build a
   slug by hand; go through parseQuery + canonicalSlug.
8. **A Worker cannot fetch its own endpoints** (error 1042). Static assets go
   through the ASSETS binding, which is how the grade share cards are read.
9. **The 311 dataset's `point` is the legacy Socrata location type**;
   collisions use GeoJSON. A reader that handles one silently zeroes the other.
10. **rescore.js reads the live board first** for which corners exist.
11. **Unknown slugs 404 honestly.** Only slugless requests get the default.
12. **My admin pushes bypass branch protection.** CI still runs and is green.

13. **Do NOT bump CACHE_VERSION while generation is billing-gated.** Cached
    letters live under the same edge key prefix, and `getLetter` only falls
    back to the stored verified letter when verification fails twice, NOT when
    the model call itself throws on quota. So a CACHE_VERSION bump today drops
    every cached letter, every regeneration fails on quota, and every letter on
    the site becomes a SAMPLE. This is why the stats payload gained fields
    without a bump: stale cached copies degrade to the old label for an hour
    and then heal. If letters ever need to survive a bump, teach the quota
    throw to reach `getVerifiedLetter` first.
14. **Do NOT rerun `tools/sweep.mjs` casually.** It rewrites both artifacts
    against a window that has moved, and `src/distribution.js` is a frozen
    census declared final. `tools/build_city_shards.mjs` refuses to build if
    the artifact and the constant disagree, which is the guard, not a
    suggestion. The district backfill is a separate pass on purpose: it adds a
    field without touching a single verified count.
15. **There is a new daily ceiling: DAILY_PHOTO_CAP, 300** (`src/store.js`,
    key `photo:{day}`). Publishing the city published 7,353 crawlable pages,
    and each one wants a billed Street View frame on first view. The
    reservation is taken before the fetch and nothing is written when it
    declines, so the next visitor retries rather than finding a corner pinned
    photoless forever. Scored corners also skip `/map.jpg` entirely and go
    straight to the free-tile interactive map.
16. **The cron must promote a corner before auditing it.** A queue entry
    resolves out of the shards tagged SCORED, and both that tag and the legacy
    `tier: "score"` tell the imagery lane not to spend. `cornerOfTheDay` strips
    the tag and stores the corner before any lane reads it. Without this the
    morning audit politely declines to audit the corner it woke up for, which
    was already quietly true of the seeded score tier before this run.
17. **`tier: "score"` in KV means ENRICHED.** 100 corners were written with
    that value before the vocabulary existed. `src/city.js` maps it in one
    place rather than rewriting 100 records to rename a string no reader sees.
18. **The tier rosters in `city:meta` are for list surfaces only.** The corner
    page always reads the corner's own record, which cannot be stale. The cron
    keeps the rosters current for the corner it audits; a corner created by an
    on-demand resolve is not added, so it shows as SCORED on the board until
    the next `build_city_shards.mjs` run. Cosmetic, and the fix is one command.
19. **6th and Market has no shard row.** DataSF's intersection table names that
    cnn by its two most frequent leg names, which are 6th and Golden Gate, so
    the sweep filed it under `6th-and-golden-gate`. The flagship page works
    (ALIASES plus the CORNERS registry) and so does the shard page; they are
    the same physical crossing under two names. Do not "fix" this by hand.
20. **`resolveCorner` deliberately does not write shard corners to KV.**
    Storing one would promote a corner to the warmed fleet just because
    somebody looked at it, and the fleet is what the daily audit works through.

21. **The Apify path is paid-run proven.** 24th and Valencia was commissioned
    on 2026-08-18 for **$0.2961**, ingested, and published. Both actors are
    PAY_PER_EVENT at $0.004 a unit. What the first real run taught, and what
    the tests now pin: the relevance scorer kept four restaurant reviews out of
    five, because naming the corner scored points on its own and "my go-to
    corner store" scored on the word corner. Both rules are now the ones
    src/cred.js already used, and the run keeps one true quote instead of five
    that pad. `commission_voices.mjs --rescore` re-applies the current scorer to
    datasets already paid for, so tightening the filter never costs a
    re-commission. The morning cron has not yet fired with this code deployed.
22. **A verification bar that reads its own data per candidate can switch
    itself off.** The street-name check was read once per candidate; one failed
    KV read cached a null for the process and the bar silently stopped running,
    with no symptom except a reject log filling with navigation menus. It is
    loaded once per build now and `tools/lib/kvenv.mjs` never caches a failed
    read. Any new bar should follow the same shape.
23. **The connections recency bar is load bearing, not tidiness.** Without it
    findSimilar returns the archive and a 2007 signal-timing post links 19th and
    Dolores to three corners on 19th Avenue, which share a slug token and
    nothing else, because `normalizeStreet` strips street types and cannot tell
    19th Street from 19th Avenue anywhere in this product.
24. **A headline-mention bar was tried and reverted.** Local reporting names the
    corner in the body and the neighborhood in the headline, so requiring the
    headline killed every real connection and kept only the corridor artifact.
    If precision needs raising again, raise it somewhere else.
25. **`tools/lib/kvenv.mjs` lets src modules run in Node** by shelling out to
    wrangler for KV. That is what makes the batch tools share the Worker's code
    instead of forking it. It is read-heavy and slow by design; do not use it
    for anything that would issue hundreds of writes.

26. **Apify caps the memory of all concurrent runs at 16GB, account-wide.**
    At 2048MB per run only eight fit and the ninth gets a 402 that reads like a
    billing error. Runs are 1024MB now. These actors bill per event, not per
    second, so lower memory costs nothing but wall clock.
27. **Do not sum the ledger and call it spend.** Topping a corner up with a
    second actor re-reads its first run, and before the `billed` marker that
    run's cost was counted again. The provider's invoice
    (`/v2/users/me/limits`) is what settles; `apify:invoice` holds the last
    reconciliation and /status shows both.
28. **A tool default can quietly outvote a module default.** The watchlist tool
    held `--days` defaulting to 45 while src/press.js said 90, and the stored
    watchlist recorded 45 for a day. Tools now pass nothing and let the module
    decide.
29. **Bulk timeline building deliberately bypasses DAILY_TIMELINE_CAP.** That
    cap is a public rail stopping a page load from spending a dozen searches
    and is untouched. `tools/build_timelines_bulk.mjs` has its own `--max-calls`
    ceiling and reserves against the cumulative Exa budget, which is the rule
    BILLING_QUEUE already states for imagery: operator budgets are separate and
    stricter, never a bypass.

30. **Never cache-bust the homepage with `?x=`.** That parameter is the legacy
    corner route: `/?x=1` resolves a corner named "1" and answers "Corner not
    found", with no hero on it at all. A browser harness that used `?x=` to
    defeat caching spent three runs looking like an intermittent hero failure
    before the parameter turned out to be the cause. Use any other name.

31. **The comparison slider has one implementation, deliberately.** `SLIDER()`
    and `SLIDER_JS` in `src/page.js` serve both the corner page and the
    homepage embed. Its CSS is keyed on `.sbase`, `.sov` and `.shdl`; the
    element ids are parameters because the corner page's script predates the
    extraction and addresses `#base`, `#overlay` and `#handle` by name. Adding
    a second slider rather than a second mount is how the two would drift.

32. **The wrangler CLI spells KV expiry `--ttl`, the Worker binding spells it
    `expirationTtl`.** Passing the binding's name to the CLI is not a warning,
    it is a rejected write. Every segment-cache write from a tool failed
    silently that way, and the only symptom was a cache that was cold every
    single time, which reads as "the cache does not help" rather than as a bug.

33. **`parseInt(x) || default` swallows a deliberate zero.** `--fresh-days 0`
    on the press batch fell back to 30, so a forced re-check checked nothing
    and reported success. Any flag where zero is meaningful needs
    `Number.isFinite`, not a falsy fallback.

34. **A price identifies a plan, never an account.** Phase 0 of the Exa burn
    pass inferred "$0.007 a search, therefore the $70 workspace" and ran a
    batch on it. The workspace's Usage page showed zero activity for the whole
    week. Any number of workspaces bill identically on one tier. The only thing
    that identifies an account is a human watching a specific dashboard move
    after a known call, which is what `tools/exa_verify.mjs` records and what
    `pressBatch` now refuses to spend without.

35. **Exa's API has no account or usage endpoint, but its Websets refusal
    names the team.** `/account`, `/me`, `/usage`, `/organizations`,
    `/billing/usage` and the `v1` forms all 404. What does state the account is
    the Pro-only Websets endpoint: `GET /websets/v0/websets` answers 401 with
    "Your team (Alex Schroeder's Personal) does not have access to the API".
    `tools/exa_probe.mjs` reads it. This was found while looking for Monitors,
    after a gotcha had already been written here saying no such signal existed,
    so treat "there is no way to check" as a claim that needs re-testing rather
    than a fact. It corroborates a dashboard observation and does not replace
    one: it names the team a key belongs to, not what a given call was billed
    against.

36. **Exa returns social posts as news.** A Facebook post came back as the top
    result for a Tenderloin corner. A lane that publishes what it keeps under
    the words "found and cited" cannot cite a Facebook post, so `NOT_PRESS` in
    `src/pressenrich.js` excludes social, video, forum and review domains. The
    per-page audited lane does NOT yet apply this filter; extending it there
    would change stored letters and cred, so it was left alone deliberately.

## Polish pass rollback

The polish pass of 2026-08-19 is visual and copy only: no scoring, data, API
behaviour, cron or cap changed. It was built on branch `polish/pass-1` and
verified on a preview Worker before main was touched.

**Production deployment live before the pass:**
`f75ce774-e045-4aba-9d2d-6969b2c9e878`, deployed 2026-08-19T00:08:50Z.

**Production deployment after the pass:**
`3d08e64b-f08b-432e-bb2b-d0c6ab9a9a92`, deployed 2026-08-19T03:3x UTC. The full
route matrix was re-run against the live URL after cutover and every cell was
green, identical to preview.

**Path A, instant:**

```
npx wrangler rollback f75ce774-e045-4aba-9d2d-6969b2c9e878
```

**Path B, from source:**

```
git checkout pre-polish-aug18 && npx wrangler deploy
```

The tag `pre-polish-aug18` is permanent. Do not delete it.

**Preview:** https://streetcred-preview.thealexschroeder.workers.dev, deployed
from `polish/pass-1` with `npx wrangler deploy --env preview`. Every page on it
carries a dashed PREVIEW badge, so a preview screenshot can never be mistaken
for production. It has no cron triggers. It shares production's KV namespace
deliberately, so it reads exactly what production reads; that also means the
lanes that write to KV write to the real store, which is why verification on it
reads pages and never touches the imagery lane.

## Polish pass 2 rollback (addendum stages 7B, 7C, 7D)

Addendum pass of 2026-08-20: visual and copy layer, plus deterministic verifier
rules. No scoring, data, API behaviour, cron or cap changed. Zero model calls,
zero billable calls. Built on branch `polish/pass-2` from main, verified on the
preview Worker before main was touched.

**Production deployment live before this pass:**
`a044a0af-cdaa-46ab-86ca-e52bffc3fd36`, deployed 2026-08-20T04:19:47Z.

**Production deployment after this pass:**
`edee624a-9d89-43df-8c9e-0e83b3f186a9`, deployed 2026-08-20T16:30:24Z, from
main at the `polish pass 2` merge. Verified after cutover: 21 addendum matrix
cells, 18 live honesty assertions and 196 unit tests, all green, three
consecutive matrix runs identical.

**Preview:** `933e96d8-eba0-4cbf-ac7b-8af9c390e2b5` on
streetcred-preview.thealexschroeder.workers.dev, from `polish/pass-2`.

**Path A, instant. This is the rollback for this pass:**

```
npx wrangler rollback a044a0af-cdaa-46ab-86ca-e52bffc3fd36
```

**Path B, from source:**

```
git checkout pre-polish-aug18 && npx wrangler deploy
```

The tag `pre-polish-aug18` is permanent. Do not delete it. Note that Path B
reverts all the way to the pre-polish-1 state, not to this pass's predecessor;
Path A is the correct rollback for this pass, and Path B is the floor.

## The watchlist runs on its own cron

Decided and implemented 2026-08-20. `docs/WATCHLIST_SUBREQUEST_FINDING.md`
option 2: the lane moved out of the daily audit's invocation and onto a cron
trigger of its own.

**Why it works.** A Worker invocation on the free plan gets 50 EXTERNAL
subrequests, and a separate 1,000 for calls to Cloudflare services, so this
lane's KV reads are not part of the arithmetic. It costs exactly one `fetch` per
query, no retry and no redirect. Sharing the audit's firing meant sharing what
the audit had left, which was about seven. Its own firing is a fresh fifty and
29 fits with twenty-one unspent.

**Schedule.** `20 13 * * *`, ten minutes after the morning audit. The minute is
deliberately not a multiple of 15 so it never fires in the same minute as the
quarter-hourly press tick. Cron Triggers are limited per account, 5 on Workers
Free and 250 on Paid; this Worker now uses 3.

**The strings are in two places** and have to agree: `wrangler.jsonc` and
`CRON_MORNING` / `CRON_WATCHLIST` / `CRON_PRESS_TICK` in `src/index.js`.
`tools/cron.test.mjs` reads the config and asserts they match, because a
schedule changed in one and not the other does not fail: the firing falls
through to the last branch and runs the press batch instead, forever, with
nothing red.

**Running it by hand.** `POST`-less GET, gated on its own secret:

```
curl -s https://streetcred.thealexschroeder.workers.dev/api/watchlist/run/$WATCHLIST_RUN_TOKEN
```

`WATCHLIST_RUN_TOKEN` is a dedicated secret, not `WEBHOOK_SECRET`. The webhook
secret is shared with the external service that posts radar detections, so it
travels outside this system, and this endpoint spends money. Rotate it on its
own with `wrangler secret put WATCHLIST_RUN_TOKEN`; nothing about the radar
changes. The endpoint is not idempotent and refuses at the Exa cent cap like
every other lane.

**The ceiling, and why there is one.** `WATCHLIST_PER_RUN` is 40. The set is 29,
so every query runs every morning and a cycle is one run. Past the ceiling the
lane rotates through the set least-recently-run first and `/watchlist` shows
each query's last-run date, rather than silently truncating. That guard exists
because the set grew from 7 to 29 once already and nothing followed it; the
whole failure was that growth was invisible.

**A second ceiling, found while verifying this one.** The KV daily write cap is
account-wide and separate from anything above: Cloudflare free tier allows 1,000
KV writes a day, resetting at 00:00 UTC. On 2026-08-20 it was exhausted by
roughly 17:00 UTC and the first manual watchlist run refused with `KV put()
limit exceeded for the day`, from `reserveExa`, before a single Exa search was
made. Nothing was spent and nothing was written, which is the lane degrading
exactly as it should, but it is a real limit on when this can run.

The 13:20 UTC cron fires 13 hours 20 minutes into the UTC day rather than at the
end of it, so it has the day's allowance largely ahead of it. That is the reason
to leave it where it is. Check the headroom before triggering a run by hand:

```
npx wrangler kv key put "diag:kvprobe" ok --binding STORE --remote
```

A `code: 10048` back means the cap is gone for the day and the watchlist run
will refuse. It is not a reason to retry: wait for 00:00 UTC.

**What the audit no longer does.** `cornerOfTheDay` does not build the watchlist
and its log entry no longer carries watchlist counts. Reading the stored record
there would have put another run's numbers in this run's entry, which is the
quieter version of the same problem.

## Coverage layer rollback

The audited coverage layer of 2026-08-20 adds a map layer and reads that the
homepage route already made. No scoring, data, cron, cap or KV write changed.
Built on `coverage/pass-1`, verified on preview, then merged.

**Production deployment live before this layer:**
`d62127ba-8eed-418e-a64c-811e224c3393`, deployed 2026-08-20T17:08:56Z.

**Production deployment after:**
`c97aeb24-a3ac-4db1-839e-5d1480fbca13`. **Preview:**
`0bf46538-ac36-4e33-8964-b4ccacca59fd`.

```
npx wrangler rollback d62127ba-8eed-418e-a64c-811e224c3393
```

**The rule the layer holds, so nobody softens it later.** Coverage is drawn per
corner as its 80 metre scoring core and never as one boundary around the audited
set. A hull around 23 corners in a city of 7,355 graded ones would enclose
thousands of crossings nobody has looked at. The union of discs is the zone and
the gaps are the truth: the layer covers 0.46 km2, which is about 0.38 percent
of San Francisco, and it should look like that.

**The outlined state is currently unreachable and that is correct.** The split
is 23 rendered, 0 pending, because the cron only admits a corner to the audited
roster once both generated states exist, so an audited corner without a render
cannot exist. `tools/tiers.test.mjs` already pins that as a known gap. The
outlined branch is waiting on a fix somewhere else, not dead.

**Do not rebuild the layer from `hin:list`.** The board list carries 25 rows and
is missing three audited corners outright, so a layer built from what the page
already had client-side draws 20 discs for a 23 corner roster and under-claims
silently. The builder reads the roster in `city:meta` and falls back to the city
shard for corners the board does not carry.

## Do not propose Workers AI for imagery again

Piloted and rejected 2026-08-20. Recorded here as well as in
`docs/ARCHITECTURE_DECISIONS.md` because the idea is attractive enough to be
proposed twice: Workers AI is free on the plan this already deploys on, needs no
key and no card, and its Flux models accept an input image, which is the one
capability the proposed-fix panel actually requires. With Gemini imagery blocked
on billing it looks like the obvious way out.

**It is disqualified on text, not on quality.** Every Flux render garbled the
street name signs, mangled the speed limit sign, and reproduced the Google
watermark as "Corcle" or "Garage". An evidence product cannot publish a
photograph of a named intersection carrying a fabricated street sign. No prompt
fixes that.

**The affordable model is a prototyping model.** `flux-2-klein-4b` is the only
image-conditioned model cheap enough for a fleet at 109.57 neurons an image, and
it is a fixed 4-step distilled model. The image-conditioned model with real
headroom, `flux-2-dev`, is 4,219 neurons an image, which is two images a day
against the 10,000 free, and it has the same text problem.

**If the hazards panel is ever rebuilt, it is not a generation task.** The site
already knows which hazards were confirmed and from which records. A computed
SVG overlay on the untouched Street View frame would be free, instant, correctly
placed and able to render a legible legend. Generating it replaces a checkable
fact with a guess.

The imagery lane stays on the Gemini path in `src/imagery.js`, pending billing.
The pilot cost 767 neurons, zero dollars, zero KV writes and no deploy; its
tooling was reverted and the model survey lives in the decision record.

## Contrast, measured for the operator's phone pass

Measured 2026-08-20 during addendum stage 7B, from the resolved CSS rather than
by eye. The site has one palette; there is no `prefers-color-scheme` block
anywhere in `src/`, so these are the only values a visitor can get.

| Surface | Foreground | Background | Ratio | WCAG |
|---|---|---|---|---|
| Check button, enabled | `#ffffff` | `--ink` `#141B2D` | **17.15:1** | passes AA 4.5:1 and AAA 7:1 |
| Check button against the page | `--ink` `#141B2D` | `--bg` `#faf9f5` | 16.28:1 | passes AA UI 3:1 |
| Check button, disabled | effective `#fcfcfa` | effective `#878a91` | 3.37:1 | below AA 4.5:1 |

The button is 14px at weight 600, which is normal text by WCAG's measure, not
large text, so 4.5:1 is the bar it has to clear and it clears it nearly four
times over. No change was made to it.

The disabled row is recorded rather than fixed: `.find button[disabled]` is
`opacity:.5`, and WCAG 1.4.3 exempts inactive controls from the contrast
minimum. It is here so the operator's phone pass knows the number was taken and
what it means, rather than rediscovering it and wondering.

## Deferred from polish pass

- **`score:24th-and-valencia` is stored at v1** while the scoring code is at v3,
  so `getScore` returns null for it and the corner's title renders without its
  grade letter. That is the specified behaviour for a missing value (omit
  rather than pad), and the page itself is unaffected because the client
  recomputes. Fixing the record means writing a score, which this pass forbids.
  One page load of `/api/score?x=24th-and-valencia` upgrades it, or
  `node tools/rescore.js`. Sampled 10 audited corners: this is the only stale
  one.
- **og:image was kept, not removed.** The pass specified text-only meta on the
  grounds that image cards are queued behind billing. They are not: corner and
  root cards are served from static grade cards and stored Street View frames
  with zero generation, and `shareCard()` deliberately never uses the annotated
  or generated states. Removing working share images before judging would be a
  downgrade, so no og:image was added anywhere and the existing ones stay. The
  five trust surfaces have none.

- **The preview Worker has no secrets, and that is deliberate.**
  `wrangler secret list --env preview` returns an empty list: secrets do not
  inherit across environments. So on preview the press lane, the letter, the
  resident voices and the static map all degrade to their sample or empty
  states, because the keys they need are not there. This is worth knowing
  before reading any preview result: it verifies HTML, meta, layout, links and
  honesty copy faithfully, and it cannot verify anything that needs a key.
  Those cells are verified against production instead. The alternative, copying
  live keys onto a second public Worker, would put a spendable surface on the
  internet to check a visual change, which is a bad trade.

## Budget burn pass: stopped at the Gemini gate

Attempted 2026-08-19. The pass is designed to stop if the Gemini preflight
fails, and it failed, so nothing after phase 0 was built and no Exa or Apify
credit was spent.

**Gate result, recorded at `gate:gemini`:** text fail, image fail, mode
blocked.

- The **deployed** key answers `429 You exceeded your current quota` for text
  generation. Verified through the live letter path, which fell back to a
  tagged sample and re-armed the backoff flag with that verbatim reason.
- The image probe was not attempted, because the gate's own rule is that a
  failed text probe stops the pass.
- Separately: **the `GEMINI_API_KEY` in `.dev.vars` is invalid**, answering
  `400 API key not valid`. It is not the same key as the deployed secret. Any
  local tool that reads it is testing a key the site does not use.
  `tools/gemini_preflight.mjs` now detects that and probes the deployed key
  through the site instead.

**What unblocks the pass:** a funded Gemini key, which is item 0 of
`specs/BILLING_QUEUE.md`. Everything the burn pass wanted to spend on Exa and
Apify is still available and untouched: Exa reports $1.245 recorded against its
own ceiling, and Apify's provider invoice reads $4.62 of the $105 cycle.

## The hero: corner of the day, and the slider inside it

Two commits, 2026-08-19, both live.

```
602b5c6 phase 1: corner of the day in the hero      version 33e4e97d-37d2-457a-87e7-345982946f57
4f85e51 hero addendum: slider restored as primary   version e1132b2b-0ff7-41ed-a1f3-a76f0b7edfa7
```

The homepage hero is two columns on a wide screen, search on the left and the
corner of the day on the right, and stacks with the search first below 900px.
The old `<a class="cotd">` strip is gone; the queue line, the voices line and
the streak ticker stayed. The stat band sits below the hero, which is what
lifts the embed above the fold on a phone.

**The slider is one component with two mounts.** `SLIDER()` in `src/page.js`
emits the markup, `SLIDER_JS` carries `mountSlider()` for drag, touch and
keyboard, and both the corner page and the homepage embed inline the same
source. The slider CSS is keyed on `.sbase`, `.sov` and `.shdl` rather than on
the corner page's `#base`, `#overlay` and `#handle`, which is the only reason a
second mount can exist. The corner page still addresses its own elements by id,
so ids are a parameter of `SLIDER()`.

Do not write a second slider. If the drag needs to change, change
`mountSlider()` and both mounts change together, which is the point.

**The embed's states, all four force-tested:**

| frames stored | what renders |
| --- | --- |
| today + fix (+ hazards) | slider, photograph left, proposal right, chips Compare / Hazards / Today |
| today + hazards, no fix | slider against hazards, chips Compare / Today |
| today only | the photograph, `hero single`, no second pane and no handle in the DOM, pending line, no chips |
| nothing | the designed pending card, no stage |

A corner that cannot compare never renders a handle. That is enforced by the
`compare` parameter of `SLIDER()`, not by CSS hiding an empty pane.

**Measured on production**, 2026-08-19, at 1280x900 and 390x844:

- handle centred on load, `aria-valuenow="50"`, both panes decoded before any
  interaction (640 and 1306 natural width)
- mouse drag to 25% and a real CDP touch drag to 25% both land on 25%
- CLS 0.0300 desktop, 0.0000 mobile
- zero provider calls; the only cross-origin request on the page is the Google
  Fonts stylesheet the site already loaded
- the corner page renders **byte identically** to the pre-change deployment
  across seven interaction steps, screenshots included, with one deliberate
  difference: `mountSlider` now writes `style.left = "50%"` at mount where the
  stylesheet alone used to place the handle. Same computed position.

## The Exa burn pass: press at city scale

Five commits, 2026-08-19, all live.

```
0eed39b phase 0: the deployed exa key is identified by what it charges
7388076 phase 1: the exa counter is denominated in dollars
b8268c2 phase 2: frugal press enrichment, measured at 4.3 cents a corner
0e0008d phase 3: the press batch, and the rails that keep it honest
c5a417a phase 4: surface the press lane, and stop calling a cycle total a per-run price
```

**Which account the key is on: still unknown, and the first answer was wrong.**

Phase 0 claimed the account was identified by price. It was not. A
contents-free search costs $0.007 on the deployed key, which identifies a
**plan tier** of $7 per thousand. It does not identify a workspace: any number
of workspaces sit on the same tier and bill identically. The gate was written
as a price comparison, reported as passed, and the batch ran on it. The human
then checked the $70 workspace's own Usage page and found **no activity at all
for Aug 12 to 19, with the balance still reading exactly $70.00**, so the spend
landed somewhere else.

What the code says now:

- `exaPlanFor()` returns a plan tier and the comment says it cannot name an
  account. `/api/health` reports `exaPlan`, never an account.
- `budget:exa` carries `account`, `accountVerified`, `verifiedAt` and
  `observedBalanceUsd`, all null until a human records an observation.
- **`verifyExaAccount()` is the only thing in the codebase that may name the
  workspace being billed**, and `tools/exa_verify.mjs` is the only caller. It
  requires a workspace name and refuses without one.
- The nightly `pressBatch` returns `account-unverified` and spends nothing
  while `accountVerified` is false. A test pins that refusal.
- /status says "workspace not confirmed" and carries the caveat that spend and
  balance are different events: where a plan grants free monthly credits those
  are consumed first, so real usage can appear while a balance does not move.

**The lesson, stated so it is not relearned:** a measurement that is consistent
with a hypothesis is not a confirmation of it. Only an observation that could
have come out otherwise, on the specific thing being claimed, is a gate.

**The meter is cents now, not calls.** `budget:exa` holds
`{period, account, capCents, spentCents, reservedCents, searches, contentPages,
deferrals, priorSpendUsd}`. Estimates are reserved before a call at 0.7 cents a
search and 0.1 a page; the provider's own `costDollars` reconciles after; the
cap is enforced on whichever is higher. The $1.269 this account had already
spent is carried as `priorSpendUsd` and shown on /status, because the
dashboard's remaining balance is that plus the counter and the two cannot be
reconciled without it. Every Exa call site records its cost now, not only the
two batch lanes.

**The frugal lane, in order.** `src/pressenrich.js`. Stored citywide sweep,
then the segment cache (`press:segment:{street}`, seven day TTL, shared by every
corner on that street), then three dated windows on the crossing itself
(2014-2019, 2020-2023, 2024-present). Searches buy no page text at all;
candidates are shortlisted on title and url, only the shortlist is fetched, and
only then is the corner-level bar applied to real text. Measured, not projected:

```
fillmore-and-lombard  5 searches + 8 pages  4.30c   both streets cold
eddy-and-mason        5 searches + 8 pages  4.20c   both streets cold
eddy-and-jones        4 searches + 8 pages  3.50c   eddy warm from the run above
eddy-and-mason        3 searches + 8 pages  2.90c   both streets warm
```

**Do not confuse the two press lanes.** The watchlist reads the city's coverage
and finds corners in it. This batch takes the worst corners and goes looking.
They share the extractor and the index; they answer different questions.

**A press-checked corner is not audited.** It keeps its tier, the record carries
`lane: "press-checked"`, the panel is tagged "press coverage, found and cited"
and states that the visual audit has not run. The homepage audited count does
not move. Searched and empty is stored and shown with the count of articles
read behind it.

## FROZEN 2026-08-24. Read this block first.

**Production: `7fc904fd-7c1f-4d5d-8239-95765e700d5d`.**

```
npx wrangler rollback d8e50565-546f-48a7-9ff8-a87b4ce24524
```

Feature-frozen from 2026-08-24, breakage only. The three crons keep running by
design and stopping them counts as breakage, not as a feature. 396 offline
tests and 35 live cells were green at the freeze, and the live suite is the
check to run before believing anything else in this file.

**The only open items are these three, in order.**

1. **HANDOFF TASK 0, below: move the corner check into the ingest scorer.** It
   is the one correction that is currently a snapshot rather than a property of
   the data, and it is the first thing to do on the other side of the freeze.
2. **Verify Monday's cron.** 13:10 UTC audit, 13:20 watchlist, quarter-hourly
   press tick. Green means: a new entry at the end of `cotd:log` dated Monday,
   the homepage hero and the newest streak chip naming that same corner (the
   live cell asserts it), `apifyruns:2026-09` opening at 2 rather than
   inheriting August's 56, and the watchlist run block reporting 29 of 29. The
   month boundary is the part worth watching: the Apify counter is keyed by
   month and has never rolled over under this code.
3. Everything else in the queue below, unchanged.

Queued for the other side of it, decided 2026-08-24 from a competitor scan and
held out of the freeze:

- **POST-JUDGING TASK 0: move the corner check into the ingest scorer.** The
  bar that decides whether an account is about this crossing
  (`namesForeignCrossing`) and the label that says which street it names
  (`matchLevel`) both run on the way OUT, in `checkVoiceItems`, so no stored
  record was rewritten. That is the right shape for a correction made in a
  hurry and the wrong shape permanently: `voices:summary` is written at ingest
  by `recordOutcome`, which counts what the ingest kept, so the homepage
  breakdown is a stamped snapshot from `tools/recount_voices.mjs` and the next
  ingest of any corner drops it (the homepage then falls back to the plain
  sentence, which stays true). Moving both functions into the ingest and
  rescore paths in `src/voices.js` makes the stored counts correct by
  construction and the snapshot unnecessary. `--rescore` re-applies a scorer
  change to datasets already paid for, so this costs nothing but writes.

- **POST-JUDGING TASK 1: the letter handoff, with no recipient.** The verified
  letter is the flagship artifact and it dead-ends at a clipboard. Add one
  button beside Copy and Download: "Open in your mail app", firing a `mailto:`
  with **no recipient**, subject pre-filled, body pre-filled with the stored
  verified letter, plus a plain link to the Board of Supervisors' own public
  contact page so the resident looks the address up themselves. Microcopy:
  "Addressed to your Supervisor by name. You choose the recipient and you send
  it. StreetCred never sends mail."

  **Do NOT implement the version that embeds staff email addresses.** That was
  the first proposal and it breaks a standing rule stated at `src/data.js:108`:
  "Names only. No email addresses anywhere in this product: nothing here is
  ever sent to a real official." Eleven `@sfgov.org` aliases in the repo would
  also rot with the next board turnover and put the letter lane's whole
  "every figure verified" claim behind a bounced address. The no-recipient
  version closes the same loop, survives turnover, and is a stronger honesty
  story than the current dead end rather than a weaker one. About 1.5 hours.

- **POST-JUDGING TASK 2: the "what we did not verify here" box.** A compact
  panel on every corner page naming, from stored records only, what this
  corner's evidence does NOT cover: no visual audit where the hazards record
  is absent or `audited: false`, no press check where `press:{slug}` is
  missing (as distinct from searched and empty), no resident scrape where no
  `voicerun` exists, no exposure normalization anywhere, and the render's
  gate `unchecked` regions where a fix exists. Every line reads off a stored
  field, exactly like the case file, and a corner with nothing missing renders
  nothing. It is the most on-brand feature on the queue: the site's whole
  claim is that it does not overstate what it checked, and right now the
  overstatement is only prevented lane by lane rather than said in one place.
  About 2 hours.

  Runner-ups from the same scan, in order: the 311 deep-link pre-fill panel
  (about 3 hours), `llms.txt` plus `agents.md` for agent readiness (about 1.5),
  district report cards (the best durable feature and far too big for a
  freeze window). A geolocation "grade the corner I am standing on" button
  over the deployed `/api/nearest` was scoped at about 2.5 hours as a judging
  demo mechanic; if judging has passed by the time this is read, it is worth
  far less and drops below every item above it.

- **Show the cadence gap, not just the count.** The ledger already behaves
  correctly and there is nothing to repair: `cotd:log` is append-only and the
  homepage ticker reads "N audited without a human so far", which is a count of
  completed cycles. No consecutive-days counter exists anywhere, so a missed
  day cannot reset one and cannot erase history. What is missing is the display
  half: nothing says "ran 11 of 12 days" or surfaces a gap at all. Compute
  days-with-a-completed-cycle against days-elapsed from `cotd:log` and show
  both. Requested 2026-08-20, deferred to hold the freeze.

- **Nothing can ever be counted as audited-with-imagery-pending.** The cron
  puts a corner in `audited` only when both frames exist and in `enriched`
  otherwise, which is right. But `recountAuditTiers` scans the audited roster,
  where every member has both frames by construction, so `textAudited` is
  structurally always 0 and the "N more with imagery pending" clause in the
  homepage subtitle can never fire. The mechanism works and nothing feeds it. A
  corner audited from the records with imagery pending is currently
  indistinguishable from one that was only swept. Needs a third state, a flag
  or a roster, before that sentence can ever be true.

- **The imagery lane failed on the 2026-08-19 daily audit.** `1st-and-bush`
  came back `partial` and landed in `enriched`. If that repeats, the hero drifts
  further from today every morning and, because of the item above, no surface
  will say why. This is the one worth unfreezing for if it happens twice.

## Open items for the human



Unchanged from the morning report, minus nothing:

- **Billing decision** drives `specs/BILLING_QUEUE.md`, top to bottom.
- **Real-phone mobile pass.** The city board and its pager have been checked at
  desktop widths only.
- **Loom URL** into the README placeholder.
- **People's Choice copy.**
- **Chrome extension account mismatch.** Still live: the browser tools could
  not connect this run, so the heat-dot tap was verified by driving its exact
  request sequence (dots asset, `/api/nearest`, `/api/resolve`, the corner
  page) rather than by clicking a real map. The Leaflet plumbing itself is the
  one thing on this page not exercised end to end by a machine.
- **Watchdog GCP preconditions** before Aug 25.
- **The first Apify run is yours to start**, see gotcha 21 and
  `specs/MAKE_THEM_KNOW.md`.
- **`specs/MAKE_THEM_KNOW.md` is a human checklist**: one LinkedIn post tagging
  both tools, two WhatsApp messages. Nothing in it has been done, and nothing
  in it should be done by a builder session.

One new one worth a decision: **the 25 worst corners in San Francisco are all
ENRICHED and none are audited.** The board now says so out loud on the
homepage. The cron closes that at one corner a day, which is 25 days, or an
afternoon with a funded key and `tools/warm_imagery.mjs` from BILLING_QUEUE
item 3.
