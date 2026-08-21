# Make them know

A human checklist. Nothing here has been sent: no post drafted into any
account, no message posted, no tag applied. Every item is an action for a
person with the accounts open. Both posts below are written to be pasted
verbatim.

The framing that matters: **these are things worth showing, not things
addressed to anyone.** Jonah Berman and Saif Raja (Exa) and Petros Hong
(Apify) were at the event and judge or mentor these categories. A post written
at them reads as a post written at them. A post that would be worth reading if
none of them existed is the one they will actually stop on.

## Blocker status: CLEARED

The Apify blocker that held the autonomous-voices claim is gone. The first
paid run happened on 2026-08-18:

- Two actor runs commissioned for 24th and Valencia, run ids
  `Os1CdqA1f2wVp5tfh` (Google Maps) and `oEGaTMxZfO3yzhfKs` (Reddit).
- **Cost $0.2961**, against a $105 cycle limit with about $104 left.
- 15 accounts read, and after the relevance filter was corrected by what that
  first run exposed, **one quote kept**: a Reddit post about a cyclist struck
  in the Valencia centre bike lane.
- Visible in the ledger at /status and on the corner page, which says the
  scrape was commissioned autonomously.

Both posts below may now make the autonomous claim. Everything in them is true
as of this writing and checkable at the URLs given.

## Post 1: the rally post, for the event WhatsApp

Paste as is. One message, not a thread.

---

StreetCred is live: https://streetcred.thealexschroeder.workers.dev

Every intersection in San Francisco now has a safety grade. All 7,355 of them,
scored against a full census of the city's own collision and 311 records rather
than a sample. Type any corner into the box and you get its grade, the counts
behind it, and a link to the exact query on data.sfgov.org so you can check the
math yourself.

There is also a Press Watchlist that reads the city's current coverage and
works out which corners are being written about right now. It publishes what it
rejected and why, which is the more interesting half.

And it runs itself overnight: one corner audited every morning, and it
commissions its own resident-voice scrapes while nobody is watching.

The drafted letters are deliberately empty right now. I tightened the letter
checker this week, nothing the site was serving could pass it, and every corner
shows a pending state until real drafts are regenerated. The check that emptied
the site is the same one that guarantees no letter can contradict its own page.

If you think it deserves a vote, I would really appreciate yours. Genuinely
curious what grade your corner gets.

---

## Post 2: the follow-up sponsor post, for LinkedIn

Reject-list led, per the original brief. Tag Exa and Apify. Lead the image with
a screenshot of the reject list at
https://streetcred.thealexschroeder.workers.dev/watchlist, not the hit list.

**Status: GO.** Every number below is live and checkable.

---

My discovery pipeline read 101 San Francisco news articles this week and put
five corners on a street-safety watchlist. The interesting half is the seven it
threw away.

"Greenwich and Lombard" is a real pair of San Francisco streets with no graded
crossing between them. "16th and 24th" are two streets that never meet.
"Church and Market" was named in an article that turned out not to be about
safety there. Each rejection is published with its reason, because a discovery
pipeline that shows only its hits is indistinguishable from a search box that
got lucky.

A further 27 candidates were discarded before that, for naming no San Francisco
street at all. News pages are full of capitalized pairs joined by "and", and
"Metro Areas and Our Cities" looks exactly like an intersection to a pattern
match. Every candidate is checked against a 2,219-name street index and then
against the 7,355-corner index the site grades from, and only then against
whether the article is actually about safety at that crossing.

That is entity discovery with the verification shown, built on @Exa: neural
search, the news category, date-sliced queries, domain filters in both
directions, and findSimilar for connecting corners that get written about in
the same breath.

The other half runs unattended. Every morning the site audits one new corner
and commissions its own resident-voice scrapes through @Apify, then ingests
them the next morning and publishes what survives a relevance filter. The first
autonomous run read 15 accounts and kept one, about a cyclist struck in the
Valencia bike lane, for 29 cents. Every run is in a public cost ledger, because
an autonomous system spending real credit without one is the thing nobody
should ship.

One lane is deliberately empty while I write this. The letter verifier gained
lane consistency and addressee rules this week, nothing the site was serving
could pass them, and every corner now shows a pending state rather than a
draft. The verifier that emptied the site is the same one that guarantees no
letter can contradict its own page.

https://streetcred.thealexschroeder.workers.dev/watchlist

---

## The checklist

- [ ] Post 1 into the event WhatsApp thread.
- [ ] Post 2 to LinkedIn, tagging Exa and Apify, with the reject-list
      screenshot. Annie reposts favorites, so it should stand on its own as
      something worth reposting.
- [ ] Optional second WhatsApp message when the autonomous-voices feature is
      worth calling out separately. The honest hook is the ledger: it runs at
      06:10 and publishes what it spent.
- [ ] Neither message addressed to a judge or mentor by name.

## Superseded in part

The judging submission copy lives in `specs/SUBMISSION.md`, written 2026-08-20
and aligned to the three criteria.

Both posts above were trued up on 2026-08-20 against the same stored records
the README sections read from: the watchlist pass built 2026-08-20T13:11Z, which
reads 101 articles, five corners, seven rejects and 27 discarded phrases, and
the voices summary at 2026-08-20T13:10Z. Both now carry a line about the letter
state.

Two things to re-read before either is pasted:

- **The watchlist figures move every morning.** Re-read `/watchlist` and swap
  the numbers if the pass has run again. The named rejects come from the stored
  reject list and change with it.
- **The searches figure is not in either post and should stay out unless it can
  be stated in full.** The stored pass reads 29 attempted against 7 completed,
  and a post saying "29 searches" without the completion count would be the
  exact claim the site was corrected for making.

## One caveat that survives

The morning cron has not yet fired with the autonomous-voices code deployed, so
"one corner audited every morning" is true of the audit and the voices path has
been proved by hand rather than by a scheduled run. If someone asks, that is
the honest answer. The next 06:10 PT run closes it.

## Update, 2026-08-21: the letter lane is no longer empty

**Status: DRAFTED, NOT POSTED.** Both posts above carry a line saying the
letters are deliberately empty. That line is now false and must be replaced
before either post is pasted. Replacements below, one per post, same length and
voice as the paragraph each one is displacing.

### Replace in Post 1

The paragraph beginning "The drafted letters are deliberately empty right now"
becomes:

---

Every corner now carries a drafted letter to its own Supervisor, and 16 of them
deliberately do not. The letters are written off the site, on my machine, and
each one is checked against the same records its page shows before it can be
stored: the figures it cites, the streets it names, the press it claims, the
resident voices it quotes, and whether it is addressed to the representative who
actually holds that district. 116 of 132 passed. The 16 that did not still show
a pending state, with the reason, because a letter that cannot be checked should
not be served as though it had been.

---

### Replace in Post 2

The paragraph beginning "One lane is deliberately empty while I write this"
becomes:

---

The letter lane filled in this week and 16 corners stayed empty on purpose. Each
draft is verified against its own page before it can be stored: every figure
traced to the records the page displays, every cited outlet checked against what
the press pass actually found, every quoted resident against what the scrape
actually returned, and the addressee against the sitting supervisor for the
district that corner resolves to. 116 of 132 cleared it, addressed to 11
different officials. The 16 that did not are still showing a pending state and
the reason they failed. Nine of them tried to cite reporting that does not exist
for that corner, which is the failure mode worth building a checker for.

---

### The numbers behind those paragraphs, all checkable

- 132 corners in the fleet, 116 with a stored verified letter, 16 pending.
- 11 distinct officials addressed. Matt Dorsey 51, Bilal Mahmood 30, Jackie
  Fielder 10, Danny Sauter 5, Chyanne Chen 4, Rafael Mandelman 4, Shamann Walton
  3, Myrna Melgar 2, Alan Wong 2, Stephen Sherrill 1, and Mayor Daniel Lurie 4
  for corners whose district does not resolve.
- The 16 holds, by what they got wrong: 9 press, 5 numbers, 1 street, 1 voices.
- Generated against Vertex AI under Application Default Credentials. The Worker
  holds no model credential and never has.
- Cost is in the public ledger at /status, named as an estimate rather than a
  provider figure, because Vertex bills out of band and Exa does not.

### Before pasting, two things that are still true and one that is not

- **Do not claim the imagery.** Seven proposed-fix renders were attempted on
  2026-08-20 and none published: two were held by the text-legibility check and
  five never returned an image. Neither post mentions renders and neither should
  until some pass.
- **The watchlist figures still move every morning.** Unchanged from the caveat
  above: re-read /watchlist and swap the numbers if the pass has run again.
- **The "one caveat that survives" section above is now stale in one respect**
  and should be re-read against the morning cron's actual run history before
  either post goes out.
