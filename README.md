# StreetCred

[![CI](https://github.com/alejandro-publius/streetcred/actions/workflows/ci.yml/badge.svg)](https://github.com/alejandro-publius/streetcred/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)](.github/workflows/ci.yml)

- **Live site:** https://streetcred.thealexschroeder.workers.dev
- **Demo video:** not recorded yet. The link lands in [Demo video](#demo-video) below, with the shot list.
- **Source:** https://github.com/alejandro-publius/streetcred

**Every claim about a dangerous corner, graded and traced to its source, ending in a picture of the fix and a letter to the Supervisor.**

![Two panels side by side for 16th and Mission with an arrow between them. Left, labelled AUDIT: the real Street View frame with the Gemini safety audit annotated onto it, red over faded crosswalk markings and amber over the vehicle conflict zone, with a legend naming both. Right, labelled PROPOSED FIX: the same view rendered with continental crosswalks, a protected bike lane and a corner curb extension.](assets/readme_hero_16th_mission.png)

*The audit and the proposed fix, 16th and Mission. The fix is an AI visualization, not a photograph of anything that exists.*

Pick a San Francisco intersection. StreetCred shows what the city's own data records, what the press reports, and what residents say, each claim traceable to where it came from. Then it shows what an automated visual audit finds wrong with the corner, what the fix would look like, and drafts the letter to the correct District Supervisor.

Built in a single 55 minute sprint at Build Club, "Moonlighting with Gemini + Exa", August 17 2026. The git log covers the whole product.

The homepage is the city: every warmed corner on one map, ranked by Danger Index, worst first. Any San Francisco intersection can be typed in and graded on the spot. Each corner lives at its own shareable URL.

**Three commands, no credentials, verified 2026-09-07 (see [Running it](#running-it) for the full output):**

```
git clone https://github.com/alejandro-publius/streetcred && cd streetcred
node --test tools/*.test.mjs          # 488 tests, 488 pass, 0 fail
npx wrangler deploy --dry-run --outdir /tmp/build
```

**Jump to:** [What it does](#what-it-does) · [How Exa is used](docs/EXA_USAGE.md) · [How Apify is used](docs/APIFY_USAGE.md) · [How we used Gemini](docs/GEMINI_USAGE.md) · [Architecture](docs/ARCHITECTURE.md) · [How the honesty rails work](#how-the-honesty-rails-work) · [Running it](#running-it) · [Honest limits](#honest-limits)

![The StreetCred homepage, captured headless against the live deployed Worker: the "What's your corner's grade?" search box on the left, and the autonomous corner-of-the-day panel on the right showing the audit-vs-fix comparison for London and Persia with its collision and 311 counts underneath.](docs/screenshots/homepage.png)

*The live homepage, screenshotted headless on 2026-09-07 to confirm the front door is actually up.*

## What it does

- **Grades any San Francisco intersection you can name.** Type two cross streets and the page rebuilds around them: Danger Index, letter grade, severity mix, provenance links. [Find your corner](https://streetcred.thealexschroeder.workers.dev/#find).
- **Ranks the whole city, not a shortlist.** Every graded crossing is drawn on one map and listed on one scoreboard, worst first, on [the homepage](https://streetcred.thealexschroeder.workers.dev/).
- **Shows the corner three ways.** The real Street View frame, the same frame with the hazards a Gemini audit actually found marked on it, and an AI visualization of the fix: [16th and Mission](https://streetcred.thealexschroeder.workers.dev/c/16th-mission).
- **Drafts the letter to the correct District Supervisor**, citing the collision counts, the press coverage and the audit findings by name. A draft that fails verification twice is never served.
- **Audits one new corner every morning with nobody present**, and publishes the result even when a lane fails, with that lane in its labelled degraded state.
- **Publishes what the city's press is talking about**, each candidate corner verified against the graded index, with every rejected candidate and its reason on the page: [/watchlist](https://streetcred.thealexschroeder.workers.dev/watchlist).
- **Holds standing Exa monitors open on the city's corridors** and shows what they caught, what the filter threw away, and what it cost: [/radar](https://streetcred.thealexschroeder.workers.dev/radar).
- **Reports its own uptime and its own spending**, from the providers' own figures rather than its own estimates: [/status](https://streetcred.thealexschroeder.workers.dev/status).
- **Writes down the arithmetic and the limits in full**: [/methodology](https://streetcred.thealexschroeder.workers.dev/methodology), with every grade movement at [/changes](https://streetcred.thealexschroeder.workers.dev/changes) and every autonomous decision at [/watchdog](https://streetcred.thealexschroeder.workers.dev/watchdog).

## Where it stands right now

Generated, not typed. `node tools/readme_numbers.mjs` reads the live endpoints and rewrites the block between the two HTML comment markers below, and nothing else in this file. A press burn is usually running, so these move: every row carries the as-of the site itself publishes for that figure, and a figure the site did not carry at fetch time reads "not known" rather than keeping its last value.

<!-- BEGIN GENERATED: readme_numbers -->

*Generated by `node tools/readme_numbers.mjs`, which reads the live Worker and rewrites only the block between these markers. Fetched 2026-08-26T21:52:09Z. Nothing in this table is typed by hand and nothing is carried over from the previous run: a figure the site did not publish at fetch time reads "not known" rather than keeping its old value. The as-of column is the site's own timestamp for the figure wherever the site publishes one, because a press burn is usually running and several of these move within the hour.*

| Figure | Value | As of | Read from |
| --- | --- | --- | --- |
| Intersections graded citywide | 7,355 | sweep 2026-08-18 | `/api/city` `total` and `sweepDate` |
| Corners fully audited, every lane checked | 50 | read 2026-08-26T21:52:09Z | homepage stat band, `fully audited` |
| Corners on the board | 55 | read 2026-08-26T21:52:09Z | `/api/board` `count` |
| Corners press-checked this month | 1,958 | read 2026-08-26T21:52:09Z | `/watchlist`, the press roll-up line |
| Of those, coverage found | 1,765, a 90.1% hit rate | read 2026-08-26T21:52:09Z | `/watchlist`, hit rate computed from the two counts beside it |
| Press scan in flight, corners checked | 2,022 over 304 chunks | last reported Aug 22, 9:45 PM | `/status`, press scan card |
| Press scan in flight, coverage found | 1,825 of 2,022, 90.3% | last reported Aug 22, 9:45 PM | `/status`, press scan card |
| Press scan in flight, spent | $65.5060 | last reported Aug 22, 9:45 PM | `/status`, press scan card |
| Press citations stored | 3,253 | Aug 20, 5:08 AM | homepage stat band, counted from the stored records |
| Exa spend this period, against the cap | $65.0330 of $65.00 · 6099 searches, 13752 pages of contents, 4 deferred at the cap | 2026-08, Alex Schroeder workspace, confirmed, budget reached | `/status`, metered from Exa's own `costDollars` |
| Exa spend all time | $66.3020 · $1.269 of it before this counter | read 2026-08-26T21:52:09Z | `/status`, from what the provider charged |
| Apify actor runs, against the monthly ceiling | 60 of 70 · $6.999 ledger | 2026-08 | `/status`, ledger written per run |
| Apify invoice for the cycle | $6.4107 of $105 | read 2026-08-26T21:52:09Z | `/status`, the provider's own figure |
| Exa monitors standing on the radar | 29 | created 2026-08-20T02:08:16Z | `/api/radar` `monitors.list` |
| Radar detections in the feed | 0, the monitors are open and nothing has arrived yet | read 2026-08-26T21:52:09Z | `/api/radar` `feed` |
| Radar budget spent, against its caps | 0 of 40 cents today, 0 of 900 cents this month | read 2026-08-26T21:52:09Z | `/api/radar` `budget` |
| Watchlist searches, attempted and completed | 29 attempted, 29 completed | built 2026-08-22T13:20:14Z | `/api/watchlist` `calls`, and `queries[].failed` |
| Watchlist articles read | 423 | built 2026-08-22T13:20:14Z | `/api/watchlist` `articles` |
| Watchlist entries verified | 13 | built 2026-08-22T13:20:14Z | `/api/watchlist` `entries` |
| Watchlist rejects published, with reasons | 20 | built 2026-08-22T13:20:14Z | `/api/watchlist` `rejected` |
| Watchlist phrases discarded, no such SF street | 48 | built 2026-08-22T13:20:14Z | `/api/watchlist` `discarded` |
| Synthetic uptime over 7 days | 47%, 168 runs, 89 with a failing check | read 2026-08-26T21:52:09Z | `/status`, counted from the monitor log |
| Dependencies answering | 8 of 9 answering ok, exa 402 credits not redeemed | read 2026-08-26T21:52:09Z | `/api/health` |

<!-- END GENERATED: readme_numbers -->

## Why this exists

Residents already know which corners are dangerous. City hall runs on evidence. The evidence is scattered across crash databases, 311 queues, news archives, and lived experience, and none of those talk to each other. Turning "this corner feels dangerous" into something an official will act on is a week of work, every time, for every corner.

The people who do that work over and over are neighborhood associations, pedestrian safety advocates, and local newsrooms. StreetCred does it in one page, for any corner with Street View coverage, in seconds.

It is not a dashboard. It ends in an action: a letter addressed to one named person with the power to move it.

## The five lanes

| Lane | Source | Endpoint |
| --- | --- | --- |
| Official records | DataSF collisions and 311, keyless | `/api/stats` |
| Press coverage | Exa | `/api/news` |
| Resident voices | Apify | `/api/voices` |
| Corner seen three ways | Street View plus Gemini vision | `/api/imagery` |
| The ask | Gemini text | `/api/letter` |
| Press history, year by year | Exa, date bounded | `/api/timeline` |
| What each tool actually did | the run itself | `/api/run` |

The first five are the evidence. The last two are the receipts: `/api/timeline` is the same press query run once per year since 2014, and `/api/run` is the manifest of what every tool actually did on this corner, which is what the replay animates.

Four independent sources cross-check each other on one specific claim, and that claim becomes a costed, addressed request. Every endpoint reports a `source` of `live`, `cache`, or `sample`, and the page tags anything that is not live. No endpoint returns an error to the browser, so a panel is never dead.

The rest of the API is on the same contract and is worth clicking: `/api/score`, `/api/cred`, `/api/hazards`, `/api/impact`, `/api/connections`, `/api/suggest`, `/api/city`, `/api/board`, `/api/nearest`, `/api/watchlist`, `/api/radar`, `/api/changes` and `/api/health`, all routed in [`src/index.js`](src/index.js).

The mechanics of how each provider lane runs — the retries, the filters, the honest-empty accounting — are in [`docs/EXA_USAGE.md`](docs/EXA_USAGE.md), [`docs/APIFY_USAGE.md`](docs/APIFY_USAGE.md), and [`docs/GEMINI_USAGE.md`](docs/GEMINI_USAGE.md). The full system diagram is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## The autonomous agent, end to end

The Worker is one half of a loop. The other half is [the Corner
Watchdog](https://github.com/alejandro-publius/streetcred-watchdog), a Python agent on Google
Cloud that reads the city's data every morning, decides on its own whether anything
changed enough to act on, and posts what it decided here. Most mornings it decides to do
nothing, and it posts those mornings too.

The full escalation-path diagram is in [`docs/WATCHDOG_INTEGRATION.md`](docs/WATCHDOG_INTEGRATION.md).

**StreetCred's job in that picture is the two blue boxes.** The ingest endpoint is
authenticated with a single bearer token and traffic runs one way: the cloud writes in
and reads nothing back. This site holds no credential for the agent and cannot call it.

**The gate validates on content, not on the sender.** Six rejection classes, in
`src/agent.js`: an unknown corner, a future timestamp, a malformed decision, a tool this
site does not recognise, a duplicate decision id, and a claimed consequence the site
cannot verify. An unknown tool is refused rather than quietly filtered, because filtering
would let a decision land here shorter than the agent made it.

**A rejection is published, not counted.** Every refused ingest shows on
[/watchdog](https://streetcred.thealexschroeder.workers.dev/watchdog) with its reason
alongside the decisions that were accepted. The first real cloud deliberation was
refused: the agent claimed it had redrafted a letter and this site holds no letter for
that corner. That entry is still on the page, because a gate whose refusals are invisible
is indistinguishable from no gate.

Two bug write-ups from generalizing past one hardcoded corner are in [`docs/SECOND_CORNER.md`](docs/SECOND_CORNER.md) (the district-boundary bug, the hardcoded relevance tokens, the sample-quote fallback) and [`docs/ANY_CORNER.md`](docs/ANY_CORNER.md) (how a typed pair of cross streets resolves against DataSF's own intersection table).

## The scoreboard

The name promised a score. This is where it gets paid.

**The Danger Index** is 0 to 100 with a letter grade, computed only from DataSF. No model touches the calculation, so every input is a number anyone can look up:

```
collisionPoints   = 10*fatal + 6*severe + 3*otherVisible + 1*pain + 2*pedInvolved
maintenanceSignal = min(0.05 * safety311, 8)
points            = collisionPoints + maintenanceSignal
```

all within 80 meters, collisions over five years, filtered 311 over twelve months.

Two radii live in this product and they are not the same claim. The Danger Index counts within **80 meters** (`SCORE_RADIUS` in [`src/score.js`](src/score.js)); the `/api/stats` lane counts within **150 meters**. The same corner therefore has two honest counts: at 6th and Mission, `ubvf-ztfx` returns 9 severe injuries within 80m over five years and 11 within 150m over the same five years, checked against data.sfgov.org on 2026-08-20. The gap is the radius and nothing else. The full derivation of every count this product publishes is in [`docs/COUNTS.md`](docs/COUNTS.md).

The weighting bug that was fixed, the percentile scale, and the three-populations breakdown (8,254 census vs. 7,353 nonzero vs. 7,355 published) are in [`docs/SCOREBOARD.md`](docs/SCOREBOARD.md).

**Corroboration** is what makes the audit worth anything, and the mechanism is rail 4 of [How the honesty rails work](#how-the-honesty-rails-work), below. What it caught is the point here, because it caught this product being wrong. The letter used to assert, at every corner, that "an automated visual audit identified sub-standard, faded crosswalk markings and vehicle turning conflict zones." It was a hardcoded sentence, not an audit result, and this README used to call it the strongest and most checkable claim in the letter. Asked to actually look, the model reports that 16th and Mission's markings are **not** faded, which matches the bright continental striping plainly visible in the screenshot at the top of this file. The product was making a specific, checkable, false claim to a named elected official. The letter is now built from the labels: CONFIRMED may be stated as documented, REPORTED is attributed to the record rather than the photograph, and CANDIDATE is an observation the letter is instructed never to present as fact.

**The Cred Check** puts the whole thesis on one line. Four lanes, four booleans, one verdict: 4 of 4 CORROBORATED, 3 SUPPORTED, 2 PARTIAL, 1 or 0 REPORTED ONLY. Agency primary sources cannot light the press lane, since a police bulletin is the record rather than reporting on it. The resident token list is split between street nouns that count on their own and ambiguous words like "scary" that only count beside one, because without that split a review reading "Safe even though it's a scary movie outside" lights the resident lane at 16th and Mission.

## How the honesty rails work

Six rules keep this product from flattering itself. They are not conventions anyone has to remember: each one is enforced somewhere specific, and the place is named.

**1. Three tiers, and press-checked is not one of them.** A corner is **AUDITED** (every evidence lane checked), **ENRICHED** (records and index, no visual audit yet) or **SCORED** (graded against the census, nothing checked beyond the official record). The vocabulary is defined once, in [`src/city.js`](src/city.js), and the tier is assigned in that same file rather than at each render site, so the word means the same thing on the homepage, on a corner page and in the API. A **press-checked** corner keeps whatever tier it had: the press lane writes `lane: "press-checked"` in [`src/pressenrich.js`](src/pressenrich.js), adds a press section, and does not move the audited count on the homepage. The distinction matters because press-checking is cheap and auditing is not, and a tier that quietly inflates when the cheap thing runs is a tier that means nothing.

**2. Searched and empty is a result, and it is stored and shown as one.** A lane that looked and found nothing is a different claim from a lane that has not looked, and the product never collapses the two. The press lane stores `source: "empty"` for a corner it searched with no on-topic coverage, in [`src/pressenrich.js`](src/pressenrich.js), and [/watchlist](https://streetcred.thealexschroeder.workers.dev/watchlist) prints the count of those alongside the hits. The voices lane does the same: a corner that was scraped and produced nothing on topic is stored with `source: "empty"` rather than as unscraped, in [`src/voices.js`](src/voices.js), the homepage counts those corners separately from the ones that produced an account, and the letter for such a corner quotes no resident at all. The Exa time machine phrases every gap as coverage this search could not find, never as a first report.

**3. Every swept number carries its sweep date, everywhere it appears.** The date rides inside each city shard rather than in a single metadata key, so the corner page can caption a number from the one read it already made instead of spending a second read to date the first: [`tools/build_city_shards.mjs`](tools/build_city_shards.mjs) writes it, and [`src/city.js`](src/city.js) hands it back as `asOf` on the payloads it serves. The same rule holds off the shards: the press citation total on the homepage carries the moment it was counted, from `fmtAsOf` in [`src/index.js`](src/index.js), because that figure moves by the hundred while a burn is running. A number without its as-of is a number that will be wrong later and will not say so. The generated table near the top of this file exists for the same reason.

**4. CONFIRMED, CANDIDATE, REPORTED.** The visual audit answers yes or no to four fixed conditions. What the letter is then allowed to say about each one is decided by arithmetic, not by a model: `label()` in [`src/hazards.js`](src/hazards.js) is six lines with no network call, and [`tools/label.test.mjs`](tools/label.test.mjs) covers all of its branches without a key. CONFIRMED means the photograph and the city's records agree and the letter may present it as documented. REPORTED belongs to the records rather than the photograph and is attributed that way. CANDIDATE is an observation the letter is explicitly forbidden to dress up as fact. No model checks another model's work anywhere in this path, because two models agreeing is not evidence.

**5. The letter verifier can refuse to serve.** Every number and every proper noun in a drafted letter is checked against the set of facts that were fed to the prompt, deterministically, in [`src/verify.js`](src/verify.js). A failing draft is redrafted once with the exact failing token named, and if it fails again it is not served: the path in [`src/index.js`](src/index.js) falls back to the last letter that did verify, marked stale, and records the incident where [/status](https://streetcred.thealexschroeder.workers.dev/status) will count it. Last week's verified letter is stale and true, which beats fresh and invented every time. This is the one lane allowed to be unavailable rather than approximately right, because it is the only artifact a person might send to an elected official with their own name on it.

**6. The rejects are published.** The watchlist prints every candidate crossing it threw away and why, in [`src/watchlistpage.js`](src/watchlistpage.js), and the radar prints what its filter discarded, in [`src/radarpage.js`](src/radarpage.js). A discovery pipeline that shows only its hits is indistinguishable from a search box that got lucky. The current rejects include two pairs of real San Francisco streets with no graded crossing between them, one pair that never meets, one crossing in another city, one article that names a corner without being about safety there, and one corner rejected for being already audited.

## Showing the work

The tools' outputs are all over this page. The tools themselves were invisible. These four features make them visible, at scale and over time, and every one of them is built so it cannot flatter itself.

**Run manifests.** Every corner's pipeline writes `run:{slug}` to KV: what each tool actually did, as counts taken from the payloads the run produced. Nothing is estimated. A stage that did not run records `ran: false` with a reason, which is why a quiet corner's manifest says "no on-topic results found" rather than reporting a zero that reads like a result. The manifest is what makes the rest of this section possible.

**The Exa time machine.** The press query is re-run once per year from 2014 using `startPublishedDate` and `endPublishedDate`, about a dozen searches per corner, cached forever. A collision record says a corner is dangerous now; a year strip says people have been writing about it for a decade. 16th and Mission has coverage in every one of the last thirteen years, 32 headlines in total, from The Bold Italic in 2014 to Walk SF in 2026. 40th and Cabrillo has one, from 2023. That contrast is the feature. It is phrased everywhere as **coverage we can find**, never as a first report, because Exa recall is not ground truth and an empty year means this search found nothing, not that nothing happened.

**The replay.** A "Watch the run" button plays the manifest back as a terminal log, one line per tool, each with its lane color. It is theatre and it says so twice: it names the date of the run it is replaying and it states that timings are compressed. It never re-runs anything, it reads cache only, and under `prefers-reduced-motion` it renders the whole log instantly with no animation and no timers scheduled at all. A corner with missing counts prints why, dimmed, rather than being quietly dropped: a log that shows only successes is an advertisement.

**Corner of the day.** A Cloudflare Cron Trigger audits one new intersection every morning at 06:10 Pacific with nobody present. It eats from a queue of High Injury Network corners, runs the same pipeline a visitor triggers, counts against the same daily generation cap rather than bypassing it, and publishes even when a lane fails, with that lane in its labelled degraded state. It is idempotent by Pacific date, so a redeploy or a retry cannot audit a second corner or spend a second pair of generations. The homepage carries the result and a growing history strip, and the corner's own page says **Audited autonomously by StreetCred on {date}**.

There is a fifth, and it is the one that currently shows nothing. `findSimilar` on the worst corner's best headline looks for a related crossing worth auditing next, then checks every candidate against the city's intersection table before offering it. Right now the coverage related to a fatality at 16th and Mission is entirely citywide, so no candidate survives and the homepage renders nothing rather than a suggestion it cannot stand behind. `/api/suggest` returns the reason.

How corners share to social (the Open Graph card, the homepage's Static Maps composite) is in [`docs/SHARING.md`](docs/SHARING.md).

## Demo video

**Link:** not recorded yet. It lands here.

The full timed script, with narration, lives in [`docs/demo_loom_script.md`](docs/demo_loom_script.md). The shot list, so the recording is paint by numbers:

1. Homepage. The masthead count, the map, the scoreboard reading worst first, the four-tile band at the bottom.
2. Type a corner nobody warmed into the search box. It resolves, grades, and shows its provenance links.
3. [16th and Mission](https://streetcred.thealexschroeder.workers.dev/c/16th-mission): the three imagery states, then the Cred Check line, then the letter with its named Supervisor.
4. "Watch the run": the manifest replayed as a terminal log, with the compressed-timings disclaimer visible.
5. [/watchlist](https://streetcred.thealexschroeder.workers.dev/watchlist), scrolled past the entries into the rejects, because the rejects are the argument.
6. [/status](https://streetcred.thealexschroeder.workers.dev/status): uptime, then the Exa and Apify ledgers with their caps.

## Running it

**With no credentials at all**, which is most of it. Verified on a clean `git clone` into an empty directory on 2026-09-07, Node v26 locally, and this is the exact output:

```
git clone https://github.com/alejandro-publius/streetcred && cd streetcred
node --test tools/*.test.mjs          # 488 tests, 488 pass, 0 fail
npx wrangler deploy --dry-run --outdir /tmp/build
```

The dry run reads 26 asset files from `public/`, reports a total upload of 621.97 KiB (171.31 KiB gzipped), and lists the two bindings the Worker uses: `env.STORE`, a KV namespace, and `env.ASSETS`. It warns that multiple environments are defined and no target was named, which is expected: production is the top-level environment and `preview` is the other one.

**There is no `package.json` and none is needed.** Nothing here is installed, bundled or transpiled. `wrangler` is invoked through `npx`, the source is plain ESM, and the tests use Node's own runner. CI runs those same two commands on **Node 22**, plus the verifier's own test file and a grep for key patterns across the tree, in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

**What needs credentials**, stated separately because each of these fails differently without one:

```
cp .dev.vars.example .dev.vars    # EXA_API_KEY, APIFY_TOKEN, GEMINI_API_KEY, GOOGLE_MAPS_API_KEY
npx wrangler dev                  # needs a Cloudflare login and the KV namespace
python3 tools/generate_imagery.py # needs GOOGLE_MAPS_API_KEY and GEMINI_API_KEY
```

Neither of those last two was verified in the clean-clone run above, because both need credentials this pass did not have. Their commands are correct as written and their outputs are unverified, and that is the honest state of them.

`GET /api/health` pings every dependency and reports them individually, which is the fastest way to find out which key is missing.

## Service level

An hourly synthetic monitor (its source is `synth/` in this repo) loads the homepage, a flagship
corner, and that corner's data lanes, and records every result to a public log. [/status](https://streetcred.thealexschroeder.workers.dev/status)
counts those records. The target is modest and stated plainly: **99% of synthetic checks passing over
any 7 days**. This is a civic reference built on free tiers, not a paged service; when it misses, the
status page says so rather than the number quietly improving.

## Honest limits

- The hazard overlay is a model reading of a photograph. It marks zones, it does not measure them.
- The proposed fix image is a visualization, not an engineering drawing, and the cost is an order-of-magnitude estimate.
- 311 counts are filtered to street-related service types within 150 meters, which is a proxy for street complaints, not a precise one.
- The voices lane is the thinnest of the five, and the reason is a finding rather than a bug. Both Apify actors ran and returned real data, but Google Maps reviews at this corner are overwhelmingly about the BART station (escalators, cleanliness, policing) and the Reddit search returned mostly off-corner noise. That is why selection moved out of the scrape and into the normalizer, which scores quotes by how directly they speak to street safety rather than passing a flat keyword test. Every quote shown is still real scrape output, never generated. The letter also only quotes a resident when the quote is actually about the street, and otherwise quotes no one rather than inventing testimony.
- Any San Francisco intersection resolves, but the warmed corners are still the ones that look best. A typed corner takes the default panorama orientation, because the heading that puts the crosswalk in the foreground was chosen by hand for the precomputed pair and there is no way to pick it automatically. Expect a resolved corner to sometimes show the street rather than the crossing.
- DataSF does not have an intersection node for every place two streets meet. Sunset and Sloat is a real junction near the zoo, but the city's dataset models it as a grade-separated interchange rather than a crossing, so the resolver correctly reports that both are San Francisco streets which do not intersect. That is accurate to the source and still not what a person typing it expects.
- The Danger Index ranks reported harm, not risk. A corner nobody walks through cannot generate pedestrian collisions, so a quiet corner scores low for a reason that has nothing to do with whether crossing it is safe. There is no exposure normalization anywhere in the formula, and the caveat sits on the page for that reason.
- The index is a percentile against a frozen reference, so the top of the board is compressed and a corner can in principle run off the end of it. The frozen distribution's maximum is 196.9 points, which is 6th and Mission, and that corner still computes exactly 196.9 today. Live points can drift above whatever the sweep recorded as new collisions land, and any corner past the 99th percentile reads 99 regardless of how far past it is, because `percentileOf` in [`src/score.js`](src/score.js) caps there: no corner is worse than itself. 16th and Mission computes 107.4 points and reads 99, and so would a corner at 150. Both read 2026-08-20 from `/api/score`. A corner reading 99 is therefore not necessarily worse than one reading 96.
- The visual audit reports on one Street View frame, taken on one day, facing one direction. It cannot see the other three approaches to an intersection, and a corner photographed in bright midday sun will not show a lighting problem that only exists at night. CANDIDATE means the model saw something the record has not caught up with; it does not mean the model is right.
- The press watchlist attempts 29 citywide searches each morning and most of them do not run. It executes last inside the daily-audit cron invocation, so it inherits an already-spent subrequest budget and the rest fail with "Too many subrequests by single Worker invocation". On the 2026-08-19 pass, 8 of 29 completed. Every failure is stored with its reason and the count is in the generated table above, but the lane is seeing a fraction of the coverage it asks for and the fix is scheduling, not searching harder.
- The Cred Check verdict is a count of lanes, not a weighting of them. Four weak agreements read the same as four strong ones.
- The resident voices lane only exists for corners that were scraped ahead of time. A typed corner shows the honest empty state, because an Apify actor run takes minutes and a page load cannot wait on one.

## Deeper docs

Cut from this README to keep it readable, not to bury it. Each file below keeps the words it had here.

| | |
|---|---|
| [`docs/EXA_USAGE.md`](docs/EXA_USAGE.md) | The three Exa lanes in full: press-per-corner, the 2014-onward timeline, `findSimilar`, the citywide watchlist sweep, and the spend meter |
| [`docs/EXA_INTEGRATION.md`](docs/EXA_INTEGRATION.md) | A judge-facing, byte-level proof of the Exa lane, with `file:line` citations |
| [`docs/APIFY_USAGE.md`](docs/APIFY_USAGE.md) | The resident-voices lane: the two actors, the unattended commission-and-ingest cycle, the budget ceiling |
| [`docs/GEMINI_USAGE.md`](docs/GEMINI_USAGE.md) | The vision and text jobs, the three-state imagery pipeline, and how the letter is bound to CONFIRMED/REPORTED/CANDIDATE |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The full file tree, the system diagram, and the two-layer cache |
| [`docs/WATCHDOG_INTEGRATION.md`](docs/WATCHDOG_INTEGRATION.md) | The Corner Watchdog escalation-path diagram: Observer, Actor, and the publish boundary |
| [`docs/SECOND_CORNER.md`](docs/SECOND_CORNER.md) | Three bugs that only became visible under a second corner |
| [`docs/ANY_CORNER.md`](docs/ANY_CORNER.md) | How a typed pair of cross streets resolves against DataSF's own intersection table |
| [`docs/SCOREBOARD.md`](docs/SCOREBOARD.md) | The weighting bug that was fixed, the percentile scale, and the three-populations breakdown |
| [`docs/SHARING.md`](docs/SHARING.md) | Open Graph cards, the share image, and how the homepage map is built from one Static Maps request |
| [`docs/COUNTS.md`](docs/COUNTS.md) | The derivation of every count this product displays |
| [`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md) | A dated decision log reconstructed from commits and specs |
