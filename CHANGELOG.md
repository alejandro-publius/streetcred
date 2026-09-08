# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), dates are
`YYYY-MM-DD`. Seeded from `git log` in this repository; entries below are
the repository's own commit subjects, grouped by day, not paraphrased. The
one tag that predates this file, `pre-polish-aug18` (2026-08-18), was a
mid-sprint checkpoint rather than a release; `[0.1.0]` is the first tagged
release proper.

There is no per-commit entry for all 282 commits here; the days with the
heaviest activity (August 18-20, the core build days) are summarized with a
representative sample rather than reproduced line for line. The full,
unabridged history is `git log`.

## [Unreleased]

Work from a polish pass on 2026-09-07, not yet released.

### Added
- Direct unit tests for `credCheck()` in `src/cred.js` (`tools/credcheck.test.mjs`,
  12 cases): a claim backed by a strong official source, a claim backed by
  only a weak source below the lane's own threshold, a corner with no source
  in any of the four lanes, an official source (a police bulletin) correctly
  excluded from corroborating its own claim, and the weak/strong word split
  in `isStreetQuote`. `credCheck` previously had no direct test, only
  indirect coverage through other lanes' fixtures.
- A headless-Chromium screenshot of the live homepage,
  `docs/screenshots/homepage.png`, referenced in the README's top screen as
  evidence the deployed site actually renders.
- License and Node-version badges, a three-command quickstart, and a jump
  list into the README's existing sections, all within the first 40 lines.
- This file.

### Fixed
- `tools/label.test.mjs`, the test for the CONFIRMED/CANDIDATE/REPORTED
  labelling rule the README calls "the product's core claim," tallied
  pass/fail to stdout but never set a process exit code. `node --test`
  recorded the file as passing regardless of how many of its own cases
  failed. Confirmed by mutation: breaking `label()`'s CONFIRMED branch still
  printed "2 FAILED" but exited 0. Now exits 1 on any internal failure,
  matching `tools/pin.test.mjs` and `tools/verify.test.mjs`.

### Changed
- Re-measured and corrected stale numbers in the README's "Running it"
  section: the verified-clean-clone test count (158 -> 488), the wrangler
  dry-run asset count and upload size (24 files / 503.60 KiB -> 26 files /
  621.97 KiB), and the verification date (2026-08-20 -> 2026-09-07).

## [0.1.0] - 2026-09-07

First tagged release. Everything below predates this pass; entries are
commit subjects from `git log`, grouped by day.

### 2026-08-17 - build window opens (19 commits)
- Worker scaffold, DataSF stats, three-state imagery generation
- Exa news, Apify voices, Gemini letter drafting wired up and deployed
- Voices lane moved to Upstash Redis with a baked-asset fallback
- Sponsor integration sections written with concrete specifics

### 2026-08-18 (78 commits)
- High Injury Network corner list, the city map, Danger Index v2
- Data corrections, "shopfront" visible-structure pass, contrast fixes
- The bulk of the day's commits were homepage and corner-page layout passes

### 2026-08-19 (67 commits)
- Exa spend metering: the deployed key identified by what it charges, the
  counter denominated in dollars, two correction passes on plan pricing
- Frugal press enrichment (measured at 4.3 cents a corner) and the press
  batch honesty rails
- The press lane surfaced on the page, separated from a cycle total

### 2026-08-20 (52 commits)
- Polish pass 2, with a rollback point recorded before the work started
- Homepage seams, corner-page copy seams, tile rendering in raw HTML
- Verifier consistency rules, letter addressee fix, methodology counts
  pulled from constants instead of duplicated literals
- Watchlist honest accounting

### 2026-08-21 (14 commits)
- Corner-stage photographs shipped in the served HTML
- Live guards made to run concurrently on every deploy
- The audited index: a date on every row, three lane states instead of two
- Stored letters served before a redraft is attempted, not only on backoff

### 2026-08-23 (12 commits)
- Stat-band and audit-date consistency fixes (nothing stored may read later
  than Pacific today)
- The full offline lane: audit, both renders, and the honest label
- Batch resume that reuses an already-bought lane instead of re-spending
- Apify surfaced where a judge would look: chip, funnel links, ledger
- The case file: one story per corner, every tool it ran

### 2026-08-24 (22 commits)
- Freeze handoff notes, split into two tasks for the other side of it
- Voices lane funnel: three outcomes counted apart and named, corridor
  quotes labelled as corridor evidence, a withheld account stays withheld
- Corner of the day redefined as the newest audit, not the newest slider

### 2026-08-26 (10 commits)
- The autonomous agent's ingest endpoint as a validation gate, with the
  diary showing what it rejected and why
- The README's architecture diagram given the whole loop, both sides of it,
  with the reflex tier corrected to Gemma rather than a plain rule
- A dead repo link fixed and a three-day-stale numbers block refreshed
- MIT license added

### 2026-08-28 (2 commits)
- A daily findings ticker, and the Apify budget reserved apart from
  everything else so the cron's own run can't be starved by other lanes

### 2026-09-04 (4 commits)
- Fixed the Exa budget-meter tests, which had failed since September 1
  because they seeded the wrong period
- CI: least-privilege token, cancel superseded runs, action majors updated
- Dependabot enabled to keep workflow actions current
- README: CI badge added

[Unreleased]: https://github.com/alejandro-publius/streetcred/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alejandro-publius/streetcred/releases/tag/v0.1.0
