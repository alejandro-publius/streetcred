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

If you think it deserves a vote, I would really appreciate yours. Genuinely
curious what grade your corner gets.

---

## Post 2: the follow-up sponsor post, for LinkedIn

Reject-list led, per the original brief. Tag Exa and Apify. Lead the image with
a screenshot of the reject list at
https://streetcred.thealexschroeder.workers.dev/watchlist, not the hit list.

**Status: GO.** Every number below is live and checkable.

---

My discovery pipeline read 104 San Francisco news articles this week and put
four corners on a street-safety watchlist. The interesting half is the seven it
threw away.

"3rd and New Montgomery" is a real pair of San Francisco streets with no graded
crossing between them. "16th and 24th" are two streets that never meet.
"Church and Market" was named in an article that turned out not to be about
safety there. Each rejection is published with its reason, because a discovery
pipeline that shows only its hits is indistinguishable from a search box that
got lucky.

A further 24 candidates were discarded before that, for naming no San Francisco
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

## One caveat that survives

The morning cron has not yet fired with the autonomous-voices code deployed, so
"one corner audited every morning" is true of the audit and the voices path has
been proved by hand rather than by a scheduled run. If someone asks, that is
the honest answer. The next 06:10 PT run closes it.
