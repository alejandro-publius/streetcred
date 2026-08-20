# The rally post, final

One file, five parts: a re-verify block, the full post, a short post, a posting
checklist, and the one caveat that survives. Nothing here has been sent. No account has been opened, no
message posted, no tag applied. Every item is an action for a person.

This supersedes the drafts in `specs/MAKE_THEM_KNOW.md`, which are stale: they
cite 104 articles, four corners, seven rejects and 24 discarded from a watchlist
pass that has since been replaced. The framing note in that file still holds and
is carried forward here: **these are things worth showing, not things addressed
to anyone.** A post that would be worth reading if no judge existed is the one a
judge will actually stop on.

Every figure below was read from the live site on **2026-08-19 between 22:52 and
22:56 PT** (2026-08-20 05:52 to 05:56 UTC), except the cron schedule, which comes
from `wrangler.jsonc` in this repo.

---

## 1. Re-verify block, run this immediately before posting

The press scan is running continuously and every press figure moves within
minutes. The watchlist is rebuilt by the 06:10 PT cron, so it moves once a day.
Run these five commands, compare against the reference column, and edit the post
before pasting. If a number has moved, use the new one or drop the sentence.

```sh
# 1. Watchlist counts. These are the numbers the post leans on hardest.
curl -s https://streetcred.thealexschroeder.workers.dev/api/watchlist \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ('builtAt','calls','articles','rejected','discarded')}, 'entries', len(d['entries']))"

# 2. Roster size and fully-audited count.
curl -s https://streetcred.thealexschroeder.workers.dev/api/board \
  | python3 -c "import json,sys; print('board count', json.load(sys.stdin)['count'])"
curl -s https://streetcred.thealexschroeder.workers.dev/ | grep -o 'intersections graded citywide[^<]*'

# 3. Did the morning cron fire, and did it commission scrapes by itself?
curl -s "https://streetcred.thealexschroeder.workers.dev/api/run?x=1st-and-bush" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['ranAt'], d['trigger'])"

# 4. Masthead corner count, in case the index has been rebuilt.
curl -s https://streetcred.thealexschroeder.workers.dev/ | grep -o '7,3[0-9][0-9] SF intersections scored'

# 5. Eyeball the two pages a reader will screenshot.
open https://streetcred.thealexschroeder.workers.dev/watchlist
open https://streetcred.thealexschroeder.workers.dev/status
```

Reference values, read 2026-08-19 22:52 to 22:56 PT:

| Number | Value then | Where a reader checks it | In the post? |
| --- | --- | --- | --- |
| Intersections scored | 7,355 | masthead on every page | yes, both versions |
| Articles read | 117 | /watchlist | yes, full version |
| Corners verified onto the watchlist | 5 | /watchlist | yes, full version |
| Rejected, with reasons | 7 | /watchlist | yes, full version |
| Phrases discarded | 25 | /watchlist | no, LinkedIn variant only |
| Watchlist built at | 2026-08-19T13:11:21Z | /api/watchlist `builtAt` | no, it dates the four above |
| Fully audited corners | 23 | homepage subtitle | no, cut for length |
| Board roster | 24 | /api/board `count` | no, cut for length |
| Morning cron run | 2026-08-19T13:11:15Z, trigger `cron` | /api/run?x=1st-and-bush | yes, as "at 06:10 this morning" |

Numbers deliberately **left out of the post** because they move too fast to
survive a screenshot, or because they are not checkable on a page:

- The live press scan (318 corners over 17 chunks, 304 with coverage, $10.9920
  spent by that run at 22:56 PT). It changes while you read /status.
- The month-to-date press-check totals on /watchlist (346 press-checked, 330
  with coverage found at 22:56 PT). Same reason.
- Exa and Apify spend ($12.5990 of $65.00 for 2026-08; Apify 42 of 70 runs,
  $4.6237 of $105 on the invoice). Correct at 22:56 PT and moving. If someone
  asks in the thread, read it off /status live rather than quoting from here.
- "15 accounts read" and "$0.2961" for the 24th and Valencia scrape, which the
  old draft used. That run's per-run counts have not been backfilled, so
  /api/run?x=24th-and-valencia reports `no Apify counts have been backfilled for
  this corner` and the ledger line is no longer on the visible part of /status.
  The kept quote itself is still live and checkable at
  /api/voices?x=24th-and-valencia. Do not quote the two numbers.
- The press radar. 29 of 29 Exa monitors are created and the feed is empty, with
  zero detections. That is the honest empty state and it is the right thing to
  ship, but "I built a thing that has found nothing yet" is not a rally line.
  Add a sentence about it only once /api/radar returns a non-empty `feed`.

One nuance to know before anyone asks, because it is visible in the JSON: the
06:10 run issued 29 queries and only 8 completed. The other 21 returned nothing
with `Too many subrequests by single Worker invocation`. The 117 articles and the
5 corners came from those 8. The post therefore cites articles and corners, which
are real, and does not cite "29 searches", which is true of the attempt and not of
the work. If somebody asks, that is the honest answer and it is a Worker platform
limit, not a search-quality problem.

---

## 2. The full version, for the event WhatsApp

Paste as is. One message, not a thread.

---

StreetCred is live: https://streetcred.thealexschroeder.workers.dev

Every intersection in San Francisco now has a safety grade. All 7,355, scored
against a full census of the city's own collision and 311 records rather than a
sample. Type any corner into the box and you get its grade, the counts behind it,
and the data.sfgov.org query so you can check the math yourself.

There is also a Press Watchlist that works out which corners the city's current
coverage is talking about. This morning it read 117 articles, kept five and
rejected seven. It publishes the rejects with their reasons, the more
interesting half.

And it runs itself: at 06:10 this morning the cron audited 1st and Bush and
commissioned its own resident-voice scrapes while nobody was watching.

If you think it deserves a vote, I would appreciate yours. Genuinely curious what
grade your corner gets.

---

## 3. The short version, for a chat thread

56 words including the URL. Use where the long one would not be read.

---

StreetCred grades all 7,355 San Francisco intersections from the city's own crash
and 311 records, and links the query so you can check it. It also reads the news
for corners in trouble, and publishes what it rejected and why. It attempts one
fresh corner audit by itself every morning. A vote would be appreciated.
https://streetcred.thealexschroeder.workers.dev

---

## 4. Posting checklist

- [ ] Run the re-verify block above. Do not skip this. Every watchlist figure in
      the full post was true at 22:52 PT on 2026-08-19 and is rebuilt at 06:10
      PT, so a post pasted after the next morning's run will be quoting numbers
      the site no longer shows.
- [ ] **Full version** into the event WhatsApp thread. One message, not a thread.
      Best posted the morning of judging day, 2026-08-24, after the 06:10 cron has
      run and the numbers have been re-read.
- [ ] **Short version** into any chat thread where a wall of text dies. Same
      numbers, so re-verify covers both.
- [ ] **Neither version is addressed to a judge or mentor by name.** No name, no
      handle, no "@" in the WhatsApp posts. This rule comes from
      `specs/MAKE_THEM_KNOW.md` and it is the one rule that does not bend.
- [ ] **LinkedIn variant** is Post 2 in `specs/MAKE_THEM_KNOW.md`, and it goes up
      separately, after the WhatsApp post rather than at the same time.
      - It leads with the **reject list**, not the hit list, because the rejects
        are the more interesting half and because a discovery pipeline that shows
        only its hits is indistinguishable from a search box that got lucky.
      - **Tagging:** tag Exa and Apify as company pages, and no individual. That
        keeps the sponsor credit on the tools rather than on people who happen to
        be judging.
      - **Image:** lead with a screenshot of the reject list at
        https://streetcred.thealexschroeder.workers.dev/watchlist, scrolled to
        "Rejected and why", not the watchlist hits.
      - **Numbers to fix before posting it.** Post 2 as written is stale. Replace
        "104 San Francisco news articles" with **117**, "four corners" with
        **five**, "24 candidates were discarded" with **25**, and check the seven
        rejects again: the current three worth naming are `2nd and 4th` and
        `Hudson and Woodside`, which are real crossings in San Rafael and Redwood
        City rather than San Francisco, and `Church and Market`, which was named
        in an SFMTA landscape-plan update that is not about safety there.
        `3rd and New Montgomery`, which the old draft used, is **not** in the
        current reject list. Do not paste it.
- [ ] Optional second WhatsApp message about the autonomous lane. The honest hook
      is the ledger: it runs at 06:10, spends real credit, and publishes what it
      spent. Only send this once the pending 1st and Bush scrapes have been
      ingested, see the caveat below.

---

## 5. The caveat: narrowed, not dropped

The old caveat in `specs/MAKE_THEM_KNOW.md` said the morning cron had not yet
fired with the autonomous-voices code deployed. **That half is now resolved and I
have dropped it**, on this evidence:

- `/api/run?x=1st-and-bush` reports `ranAt` 2026-08-19T13:11:15.162Z with
  `trigger: "cron"`.
- `/api/watchlist` reports `builtAt` 2026-08-19T13:11:21.576Z, six seconds later,
  from the same run.
- `wrangler.jsonc` schedules `10 13 * * *`, which is 06:10 Pacific while daylight
  time is in force.
- /status shows `1st and Bush, 2 runs commissioned, in flight, 2026-08-19,
  pending`. /status carries no clock time on that line, so the attribution rests
  on the date plus the fact that the cron run above is the only run recorded for
  1st and Bush that day. If that is not good enough for you, cut the words "and
  commissioned its own resident-voice scrapes" and the post still stands.

So the cron fired, audited a corner it picked itself, and commissioned two paid
Apify runs unattended. The full post says exactly that and no more.

**What I kept.** No cron-fired scrape has been ingested and published yet. The
two 1st and Bush runs are still in flight and pending as of 22:56 PT. The one
resident quote that is live on the site, the Reddit post about a cyclist struck
in the Valencia centre bike lane at
https://streetcred.thealexschroeder.workers.dev/c/24th-and-valencia, was
commissioned at 2026-08-18T22:05:50Z, which is 15:05 PT and therefore not a
06:10 cron. The commission side is autonomous and proven. The ingest side is
proven by hand and is scheduled to close on the next 06:10 run. If anybody asks
whether a machine has published a resident quote start to finish without a human,
the answer today is not yet, and it will probably be yes by tomorrow morning.
Re-check `/api/voices?x=1st-and-bush` before claiming otherwise: it currently
returns `{"source":"empty","items":[]}`.
