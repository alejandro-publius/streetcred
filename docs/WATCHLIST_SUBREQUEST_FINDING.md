# The watchlist runs 8 of its 29 searches

> **Resolved 2026-08-20.** Option 2 below was chosen and implemented: the lane
> has its own cron trigger and its own subrequest budget, and all 29 searches
> complete in one run. This file is kept as the finding and the evidence; the
> numbers in it describe the state before the fix. See "The watchlist runs on
> its own cron" in `specs/HANDOFF.md` for what runs today.

Found 2026-08-19, during the overnight verification pass. Not fixed, because the
feature freeze holds until 2026-08-25 and the fix is a behavior change. This file
is the finding, the evidence, and the options.

## The claim on the site, and the truth

`/watchlist` prints two sentences about how much work it did:

- a stat reading **"29 searches"** (`src/watchlistpage.js:76`, from `w.calls`)
- and, lower down, **"The whole pass costs 29 searches"** (`src/watchlistpage.js:131`)

Twenty-nine is what the lane **attempted**. Eight is what **completed**. The other
twenty-one returned nothing, each one carrying the same failure:

```
Too many subrequests by single Worker invocation.
```

Reproduce it:

```sh
curl -s https://streetcred.thealexschroeder.workers.dev/api/watchlist | python3 -c "
import json,sys
q = json.load(sys.stdin)['queries']
f = [x for x in q if x.get('failed')]
print('attempted', len(q), 'completed', len(q)-len(f), 'failed', len(f))"
```

Read 2026-08-20T06:12Z against the pass built 2026-08-19T13:11:21Z: **attempted 29,
completed 8, failed 21**. The cutoff is exact and sequential. Queries 0 through 7
return 15 results each; queries 8 through 28 return zero, every one of them with
the `failed` field set.

## Why

Cloudflare allows 50 subrequests per Worker invocation. This codebase already knows
that and already sizes for it: `src/index.js:1085-1089` says so in a comment, and
`PRESS_BATCH_PER_TICK = 6` exists because six corners at up to six Exa calls each
is 36, which fits.

The watchlist was never given the same treatment. It runs as a lane inside the
daily-audit cron invocation (`src/index.js:1695`), and it runs near the end, after
the audit has already spent most of the budget on DataSF, Exa press, Apify
commissioning, imagery and `findSimilar`. It then issues 29 sequential searches
into whatever is left. Eight fit.

`WATCHLIST_QUERIES` (`src/press.js:70`) grew from 7 to 29 at some point. The comment
above the lane at `src/index.js:1692` still reads "Seven semantic searches", and so
does the live methodology page at `src/methodology.js:189`. Neither the comment, the
page, nor the invocation budget followed the list when it grew.

## Why it matters more here than it would elsewhere

Three reasons, in increasing order of seriousness.

**The number overstates the work.** "29 searches" reads as work done. It is not.

**The number also overstates the cost.** The twenty-one that failed never reached
Exa, so they cost nothing. The page says the pass "costs 29 searches" when the
ledger would show eight.

**The failures are hidden on the one page whose thesis is publishing failures.**
`/watchlist` exists to show the rejects. Its own opening text says a discovery
pipeline that shows only its hits is indistinguishable from a search box that got
lucky. Twenty-one searches failed, each one stored with its reason, and the page
renders none of them. The lane is holding itself to a lower standard than it holds
its candidates to.

There is a coverage consequence too, and it is not random. The twenty-one that never
run are the tail of the list, which is where every neighborhood-scoped query sits:
the Tenderloin, the Excelsior, the Bayview, the Sunset, the Mission, SoMa, the
Richmond, Chinatown, the Castro and Visitacion Valley. The watchlist has a
systematic geographic blind spot and has never run those queries at all.

## Options, for after the freeze

**Resolved 2026-08-20: option 2.** The lane moved onto its own cron trigger,
`20 13 * * *`, so it no longer inherits the audit's spent budget. Option 1's
honest accounting shipped first, on 2026-08-20, and is kept: `/watchlist` still
reports attempted, completed and failed, and still lists every query. The four
options are left below as the record of what was weighed.

None of these was chosen when this file was written.

1. **Report both numbers.** Smallest possible change, and it makes the site honest
   immediately: print attempted and completed, and list the failures with their
   reason among the rejects, where the page already has the vocabulary for it. This
   is the one that matches the page's existing ethos. It does not recover the lost
   coverage.
2. **Move the watchlist out of the audit invocation**, onto its own tick, the way
   the press batch already works. Recovers the coverage. Largest change.
3. **Chunk and checkpoint it** across several quarter-hourly ticks, reusing the burn
   checkpoint machinery that already exists in `src/store.js`.
4. **Cut the query list** back to what one invocation's remaining budget can carry,
   and say so. Honest, cheap, and gives up the neighborhood queries deliberately
   rather than accidentally.

Option 1 is the freeze-compatible half of every other option and does not conflict
with any of them.

## What has already been done about it

Nothing on the site. Two things in the repository:

- `tools/readme_numbers.mjs` reads `queries[].failed` and generates the row
  "29 attempted, 8 completed, 21 cut off by the Worker subrequest limit", so the
  README states the true figure and keeps stating it as it changes.
- The README's watchlist paragraph names the ceiling as a real limit that is not
  fixed, rather than quoting the attempt.
