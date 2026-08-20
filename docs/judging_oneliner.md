# One-liners, by audience

Five audiences, five sentences, plus an alternate for each in a different register.
Every sentence below is true of the product as it stood when it was checked against the
live site on 2026-08-19 between about 22:40 and 22:55 PT. Press figures move while the
burn is running, so any sentence carrying a press number names the reading it was taken
from, and should be re-read off `/status` before it is spoken out loud.

One rule was applied throughout: the site grades every intersection and audits one a
morning, and those are two different claims. `src/methodology.js` line 122 states it
outright ("Every intersection in San Francisco has a grade, and only some have an
audit"), and no sentence here blurs them.

---

## 1. Build Club judges

**Primary.**
StreetCred grades all 7,355 San Francisco intersections from the city's own collision
and 311 records, and a scheduled Cloudflare Worker attempts a full audit of one more
corner every morning with nobody present, publishing the result even when a lane comes
back partial.

- 7,355 is the masthead figure served on every page, and the homepage subtitle reads
  "7,355 intersections graded citywide, 23 fully audited, one attempted every morning."
  Check with `curl -s https://streetcred.thealexschroeder.workers.dev/`.
- "Every morning" is `wrangler.jsonc` line 29, `"crons": ["10 13 * * *", ...]`, which the
  comment on lines 20 to 22 explains is 06:10 Pacific during daylight time.
- "Even when a lane comes back partial" is visible right now: `/api/board` returns a count
  of 24 while the homepage says 23 fully audited, because 1st and Bush sits in the
  ENRICHED state after its imagery lane came back partial on the 2026-08-19 run.

**Alternate, shorter and more direct.**
Built in a 55 minute sprint at Build Club on 2026-08-17, it now grades 7,355 corners,
runs its own morning audit unattended, and publishes its own uptime and its own spend.

- The sprint length and event date are stated in `README.md` near the top, under the hero
  image.
- Uptime and spend are both live pages, not claims in a deck: `/status` reported 97.3%
  over 37 runs in 7 days with 1 failing, and carries both the Exa and Apify ledgers.

---

## 2. Exa prize judges

**Primary.**
Exa runs the direction no city dataset can run, discovery: the citywide pass read 117
articles on 2026-08-19, and every crossing name it surfaced had to match the graded city
index and be confirmed as coverage about safety at that crossing before it could appear,
with all 7 rejects published beside the 5 that passed.

- All of these come from one call, `curl -s .../api/watchlist`, on the pass built at
  2026-08-19T13:11:21Z: `articles` 117, `entries` 5, `rejects` 7, `discarded` 25, over a
  90 day window.
- Say 117 articles, not "29 searches read 117 articles." The pass issues 29 queries, and
  on that build only 8 of them returned. The other 21 carry
  `"failed": "Too many subrequests by single Worker invocation"`, which is a Cloudflare
  invocation ceiling and not an Exa failure. The 117 came from the 8 that returned.
- The rejects carry their reasons in the payload, for example "no graded crossing by that
  name in the citywide index" for `16th and 24th` and "the article names this crossing but
  is not about safety at it" for `Church and Market`. Both are visible at `/watchlist`.
- Note before quoting: `src/methodology.js` line 189 still says "Seven citywide semantic
  searches" and is stale against the 29 the live pass issues. Do not repeat the seven.

**Alternate, leaning on the standing radar.**
Twenty-nine standing Exa monitors sit open on San Francisco's corridors and push new
coverage in as it publishes, and the feed reads empty tonight because nothing has been
published about a watched corridor since they were created.

- `curl -s .../api/radar`: `setup` reports 29 created of 29 with 0 failed at
  2026-08-20T02:08:17Z, and `feed` is an empty array.
- The `/radar` page states the push mechanism itself: "Exa holds the queries open and sends
  a detection as coverage appears, so nothing here is on a schedule this page could
  promise."
- The empty feed is the sentence's strongest part, not its weakest. Budget shows 0 cents
  spent against a 40 cent daily cap and a 900 cent monthly cap, not paused.

---

## 3. A DevRel person deciding in three seconds

**Primary.**
Type any two San Francisco cross streets and you get a letter grade for that corner, the
crash and 311 counts behind it with links to the exact city queries that produced them,
and a letter addressed to the Supervisor whose district it is in.

- The links are real and are in the payload. `curl -s ".../api/stats?x=19th-and-mission"`
  returns `crashes` 23, `reports311` 201, `district` 9, and a `urls` object whose entries
  are full `data.sfgov.org` SoQL URLs anyone can paste into a browser.
- The named Supervisor comes from the same corner: `/api/letter?x=19th-and-mission`
  returns `"supervisor":"Jackie Fielder"` and a letter body that opens "Dear Supervisor
  Jackie Fielder".
- One caveat if pressed: at the time of checking, that letter came back with
  `"source":"sample"` because the Gemini daily quota was spent and the route was in
  backoff. The page tags anything that is not live, so this is a labelled state rather
  than a hidden one, but do not demo the letter as freshly generated without checking
  `source` first.

**Alternate, punchier.**
Every San Francisco intersection has a grade, one more corner is attempted unattended
every morning, and the misses are on the page next to the hits.

- "Attempted" is the site's own word, from the homepage subtitle, and it is the honest
  one: the morning run publishes a partial result rather than nothing when a lane fails.
- "The misses" is literal and is the hook worth defending: `/watchlist` publishes the 7
  rejected candidates with reasons, `/status` counts the 1 failing synthetic run against
  the 97.3% rather than trimming it, and `/radar` shows an empty feed rather than filler.
- `src/watchlistpage.js` line 4 is the reason it works that way: "a discovery pipeline that
  publishes only its hits is indistinguishable from a search box that got lucky."

---

## 4. A journalist

**Primary.**
Each city-records figure on a corner page links to the exact data.sfgov.org query that
produced it, and every candidate corner the press pass rejected is published with the
reason it was rejected.

- Verifiable in one command: `curl -s ".../api/stats?x=19th-and-mission"` returns a `urls`
  object with the collision, fatality, 311 and district queries against datasets
  `ubvf-ztfx` and `vw6y-z8j6`. Those are keyless and free, so a reporter can rerun them.
- The rejects are at `/watchlist` and in `/api/watchlist`, 7 of them on the 2026-08-19
  pass, each with a plain-language reason.
- The scoring code is arithmetic, not a model. `src/score.js` line 1: "Nothing in this file
  touches a model: the score is arithmetic over two public datasets, and every input is a
  number a person can look up."

**Alternate, framing the story rather than the tool.**
The story is not that software ranked San Francisco's corners, it is that the ranking
shows its arithmetic, names what it cannot see, and prints the leads it threw out.

- "What it cannot see" is a real published list, not a posture: `/methodology` has a
  "Known limitations, honestly" section covering police-reported undercounting, the 80m
  circle double-counting dense blocks, and corridor-level press coverage.
- The exposure caveat is the one a reporter will reach for first, and it is on the page
  beside every score: the index ranks reported harm, not risk per crossing
  (`src/methodology.js` line 222).

---

## 5. A San Francisco Supervisor's aide

**Primary.**
When a neighbor calls about a dangerous corner, this puts the city's own collision and 311
counts for that exact crossing in front of you in seconds, along with any news coverage of
it, so the request arrives with its evidence attached instead of as a complaint.

- No product vocabulary on purpose. The underlying facts: `/api/stats` returns collision
  counts over 5 years and street-related 311 reports over 3 years within 150 meters, with
  the source queries attached, and the press lane returns headlines with outlet and date.
- The corner page for 19th and Mission renders that as "23 collisions in 5 years, 201
  street-condition 311 reports in 3 years. District 9."
- Honest framing for this audience: news coverage is often about the corridor rather than
  the single crossing, and the site labels it that way rather than overstating it. The
  19th and Mission press panel is headed "Coverage of this corridor" for exactly that
  reason.

**Alternate, for the budget conversation.**
It ranks all 7,355 crossings in the city by the harm actually recorded at them, so you can
see where the ones in your district sit before you decide what to put money behind.

- District is on every corner in the board payload, assigned by the majority of collision
  rows within 150 meters, which is described in `/methodology` under "How the whole city is
  graded."
- "Harm actually recorded" is doing real work in that sentence and must not be softened to
  "risk." A quiet corner scores low because nobody walks through it, not because it is
  safe, and that is stated in the README's "Honest limits."

---

## Words we do not use

These are not style preferences. Each one is a claim the product declines to make, with
the place the decision is written down.

- **"First reported."** We say **coverage we can find**. Exa recall is not ground truth, and
  an empty year means this search found nothing, not that nothing happened. Enforced in the
  UI at `src/page.js` line 2448 and in the run manifest at `src/manifest.js` lines 65 to 68,
  which says a manifest that hardened it into "first reported" "would be the place the
  overclaim entered the product."
- **"Risk," "the most dangerous corner."** The Danger Index ranks **reported harm, not risk
  per crossing**. There is no exposure normalization anywhere in the formula, so a busy
  corner ranks high partly because it is busy. `src/methodology.js` line 222, and the README
  "Honest limits."
- **"Audits every intersection in San Francisco."** It **grades** every intersection and
  **audits** one a morning. `src/methodology.js` line 122.
- **"Real time," "live alerts."** The radar is push delivery, and the page says so:
  "nothing here is on a schedule this page could promise." Do not promise a latency the
  system cannot promise itself.
- **"A photo of the fix," "a rendering of the redesign."** The fix image is an AI
  visualization, not an engineering drawing, and its cost figure is an order-of-magnitude
  estimate. README, "Honest limits," and the caption under the hero image.
- **"The AI found a hazard."** A CANDIDATE finding means the model saw something the record
  has not caught up with. It does not mean the model is right, and one Street View frame
  taken on one day facing one direction cannot see the other three approaches. README,
  "Honest limits."
- **"Residents say."** Only when a real scraped quote is actually about the street. The
  letter quotes no one rather than inventing testimony, and the voices lane shows an honest
  empty state on corners that were never scraped. README, "Honest limits."
- **"We spent $X on Exa."** Spend is stated with its attribution and its limits, because a
  price identifies a plan tier, not a workspace. `/status` says it plainly: the total "is
  only attributable once somebody has watched a specific dashboard move after a known
  call."
- **Marketing verbs generally.** No "revolutionizing," no "empowering," no "AI-powered."
  The site describes what ran and what it returned. If a sentence would survive being read
  aloud to somebody holding the source data, it is fine. If it would not, rewrite it.

## What is not known

- Whether "7,355" and the sweep's 8,254 crossings describe the same population is not
  settled here. `docs/COUNTS.md` carries the derivation of both, including `/api/city`
  returning `"total":7355` and the score's `sampleSize` of 8,254. Read that file rather
  than guessing from these sentences.
- Whether any of the 5 verified watchlist corners will still be on the list at judging is
  not known. The pass rebuilds and the numbers move.
