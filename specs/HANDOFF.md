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

## Polish pass rollback

The polish pass of 2026-08-19 is visual and copy only: no scoring, data, API
behaviour, cron or cap changed. It was built on branch `polish/pass-1` and
verified on a preview Worker before main was touched.

**Production deployment live before the pass:**
`f75ce774-e045-4aba-9d2d-6969b2c9e878`, deployed 2026-08-19T00:08:50Z.

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
