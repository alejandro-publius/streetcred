# The billing queue

Everything blocked on a funded Gemini key, in execution order for the moment
one lands. Nothing here is speculative work: each item is specced, its inputs
already exist in the repo, and its guardrails are named. Work the list top to
bottom; each item assumes the ones above it are done.

Context for whoever runs this: the free-tier key allows 20 text generations a
day on `gemini-3.7-flash` and zero image generations, zero Pro calls. That is
what queued all of this. Before starting, confirm billing with
`curl -s -X POST .../gemini-3.7-flash:generateContent` twenty-plus times or by
checking the quota page; a `PerDay limit: 20` error means nothing has changed.

## 1. The single all-corner letter regeneration, verified

One pass, exactly once, over every corner that serves a letter (both flagship
tiers and the audited fleet; score-tier corners have no letters and gain none
here).

- Bump `LETTER_VERSION` in `src/index.js` (currently v6; the v7 bump was
  reverted when the fleet could not be regenerated on the free tier).
- Every draft picks up, automatically, because the prompt already carries
  them: census percentile phrasing, the verified Supervisor roster (Sherrill,
  Wong, Mahmood included; `hasSupervisor` gates the title), coverage longevity
  where the timeline supports it, and the both-radii sentence.
- **Impact sentences are CLEARED TO RUN.** On 2026-08-18 the human reviewed
  and approved `data/cmf.json` and `data/precedents.json` exactly as curated:
  LPI 0.87, 5 stars, id 9918; continental crosswalks 0.63, 4 stars, id 2697
  with the school-zone context named; the no-factor rows stay no-factor; Safer
  Taylor stays qualitative-only. No further review is needed; the sentences
  run the moment a funded key exists, verifier extension first. Add to the
  letter prompt, per corner where the factor applies:
  - predicted: "published CMF {id} suggests roughly {range} fewer {type}
    collisions at a location with this history"
  - observed: "San Francisco's own evaluation of {precedent} reported
    {outcome}"
- **Extend the verifier input set FIRST** (`buildInputSet` in `src/verify.js`):
  add the numbers from both curated tables (CMF ids, star counts, range
  endpoints, precedent percentages) so a fabricated projection fails exactly
  like an invented collision count. Write the doctored case before wiring the
  prompt: a letter citing "CMF 9999" or "80% fewer" must fail with the token
  named.
- Every regenerated letter passes through `verifyLetter`; report the pass
  rate and paste both flagship data paragraphs.
- Cost: ~25 corners x (1 + retry allowance) calls. Trivial under billing;
  impossible under the 20/day free tier, which is why it is here.

## 2. The golden corpus, wired into CI

Five frozen-input corners asserting the whole letter contract end to end:

- both flagships (16th & Mission, 6th & Market)
- one Tenderloin F (taylor-and-turk)
- one calm Sunset A (40th-and-cabrillo)
- one score-tier corner with empty voices (6th-and-stevenson)

Frozen inputs (stats, news, timeline, hazards payloads recorded to
`tools/fixtures/golden/`), then assertions per corner: verification passes,
correct Supervisor by name, exact counts appear, the percentile sentence, no
quotes when voices are empty, no audit claim on the score tier, banned content
absent (em dashes, brackets, invented sources). The doctored-letter verifier
cases (already in CI as `tools/verify.test.mjs`) stay frozen beside them.
Generator-dependent, hence queued: the corpus needs live drafts to freeze.

## 3. Audit-tier imagery warming, then OG composites

- `tools/warm_imagery.mjs` (to write): for each corner in the fleet without
  stored hazard/fix states, run the standard two generations through the
  deployed endpoints, under an operator budget: `--max-images N` hard cap per
  run, resumable log in `.warm-imagery.log`, skip anything already stored,
  never touch the public daily cap's KV counter (the operator budget is
  separate and stricter).
- The ~100 score-tier corners are explicitly NOT warmed by default; they are
  the cron's runway. Warm only the audited fleet plus corners the operator
  names.
- Then OG composites: `tools/make_og.py` per corner, pushed via the new
  `putShareCard` path or the existing KV upload, so every audited corner gets
  a real share card.
- Cost estimate: 2 generations x fleet size; state the number before running.

## 4. The Pro thinking upgrade, measured not assumed

- `src/index.js` `GEMINI_TEXT_MODEL`: candidate `gemini-3.1-pro-preview` with
  `thinkingConfig: { thinkingLevel: "high" }` ("max" does not exist; "high" is
  the ceiling; Deep Research models speak only the Interactions API and cannot
  be dropped in).
- **Re-confirm the responseSchema finding first**: on the free probe, a
  structured-output call (`responseMimeType` + `responseSchema`, as the vision
  audit uses) accepted `thinkingConfig` and spent zero thinking tokens. If
  that holds on a billed key, the audit lane gains nothing from Pro and stays
  on flash; log the finding either way. Do not swap any model based on an
  unmeasured assumption.
- Letter lane A/B: five corners, flash vs Pro-high, judged on verifier pass
  rate and rule adherence (word count, no em dashes, addressee). Swap only on
  a measured win; latency budget 30s per draft (Pro-high measured 14-28s).

## 5. The letter fleet, after the v2 letter check

Added 2026-08-20 by the addendum's stages 7C and 7D. Four new rules are in
`src/verify.js` at `VERIFY_VERSION` v2 and are enforced at serve time: three
lane-consistency rules (resident accounts, press coverage, magnitude words) and
the addressee rule. This section records what re-running all four found, so the
regeneration pass in item 1 knows exactly what it is regenerating and why.

- **Stored letters re-checked: 0 pass, 0 fail, 0 checked**, broken out by rule:
  consistency 0 fail, addressee 0 fail. Not a pass rate,
  an empty population: `letter:verified:*` holds **zero keys**. Confirmed with
  `wrangler kv key list --binding STORE --remote` against the 2,148-key
  namespace, and by `node tools/reverify_letters.mjs`. Twenty-three
  `letterrun:{slug}` provenance records exist, so twenty-three letters were
  drafted and verified at some point, but none of their text was ever stored.
  Nothing on disk can be re-verified because nothing on disk is a letter.
- **What was actually being served was the sample**, at every corner that has a
  letter lane. `letter:backoff` is set (Gemini 429), there is no stored letter
  to fall back to, and the fallback was `sampleLetter`. That is one fixed
  paragraph asserting resident accounts, press coverage and "hundreds of
  collisions" regardless of the corner it is served for. On
  `16th-and-potrero` it failed all three new rules at once: hundreds against a
  displayed 65, press against zero citations, residents against a voices lane
  reading NONE FOUND.
- **The sample no longer serves anywhere.** Every corner without a letter
  verified under v2 now shows the honest pending state, "A verified letter for
  this corner is queued behind generation." That is **all 130 corners with a
  `corner:{slug}` record**, plus the two flagships. `sampleLetter` is kept and
  exported purely as the exhibit: `tools/verify.test.mjs` runs it through the
  check and asserts it fails, so routing it back to a reader breaks a test by
  name.
- **The addressee rule found nothing to fail because there was nothing to
  check**, but the defect it exists for was real and is fixed at its root:
  `resolvedDistrict` in `src/data.js` is now the single answer to which district
  a corner is in, and `addresseeFor` the single answer to who that district's
  representative is. Every regenerated letter is checked against both.
- **Regenerate with a lane-conditioned prompt.** The prompt must be told which
  lanes came back empty for that corner and forbidden to describe them, rather
  than told in general not to invent. The reasons the check emits are written
  for exactly this: they name the lane, the claim and the displayed figure.
- **The twenty-three corners with prior provenance**, worth regenerating first
  because they already have the records that justified a letter:
  `12th-and-moraga`, `16th-and-potrero`, `16th-mission`, `19th-and-dolores`,
  `19th-and-mission`, `31st-and-lawton`, `3rd-and-palou`, `40th-and-cabrillo`,
  `6th-market`, `9th-and-judah`, `alemany-and-ocean`, `broadway-and-columbus`,
  `eddy-and-leavenworth`, `fulton-and-masonic`, `geary-and-polk`,
  `geary-and-webster`, `geneva-and-mission`, `golden-gate-and-hyde`,
  `market-and-octavia`, `market-and-van-ness`, `mission-and-silver`,
  `oak-and-octavia`, `taylor-and-turk`.
- **Re-run the audit after any regeneration** with
  `node tools/reverify_letters.mjs --queue`, which rewrites the generated block
  below in place. It imports the verifier directly and reads KV read-only, so
  it costs nothing and can run on the free tier.
- Cost: zero. Nothing in this section spends; it is the accounting that tells
  item 1 what to spend on.

## Sizing this queue against the KV write cap

Added 2026-08-20, after the cap stopped a run mid-verification. Analysis only:
nothing here was executed and nothing here writes.

The Workers Free plan allows **1,000 KV writes per day per account**, resetting
at 00:00 UTC, alongside 100,000 reads and 1,000 list requests. Workers Paid
replaces the daily cap with **1,000,000 writes a month** plus $5.00 per million.
Exceeding the free cap does not slow anything down, it fails the operation: on
2026-08-20 the cap was gone before 17:10 UTC and a manual watchlist run refused
at `reserveExa` with `KV put() limit exceeded for the day`, before a single Exa
search was made.

### Writes per stage, counted from the code

**Item 1, letter regeneration.** Per corner, on the ordinary path:
`putLetterRun` and `putVerifiedLetter`, so **2 writes**. A draft that fails
verification twice adds `appendTrustIncident`, so **3**. A corner whose score or
hazards are not already stored adds `putScore` and `putHazards`, one each. The
audited fleet is warm, so 2 is the figure to plan with.

- item 1's own scope, the flagships plus the audited fleet, about 25 corners: **50 writes**
- every corner that currently serves the pending state, 130: **260 writes**

**Item 2, the golden corpus.** Fixtures are written to `tools/fixtures/golden/`
on disk. **0 KV writes.**

**Item 3a, imagery warming.** Per corner: `reserveGeneration`,
`putImageryStatus("pending")`, `putImage("hazards")`, `putImage("fix")`,
`putImageryStatus("ready")`, so **5 writes**, or 6 where the Street View frame
is not already stored. Top 30: **150 to 180 writes**.

This stage has a harder ceiling than KV, and it is not the one anybody expects.
`reserveGeneration` increments once per corner against
`DAILY_GENERATION_CAP = 25`, so **at most 25 corners can be warmed in a day
whatever KV allows**. A top 30 pass takes two days on the generation cap alone.

**Item 3b, OG composites.** `putShareCard`, **1 write per corner**, so **30**
for a top 30 pass.

**The multiplier nobody costs in.** Every successful Exa call writes **two**
keys, not zero: `recordExaSpend` writes `exa:spend` and then `budget:exa`. Each
reservation writes `budget:exa` once more. So a full 29 query watchlist run
costs 1 reservation plus 58 spend writes plus `putWatchlist` and
`putWatchlistRun`, which is **61 KV writes for one run**. Any queue stage that
touches the press lane carries this and it is invisible at the call site.

### The verdict

**The queue does not fit in one day, and KV is only the second reason.**

| Stage | Writes | Blocking limit |
|---|---|---|
| Letters, 25 corners | 50 | fits |
| Letters, 130 corners | 260 | fits alone |
| Imagery, 30 corners | 150 to 180 | **generation cap, 25 corners a day** |
| OG cards, 30 corners | 30 | fits |
| **Full queue at 130 letters** | **440 to 470** | see below |

440 against a 1,000 cap looks comfortable and is not, because the cap is
account wide and shared with everything the site does anyway. The recurring
baseline is **estimated, not counted**: the quarter hourly press tick writes one
checkpoint plus one `putPress` per corner it works, the morning audit writes
several dozen, and the Exa spend multiplier above rides on all of it. The
stored counters put the press lane alone somewhere in the low hundreds of
writes a day. The one hard measurement is that on 2026-08-20 the cap was
exhausted before 17:10 UTC.

**Recommended, on the free plan: split across days**, in this order.

1. **Day one, letters only.** 260 writes at the full 130 corner scope, or 50 at
   item 1's scope. Run it early in the UTC day, since the allowance resets at
   00:00 UTC and the press lane spends it steadily from there.
2. **Day two, imagery for 25 corners.** 125 writes, and 25 is the generation cap
   rather than a choice.
3. **Day three, the remaining imagery plus all OG cards.** 25 plus 30, about 55
   writes.

Check the headroom before starting any of them:

```
npx wrangler kv key put "diag:kvprobe" ok --binding STORE --remote
```

`code: 10048` means the day is spent and the stage will fail partway, which for
letter regeneration means paying a model for drafts that are never stored.

**What the paid plan changes**, for $5 a month:

- The daily write cap becomes 1,000,000 a month. At the current baseline the
  site would use somewhere near 1 to 2 percent of it, and the whole queue could
  run in a single afternoon.
- External subrequests per invocation go from 50 to 10,000, configurable higher.
  That is the limit that cut the watchlist to 7 of 29 searches and forced it
  onto its own cron, and it is the limit that keeps `PRESS_BATCH_PER_TICK` at 6.
  Both could be raised rather than worked around.
- The generation cap of 25 is ours, not Cloudflare's, and would still apply.

The honest summary: the queue is affordable in model and scraper credit and is
gated by a free tier write allowance that costs $5 a month to remove. If the
regeneration is going to happen under time pressure, upgrading first is cheaper
than sequencing around a cap that fails operations rather than slowing them.

## Standing rules for the whole queue

The daily public generation cap stays enforced; operator budgets are separate
and stricter, never a bypass. Sample and empty payloads are never cached. No
key material in the tree, transcript, or responses. Every letter change goes
through the verifier. The cron is never disabled for any of this.
