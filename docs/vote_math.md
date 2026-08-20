# Vote math

## What this file is, and what it deliberately is not

This is the instrument for tracking the People's Choice standing, not a record of
it. **There is no vote count in this document, because there is no vote count
anywhere in this repository.**

That is a finding, not an omission. Every markdown, JS, MJS, JSONC, HTML and PY
file in the tree was searched for "People's Choice", "vote", "voting", "ballot",
"judging" and "judge":

```sh
grep -rn -i "people's choice\|peoples choice\|vote\|voting\|ballot\|judging\|judge" \
  --include="*.md" --include="*.js" --include="*.jsonc" --include="*.mjs" \
  --include="*.py" --include="*.html" . | grep -v node_modules
```

Every hit is either the district-assignment majority vote in the resolver
(`src/resolve.js:234`, `tools/sweep_districts.mjs:14`, `tools/lib/districts.mjs:9`,
`src/methodology.js:130`), the radar's `judge()` function that classifies a press
detection (`src/radar.js:140`), a test fixture, or a line asking someone to vote
in prose (`specs/MAKE_THEM_KNOW.md:52`, `docs/rally_post_final.md:115` and `:129`).
The only reference to the competition standing is `specs/HANDOFF.md:642`, which
reads, in full:

> - **People's Choice copy.**

It is listed there as an open item for the human. So the standing, the totals and
the mechanics are unknown to this repo and to me. A number invented here would be
a number the owner might act on, so section 2 leaves blanks instead of guesses.

What IS derivable is the calendar and the clock arithmetic, and that is most of
what follows.

---

## 1. What is known, with sources

| Fact | Value | Source |
|---|---|---|
| The event | Build Club, "Moonlighting with Gemini + Exa" | `README.md` line 14 |
| Event date | 2026-08-17 | `README.md` line 14, "August 17 2026" |
| Build duration claimed | a single 55 minute sprint | `README.md` line 14 |
| Judging date | 2026-08-24 | the project owner's instruction. Not in any repo file. `docs/CHANGELOG_DRAFT.md:312` repeats it as prose, sourced from the same instruction, so it is not independent confirmation |
| Feature freeze lifts | 2026-08-25 | `specs/HANDOFF.md:604`, `docs/CHANGELOG_DRAFT.md:3` and `:235`, `docs/KEY_ROTATION.md:275` |
| Now, at the time this file was written | 2026-08-19 23:01 PT, which is 2026-08-20 06:01 UTC | `python3` run shown in section 3 |
| Daily audit cron | `10 13 * * *` UTC | `wrangler.jsonc`, `triggers.crons` |
| Press-batch cron | `*/15 * * * *` UTC | `wrangler.jsonc`, `triggers.crons` |
| Roster size | 24 corners | `curl -s .../api/board`, read 2026-08-20T06:01:01Z |
| Fully audited | 23 | homepage subtitle, read 2026-08-20T06:01:01Z |
| Masthead | "7,355 SF intersections scored" | homepage, read 2026-08-20T06:01:01Z |

The gap between 24 and 23 is `1st-and-bush`, which is ENRICHED rather than fully
audited because its imagery lane came back partial on the 2026-08-19 daily audit.
The press-facing counts move continuously while the press scan runs, so re-read
them from the live site before quoting them anywhere. `docs/rally_post_final.md`
section 1 carries the exact re-verify commands.

---

## 2. What is not known

Fill these in by hand. Nothing downstream should be written until they are filled.

**Q1. What is the current People's Choice standing?**
Answer: ______________________
Where to look: the Build Club event page or app used on 2026-08-17, whichever
surface shows the leaderboard. Not in this repo.

**Q2. How many votes have been cast in total, across all projects?**
Answer: ______________________
Why it matters: a standing without a denominator cannot be turned into a gap.
Same source as Q1.

**Q3. Is voting open right now?**
Answer: open / closed / not yet started: ______________________
Where to look: the event page, or ask the organiser directly. If voting has not
opened, every deadline row in section 3 is moot and the countdown in section 5
changes shape.

**Q4. What is the voting mechanism, and what is its URL?**
Answer: ______________________
One vote per account, per person, or per session? Can a vote be changed? Is the
URL something a rally post can link to directly, or does it require the voter to
be signed in first? The answer decides whether `docs/rally_post_final.md` can
carry a call to action at all, or only a link to the live site.

**Q5. What is the exact close time, and in which timezone was it stated?**
Answer: ______________________ in timezone ______________________
This is the one to nail down verbatim, in the organiser's own words, because a
close time restated in the wrong zone is how a deadline gets missed. Section 3
exists to convert whatever answer lands here.

**Q6. Do votes from the event night of 2026-08-17 carry over to 2026-08-24?**
Answer: yes / no / partially: ______________________
If they carry, the standing has a seven day head start baked in and a rally post
is arithmetic on top of an existing base. If they reset, the whole contest is
decided in whatever window Q5 defines.

**Q7. Who is the organiser to ask, and by what channel?**
Answer: ______________________
Q1 through Q6 are probably one message to one person.

---

## 3. Timezone conversion for 2026-08-24

On 2026-08-24 San Francisco is on Pacific Daylight Time, UTC-7. That was verified
by running the IANA database rather than by reasoning about the DST boundary:

```sh
python3 -c "
import zoneinfo, datetime
la = zoneinfo.ZoneInfo('America/Los_Angeles')
d = datetime.datetime(2026,8,24,12,0,tzinfo=la)
print('offset', d.utcoffset(), 'tzname', d.tzname())"
```

Output:

```
offset -1 day, 17:00:00 tzname PDT
```

`-1 day, 17:00:00` is Python's normalized form of minus seven hours. PDT
confirmed for the judging date.

The table below was generated, not typed, by the same script extended over five
candidate close times and five zones. UTC and New York cover most organisers,
London covers a European one, Sydney and Kolkata are included because both cross
the date line relative to Pacific evening and that is exactly where a deadline
gets read a day wrong.

| Pacific (PDT) | UTC | New York | London | Sydney | Kolkata |
|---|---|---|---|---|---|
| 09:00 PT Aug 24 | 16:00 Aug 24 | 12:00 Aug 24 | 17:00 Aug 24 | 02:00 Aug 25 | 21:30 Aug 24 |
| 12:00 PT Aug 24 | 19:00 Aug 24 | 15:00 Aug 24 | 20:00 Aug 24 | 05:00 Aug 25 | 00:30 Aug 25 |
| 17:00 PT Aug 24 | 00:00 Aug 25 | 20:00 Aug 24 | 01:00 Aug 25 | 10:00 Aug 25 | 05:30 Aug 25 |
| 23:00 PT Aug 24 | 06:00 Aug 25 | 02:00 Aug 25 | 07:00 Aug 25 | 16:00 Aug 25 | 11:30 Aug 25 |
| 23:59 PT Aug 24 | 06:59 Aug 25 | 02:59 Aug 25 | 07:59 Aug 25 | 16:59 Aug 25 | 12:29 Aug 25 |

The generating command, so the table can be rebuilt if the judging date moves:

```sh
python3 - <<'PY'
import zoneinfo, datetime
la = zoneinfo.ZoneInfo("America/Los_Angeles")
zones = ["UTC","America/New_York","Europe/London","Australia/Sydney","Asia/Kolkata"]
for h,m in [(9,0),(12,0),(17,0),(23,0),(23,59)]:
    d = datetime.datetime(2026,8,24,h,m,tzinfo=la)
    print(f"{h:02d}:{m:02d} PT", [d.astimezone(zoneinfo.ZoneInfo(z)).strftime("%H:%M %b %d") for z in zones])
PY
```

Note the trap in rows three, four and five: **a Pacific close time at or after
17:00 falls on 2026-08-25 in UTC.** An organiser who writes "closes end of day
August 24" and means UTC is asking for something seventeen hours earlier than an
organiser who means Pacific. Q5 exists for this reason.

### The site's own clock

`wrangler.jsonc` sets `"crons": ["10 13 * * *", "*/15 * * * *"]`. Cloudflare crons
are UTC only. The comment in that file states the consequence, and the conversion
checks out:

```sh
python3 -c "
import zoneinfo, datetime
u = datetime.datetime(2026,8,24,13,10,tzinfo=datetime.timezone.utc)
print(u.astimezone(zoneinfo.ZoneInfo('America/Los_Angeles')).strftime('%Y-%m-%d %H:%M %Z'))"
# 2026-08-24 06:10 PDT
```

So the daily audit fires at 06:10 Pacific during daylight time, and at 05:10 once
daylight time ends. The handler records the Pacific date, not the UTC date,
because the claim the product makes is about mornings.

**The last autonomous audit before judging happens the morning of 2026-08-24 at
06:10 PT.** If judging starts at 09:00 PT, the audit lands two hours fifty
minutes ahead of it, unattended. That is the single most demonstrable thing the
project does on the day, and it needs nobody awake for it.

Counting forward from 2026-08-19 23:01 PT, there are **five** daily audit runs
left before judging: Aug 20, 21, 22, 23 and 24, each at 06:10 PT. Verified:

```sh
python3 - <<'PY'
import zoneinfo, datetime
la = zoneinfo.ZoneInfo("America/Los_Angeles")
now = datetime.datetime.now(la)
d = now.replace(hour=6, minute=10, second=0, microsecond=0)
runs = []
while d <= datetime.datetime(2026,8,24,6,10,tzinfo=la):
    if d > now: runs.append(d.strftime("%Y-%m-%d 06:10 PT"))
    d += datetime.timedelta(days=1)
print(len(runs), runs)
PY
# 5 ['2026-08-20 06:10 PT', ... , '2026-08-24 06:10 PT']
```

Five runs means the roster can grow by **at most five** corners before judging,
from the 24 read at 2026-08-20T06:01:01Z. At most, not exactly: a run whose
imagery lane comes back partial publishes an ENRICHED corner rather than a fully
audited one, which is what happened to `1st-and-bush` on 2026-08-19, and a run
can fail outright. `/status`, read 2026-08-20T06:04:20Z, reports 97.3% uptime and
"37 runs in the last 7 days, 1 with at least one failing check". Do not promise a
number here. Read `/api/board` on the morning of the 24th and quote what it
actually says.

Hours remaining, from 2026-08-19 23:01 PT: 105.98 to 09:00 PT on the 24th,
120.97 to 23:59 PT on the 24th. Both from the same script.

---

## 4. What one rally post plausibly moves

**This section contains no number, and that is the correct output.**

The arithmetic anyone would want is:

```
votes gained  =  reach  x  conversion rate
```

where `reach` is how many people see the post and `conversion rate` is the
fraction of those who go and vote. Both terms are unknown here, and neither is
estimable from anything in this repo:

- **`reach` is unknown.** No account has been opened and no post has been made.
  `docs/rally_post_final.md` opens by stating that nothing in it has been sent.
  There is no follower count, no prior post, and no impression history to
  extrapolate from. A first post from a cold account and a post from an
  established one do not reach comparable audiences, and nothing in this repo
  tells me which of the two this would be.
- **`conversion rate` is unknown.** It depends entirely on the answer to Q4. A
  one-click vote from a link is a different funnel from one that requires signing
  up for an event platform first. I have no measured conversion rate for either
  shape of funnel, and borrowing an external benchmark would be dressing a guess
  as a measurement.

Multiplying two unknowns gives an unknown. Any figure written into this section
would be manufactured, and it would be manufactured about the one topic where the
owner is most likely to act on it. So it is not written.

**The single measurement that unlocks this:** post once, then read the platform's
own impression count for that post alongside the vote total before and after. One
post gives `reach` directly and `conversion rate` as `(votes after minus votes
before) / reach`. That is one data point rather than a rate, and it will be noisy,
but it is a measured data point rather than an invented one, and it is enough to
project the second post. **Any figure derived that way is a projection from a
single observation and must be written as a projection in the sentence that
carries it.**

Prerequisite: Q2 has to be answered *before* the post goes out, so there is a
before-value to subtract. If the standing is only checked after posting, the
denominator is lost and this measurement cannot be reconstructed.

`docs/rally_post_final.md` holds the post itself, both lengths, plus the
re-verify block to run immediately before pasting, because the press figures move
within minutes. Its own checklist already puts the post on the morning of
2026-08-24, after the 06:10 cron has fired, which is the same reasoning as
section 3 here arrived at from the cron side. This file holds only the arithmetic
around the post. `docs/COUNTS.md` holds the collision-count derivations and
`docs/METHODOLOGY_SYNC.md` the page-versus-code diff. Neither is duplicated here.

---

## 5. Countdown to judging

All times Pacific. Verify each live figure at the moment you use it rather than
trusting a value copied from any document, including this one.

**Now, 2026-08-19 into 2026-08-20**
- [ ] Send the organiser one message covering Q1 through Q6 in section 2. Nothing
      else in this file can be completed until those come back.
- [ ] Write the answers into section 2 and, if Q5 lands outside the five rows in
      section 3, regenerate that table with the script given there.

**Thu 2026-08-20**
- [ ] 06:10 PT, daily audit run 1 of 5. Check `/api/board` afterwards to confirm
      it fired and whether the new corner is fully audited or ENRICHED.
- [ ] Decide what to do about `src/methodology.js` line 189, which says "Seven
      citywide semantic searches run each morning through Exa" while the live pass
      ran 29, built 2026-08-19T13:11Z. `grep -n "Seven citywide" README.md
      src/methodology.js` now matches the methodology file only: README has been
      brought current and cites 29 searches, 117 articles, 5 corners, 7 rejects
      and 25 discarded at lines 58 to 61 and 117. The full line by line diff,
      including the replacement text, is in `docs/METHODOLOGY_SYNC.md`. Do not
      re-derive it here. The decision this checklist needs is only whether a
      factual correction inside `src/` counts as breakage-only under the freeze.
      If it does not, it waits for the 25th, and a judge who opens /methodology
      before then reads seven where the site ran 29.
- [ ] `specs/HANDOFF.md:642`, People's Choice copy, is still open. It closes when
      section 2 is filled in.

**Fri 2026-08-21**
- [ ] 06:10 PT, run 2 of 5.
- [ ] Demo video into the README placeholder. `README.md` line 4 currently reads
      "not recorded yet. The link lands in [Demo video](#demo-video) below, with
      the shot list." The shot list is in the "Demo video" section. A judge who opens the README
      sees line 4 first.
- [ ] Real-phone mobile pass, still open per `specs/HANDOFF.md`. The board and its
      pager have been checked at desktop widths only.

**Sat 2026-08-22**
- [ ] 06:10 PT, run 3 of 5.
- [ ] Decide the posting date, and note there is a real tension here.
      `docs/rally_post_final.md` line 141 recommends posting the morning of
      2026-08-24, after the 06:10 cron has fired, so the post can point at a fresh
      unattended audit. Section 4 of this file wants the post earlier, so there is
      time to read the impression count and the vote delta before judging closes.
      Both cannot be had from one post. The owner picks: freshest evidence, or a
      measured conversion rate. If voting is open per Q3 and a second post is
      allowed, posting a short version now and the full version on the 24th gets
      both, but check the platform's and the event's rules on repeat posting first.
- [ ] Whenever the post goes out, record the vote total immediately BEFORE posting
      and the post's impression count after. Without the before-value the
      measurement in section 4 cannot be reconstructed.

**Sun 2026-08-23**
- [ ] 06:10 PT, run 4 of 5.
- [ ] Re-read the standing. With a before-value and an impression count in hand,
      section 4's arithmetic becomes computable for the first time, as a
      projection from one observation.
- [ ] Final read of every number quoted anywhere public, using the re-verify block
      in `docs/rally_post_final.md`.

**Mon 2026-08-24, judging day**
- [ ] 06:10 PT, run 5 of 5, the last autonomous audit before judging. It runs
      whether or not anyone is awake. Confirm it landed.
- [ ] Read `/api/board`, `/status`, `/api/watchlist` and `/api/radar` fresh.
      Quote only what they say this morning.
- [ ] Judging. Exact start time unknown, see Q5.
- [ ] Voting closes at the time Q5 establishes. If it closes at or after 17:00 PT,
      that timestamp is 2026-08-25 in UTC. Do not let a UTC-stated deadline be
      read as a Pacific one.

**Tue 2026-08-25, freeze lifts**
- [ ] The feature freeze lifts, per `specs/HANDOFF.md:604`.
- [ ] `docs/CHANGELOG_DRAFT.md` may be published, per its own line 3.
- [ ] `docs/KEY_ROTATION.md` item 9, extend the CI grep, is unblocked.
- [ ] Watchdog GCP preconditions, per `specs/HANDOFF.md`.

### Why the freeze lifts after judging and not before

The freeze runs through 2026-08-24 and lifts on the 25th, one day after judging.
That ordering is deliberate. Everything a judge sees was built before the freeze
and has been running unattended since, which is the claim the product makes about
itself. A feature shipped on the 23rd would be a feature with no unattended track
record behind it, and it would put the daily 06:10 run at risk on the one morning
where that run is the demonstration. The last thing that changes before judging is
nothing.

---

## Limits of this file

- It contains no vote count, no standing, and no estimate of either, because none
  exists in this repository and I did not go looking for one outside it.
- The judging date of 2026-08-24 rests on the project owner's instruction alone.
  No file in this repo establishes it independently.
- The timezone table assumes the judging date stays 2026-08-24. If it moves, the
  table is wrong and the script in section 3 regenerates it.
- The five remaining audit runs assume both crons keep firing and the Worker stays
  up. `/status` showed 1 run with at least one failing check out of 37 over 7 days
  when read at 2026-08-20T06:04:20Z, so five clean runs is not guaranteed.
- Section 4 is deliberately empty of numbers. It stays that way until the
  measurement it describes has actually been taken.
