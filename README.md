# StreetCred

**Every claim about a dangerous corner, graded and traced to its source, ending in a picture of the fix and a letter to the Supervisor.**

![The Hazards state at 16th and Mission. The real Street View frame on the left, the Gemini safety audit annotated onto that same frame on the right, drag handle between them, with a legend naming faded crosswalk markings in red and vehicle conflict zones in amber.](docs/hazards.jpg)

Pick a San Francisco intersection. StreetCred shows what the city's own data records, what the press reports, and what residents say, each claim traceable to where it came from. Then it shows what an automated visual audit finds wrong with the corner, what the fix would look like, and drafts the letter to the correct District Supervisor.

Built in a single 55 minute sprint at Build Club, "Moonlighting with Gemini + Exa", August 17 2026. The git log covers the whole product.

The homepage is the city: every warmed corner on one map, ranked by Danger Index, worst first. Any San Francisco intersection can be typed in and graded on the spot. Each corner lives at its own shareable URL.

## Why this exists

Residents already know which corners are dangerous. City hall runs on evidence. The evidence is scattered across crash databases, 311 queues, news archives, and lived experience, and none of those talk to each other. Turning "this corner feels dangerous" into something an official will act on is a week of work, every time, for every corner.

The people who do that work over and over are neighborhood associations, pedestrian safety advocates, and local newsrooms. StreetCred does it in one page, for any corner with Street View coverage, in seconds.

It is not a dashboard. It ends in an action: a letter addressed to one named person with the power to move it.

## The five lanes

| Lane | Source | Endpoint |
| --- | --- | --- |
| Official records | DataSF collisions and 311, keyless | `/api/stats` |
| Press coverage | Exa | `/api/news` |
| Resident voices | Apify | `/api/voices` |
| Corner seen three ways | Street View plus Gemini vision | `/api/imagery` |
| The ask | Gemini text | `/api/letter` |

Four independent sources cross-check each other on one specific claim, and that claim becomes a costed, addressed request. Every endpoint reports a `source` of `live`, `cache`, or `sample`, and the page tags anything that is not live. No endpoint returns an error to the browser, so a panel is never dead.

## How we used Exa

Exa is the press-coverage lane. It answers "has anyone reported on this corner," which no government dataset can.

**The call.** `POST https://api.exa.ai/search`, with the query built from the corner name plus safety terms:

```
pedestrian safety OR crash OR traffic 16th Street and Mission Street San Francisco
```

sent with `type: "auto"`, `numResults: 8`, and page text requested as a **nested** `contents: { text: { maxCharacters: 400 } }`. The nesting matters: a flat `text` field is rejected, so the shape of that object is not cosmetic.

**The filter.** Relevance tokens are derived from the corner's own name, so `"16th Street and Mission Street"` yields `["16th", "mission"]` and the filter travels to any corner rather than being pinned to the first one. A result counts as corner level only when it carries every street token, not just the neighborhood, and the panel claims corner-level precision only when at least three results clear that bar. Below it the heading drops to "Coverage of this corridor," which is the honest description of what is actually on screen. Law firm and lead generation domains are denied outright: they republish crash reports to farm clients and they are not press coverage. Results are then sorted newest first and capped at five.

**The render.** Every headline shows its outlet domain and publish date and links out, so any claim on the page can be checked in one click. That is what makes this an evidence lane rather than a search box.

**Load bearing on the output, not just the panel.** The top two headlines, with outlet and date, are passed into the Gemini letter prompt. Exa results therefore appear in the drafted letter by outlet name, cited as sources in the ask itself, rather than sitting in a side panel the Supervisor never sees.

**Live example.** The current result set for this corner includes Walk SF (`walksf.org`, 2026-05-27), Mission Local (`missionlocal.org`, 2026-05-28), and KRON4 (`kron4.com`, 2026-05-28), all covering the May 2026 fatality at 16th and Mission. An advocacy organization and a neighborhood newsroom independently reporting the same death is the single most load-bearing fact on the page, and neither one is in any city dataset.

## How we used Apify

Apify is the resident-voices lane: what people say about a corner in the places they actually say it, which is the one thing no government database records.

Two actors run against the corner, and getting each one to return anything useful took a different trick.

**`compass/crawler-google-places`, for Google Maps reviews.** An intersection is not a place. Geocoding "16th and Mission" resolves to a road junction, which has no reviews attached to it, so the obvious query returns nothing. The working approach is to treat the corner as a **geographic circle, roughly 350m**, and collect reviews from the real businesses and the transit station standing inside it. The corner gets a voice by borrowing the voices of everything on it.

**`trudax/reddit-scraper-lite`, for Reddit.** Driven by **explicit `startUrls`** rather than the actor's search builder, which in the configuration used here enqueued zero requests and returned an empty dataset. Pointing it at specific threads is less elegant and completely reliable.

**Normalization.** The two output shapes have nothing in common: Google Maps nests `reviews[]` with `text`, `stars`, and `publishedAtDate`, while Reddit returns flat records with `title`, `body`, and `createdAt` and no rating at all. `tools/collect_voices.py` flattens both into one contract, `{source, stars, text, when}`, scoring each candidate on how directly it speaks to street safety and keeping both sources represented. Reviewer names are dropped on purpose, quotes are truncated, and HTML entities and Reddit's "submitted by" boilerplate are stripped.

**Serving.** Scraping happens ahead of the demo, never during one: actor runs take minutes and a page load cannot wait on one. `/api/voices` serves the normalized file baked into `public/data/` for corners that were scraped ahead of time, and the honest empty state for every corner that was not. An Upstash path exists in the code and activates if those credentials are ever set, but nothing in the deployed product uses it: the store is Cloudflare KV.

**Honest limit.** Reviews at this corner skew heavily toward the BART station: escalators, cleanliness, policing, rather than crossing conditions. The quotes shown are real scrape output and thinner on traffic safety than the other four lanes. The letter therefore only quotes a resident when the quote is actually about the street, and otherwise quotes no one rather than inventing testimony. The fix is better targeting, not more code.

The second corner makes the same point more sharply. The Reddit scrape for 6th and Market returned 40 items, none of them actually about crossing that street, so the panel shows an empty state saying no on-topic resident accounts were found and the letter for that corner quotes no resident. A lane that reports nothing when it found nothing is worth more here than a lane that always fills.

This is the Apify category criteria almost word for word: collecting and structuring data from the web, and applying external information the product could not otherwise reach.

## How we used Gemini

Gemini does two distinct jobs here, on two different models, and the first one is the reason this product exists.

| Role | Model | Job |
| --- | --- | --- |
| Vision | `gemini-3.1-flash-image` | Reads the real Street View frame, returns it annotated with hazard zones and a legend. Also renders the proposed-fix visualization. |
| Text | `gemini-3.7-flash` | Turns collisions, 311 counts, press headlines, resident quotes, and the audit findings into a letter to the correct District Supervisor, citing each source. |

**Vision: the corner seen three ways.** Not a before and after pair. A three state narrative, observation to diagnosis to prescription:

1. **Today.** The real Street View frame for the corner, fetched server side after the free metadata endpoint confirms coverage. Google attribution stays visible in the image.
2. **Hazards.** The Today frame goes to `gemini-3.1-flash-image`, which reads the actual photograph and returns it annotated: red hatching over sub-standard or faded crosswalk markings, amber over vehicle turning conflict zones, plus a legend naming the intersection. The distinction that matters is that this is an **audit of a real photograph**, not an invented scene: the model is finding the hazards in a specific corner that exists, and the annotation is rendered onto that frame. The overlay marks the zones the model flags as high risk. It is zonal, not surveyed, and it does not measure anything.
3. **Proposed fix.** The same Today frame, edited to hold everything constant (buildings, vehicles, people, sky, poles, signals, camera angle, lighting) while changing only the safety infrastructure: fresh asphalt, high visibility continental crosswalks, a green painted bike lane with white flex posts, and a concrete curb extension with plantings. Labeled on the page as an AI visualization of a proposed fix, never as a photograph of something that exists.

Both derived states are generated in parallel at build time by `tools/generate_imagery.py` and served as static assets, so nothing is generated during a demo.

The pipeline is not tuned to one corner. It was validated first on a completely different intersection, Telegraph Avenue and Durant Avenue in Berkeley, producing the same three states from the same code path. Any intersection with Street View coverage works: add one object to `CORNERS`.

**Text: the ask.** `gemini-3.7-flash` receives the corner, the district, the Supervisor's name, the live collision and 311 counts, the top two Exa headlines with outlets, one resident quote, the hazards the visual audit named, and the costed fix with its grant program. It returns a letter under 220 words in plain civic English.

The strongest sentence in that letter is the one only this product can write: *an automated visual audit of the intersection identified sub-standard, faded crosswalk markings and vehicle turning conflict zones.* That is a specific, checkable claim, and it is corroborated by the collision count, the press coverage, and the residents independently. Four lanes agreeing on one claim is the entire thesis.

The letter renders as a draft with a copy button. **Nothing is ever sent to any official, and no email addresses appear anywhere in this product.**

## Architecture

One Cloudflare Worker, no build step, no framework.

```
src/index.js   router, every data lane, health, graceful degradation
src/page.js    one corner, as one HTML string, plus the shared CSS
src/home.js    the city map and the scoreboard
src/data.js    corner registry, Supervisor roster, 311 allow list, samples
src/resolve.js free text to a corner: normalizing, DataSF lookup, districts
src/score.js   the Danger Index, DataSF arithmetic only
src/hazards.js the audit pass and the deterministic corroboration rule
src/cred.js    four lanes to one verdict, no model
src/store.js   KV: corners, scores, imagery, budget, rate limiting, leaderboard
src/imagery.js on-demand Street View and Gemini generation, never blocking
tools/         precompute, share cards, imagery, voices, two test files
public/        logos and the wordmark
docs/          the README screenshot
```

**Imagery lives in KV, not in the repo.** Generated frames are 700 to 830KB each and there is no reason to carry them in git. Every corner, precomputed or typed, serves its three states from KV through the edge cache on one code path.

**Caching, in two layers.** An in-process `Map` sits inside the Worker isolate, and a Cloudflare edge cache (`caches.default`) sits in front of it. The second layer is the one that matters: Worker isolates are short lived and per-colo, so warming the in-process map does nothing for the next visitor, who usually lands on a cold isolate and pays the full upstream cost again. With the edge cache in place every lane on both corners returns in under 0.26s, and the letter went from about 7s to 0.16s.

Two deliberate rules govern it. **Sample and empty payloads are never cached**, so a lane that failed once is retried on the next request rather than pinned in that state for an hour. And what goes back to the browser is always `no-store` while the internally cached copy carries `max-age`: fast internally, never stale externally, so a data correction ships and actually shows up. A `CACHE_VERSION` constant invalidates every cached payload at once when the numbers change.

Adding a corner is one object in `CORNERS` plus one imagery run. What that object cannot do is paper over code that assumed one specific corner, which is what the second corner was for.

## What the second corner exposed

Generalizing from one corner to two is where a demo either holds up or quietly starts lying. Three bugs only became visible under a second corner, and each one had been silently wrong the whole time.

**The district boundary bug.** The Supervisor lookup took the first row DataSF happened to return and read its `supervisor_district`. That works until the corner sits on a district line, and major streets very often are one. Within 150 meters of 6th and Market, DataSF holds 242 crash records in District 6 and 114 in District 5, so the answer depended entirely on row order. The lookup is now a grouped majority query, and the corner's configured district is authoritative with the majority as corroboration and fallback. A wrong answer here does not look like a bug, it looks like a letter confidently addressed to the wrong elected official.

**Hardcoded Exa relevance tokens.** The press filter tested titles against the literal strings `16th`, `mission`, and `sixteenth`. Every result for the second corner failed that test, so the lane discarded its entire result set and fell through to sample. Tokens now derive from the corner name.

**The sample quote fallback.** The last-resort resident quotes named 16th and Mission in their text. Under any other corner they would have been not merely generic but flatly, specifically wrong, and they would have rendered as testimony. That fallback is gone. A corner with no usable scrape now shows an empty state that says so.

**The related landmine, for anyone extending this:** `supervisor_district` comes back as `"11"` from the collisions dataset and `"9.00000"` from 311. Always `parseInt`.

**An honest empty state, live right now.** The Reddit scrape for 6th and Market returned 40 items and nothing that was actually about the street. That corner's voices panel says no on-topic resident accounts were found, and its letter quotes no resident at all. That is the correct output, not a gap waiting to be filled.

**Data corrections shipped at the same time.** The 311 filter had been substring matching on "Street", which swept in Street and Sidewalk Cleaning, a 3.4M row sanitation queue. That single bug inflated this corner from roughly 355 street-condition reports to 8,546. It is now an explicit allow list of service types. The collision count had also been unbounded back to 2005, describing two decades of a corner that has since been rebuilt; it is now bounded to five years and shows the fatal count alongside it.

## Any corner

Type two cross streets and the whole page rebuilds around them. The registry is now a fast path, not the whole product.

**Geocoding uses the city's own data, not a general geocoder.** San Francisco publishes `gmfx-8h6i`, 18,546 intersections, keyless and unthrottled. Its shape is not obvious: it stores **one row per street leg**, so an intersection is two or three rows sharing a `cnn` and an identical point. Matching a typed pair is therefore a self-join, expressed as one grouped query with `count(distinct st_name) > 1`. The dataset agrees with the hand-configured 16th and Mission coordinates to about two meters. Nominatim stays as a fallback with a real User-Agent and an SF viewbox, but it cannot resolve intersection-style queries at all, so in practice DataSF answers or nobody does.

**The quirk that would have broken it:** single-digit ordinals are zero-padded. `01ST`, `02ND`, `09TH` exist; `1ST`, `2ND`, `9TH` return nothing. Without that, "6th and Market" silently fails to resolve.

**One canonical corner per intersection.** Input is lowercased, punctuation-stripped, split on `and`, `&`, `/`, `+`, `at` or `x`, relieved of its street type suffix, and spelled ordinals become numeric. The two street names are then sorted alphabetically to build the slug, so "24th and Valencia" and "Valencia and 24th" are one cached corner that is geocoded once and generates imagery once. The two precomputed corners keep their original slugs as aliases, so no existing link breaks.

**Rejections say which kind of miss it was.** Both streets real but never crossing is a different answer from a misspelling, which is different again from a corner in another city. Telegraph and Bancroft is the interesting case: San Francisco has Telegraph Place on Telegraph Hill and Bancroft Avenue in the Bayview, six miles apart, so the honest answer is that both are SF streets that do not intersect, not that the corner is out of town.

**Imagery never blocks the page.** `/api/imagery` answers immediately with the Street View frame and `status: "pending"`, the two Gemini states generate in the background, and the page polls every 3 seconds up to a 90 second ceiling, enabling each toggle button as its state lands. Coverage is confirmed first against the free Street View metadata endpoint, so a corner with no photograph says so and still renders every records lane. Precomputed corners return no status field at all and skip the entire mechanism.

**Spending is bounded in four places**, because a public URL that triggers paid image generation is a standing invitation:

- a query that does not resolve to a real SF intersection spends nothing, and nonsense never leaves the Worker
- resolved corners are cached in KV with no TTL, so a corner is geocoded once and generated once
- a global daily generation cap, currently 25 corners, after which new corners still render every records lane and the photograph with an honest at-capacity label
- per-IP rate limiting on the resolve endpoint, 20 lookups per 10 minutes

A corner whose records lanes all come back empty never generates imagery either, since that is a strong signal the resolve was wrong.

## The scoreboard

The name promised a score. This is where it gets paid.

**The Danger Index** is 0 to 100 with a letter grade, computed only from DataSF. No model touches the calculation, so every input is a number anyone can look up:

```
points = 10*fatal + 6*severe + 3*otherVisible + 1*pain + 2*pedInvolved + 0.5*safety311
```

all within 80 meters, collisions over five years, filtered 311 over twelve months. `REFERENCE_MAX` is **frozen at 142**, computed once against ten known-severe SF intersections; 16th and Mission set it at 142.0 points with 6th and Market second at 136.0. It must never float with whatever corners happen to be loaded, because a corner graded B on Tuesday that becomes a C on Friday with nothing changed on the ground is a grade nobody can cite, and people screenshot these. One caveat travels with the number everywhere it appears, on the page rather than buried here: there is no exposure normalization, so the index ranks reported harm, not risk per crossing.

**Corroboration** is what makes the audit worth anything. A structured pass asks Gemini which of four fixed conditions it can actually see in that corner's frame and returns booleans. Everything after that is arithmetic: `label()` in `src/hazards.js` decides CONFIRMED, CANDIDATE or REPORTED from record counts alone, and `tools/label.test.mjs` covers all six branches without a network or a key.

That immediately caught something this product had been getting wrong. The letter used to assert, at every corner, that "an automated visual audit identified sub-standard, faded crosswalk markings and vehicle turning conflict zones." It was a hardcoded sentence, not an audit result, and this README used to call it the strongest and most checkable claim in the letter. Asked to actually look, the model reports that 16th and Mission's markings are **not** faded, which matches the bright continental striping plainly visible in the screenshot at the top of this file. The product was making a specific, checkable, false claim to a named elected official. The letter is now built from the labels: CONFIRMED may be stated as documented, REPORTED is attributed to the record rather than the photograph, and CANDIDATE is an observation the letter is instructed never to present as fact.

**The Cred Check** puts the whole thesis on one line. Four lanes, four booleans, one verdict: 4 of 4 CORROBORATED, 3 SUPPORTED, 2 PARTIAL, 1 or 0 REPORTED ONLY. Agency primary sources cannot light the press lane, since a police bulletin is the record rather than reporting on it. The resident token list is split between street nouns that count on their own and ambiguous words like "scary" that only count beside one, because without that split a review reading "Safe even though it's a scary movie outside" lights the resident lane at 16th and Mission.

## Sharing and the city view

Corners live at `/c/{slug}`. The older `?x=` form redirects rather than dying, because links already exist in the wild.

Open Graph and Twitter tags render server side carrying the real index and the real verdict, and they read only what is already cached: a crawler can never trigger a score, a corroboration pass, or a paid image generation just by fetching a page.

The 1200x630 share card is built by `tools/make_og.py` rather than in the Worker, because a Worker has no image library and the alternative was shipping a WASM codec to draw two lines of text. It composites on the **unedited** Street View frame, never the hazard overlay and never the generated fix, since those are modified Street View imagery and pushing them out as social preview assets is the redistribution question the risk review flagged as unsettled. The frame is cropped from the top so Google's watermark stays visible in the finished card.

The homepage is one Static Maps image with every warmed corner drawn into it as a pin colored by grade, plus transparent anchors laid over it at positions computed with the same Web Mercator projection the server used to request the image. That buys a clickable map for the cost of a single image request and no map SDK at all. `tools/pin.test.mjs` checks the projection, including that north is up and east is right, which is the classic way to get this exactly backwards.

## Running it

```
npm install -g wrangler
cp .dev.vars.example .dev.vars   # then fill in the keys
python3 tools/generate_imagery.py
wrangler dev
```

`GET /api/health` pings every dependency and reports them individually.

## Honest limits

- The hazard overlay is a model reading of a photograph. It marks zones, it does not measure them.
- The proposed fix image is a visualization, not an engineering drawing, and the cost is an order-of-magnitude estimate.
- 311 counts are filtered to street-related service types within 150 meters, which is a proxy for street complaints, not a precise one.
- The voices lane is the thinnest of the five, and the reason is a finding rather than a bug. Both Apify actors ran and returned real data, but Google Maps reviews at this corner are overwhelmingly about the BART station (escalators, cleanliness, policing) and the Reddit search returned mostly off-corner noise. That is why selection moved out of the scrape and into the normalizer, which scores quotes by how directly they speak to street safety rather than passing a flat keyword test. Every quote shown is still real scrape output, never generated. The letter also only quotes a resident when the quote is actually about the street, and otherwise quotes no one rather than inventing testimony.
- Any San Francisco intersection resolves, but the warmed corners are still the ones that look best. A typed corner takes the default panorama orientation, because the heading that puts the crosswalk in the foreground was chosen by hand for the precomputed pair and there is no way to pick it automatically. Expect a resolved corner to sometimes show the street rather than the crossing.
- DataSF does not have an intersection node for every place two streets meet. Sunset and Sloat is a real junction near the zoo, but the city's dataset models it as a grade-separated interchange rather than a crossing, so the resolver correctly reports that both are San Francisco streets which do not intersect. That is accurate to the source and still not what a person typing it expects.
- The Danger Index ranks reported harm, not risk. A corner nobody walks through cannot generate pedestrian collisions, so a quiet corner scores low for a reason that has nothing to do with whether crossing it is safe. There is no exposure normalization anywhere in the formula, and the caveat sits on the page for that reason.
- The index is bounded by a frozen reference, so a corner can exceed it. 16th and Mission already computes above 142 points as newer collisions land, and it caps at 100. Everything at the top of the board is therefore compressed, and a corner scoring 100 is not necessarily worse than one scoring 96.
- The visual audit reports on one Street View frame, taken on one day, facing one direction. It cannot see the other three approaches to an intersection, and a corner photographed in bright midday sun will not show a lighting problem that only exists at night. CANDIDATE means the model saw something the record has not caught up with; it does not mean the model is right.
- The Cred Check verdict is a count of lanes, not a weighting of them. Four weak agreements read the same as four strong ones.
- The resident voices lane only exists for corners that were scraped ahead of time. A typed corner shows the honest empty state, because an Apify actor run takes minutes and a page load cannot wait on one.
