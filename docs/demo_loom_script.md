# StreetCred demo, 3:00 shot list

A recording script. It is not a spec and it is not marketing. Every line in the
"What is said" column was written against a page that was loaded and read on
**2026-08-20 between 05:45 and 06:05 UTC (2026-08-19, 22:45 to 23:05 PT)**, so
that nothing spoken aloud is a claim the screen cannot back at the moment it is
spoken.

Site: `https://streetcred.thealexschroeder.workers.dev`

## The one rule that governs the whole recording

**Almost every number on this site moves.** The press batch runs on a quarter
hourly cron (`wrangler.jsonc`, `"crons": ["10 13 * * *", "*/15 * * * *"]`), the
DataSF time windows slide every second, and the corner of the day rotates at
13:10 UTC. So the narration is written to **point at numbers rather than to
recite them**. Where a figure is spoken anyway, the row carries a
**READ THE SCREEN** instruction. Follow it. Saying a number the screen contradicts
is the only failure mode in this recording that cannot be edited out.

---

## Pre-flight

### Have open, in this tab order

| # | URL | Why |
|---|---|---|
| 1 | `/` | Beats 1 and 2, and the closing beat returns here |
| 2 | `/c/16th-mission` | Beats 3 to 7, the full audit |
| 3 | `/radar` | Beat 8 |
| 4 | `/status` | Beat 9 |
| 5 | `/changes` | Beat 10 |
| 6 | `/c/24th-and-noe` | Beat 11, the closing corner. **Load it once before recording and then close it.** See the two cold-corner rows in "What will break on camera" |

### Warm it, then check it

Run these four, in order, immediately before you roll. They are all free reads
against the live Worker.

```
# 1. Does the letter lane have a real draft right now, or the sample template?
curl -s "https://streetcred.thealexschroeder.workers.dev/api/letter?x=16th-mission" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('source'), d.get('backoff') and 'BACKED OFF' or '')"

# 2. Has the radar caught anything yet? If feed is not 0, beat 8 changes.
curl -s "https://streetcred.thealexschroeder.workers.dev/api/radar" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('feed',len(d['feed']),'monitors',len(d['monitors']['list']))"

# 3. Which corner is the hero today?
curl -s "https://streetcred.thealexschroeder.workers.dev/" \
  | grep -o 'class="hcname" href="/c/[a-z0-9-]*">[^<]*'

# 4. Is the closing corner's Street View frame already stored? 200 means yes,
#    404 means the first load on camera has to go and fetch it.
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://streetcred.thealexschroeder.workers.dev/gen/24th-and-noe/today.jpg"
```

Then load each of the six tabs once and let every lane finish, so the edge cache
and KV are hot for the take.

### Browser and window

- One window, 1440 wide or more. Bookmarks bar hidden, no extension icons.
- Browser zoom at 100%.
- **Do not resize the window during a take.** The corner page reorders its
  reading order below 860px (`src/page.js`, `@media(max-width:860px)`), so a
  mid-take resize reshuffles the panels you are narrating.
- The stat tiles count up once, over 600ms, the first time they scroll into
  view. Scroll past them once per take, not twice.

### What will break on camera

| Risk | What actually happens | Instruction |
|---|---|---|
| **Cold corner imagery** | A corner nobody has opened has no stored frames. The hazard and fix renders "cost 10 to 20 seconds each of Gemini time" (`src/imagery.js`, top comment), and the page polls every 3 seconds for up to 90 seconds (`POLL_MS = 3000, POLL_MAX = 30` in `src/page.js`). | **Never type a corner on camera that you have not opened before.** Not once, not "just to see". |
| **Cold corner, worse case** | A corner that is not in the citywide sweep runs the whole audit path, not just a photograph. | Only ever type a corner that resolves against the sweep. Verified safe: `24th and Noe`, `24th and Valencia`. Verified **unsafe**: `Haight and Ashbury` had no stored frames at all when this was written (`GET /gen/ashbury-and-haight/today.jpg` returned 404) and is not on the scored tier, so it would generate live. |
| **The letter lane is on the sample template** | At the time of writing, `/api/letter` for every corner tested returned `source: "sample"` with a Gemini quota backoff active until `2026-08-20T06:11:10Z`. On screen the letter tag reads **"sample"** in a dashed orange chip and the body is the generic template. | Run pre-flight check 1. If it says `sample`, either wait out the backoff or change beat 7's line to the honest version given in that row. **Do not narrate a template letter as a drafted one.** |
| **The hero corner rotates** | The corner of the day is chosen by the 13:10 UTC cron. On 2026-08-20 it was **19th and Mission, grade D, "Audited autonomously 2026-08-18"**. It will not be that when you record. | Beat 2 names no corner. Read whatever the card says. |
| **The press burn is running** | `/status` moved between two measurements 15 minutes apart: 312 corners over 16 chunks became 318 over 17, and the spend moved from $10.79 to $10.9920. | Beat 9 speaks no figures. Point, do not recite. |
| **`/changes` grows while you browse** | Opening a corner whose stored score is an older model version appends a row. A row for `24th & Valencia` was written at `2026-08-20T05:54Z`, minutes after that corner was opened during research for this script. | Expect more than the three rows described here. Beat 10 speaks no counts. |
| **Nothing here is deployed for the demo** | A feature freeze is in force until 2026-08-25. Record the live production Worker as it stands. | Do not deploy, do not run the pipeline by hand to make a shot look better. |

---

## The run of show

Eleven rows, six beats. The **Dur** column is what each row is allotted; the
arithmetic is checked at the bottom.

| # | Time | Dur | On screen | What is said |
|---|---|---|---|---|
| 1 | 0:00 to 0:12 | 12s | `/` at the very top, no scroll. Masthead, the "What's your corner's grade?" heading, the search box with its `Try 24th and Valencia` placeholder, and the subtitle line under it. | "This is StreetCred. It grades every intersection in San Francisco from the city's own crash and 311 records. The number on screen is how many are graded right now." |
| 2 | 0:12 to 0:32 | 20s | Scroll down to the **Corner of the day** card. Grab the slider handle and drag it slowly left, then right, then leave it near the middle. Do not click the Hazards or Today chips. | "Every morning it picks one corner and audits it with nobody watching. On the left is the Street View photograph. On the right is an AI visualization of the fix: continental crosswalks, a curb extension, a protected bike lane. The caption says it is a visualization, not a photograph of anything that exists." |
| 3 | 0:32 to 0:44 | 12s | Click through to `/c/16th-mission`. Land at the top: the big **F**, the line "F, worse than 99% of San Francisco intersections", the evidence sentence under it, the four verdict dots and **SUPPORTED**. | "Open one that has been fully audited. Sixteenth and Mission. Grade F, worse than ninety nine percent of San Francisco intersections, and the line underneath is where that comes from." **READ THE SCREEN** for the grade and the percentile. |
| 4 | 0:44 to 1:04 | 20s | Scroll to **The corner, three ways**. Click **Hazards**, then drag that slider once. Keep scrolling a few lines to the hazard rows and their footnote. | "Gemini read the actual photograph and marked what it flags. Underneath, each finding is checked against the city's own record. Confirmed means the record backs what the audit saw. Reported means the record raised it and the photograph does not show it." **READ THE SCREEN** before adding any count of confirmed versus reported. |
| 5 | 1:04 to 1:16 | 12s | Scroll past **Projected outcome** without stopping, to **Official record**: the big index number out of 100, the line "Danger Index, reported harm within 80 meters" and its 80m-core caveat under it, the citywide distribution strip with this corner's marker on it, then the row of four Cred Check chips and the verdict word. | "The Danger Index is arithmetic over two public datasets. No model touches it. Below it, four evidence lanes either agree or they do not, and the verdict is only ever as strong as the lanes that lit up." **READ THE SCREEN** for the verdict word and how many chips are lit. |
| 6 | 1:16 to 1:32 | 16s | Scroll to the left column: **Press coverage**, with its "cited from found" count and the Exa tag, then down past the coverage-by-year strip to **Resident voices**. | "Press coverage found by Exa and cited, with the outlet and the date on every row. Next to it, the resident accounts lane is empty on purpose. The scrapers ran here, and nothing they found was about the street itself, so nothing is shown as evidence." |
| 7 | 1:32 to 1:48 | 16s | Move to the right column, **The ask**. Show the DRAFT ONLY chip, the proposed fix, the estimated cost, the funding route, the letter body, and the "NOT SENT TO ANY OFFICIAL" line. | If pre-flight check 1 said `live`, `cache` or `verified-cache`: "The output is a letter to the district Supervisor, naming the fix, an estimated cost and a funding route. Every figure in it is checked against the source records before it is shown. It is marked draft only and nothing here is sent to any official." <br><br> If it said `sample`: "The output is a letter to the district Supervisor, naming the fix, a cost and a funding route. Right now the drafting model has no allowance left, so this is the template rather than a draft, and the page labels it sample rather than hiding it." |
| 8 | 1:48 to 2:10 | 22s | `/radar`. Top of page: the four counter tiles, then scroll to the **Detections** panel and let the empty-state sentence sit on screen, then keep going to **The standing queries** and scroll the list of corridor queries. | "The press radar. Standing Exa monitors watch San Francisco corridors and push a detection as coverage appears, so there is no polling schedule to promise. The feed is empty. Nothing has been published about a watched corridor since the monitors started, and the page says exactly that instead of filling the space. The lag figure stays not-applicable until there is something to measure." **READ THE SCREEN** for the monitor count. **If pre-flight check 2 shows a non-empty feed, cut the two empty-state sentences and describe the detections instead.** |
| 9 | 2:10 to 2:36 | 26s | `/status`. Uptime percentage and the paragraph naming the failing run, then the per-run bar strip, then scroll to **Press scan, running now**, then to the Exa and Apify ledger rows, then to the paragraph that begins "The ledger above is written per run". | "An hourly synthetic monitor loads the same pages you just saw, and this page only counts what those runs recorded. Uptime is under the ninety nine percent target and the failing run is described rather than trimmed. Then the money. Two provider ledgers, written from what the providers themselves report, next to the invoice figure that actually settles. They disagreed once, and the counting was fixed rather than the history." **Speak no figures here.** Let the ledger rows be read. **READ THE SCREEN** for uptime: it was 97.3% against a 99% target when this was written, so "under the target" was true. If it has climbed above 99%, say "uptime is over the target and the run that failed is still described" instead. |
| 10 | 2:36 to 2:46 | 10s | `/changes`. Three rows fit without scrolling; scroll slowly if more have appeared. | "Every grade movement is on the record, with who moved it and why. A grade that changes with no public record is a grade nobody can cite." |
| 11 | 2:46 to 3:00 | 14s | Back to `/`, top. Click the search box, type `24th and Noe`, press Check. Land on the corner page. Stop on the grade and the imagery panel's note. | "You do not have to be on the audited list. Type any San Francisco corner and it comes back with a real grade from the citywide sweep, and it says plainly that the visual audit has not run there yet." |

### Arithmetic check

12 + 20 + 12 + 20 + 12 + 16 + 16 + 22 + 26 + 10 + 14 = **180 seconds = 3:00**.

Cumulative: 12, 32, 44, 64, 76, 92, 108, 130, 156, 166, 180.

---

## Where this deviates from the requested run of show, and why

**1. Beat order inside the corner page follows the page, not the brief.**
The brief asked for grade and index, then the evidence lanes, then the Cred
Check, then the visual audit, then the letter. The desktop DOM order is:
verdict, visual audit, projected outcome, Official record and Danger Index, the
Cred Check chip row, location, then a two column split with press, coverage
timeline, voices and the stat tiles on the left and the letter on the right
(`src/page.js`, from the `#verdict` section down through `<div class="cols">`).
Scripting the brief's order would mean scrolling down, back up, and down again
inside a 70 second segment. The script scrolls once, top to bottom. Nothing is
dropped, only reordered.

**2. It is four lanes, not five.**
The Cred Check has exactly four: Official records, Press coverage, Resident
accounts, Visual audit. `/api/cred?x=16th-mission` returns four lanes and a
verdict scored out of four, and the tooltip on the verdict says "of 4 lanes
agree" (`src/page.js`, `LANE_LOADERS.cred`). The narration says four. Saying
five would be the first false claim in the video.

**3. The closing corner is `24th and Noe`, not a fresh one.**
It is on the SCORED tier, which means it resolves from one KV read against the
citywide sweep and its imagery lane takes the `scoredonly` path: one Street View
frame, no Gemini call, no polling (`src/imagery.js`, `imageryFor`). It shows a
real grade and the honest note "Scored from city records. The visual audit has
not run for this corner yet. The Street View photograph is real." That is the
right closing image and it cannot stall on camera. `24th and Valencia`, the
site's own placeholder text, is the fallback: fully warmed, all three frames
stored, but it is already AUDITED so it makes the citywide-reach point less
sharply.

**4. `/radar` is scripted around an empty feed on purpose.**
`/api/radar` returned `feed: 0` with 29 monitors standing and `dayCents: 0`
against a 40 cent cap. There is no feed to scroll. The script shows the empty
state and says what it is waiting for, because a monitor that has not fired yet
is a different thing from a monitor that is broken, and the page already draws
that distinction. If a detection lands before you record, beat 8's instruction
tells you to swap the lines.

**5. "Watch the run" is deliberately not in the 3:00.**
`/api/run?x=16th-mission` returns a full recorded pipeline trace with per stage
counts, and the corner page can replay it. It is genuinely one of the better
things here. It does not fit in three minutes without cutting the letter, and
the letter is the point. Consider it for a separate, longer recording.

---

## What is on screen at each beat, as measured

Recorded so you can tell a stale shot from a fresh one. **These are not lines to
read aloud.** They are what the pages held between 05:45 and 06:05 UTC on
2026-08-20, and they are the thing that will have moved.

- **Homepage:** masthead "7,355 SF intersections scored"; subtitle "7,355
  intersections graded citywide, 23 fully audited, one attempted every morning.";
  corner of the day 19th and Mission, grade D, "Audited autonomously 2026-08-18";
  press citations tile 2,695 "as of Aug 19, 10:48 PM"; spend tile $4.62.
- **`/c/16th-mission`:** grade F, index 99, "worse than 99% of San Francisco
  intersections"; evidence line "67 collisions in 5 years, 2 fatal, 353
  street-condition 311 reports in 3 years. District 9"; tier chip AUDITED;
  Cred Check verdict SUPPORTED with 3 of 4 lanes lit, the dark one being
  Resident accounts; four hazard rows, 1 CONFIRMED and 3 REPORTED; press lane
  showing 5 cited from 8 found, newest missionlocal.org 2026-05-28; Danger Index
  computed over an 80m radius against a distribution of 8,254 crossings;
  proposed fix $265,000 estimated via Caltrans HSIP.
- **`/radar`:** 29 monitors running, 0 detections this week, 0 cleared the
  relevance filter, median lag "n/a", 0.0c of a 40c daily cap. Monitors created
  2026-08-20T02:08Z, 29 of 29, none failed.
- **`/status`:** 97.3% over 37 runs in 7 days, 1 with a failing check; press scan
  318 corners over 17 chunks, 304 with coverage at 95.6%, $10.9920 by that run,
  last reported Aug 19 10:46 PM; Exa 2026-08 $12.6340 of $65.00 across 1,228
  searches and 2,552 pages of contents, workspace Alex Schroeder, confirmed;
  Exa all time $13.9030; Apify 42 of 70 runs, $4.829 ledger against a $4.6237
  invoice on $105.
- **`/changes`:** three rows. 24th & Valencia B 24 to D 88; Ashbury & Haight
  C 72 to C 71; 19th & Judah F 95 to F 96. All three from the pipeline, all three
  reasoned "score model replaced by v3".
- **`24th and Noe`:** grade C, worse than 77%, tier chip SCORED, score source
  `sweep`.

Two counts on this site describe different populations and must not be merged in
narration. **7,355** is how many intersections carry a published grade, read from
`city:meta` and confirmed by `/api/city` returning `"total":7355`. **8,254** is
the full census of real crossings the distribution strip was computed over
(`src/distribution.js`, top comment), including crossings that scored zero
points; the published roster is the nonzero subset. The homepage map legend says
the same thing in one line: "Unmarked crossings had no reported harm in the
record." `docs/COUNTS.md` carries the full derivation, and it also records one
difference it could not close: the sweep artifact on disk holds 7,353 nonzero
corners against the 7,355 the site publishes, and where the other 2 come from is
**not known**. None of this belongs on camera. It is here so you do not
improvise an explanation if somebody asks.

Two figures that are **stale in the repo** and must not be spoken: `README.md`
line 66 and `src/methodology.js` line 189 both say "Seven citywide semantic
searches". The live watchlist ran **29** queries (`/api/watchlist`: 29 queries,
117 articles, 5 entries, 7 rejects, 25 discarded, 90 day window), and `/radar`
holds 29 standing monitors. If a shot happens to catch the methodology page, do
not read that sentence aloud.

---

## 60 second cut-down

Same rules, same pre-flight, four beats. Skip `/changes` and skip the press
radar; what survives is the image, the evidence, the money, and the invitation.

| # | Time | Dur | On screen | What is said |
|---|---|---|---|---|
| A | 0:00 to 0:18 | 18s | `/` top, then straight down to the Corner of the day card. Drag the slider left and right once. | "StreetCred grades every intersection in San Francisco from the city's own crash and 311 records. Every morning it audits one of them with nobody watching. Photograph on the left, an AI visualization of the fix on the right. The caption says it is a visualization, not a photograph of anything that exists." |
| B | 0:18 to 0:38 | 20s | `/c/16th-mission`. Land on the grade, then one continuous scroll: hazard rows, Danger Index, Cred Check chips, press lane, stopping on **The ask**. | "Open a fully audited corner. The grade, then the receipts. Gemini's read of the real photograph, checked line by line against the city record. An index that is arithmetic over two public datasets. Four evidence lanes that either agree or they do not. And a letter to the district Supervisor, marked draft only, sent to nobody." **READ THE SCREEN** for the grade and the verdict word. |
| C | 0:38 to 0:50 | 12s | `/status`. Uptime, then scroll to the Exa and Apify ledger rows. | "It reports its own uptime including the run that failed, and it keeps a ledger of what it spent doing all of this, against the invoice the provider actually sent." **Speak no figures.** |
| D | 0:50 to 1:00 | 10s | Back to `/`, type `24th and Noe`, Check, land on the grade. | "And you do not have to be on the audited list. Type any San Francisco corner and it comes back with a real grade, and it tells you what has not been checked there yet." |

**Arithmetic check:** 18 + 20 + 12 + 10 = **60 seconds = 1:00**. Cumulative: 18,
38, 50, 60.
