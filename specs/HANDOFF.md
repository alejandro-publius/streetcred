# Handoff for a fresh session

Written 2026-08-18, after the overnight ONE PASTE run and its close-out. Read
this before touching anything; the gotchas at the bottom are each a bug that
already happened once.

## The last 25 commits, one line each

```
cdee081 impact tables approved on the record      human approval recorded in BILLING_QUEUE item 1
ceca878 merge human pass into production          redesign branch merged; both conflicts were additive unions
fee36dc billing queue codified                    specs/BILLING_QUEUE.md, 4 items in execution order
437692c projected outcome + precedent card        fix-state projections + SFMTA precedent card, live
b298bf6 projection engine                         src/impact.js, deterministic, hand-check matched
7986b5e cmf + precedent data                      data/cmf.json + data/precedents.json, every source opened
6152314 split stage                               desktop band, in-place pushState corner swaps, proven
1351ae2 honesty polish                            one tag system, voices street-token rule, percentile travels
44488ac check your corner                         homepage question hero, local-only Your Corners
4b17923 letter forward                            sticky bar, mobile order, Copy promoted, Download-as-text
4b5f8ea verdict block                             grade + percentile + thesis + cred dots above imagery
d5852cd preview env                               (worker since deleted after merge verification)
ee150cb a11y floor                                slider keys, data alt text, AA contrast, landmarks, axe clean
76ea215 ci + status                               GitHub Actions gate, synth monitor worker, /status
3082461 methodology + changelog                   /methodology, /changes, grade history, changes:log
9e3832e provenance                                soqlUrl receipts on stats + score, stat numbers are links
ffcb82f corner typeahead                          7,926 crossings, 247 KV shards, APG combobox
44b032d tap any corner                            /api/nearest, popup-confirm resolve flow
954fdc9 interactive map + city layers             Leaflet+Carto both surfaces, 3 layers, heat dots
54d40bc score tier fleet                          top-100 pages, scoredonly imagery state, queue reseeded
f5c6a7f census recalibration                      8,254-crossing census replaces the 600 sample, SCORE v3
44d9f3e citywide sweep                            tools/sweep.mjs, parity-proven counter, artifacts committed
bfc41e7 watchdog diary: real repo url             alejandro-publius/streetcred-watchdog
563af3b error hygiene + radius labeled            generic 500s, honest 404s, both radii labeled
d3e77d2 letter verification                       src/verify.js, one verifier for serving + agent paths
```

Earlier the same day: `68a92fb` watchdog ingest and diary, `37a94ca` board api.

## Deployed state: what a visitor sees today

Production is `streetcred` at https://streetcred.thealexschroeder.workers.dev,
deployed from main at `cdee081`, health all green.

- **Homepage**: "What's your corner's grade?" over a big typeahead; scope line
  "123 intersections scored, 23 fully audited, one more every morning"; Corner
  of the day; local-only Your Corners strip; interactive Leaflet city map
  (audited pins, scored rings, census heat dots past zoom 13); scoreboard.
- **Corner page**: verdict block (grade chip, percentile sentence, thesis,
  Cred Check dots, Get the letter) above everything; desktop >=1100px puts
  imagery 60 / live corner map 40 in one band, with in-place pushState corner
  swaps from pin taps and a working back button; mobile order is verdict,
  imagery, letter, evidence, map; sticky letter bar on scroll; every stat
  number is a provenance link to its exact Socrata query; Projected outcome on
  the fix state; This works in San Francisco under the letter; grade history
  line when the changelog has rows.
- **/watchdog** diary (agent journal, 1 real entry), **/methodology**,
  **/changes**, **/status** (hourly synthetic monitor), all footer-linked.
- **The merge is completed and verified**: served script parsed as a file,
  behavioral swap test run against production (16th & Mission -> Taylor &
  Turk repainted 67 -> 80 collisions, pushState fired), desktop band and
  mobile stack screenshotted, homepage verified, preview worker and the
  redesign branch deleted afterward.

## Done and where the artifacts live

- **Citywide sweep**: `tools/sweep.mjs`; committed artifacts
  `sweep-results.json` (7,353 named nonzero corners with raw counts) and
  `sweep-distribution.json` (all 8,254 values + row counts). Raw pulls cached
  in `.sweep-cache/` (gitignored). Local counter proven EXACT against
  production `within_circle` on three corners before anything was written.
- **Census recalibration**: `src/distribution.js` is the frozen census,
  declared final, dated. `SCORE_VERSION = "v3"`. Zero grade changes on the
  warmed fleet; index capped at 99. The 600-sample era is git history.
- **Score tier**: top 100 un-audited corners seeded by
  `tools/seed_scoretier.mjs` (corner: + score: KV, `tier:"score"` drives the
  honest "scoredonly" imagery state). `public/data/scoretier.json` and
  `public/data/heat.json` are the map/typeahead assets. `cotd:queue` holds 100
  worst-first names beginning 6th and Mission.
- **Impact tables**: `data/cmf.json`, `data/precedents.json` (mirrored under
  `public/data/` for the client). **Approved by the human 2026-08-18 exactly
  as curated.** Engine `src/impact.js`; endpoint `/api/impact`.
- **Typeahead index**: `tools/build_suggest_index.mjs` -> 247 `suggest:idx:*`
  KV shards.
- **Timelines**: 17 of the 100 score-tier corners built (221 Exa calls);
  rerun `node tools/build_timelines.js --file public/data/scoretier.json`
  daily until the 40/day budget stops finding work.

## Billing: still blocked

Key #2 (in the Worker as GEMINI_API_KEY) is free-tier: **20 text calls/day on
gemini-3.7-flash, spent daily by testing + the synthetic monitor's occasional
cold letter; zero image generations; zero Pro calls.** `specs/BILLING_QUEUE.md`
is current and ordered: (1) fleet letter regeneration with approved impact
sentences, verifier extension FIRST; (2) golden corpus into CI; (3) audit-tier
imagery + OG under an operator budget; (4) Pro A/B with the responseSchema
think=0 re-confirmation. Try a key minted inside the moonlight26aug17sfo
project first; if it also reads limit 0, the grant is gone.

## KV key families (binding STORE, id 6918c07a...)

`corner:{slug}` `score:{slug}` `hazards:{slug}` `cred:{slug}` `hin:list`
`cotd:queue` `cotd:log` `timeline:{slug}` `timelines:{day}` (budget)
`gen:{day}` (image budget) `imgstatus:{slug}` `img:{slug}:{state}` `og:{slug}`
`apify:{slug}` `run:{slug}` `letterrun:{slug}` `letter:verified:{slug}`
`trust:incidents` `changes:log` `suggest:board` `suggest:idx:{2chars}`
`agent:journal` `agent:rescore/letter/flag:{slug}` `agent:rejects`
`synth:log` (written by the separate `streetcred-synth` worker, hourly cron
at :07, service-bound to the site) `rl:{ip}:{window}`.

## Gotchas a fresh session must not rediscover

1. **The page's JS lives inside a template literal.** `node --check
   src/page.js` validates the template, NOT the page. `\/` or `\'` written
   into it are EATEN and serve as syntax errors that kill the whole script.
   Always emit and check: render PAGE(), extract the `<script>`, `node
   --check` that file. This bit twice tonight (a regex, an apostrophe).
2. **Radius labeling is a decision, not a bug.** The grade counts 80m
   (SCORE_RADIUS), displayed stats count 150m (radiusMeters). Both are
   deliberate, both are labeled everywhere (tiles, index panel, letter
   sentence, /methodology). Do not "fix" the mismatch.
3. **There is no per-corner cache invalidation.** `stats:`/`letter:` memo keys
   are in-process; the edge cache keys carry CACHE_VERSION (v11) and
   LETTER_VERSION (v6). Version bumps invalidate EVERYTHING. Bumping
   LETTER_VERSION while generation is quota-blocked turns every letter into a
   sample (this happened; the revert is in `d3e77d2`'s message).
4. **Samples and empty payloads are never edge-cached** (by design), so a
   failing lane retries on every request. On a quota-starved key the letter
   lane is therefore SLOW (15-35s), which makes headless screenshots hang.
   That is the honesty rule working, not a bug.
5. **The cron and the caps are untouchable.** 06:10 PT cotd cron (13:10 UTC,
   shifts to 05:10 PT when DST ends), DAILY_GENERATION_CAP 25,
   DAILY_TIMELINE_CAP 40, the agent ingest rails. Operator tools respect
   them; they are never bypassed, only reported.
6. **The verifier is `src/verify.js`** and it is ONE function used by both the
   serving path (index.js getLetter) and the agent ingest (agent.js). Frozen
   doctored cases live in `tools/verify.test.mjs`, in CI. Extending the input
   set for impact sentences is BILLING_QUEUE item 1's first step.
7. **Flagship slugs are legacy**: `16th-mission`, `6th-market` (no "-and-").
   `ALIASES` in data.js maps the long forms. Everything else is
   `{a}-and-{b}` alphabetical from parseQuery. Never build slugs by hand;
   go through parseQuery + canonicalSlug.
8. **A Worker cannot fetch its own endpoints** (error 1042), and
   workers.dev cannot fetch workers.dev in the same account (instant 404s).
   The synth monitor uses a service binding for this reason.
9. **The 311 dataset's `point` is the legacy Socrata location type**
   ({latitude, longitude} strings); collisions use GeoJSON. A reader that
   handles one shape silently zeroes the other dataset citywide.
10. **rescore.js reads the live board first** for WHICH corners exist; the
    local `.hin-list.json` goes stale the morning the cron adds a corner
    (this once dropped the corner of the day off the board, and separately a
    board restore without lat/lon NaN'd every homepage pin -- HOME now drops
    non-finite rows).
11. **Unknown slugs 404 honestly** (page and API). Only slugless requests get
    the default corner. The agent path uses strict `cornerBySlug`.
12. **My admin pushes bypass branch protection** (the "checks" requirement
    binds non-admin merges). CI still runs on every push and is green.

## Open items for the human (unchanged from the morning report)

Billing decision -> BILLING_QUEUE top to bottom; real-phone mobile pass; Loom
URL into the README placeholder; People's Choice copy; Chrome extension
account mismatch; Watchdog GCP preconditions before Aug 25 (the agent repo
scaffold is public at alejandro-publius/streetcred-watchdog, 21 tests green).
