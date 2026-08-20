# Architecture decisions

Backfilled 2026-08-20 from this project's own record: the commit log, `specs/HANDOFF.md`
(whose "Gotchas a fresh session must not rediscover" section is a decision log in all but
name), `specs/BILLING_QUEUE.md`, and the top-of-file comments in `src/`, which in this repo
usually state the decision and its reason directly.

Newest last. Each entry gives the context, the decision, and the consequence including what
it costs. Where a decision corrected an earlier one, the earlier one is named and so is what
it broke, because that is the part worth reading.

Every entry cites the commit, the `file:line`, or the spec section it was reconstructed from.
Nothing here changes behaviour and nothing here is a proposal. It was written during the
feature freeze that runs to 2026-08-25.

Two limits on this file, stated rather than hidden. Decisions taken in conversation and never
written into a commit, a comment or a spec are not here, because there is no record of them
to reconstruct; where a decision exists in the tree but the record does not date it, the entry
would say "date not recorded", and as it happens every decision below is dated by a commit.
And `src/methodology.js:189` still describes the watchlist as "Seven citywide semantic
searches" while the live build recorded 29 queries, so at least one published description of a
decision below is stale in the deployed code. That is noted where it applies, not corrected
here.

---

## 2026-08-17: An explicit allow list of 311 service types, not a substring match

The Danger Index and the stats tiles both count 311 street-condition reports near a corner,
and the first implementation selected them by matching any service category containing the
word "Street". That swept in "Street and Sidewalk Cleaning", which is a sanitation queue of
millions of rows and not a signal about the physical condition of a crossing. It inflated one
corner from 354 reports to 8,546. (`README.md` rounds the same figure to "roughly 355";
the code comment and `/methodology` both say 354, and that is the number used here.)

The filter is now a verbatim list of nine service names in one place, `src/data.js:47`,
shared by the score and by the stats lane so the two cannot drift. The cost is that the list
is ugly, has to be maintained by hand, and will silently miss a category the city adds later:
adding one is a deliberate edit rather than something a pattern picks up for free. That is the
trade the project took, and `/methodology` states it in the same words the code does: a
substring match was elegant and wrong by a factor of 24.

Source: `797bbed` (data corrections), `f27a39e` (danger index), `src/data.js:47-61`,
`src/methodology.js:88-94`, README.md "What the second corner exposed".

## 2026-08-17: The letter reserves judgment, and CONFIRMED, CANDIDATE and REPORTED are computed from record counts

Hazard corroboration was built on a premise that turned out to be false: that the imagery
record already held hazard labels. It did not, it held image bytes, and the annotation prompt
names the two hazards it wants drawn, so the annotation pass cannot discover anything.
Corroborating it would have meant every corner flagging the same two constants and every
corner then having them confirmed. Building the real audit pass exposed something worse. The
letter had been asserting "an automated visual audit identified sub-standard, faded crosswalk
markings" at every corner, as a hardcoded sentence, and the README described it as the
product's strongest and most checkable claim. Asked to actually look at 16th and Mission, the
model reported the markings are not faded, which matches the bright continental striping
visible in the frame. The letter was making a specific, checkable, false claim to a named
elected official.

The audit pass now asks the model which of four fixed conditions it can see and returns
booleans, and everything after that is arithmetic: `label()` in `src/hazards.js:188` decides
CONFIRMED when the model saw it and the record supports it, CANDIDATE when the model saw it
and the record is silent, and REPORTED when the model did not see it but the record raises it
anyway. The letter is built from those labels, CONFIRMED may be stated as documented, REPORTED
is attributed to the record and not to the photograph, and CANDIDATE is an observation the
prompt is instructed never to present as established fact. The cost is that the strongest
sentence the letter used to carry is gone, and many corners now say less. That is the correct
amount to say.

Source: `8968383` (hazard corroboration), `src/hazards.js:180-193`, `tools/label.test.mjs`.

## 2026-08-17: A lane that fails renders its labelled degraded state, and no endpoint returns an error to the browser

Every panel on a corner page is fed by a different provider, and any of them can be down,
rate limited, out of budget or simply empty for that corner. A page that surfaces an error
from one lane teaches a reader to distrust the other eight, and a page that renders half of
itself teaches them nothing at all.

Every provider lane is optional at request time and answers with its labelled degraded state
instead of an error. Two rules keep that honest. Sample and empty payloads are never written
to the edge cache, so a lane that failed once is retried on the next request rather than
pinned in that state for the life of the cache entry; `verified-cache` was later added to the
same exclusion list because it is what the letter lane serves while the model is unavailable
and caching it for a day would outlast the hour-long backoff that produced it. And what goes
back to the browser is always `no-store` while the internally cached copy carries `max-age`,
so a data correction ships and actually shows up. The cost is real: a persistently failing
lane is retried on every single request forever, which is exactly the load pattern a cache
exists to prevent, and the project pays it deliberately.

This was corrected once on 2026-08-18. The global handler carried the comment "No endpoint may
ever return an error to the browser" and then returned `String(e.message)`, which could echo an
upstream response body to a client verbatim. The comment claimed one thing and the code did
the reverse. Browsers now get `{error: "internal error"}` and the detail goes to the Worker
log.

Source: `f76e863` (readme truth pass), `563af3b` (error hygiene + radius labeled),
`src/index.js:96-132`, `src/index.js:2491-2498`, README.md "How it is put together" (the
provider-lane paragraph and the two caching rules), `specs/HANDOFF.md` gotcha 4.

## 2026-08-18: A 311 report is capped at less than one fatality

The first Danger Index gave each filtered 311 report half a point, uncapped. A corner with
353 reports therefore collected 176 points from maintenance complaints against 10 for a death,
and the report count rather than the collision record decided the grade.

The signal is worth keeping, because a corner nobody reports is a corner nobody is watching,
so it stays as context and is capped: 0.05 points per report to a ceiling of 8, against a
fatality weight of 10. The cap is deliberately smaller than one death and is stated on
`/methodology` in those terms. The cost is that a genuinely neglected corner with hundreds of
reports and no recorded collisions cannot climb out of the calm end of the distribution on
paperwork alone, which is the intended behaviour and also a known blind spot.

Source: `8acf0f1` (danger index v2, commit body empty; the reasoning is in the code),
`src/score.js:24-31`, `src/methodology.js:96-103`.

## 2026-08-18: The letter verifier is deterministic, and there is exactly one of it

The letter is the only artifact on this site a person might print and send to an elected
official with their own name on it. A letter citing a collision count the city never recorded,
or addressed to the wrong Supervisor, is a person made to look careless in public by software
they trusted.

Verification is arithmetic and set membership over the same input objects the prompt was built
from, and no model checks another model's work, because a second model has the same failure
mode as the first and two models agreeing is not evidence. `verifyLetter` is one function with
two callers, the serving path in `src/index.js` and the agent ingest path in `src/agent.js`.
A verifier the agent can route around is not a rail, and two verifiers that drift apart are
worse than one. The cost is that the verifier only knows what is in its input set, so
extending what a letter is allowed to assert means extending `buildInputSet` first: this is
written into `specs/BILLING_QUEUE.md` item 1 as an ordering constraint, verifier before
prompt, with a doctored case required before the wiring.

Source: `d3e77d2` (letter verification), `src/verify.js:1-20`, `src/verify.js:34`,
`specs/BILLING_QUEUE.md` item 1.

## 2026-08-18: The agent's claim that it verified itself is recorded and then ignored

`/api/agent/*` is the only endpoint on StreetCred that accepts facts from outside the
building, written by an autonomous agent running on Google Cloud, so it is the only one that
has to assume its caller is wrong or hostile.

Two rails, deliberately independent. A bearer token nobody else holds, where a failed request
dies at 401 having produced exactly one side effect, a counter, with no IP, no body and no
echo of what was sent, because a detailed rejection is an oracle for guessing the token. And
every number in an agent-written letter is checked against the corner's own DataSF record
before the letter is stored. The agent may declare that it verified its own output; that claim
is recorded and then ignored in favour of the arithmetic in `src/agent.js`. An agent allowed to
mark its own homework is not being supervised. The cost is that the agent's throughput is
bounded by the verifier, and legitimate agent letters can be rejected for citing numbers the
Worker cannot reproduce.

Source: `68a92fb` (watchdog ingest and diary), `bfc41e7` (watchdog diary: real repo url),
`src/agent.js:1-23`.

## 2026-08-18: The census is declared final and does not float with new data

Grades were calibrated against a 600-corner sample of the city, which was the right tool when
scoring every crossing cost about 25,000 API calls. `tools/sweep.mjs` made the census cheap,
so all 8,254 real crossings were scored with the production formula and the resulting
distribution was frozen into `src/distribution.js`.

The array is then declared final in the file itself: it is not to be recomputed. A grade is a
percentile against that yardstick, and a yardstick that changes length regrades every corner
in the city for reasons that have nothing to do with the city. People screenshot these grades
and paste them into public comment, and a grade that drifts while nothing changed on the
ground is a grade nobody can cite. The recalibration validated the sample rather than
repudiating it: re-scoring all 22 warmed corners changed zero grades, the largest percentile
move was 3 points, and both medians are 3.1. The costs are stated plainly. The distribution
ages, silently, against a city that keeps having collisions. Escaping that requires bumping
`SCORE_VERSION`, shipping a changelog entry on every affected corner and saying so on
`/methodology`, which is expensive on purpose. And the guard is mechanical rather than
advisory: `tools/build_city_shards.mjs` refuses to build if the artifact and the frozen
constant disagree, which is why `tools/sweep.mjs` must not be rerun casually.

Source: `f5c6a7f` (census recalibration), `src/distribution.js:1-27`, `src/score.js:16-19`,
`specs/HANDOFF.md` gotcha 14.

## 2026-08-18: Two radii on purpose, 80 metres for the grade and 150 for the surroundings, stated rather than reconciled

The same corner can be made to report two different counts of the same thing. At 6th and
Mission the severe-injury count over five years is 9 within 80 metres and 11 within 150,
re-measured against `data.sfgov.org` dataset `ubvf-ztfx` on 2026-08-20. Both are correct, and
the gap is the radius and nothing else.

They are two answers to two different questions and both are kept. `SCORE_RADIUS = 80` in
`src/score.js:13` bounds the Danger Index, because a grade is a claim about one intersection
and not about a block in every direction. The displayed statistics use 150 metres, because
they describe the corner's surroundings. The decision was not to pick one and quietly restate
the other, but to label the radius everywhere both figures appear, and to carry the window and
the radius in the payload rather than baking them into the page. The cost is that a reader who
does not read the labels sees two numbers for one thing and concludes the site is inconsistent,
which is a worse first impression than a single tidy figure would make and a better second one.
The full derivation, with a runnable query for each count, is in `docs/COUNTS.md`; it is not
duplicated here.

Source: `563af3b` (error hygiene + radius labeled), `e5cbbe7` (burn 2: the counts derivation),
`src/score.js:11-13`, `docs/COUNTS.md` section 6, `specs/HANDOFF.md` gotcha 2, and a direct
`within_circle` count against `ubvf-ztfx` at radius 80 and 150 run 2026-08-20.

## 2026-08-18: The city ships as 71 KV shards, not as 7,353 records

Publishing every graded crossing as its own KV record would be 7,353 writes to publish the
city and 7,353 more to correct it, which is the wrong shape for a store with a write quota and
no transactions.

Corners are bundled by the first character of the slug, with digits taking two characters so
that every numbered street in San Francisco does not pile into one bundle several times the
size of any other. A corner page is one read, the whole city republishes in one bulk
operation, and the largest shard is 175.4 KB against KV's 25 MiB ceiling, with the builder
refusing to run if any shard passes a tenth of the limit. Nothing in `src/city.js` computes a
grade: the index and grade were computed at build time by the same `percentileOf` and
`gradeFor` the live path calls, against the same frozen census, because a second
implementation would eventually disagree with the first and the page would show no sign of it.
Two costs follow and both are recorded. The tier rosters in `city:meta` are for list surfaces
only, so a corner created by an on-demand resolve shows as SCORED on the board until the next
shard build. And `resolveCorner` deliberately does not write shard corners into KV, because
storing one would promote a corner into the warmed fleet just because somebody looked at it,
and the fleet is what the daily audit works through. The 7,353 figure is the one that was true
when the shards were built; the counter reads 7,355 today, because a slug-collision audit later
split two crossings that had been sharing one page.

Source: `388c7e0` (city shards), `52afa33` (composed corners), `src/city.js:1-13`,
`specs/HANDOFF.md` gotchas 18 and 20.

## 2026-08-18: The interactive map is Leaflet over Carto tiles, never the Google Maps JS SDK

The homepage and the corner page both needed a real map rather than a static image with
anchors positioned by hand-rolled Web Mercator arithmetic. The obvious upgrade, the Google Maps
JS SDK, puts an API key in client HTML.

This product's zero-keys-in-the-browser property is load bearing, so the map is Leaflet with
Carto raster tiles, added as progressive enhancement: the server-rendered static image stays
until the tiles have actually arrived, and a failure at any step leaves it standing. Tile
attribution renders on the map and the captions name the provider actually on screen, which
means the credit changes from Google to OpenStreetMap and CARTO at the moment the interactive
layer takes over. The cost is a second rendering path to keep working and a payload the static
version did not have.

Source: `954fdc9` (interactive map + city layers), `public/leafmap.js`, `src/home.js:1-7`.

## 2026-08-18: A failed KV read is an error, not an absent key

The batch tools run `src/` modules in Node through a Worker-shaped `env` backed by the
wrangler CLI, which is what lets the tools share the Worker's code instead of forking it. That
adapter treated a failed read the same as a missing key and returned null. For a corner record
that is harmless. For a budget it is not: a transient Cloudflare authentication error made a
tool read the Exa counter as zero of 1,500 when KV actually held 103. That is precisely how a
tool talks itself past a spending ceiling.

Cloudflare returns 404 for an absent key and something else for a failure, so the adapter now
tells them apart and throws rather than inventing an answer, and it does not cache either
outcome, because a transient failure must not become a value the process believes for the rest
of its life. The related bar-shutoff case has the same shape and is recorded next to it: a
verification bar that read its own reference data once per candidate cached a null after one
failed read and silently stopped running, with no symptom except a reject log filling with
navigation menus. Reference data is loaded once per build now. The cost is that batch tools
are more brittle in the face of a flaky network, which is the correct direction for a process
that spends money.

Source: `985eed9` (ledger tells the whole story, and a failed read stops lying),
`tools/lib/kvenv.mjs:22-55`, `specs/HANDOFF.md` gotchas 22 and 25.

## 2026-08-18: The discovery pipeline publishes its rejects

Every other lane on the site starts from a corner and asks what is written about it. The
watchlist runs the other way: it starts from the city's coverage and asks which corners are in
it. That is an entity-discovery problem, and a discovery pipeline that shows only its hits is
indistinguishable from a search box that got lucky.

Candidates must clear three bars, both names being real San Francisco streets against the
2,219-name city index, an exact pair match in the graded-city index, and coverage confirmed to
be about safety at that crossing. Everything that fails is stored with its reason and rendered
on `/watchlist`, along with the count of extracted phrases that named no street at all. The
cost is that the page usually shows more rejects than entries, and says so: the live build of
2026-08-19T13:11Z read 117 articles across 29 queries over a 90 day window and published 5
verified entries against 7 rejects and 25 discarded phrases. Note one staleness this file will
not fix: `src/methodology.js:189` still says "Seven citywide semantic searches", which was true
of the first version of this lane and is not true of the build now serving.

Source: `68b47fb` (press watchlist), `src/press.js:1-22`, `src/watchlistpage.js:1-7`,
`curl -s .../api/watchlist` run 2026-08-20.

## 2026-08-18: The preview Worker shares production's KV and carries none of its keys

A preview environment is for checking a visual change before production sees it. It needs to
read exactly what production reads, which means the same KV namespace, and it must not be able
to act like production, which means no cron triggers: a second 06:10 firing against a shared
store would consume the corner-of-the-day queue and the generation budget twice.

Secrets do not inherit across wrangler environments, and the decision was to leave it that
way rather than copy live keys onto a second public Worker. `wrangler secret list --env
preview` returns an empty list. The consequence has to be known before reading any preview
result: the press lane, the letter, the resident voices and the static map all degrade to
their sample or empty states on preview, so it verifies HTML, meta, layout, links and honesty
copy faithfully and verifies nothing that needs a key. Those cells are checked against
production instead. The cost is a preview that is only half a preview. The alternative is
putting a spendable surface on the internet in order to check a visual change, which is a
worse trade. Every page on preview also carries a dashed PREVIEW badge, so a preview
screenshot cannot be mistaken for production.

Source: `d5852cd` (preview env), `wrangler.jsonc:34-39`, `specs/HANDOFF.md` "Deferred from
polish pass", third bullet.

## 2026-08-18: One slider implementation with two mounts, never a second slider

The before-and-after comparison slider existed on the corner page. The homepage hero needed
the same interaction, and the obvious move was to write a small one for the hero.

Instead the corner page's slider was extracted: `SLIDER()` emits the markup and `SLIDER_JS`
carries `mountSlider()` for drag, touch and keyboard, and both surfaces inline the same source.
The CSS is keyed on `.sbase`, `.sov` and `.shdl` rather than on the corner page's `#base`,
`#overlay` and `#handle`, which is the only reason a second mount can exist at all, and the
element ids are therefore parameters of `SLIDER()` because the corner page's script predates
the extraction and still addresses its own elements by name. Adding a second slider rather
than a second mount is how the two would drift. The cost is a slightly awkward API, an id
parameter that exists purely for backwards compatibility, and one component that two very
different layouts both have to live with. What it buys is that changing the drag changes both
places at once, and that a corner which cannot compare renders no handle in the DOM at all,
enforced by the `compare` parameter rather than by CSS hiding an empty pane.

Source: `4f85e51` and `684f519` (hero addendum: slider restored as primary imagery),
`2630c60` (hero: always slider), `src/page.js:128`, `src/page.js:168`,
`specs/HANDOFF.md` gotcha 31.

## 2026-08-19: Spend is reserved before the call, not recorded after

An unattended nightly batch that records what it spent after each call has a window in which
it has already spent past the ceiling. Counting calls rather than money makes that worse,
because two calls with different shapes cost different amounts, and a count cannot be compared
to a provider's invoice at all.

The Exa meter is denominated in cents. `reserveExa` computes the estimated cost of a piece of
work before it runs, at `EXA_SEARCH_CENTS = 0.7` and `EXA_CONTENTS_CENTS = 0.1`, refuses if it
would cross `EXA_CAP_CENTS = 6500`, and records the refusal as a deferral so a batch that did
not run is visible as a decision rather than as silence. After the call, `recordExaSpend`
reconciles against Exa's own `costDollars` field, so the published spend is a measured number
and not an estimate. The cap is then enforced against whichever of reserved and reported is
higher, which is the only version that is safe in both directions: an estimate that is too low
cannot spend past the ceiling, and a reservation that was never consumed cannot be re-spent
until reconciliation catches up. Two costs. The counter over-reports in the short run, because
a reservation is held even where the real cost came in lower. And the same discipline had to be
duplicated per provider: the Apify ledger learned separately that summing your own ledger is
not spend, since topping a corner up with a second actor re-reads the first run and counted its
cost twice, so `apify:invoice` holds the provider's own reconciliation from
`/v2/users/me/limits` and `/status` shows both figures side by side. `EXA_PRIOR_SPEND_USD =
1.269` is carried separately for the same reason: the provider's remaining balance is that plus
the counter, and the two cannot be reconciled without it.

Source: `7388076` (phase 1: the exa counter is denominated in dollars), `985eed9`,
`src/store.js:489-498`, `src/store.js:608-641`, `specs/HANDOFF.md` "The meter is cents now, not
calls" and gotcha 27, `tools/exabudget.test.mjs`.

## 2026-08-19: A price identifies a plan tier and not a workspace

This one is a correction, and it is the entry in this file most worth reading twice.

Phase 0 of the Exa burn pass needed to know which account the deployed key was billing,
because the pass was about to spend real credit unattended. It answered the question by
measurement: a contents-free search on the deployed key costs 0.007 dollars, which is the 7
dollars per thousand tier, the 70 dollar workspace is on that tier, therefore the key is that
workspace's. The gate was written as a price comparison, it reported passed, and a batch
ran on it. The human then opened that workspace's own Usage page and found no activity at all
for 12 to 19 August with the balance still reading exactly 70.00 dollars. The spend had landed
somewhere else. The inference was not merely unlucky, it was invalid: any number of workspaces
sit on the same tier and bill identically, so the observation could not have come out
differently no matter which account was being billed. A measurement consistent with a
hypothesis is not a confirmation of it. Only an observation that could have come out otherwise,
on the specific thing being claimed, is a gate.

The code now separates the two questions and refuses to let either impersonate the other.
`exaPlanFor()` returns a plan tier and its comment says in as many words that it cannot name an
account; `/api/health` reports `exaPlan` and never an account, and reads `"7-per-1k"` with
`exaUnitUsd` `0.007` as of 2026-08-20. `verifyExaAccount()` in `src/store.js:548` is the only
function in the codebase permitted to name the workspace being billed, it throws without a
workspace name, and `tools/exa_verify.mjs` is its only caller. The meter carries `account`,
`accountVerified`, `verifiedAt` and `observedBalanceUsd`, all null until a human records an
observation, and `attributedFromCents` marks the boundary so spend from before the confirmed
key is kept in the total, where it belongs, without being charged to a workspace that did not
pay it. The nightly `pressBatch` returns `account-unverified` and spends nothing while
`accountVerified` is false, and a test pins that refusal rather than trusting the comment.

The cost is that a human has to sit in front of a dashboard before the autonomous batch can
spend anything, which is a manual step in an otherwise unattended system and cannot be removed
by any amount of cleverness. A partial corroboration was later found and deliberately not
promoted into a substitute: Exa has no account or usage endpoint, but the Pro-only Websets
endpoint answers 401 with the team name in the message, which `tools/exa_probe.mjs` reads. It
names the team a key belongs to, not what a given call was billed against, so it corroborates a
dashboard observation and does not replace one. The related discipline from that episode is
worth keeping too: a gotcha had already been filed saying no such signal existed, so "there is
no way to check" is a claim that needs re-testing rather than a fact.

Source: `0eed39b` (phase 0), corrected by `c2f34b8` (a price identifies a plan, not an account),
`03bd618`, `fb28e56`, `1b6753c`, `src/store.js:643-656`, `src/store.js:544-573`,
`src/index.js:1099-1104`, `tools/exabudget.test.mjs:138-159`, `specs/HANDOFF.md` gotchas 34 and
35, `docs/EXA_INTEGRATION.md`.

## 2026-08-19: A failed probe reports its own failure and does not borrow the last good reading

`/api/health` fell back to the stored probe when the live one failed, so it printed a unit
price and a plan tier immediately beside `http 401`. Nothing was strictly false, and the
arrangement read as though the rejected call had produced those numbers.

This run's probe describes this run. A stored reading is reported separately as `lastGoodProbe`
with the date it was taken, or not reported at all. The same principle was applied to the
citation tile a day later: a running counter added after the fact counted zero for the 246
corners already stored, so the tile kept an old snapshot while gaining a fresh as-of, and a
stale number with a current timestamp is worse than a stale number because it looks checked.
The count now comes from a bounded scan of the records themselves. The cost is that the health
endpoint sometimes has fewer numbers on it, and the citation tile costs a background scan.

Source: `3c0c502` (a failed probe does not borrow the last good one's numbers),
`25f2e3d` (the citations tile counts what is stored, not what a counter caught).

## 2026-08-19: The webhook is public by necessity, so a detection is data and never an instruction

Exa Monitors deliver by push, which means a URL on this Worker that anybody can post to. There
is no version of that which is private.

It is treated as hostile end to end. Two independent checks run before the payload is read, a
shared secret in the path and a monitor id this Worker created, and nothing in the payload is
trusted after that: every article runs the same relevance filter and the same graded-index bar
as the rest of the press lane before it can appear as a citation anywhere. A forged post can at
worst waste a filter pass. It can never invent coverage, move a grade, or cause a billed
imagery or voices call. Two related decisions are recorded in the same design. The page claims
no delivery frequency, because Exa's create API has no cadence, schedule or interval field, so
what is published instead is the measured lag between an article's publish date and the moment
the detection arrived, with undated articles excluded from the median and counted. And radar
entries reach `/changes` with no old and no new value, rendered as "no grade change", because
press attention decides what gets looked at next and never what a corner scores. The cost is
that a secret travels in a URL path, which is the part of a request most likely to end up in
somebody else's log, and it is held by Exa in 29 places, so rotating it is not a single
`secret put`. That cost is documented rather than argued away.

Source: `3e2b49a` (radar phase 2: the radar page, the webhook, and the caps), `src/radar.js:1-22`,
`src/index.js:996`, `docs/KEY_ROTATION.md` section on `WEBHOOK_SECRET`.

## 2026-08-19: Report a secret's length, never its value, because empty and absent are different failures

The radar would not create its monitors. `/api/radar` reported which secrets the runtime could
see, as booleans, and showed five older secrets visible and `WEBHOOK_SECRET` not, while
`wrangler secret list` insisted it existed. That single line separated "wrangler did not attach
it" from "this code is looking in the wrong place" after four deploys of guessing, and the
diagnosis written at the time was the Workers versions model: `wrangler secret put` creates a
new version holding the secret and does not promote it, and a later `wrangler deploy` builds
from local code without it, so secrets have to be installed after the last code deploy.

That diagnosis was wrong, and diagnosing it that way cost six deploys and a confident wrong
answer. The secret
was bound the whole time. It was empty. An empty secret is bound, is listed by wrangler, and is
reported as a successful upload, so "missing" and "present but empty" are identical from every
angle except one. `/api/radar` now publishes `webhookSecretLength`, a length and never a value,
alongside the visibility booleans; it reads 64 with `envKeyCount` 8 as of 2026-08-20, which is
six secrets plus the `ASSETS` and `STORE` bindings and nothing unaccounted for. The cost is
that the length of a secret is public. At 64 characters that is not a meaningful narrowing, so
it is recorded as a known trade rather than flagged, with the standing instruction that any
replacement is kept at least as long.

Source: `15b9d6a` (the earlier, wrong diagnosis, stated in its own commit body), corrected by
`c942002`, `src/index.js:2006-2023`, `docs/KEY_ROTATION.md` hygiene notes 1 and 2.

## 2026-08-19: Resumable batches instead of a lock

Creating the radar's monitors meant 29 sequential POSTs, which did not fit inside a page load's
budget. The run was killed partway, wrote nothing, and left behind a five minute self-expiring
lock, so every later attempt reported "creation already in flight" while nothing was in flight
at all. A guard intended to prevent duplicate work turned one failure into five minutes of a
confident wrong answer.

Creation runs in parallel batches of six and stores its result after each batch, so a run that
dies costs the batch it was in and the next invocation resumes rather than restarts. That makes
the lock unnecessary, and unnecessary is the right state for a lock: a duplicate run now skips
what already exists. `ensureMonitors` also writes its outcome to `radar:setup` every time,
success or failure, because three earlier runs threw their reason away inside `waitUntil` and
that looks identical from outside to never having run. The result stands at 29 monitors live,
25 corridors derived from the rank plus 4 citywide, 0 failed, created 2026-08-20T02:08:16Z. The
cost is that a duplicate run does more work than a locked one would, which is the cheaper of the
two failure modes.

Source: `15b9d6a`, `c942002` (monitors create in resumable batches, and the lock comes out),
`curl -s .../api/radar` run 2026-08-20.

## 2026-08-19: The batch runs inside the Worker, where KV is a binding, and a stop reason names the subsystem that actually failed

The press burn ran as a local tool. The tool drives KV through Cloudflare's REST API, which is
what the wrangler CLI talks to, and the run died on that layer: two 429s, a DNS failure, and a
run of fetch errors. Inside the Worker, KV is a binding and none of that layer exists, so the
batch moved into the Worker. The morning cron at 13:10 UTC keeps its job, audit one corner,
create the monitors if they are missing, then run a full press batch, and a new quarter-hourly
tick continues the batch six corners at a time, which is what one invocation's 50 subrequest
budget allows at up to six Exa calls a corner. Roughly 190 corners overnight, governed by the
same cent counter, refusing past the same cap, and still refusing entirely while the workspace
is unverified. The batch resumes from its checkpoint's page rather than rescanning the rank from
the top, because on a six corner tick that would mean re-reading several hundred already-checked
corners to find six new ones.

The second half of this entry is the part that generalises. The run's stop message blamed Exa,
and every one of the ten failures was Cloudflare's API failing to read the budget meter. The
counter is blind to which layer broke, so a message composed from the counter names the wrong
subsystem with complete confidence, and an operator reading it starts debugging the wrong
provider. The message now quotes what actually failed. The cost of the move into the Worker is
a hard ceiling on how much work fits in one invocation, which is what forced the chunking and
the checkpoint in the first place.

Source: `cd17e03` (radar phase 4: the press batch runs in the worker on a quarter-hourly tick),
`3e2b49a` (the stop message correction), `fce7fe4` (phase 5: burn mode, chunked and
checkpointed), `src/index.js:1099-1128`, `wrangler.jsonc:20-29`, `specs/HANDOFF.md` gotcha 25.

## 2026-08-19: The composite states the attribution that is true rather than copying the one that is not

The README hero shows the hazard audit and the proposed fix for one corner side by side, built
by `tools/make_readme_hero.py` from frames already stored in KV rather than from anything
regenerated for a picture. Two rules are enforced by the script rather than left to whoever
runs it: panels are only scaled and never cropped, because Google's attribution is burned into
the bottom of the source frame and cropping is how an attribution quietly disappears, and the
script refuses outright when either frame is missing rather than producing a half composite
that misrepresents what ran.

One thing could not be solved by preservation. The audit frame is the photograph with overlays
and keeps Google's watermark. The fix frame is a render, and for 16th and Mission the model
reproduced no watermark at all. Copying Google's mark onto a render Google did not make would be
a false attribution, so the right panel carries the true statement instead, "Base imagery:
Google", and it is drawn unconditionally. That last word is the decision: a duplicate credit on
a corner whose render happened to keep the watermark is harmless, and a missing credit is not,
so the unconditional version is correct even though it is sometimes redundant. The cost is a
redundant line of text on some composites. The disclaimer travels with the render in the caption
under the image, in the same words the site uses elsewhere.

Source: `853dc03` (readme: before and after hero composite), `tools/make_readme_hero.py:12-14`
and `:117-122`,
README.md "Sharing and the city view" for the related share-card rule.

## 2026-08-20: Workers AI image generation is rejected for the imagery lane, and the survey is kept so nobody proposes it again

Workers AI ships with the account this already deploys on: an `env.AI` binding, 10,000 free
neurons a day resetting 00:00 UTC, and Flux models that accept an input image. That last part
is what made it worth an hour, because the proposed-fix panel has to be conditioned on the
corner's real Street View frame and a text-to-image model cannot do it at any price. Gemini
imagery has been blocked on billing for days. Free, keyless, already-bound image generation
looked like the way out.

It was piloted properly and it was rejected. The reason is specific and it is not going to be
fixed by a better prompt.

**Flux corrupts text.** Every render garbled the street name signs, mangled the speed limit
sign, and reproduced the Google watermark as "Corcle" or "Garage". This product's entire
argument is that every figure on it traces to a record a reader can check. A photograph of a
named intersection carrying a fabricated street sign is the worst possible image for it to
show, and it is the first thing anyone looking to discredit the site would find. That is
disqualifying on its own, independent of render quality.

**The hazards panel was the wrong shape of problem.** Asking a diffusion model to overlay
hatching on specific roadway geometry produced a smear across building facades and sky, with
an unreliable red versus amber distinction and no legend, because the legend needs legible
text. The site already knows deterministically which hazards were confirmed at a corner and
from which records. Generating that overlay throws a checkable fact away and replaces it with a
plausible-looking guess, which is the same failure the letter verifier exists to prevent, in
pixels rather than prose. If that panel is ever rebuilt it should be a computed SVG overlay on
the untouched frame, not a generated image.

**The model survey, kept so the arithmetic does not have to be redone.** Neurons per image at
1024x640, which is four 512x512 tiles, with a 448x280 input frame:

| Model | Image input | Rate | Neurons per image | Images per free day |
|---|---|---|---|---|
| `flux-2-klein-4b` | yes | 5.37 per input tile, 26.05 per output tile, fixed 4 steps | 109.57 | 91 |
| `flux-2-dev` | yes, up to 4 | 18.75 per input tile per step, 37.50 per output tile per step | 4,218 at 25 steps | 2 |
| `flux-2-klein-9b` | yes | 1363.64 first MP, 181.82 per input MP | 1,545 | 6 |
| `leonardo/lucid-origin` | no | 636 per tile, 12 per step | 2,544 | 3 |
| `leonardo/phoenix-1.0` | no | 530 per tile, 10 per step | 2,120 | 4 |
| `flux-1-schnell` | no | 4.80 per tile, 9.60 per step | 57.6 at 4 steps | 173 |

The two cheap models cannot see the corner. The one that is both image-conditioned and
affordable, `flux-2-klein-4b`, is a fixed 4-step distilled model Cloudflare markets for rapid
prototyping, and it renders like one. The image-conditioned model with real quality headroom,
`flux-2-dev`, costs 4,219 neurons an image because its rate is charged per step, which is two
images a day free and could never serve a 130 corner fleet.

So the trade is: affordable and not good enough, or good enough and unaffordable, on top of a
text-corruption problem that neither rung solves. The imagery lane stays on the Gemini path in
`src/imagery.js`, pending billing, and that remains the only route to a shipped render.

Cost of finding out: 767 neurons of the 10,000 free that day, zero dollars, zero KV writes, no
deploy. The pilot tooling was reverted; this entry is what survives of it.

Source: pilot at `6970dc5`, reverted. Verdict recorded 2026-08-20 by the operator after
reviewing the six renders.
