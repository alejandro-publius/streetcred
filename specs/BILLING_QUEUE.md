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

## Standing rules for the whole queue

The daily public generation cap stays enforced; operator budgets are separate
and stricter, never a bypass. Sample and empty payloads are never cached. No
key material in the tree, transcript, or responses. Every letter change goes
through the verifier. The cron is never disabled for any of this.
