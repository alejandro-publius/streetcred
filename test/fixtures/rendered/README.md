# Rendered baselines

Visual-regression-lite. Five live pages, fetched, normalized, and committed, so
that a change in what the site renders becomes something a machine can notice
rather than something somebody has to remember to look at.

It exists because of the feature freeze in force until 2026-08-25. During a
freeze the interesting question is not "is the site correct", which the unit
tests answer, but "is the site rendering the same page it rendered when the
freeze started". This answers that one.

## What is in here

| file | page |
| --- | --- |
| `home.txt` | `/` |
| `corner-16th-mission.txt` | `/c/16th-mission` |
| `status.txt` | `/status` |
| `radar.txt` | `/radar` |
| `methodology.txt` | `/methodology` |
| `manifest.json` | when the baseline was captured, from which origin, and how big each page was |

They are not HTML. They are normalized text: the markup with every volatile
value replaced by a shape token, one tag per line. They are not meant to be
opened in a browser, only read and diffed.

The capture time lives in `manifest.json` rather than in a header inside each
snapshot, because a stamped header is a line that changes on every capture and
would show up in every diff.

## Running it

```
node tools/snap_rendered.mjs      # write the baseline (overwrites these files)
node tools/rendered_diff.mjs      # check the live site against the baseline
```

Both accept `--origin=`, `--dir=` and `--only=` (`--only=status`, or a path like
`--only=/radar`). The differ exits 0 when nothing structural moved, 1 when
something did, and 2 when it could not fetch or could not read a baseline.

Re-baselining is a decision, not a repair. `snap_rendered.mjs` is the only thing
in the harness that writes a fixture, and it should be run when a change is
understood and intended, with the reason in the commit message.

## A diff is a question, not a verdict

The normalizer hides value drift and shows shape change. That is a guess about
which changes matter, and it will sometimes be wrong in both directions. So a
non-zero exit means "a human should look at this", not "somebody broke the
freeze". Read the region name, read the two lines, decide.

Three things are known to produce a legitimate diff with nothing wrong:

- A counter crossing a digit boundary. 999 corners checked to 1,000 is a real
  token change, `{N3}` to `{N4}`, and it is correct that it asks.
- The failing synthetic run of 2026-08-18 aging out of the 7-day uptime window.
  The bar strip currently reports two shapes, `i.bad` and `i.ok`; when the bad
  one leaves it will report one, and the diff will say so.
- A page genuinely being deployed. That is the case the harness is for.

## The normalization rules, and why each one is there

Rules are defined once, in `tools/lib/rendered_norm.mjs`, and imported by both
tools, so the snapshotter and the differ cannot drift apart about what a
snapshot is.

### What is never touched

`<style>`, `<pre>` and `<code>` blocks pass through byte for byte. They are the
two densest constant surfaces on the site: the generated CSS in `src/page.js`,
and the quoted formula and the 311 allow list on `/methodology`. A code block
here is quoted source, and quoted source that drifts is exactly the change this
harness is looking for. The doctored-fixture check that proved this works
changed `6*severe` to `5*severe` in the formula and the differ printed it.

Attributes are also left alone, except four that carry prose: `title`, `alt`,
`content`, `aria-label`. So `class`, `id`, `href`, `src`, `style`, `width` and
every SVG coordinate are compared literally. A CSS class rename, a changed link
target, or a moved chart point is a hard diff.

### Region rules

These collapse a list that grows on its own schedule. Each is matched by class,
because class is the only stable handle a rendered page offers.

| region | what it collapses to | why |
| --- | --- | --- |
| `corner-of-the-day` | `{COTD <skeleton>}` | `section.herocorner` rotates every morning. Name, slug, grade class, two image srcs, both alt texts and the audit date all move at once, and none of that is a code change. |
| `audited-roster-js` | `var AUDITED = {JSON-ARRAY items={N2}};` | the JSON roster behind the homepage map, appended to by the morning run. |
| `map-pins` | `{RUN a.pin n={N2} <skeleton>}` | one anchor per audited corner, so the run lengthens daily. The `left`/`top` percentages inside are layout, not measurement. |
| `audit-log-chips` | `{RUN a.cotdi n={N1} <skeleton>}` | one chip per unattended audit, grows with the roster. |
| `uptime-bars` | `{RUN i.bar n={N2} <skeletons>}` | one `i` per synthetic run, appended hourly, each carrying its own run time in a `title`. |
| `per-corner-srows` | `{RUN div.srow[corner] n={N1} <skeleton>}` | the Apify ledger and the recent-grade-changes list on `/status`. Both are `div.srow` rows carrying a `/c/` link, which is what separates them from the endpoint checks and the budget lines in the same class, and both grow whenever the morning run does anything. |

A collapsed run is replaced by a **skeleton**, not by a blank token: tag names
and class values survive, every other attribute value and every run of text does
not. So `[a class="pin" href=* style=* title=*]{t}[/a]` still fails loudly if
somebody adds a span inside a pin or renames the class, while the roster growing
from 24 corners to 25 is silent. Grade letters in class names (`gD`, `gF`) are
written `g*`, because the corner of the day is a D today and an F tomorrow with
nothing in the repo changed. The skeletons in a run are sorted, so a failing bar
moving from the middle of the strip to the front is not reported as a change:
which shapes are present is the signal.

### Value rules

Applied in this order to text nodes and the four prose attributes. Order
matters: the longest and most specific pattern has to win before a shorter one
eats half of it.

| rule | example in | becomes | why |
| --- | --- | --- | --- |
| `iso-timestamp` | `2026-08-19T22:45:03Z` | `{TS}` | full ISO instants move on every write. |
| `iso-date` | `2026-08-18` | `{DATE}` | audit dates, ledger dates and grade-change dates roll over daily. |
| `iso-month` | `2026-08` | `{MONTH}` | the Exa and Apify budget lines are labelled by billing month. |
| `short-date` | `08-19` | `{MMDD}` | the audit-log chips print month and day only. |
| `human-datetime` | `Aug 19, 10:46 PM` | `{WHEN}` | "Last reported" moves every few minutes while the press burn runs. |
| `human-date` | `Aug 19`, `August 17 2026` | `{DAY}` | run headings and the footer build line print a written date. |
| `money` | `$10.9920`, `$105` | `{$2.4}`, `{$3.0}` | every ledger figure on `/status` moves while a run is in flight. Integer digits and decimal places are kept. |
| `milliseconds` | `321ms` | `{MS}` | the synthetic monitor prints a fresh latency per endpoint every hour. |
| `seconds` | `43 seconds` | `{SECS}` | the letter-timeout incident note quotes a measured duration. |
| `cents` | `0.0c`, `40 cent` | `{CENTS}` | the radar prints today's spend and its cap in cents. |
| `percent` | `97.3%`, `99%` | `{%2.1}`, `{%2.0}` | uptime and press coverage are both live rates. |
| `percent-word` | `93 percent` | `{PCTW}` | the grade sentence spells it out. |
| `grouped-count` | `7,355`, `8,254` | `{N4}` | the masthead and census counters. The separators are dropped before counting digits. |
| `decimal` | `3.1`, `196.9` | `{N1.1}`, `{N3.1}` | medians, points and index values are recomputed from live data. |
| `integer` | `318`, `24`, `9` | `{N3}`, `{N2}`, `{N1}` | the catch-all: corners checked, chunks, monitors, runs, collisions, 311 reports. |

HTML numeric entities (`&#9733;`) are parked before any of this and restored
after, so the star on the corner page does not read as a five-digit counter.
Every token a rule emits is parked the same way, so a later rule cannot chew on
an earlier rule's output.

### The shape idea, stated plainly

A token keeps the digit count and throws away the digits. 24 audited corners and
25 audited corners are the same token. 24 and 4 are not, because losing twenty
corners is a real event. That is the whole trade: a number changing is
invisible, a number appearing, disappearing or changing magnitude is loud.

## What this harness cannot see

Named here rather than discovered later.

- **Same-shape edits to constants in prose.** If somebody changed "within 80
  meters" to "within 90 meters" on `/methodology`, both are `{N2}` and this
  harness is silent. The formula and the 311 allow list are safe because they
  live in `<pre>`, and the CSS is safe because `<style>` is untouched, but a
  constant written into a sentence is not. `tools/*.test.mjs` is the guard for
  those, not this.
- **Two counters swapping.** 7,355 scored and 8,254 crossings are both `{N4}`.
- **Client-hydrated content.** The corner page ships nearly all of its data
  lanes as empty containers filled by fetch: press coverage, resident voices,
  the record tiles, the grade history, the map image. This harness reads the
  server response only, so it checks the scaffolding and not what lands in it.
  `/api/*` shape is covered by `tools/shape.test.mjs` instead.
- **Anything off these five pages.** `/watchlist`, `/changes` and `/c/` pages
  other than 16th and Mission are not covered. Adding one is a line in `PAGES`
  in `tools/lib/rendered_norm.mjs` and a re-run of the snapshotter.
- **A page that fails to load.** The differ exits 2 on a non-200, which is the
  right answer but is not the same signal as a rendering change.

## Wiring it into CI later

Deliberately not wired in. The freeze forbids changing the gate, and
`.github/workflows/ci.yml` is the gate. After the freeze lifts, the one line to
add, as its own step so a network failure is legible as a network failure:

```yaml
      - name: rendered baseline
        run: node tools/rendered_diff.mjs
```

Two things to decide before adding it. It reaches the public internet, so it
will fail when GitHub cannot reach the Worker, and it compares against the
deployed site rather than against the commit being tested, so on a deploying
branch it will diff the new code against the old baseline and be right to. A
`continue-on-error: true` for the first week is a reasonable way to find out how
noisy it really is before it can block a merge.
