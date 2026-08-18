# Make them know

A human checklist. Nothing here is builder work and nothing here has been done:
no post has been drafted into any account, no message sent, no tag applied.
Every item below is an action for a person with the accounts open.

The framing that matters: **these are things worth showing, not things
addressed to anyone.** Jonah Berman and Saif Raja (Exa) and Petros Hong (Apify)
were at the event and judge or mentor these categories. A post written at them
reads as a post written at them. A post that would be worth reading if none of
them existed is the one they will actually stop on.

## What is now true and worth showing

Both of these shipped today and both are live. The claims below are checkable
at the URLs given, which is the point.

**Exa.** The Press Watchlist at
https://streetcred.thealexschroeder.workers.dev/watchlist is entity discovery
with the verification shown. Seven citywide semantic searches, every crossing
name extracted, three hard bars before anything surfaces, and the rejects
published with their reasons. The last pass read 104 articles, surfaced 4
corners, published 7 rejects and discarded 22 phrases that named no street.
The rejects are the interesting half: `3rd and New Montgomery` is a real pair
of SF streets with no graded crossing between them; `16th and 24th` are two
streets that never meet. Capabilities in use, all six: neural search, news
category, date-sliced queries, `includeDomains` and `excludeDomains` at the
API, contents extraction, and `findSimilar`. This is a Websets-shaped workflow
on the search API.

Press connections are the second half: 16th and Mission links to Grant and
Jackson through CBS coverage of a fatal Chinatown crash, and both corners' pages
say so. Nineteen of 23 audited corners show nothing, which is the honest answer
and the more interesting screenshot.

**Apify.** The site commissions its own scrapes. The 06:10 cron starts both
actors for the corner it audits, and the next morning's run ingests them. A
hard monthly ceiling of 70 runs and a per-run cost ledger from Apify's own
reported number, both visible at
https://streetcred.thealexschroeder.workers.dev/status. An autonomous system
spending real credit, with the ledger in public.

## The checklist

- [ ] **LinkedIn post, tagging Exa and Apify.** Annie reposts favorites, so the
      post should stand on its own as a thing worth reposting. Lead with the
      screenshot of the reject list, not the hit list: "here is what my
      discovery pipeline threw away and why" is a more interesting post than
      "here is what it found", and it is the part that shows the verification.
      One post, both tools, because they do different halves of the same
      unattended morning.
- [ ] **Event WhatsApp thread, one message when the watchlist goes live.** Name
      the feature and the tool, link the page. Not a thread, not a series.
- [ ] **Event WhatsApp thread, one message when autonomous voices go live.**
      Same shape. The honest hook is the ledger: the thing runs at 06:10 and
      publishes what it spent.
- [ ] Neither message should be addressed to a judge or mentor by name.

## Two caveats to keep the posts truthful

1. **No Apify actor run has been paid for yet.** The wiring is deployed and the
   inputs are verified against the published input schemas, but the first real
   run has not happened: the sandbox blocked the billable call, so the first
   spend was left as a deliberate human action. Run
   `node tools/commission_voices.mjs "24th and Valencia" --dry` to read the
   exact inputs, then drop `--dry` to commission one, then
   `node tools/commission_voices.mjs --ingest` a few minutes later. **Do that
   before posting about autonomous voices**, and confirm the ledger row appears
   at /status. Until then the honest claim is "it ships tomorrow morning", not
   "it has been running".
2. The Exa side is fully exercised and paid for: 103 searches, $0.85 recorded,
   against a 1,500-call ceiling. Screenshot away.
