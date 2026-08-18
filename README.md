# StreetCred

**Every claim about a dangerous corner, graded and traced to its source, ending in a picture of the fix and a letter to the Supervisor.**

Pick a San Francisco intersection. StreetCred shows what the city's own data records, what the press reports, and what residents say, each claim traceable to where it came from. Then it shows what an automated visual audit finds wrong with the corner, what the fix would look like, and drafts the letter to the correct District Supervisor.

Built in a single 55 minute sprint at Build Club, "Moonlighting with Gemini + Exa", August 17 2026. The git log covers the whole product.

Live corner tonight: **16th Street and Mission Street, District 9**.

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

**The filter.** Results are kept only when the title or URL carries a street token (`16th`, `mission`, `sixteenth`), then sorted newest first and capped at five. Without that filter the query pulls in citywide Vision Zero coverage that is real but not about this corner.

**The render.** Every headline shows its outlet domain and publish date and links out, so any claim on the page can be checked in one click. That is what makes this an evidence lane rather than a search box.

**Load bearing on the output, not just the panel.** The top two headlines, with outlet and date, are passed into the Gemini letter prompt. Exa results therefore appear in the drafted letter by outlet name, cited as sources in the ask itself, rather than sitting in a side panel the Supervisor never sees.

**Live example.** The current result set for this corner includes Walk SF (`walksf.org`, 2026-05-27), Mission Local (`missionlocal.org`, 2026-05-28), and KRON4 (`kron4.com`, 2026-05-28), all covering the May 2026 fatality at 16th and Mission. An advocacy organization and a neighborhood newsroom independently reporting the same death is the single most load-bearing fact on the page, and neither one is in any city dataset.

## How we used Apify

Apify is the resident-voices lane: what people say about a corner in the places they actually say it, which is the one thing no government database records.

Two actors run against the corner, and getting each one to return anything useful took a different trick.

**`compass/crawler-google-places`, for Google Maps reviews.** An intersection is not a place. Geocoding "16th and Mission" resolves to a road junction, which has no reviews attached to it, so the obvious query returns nothing. The working approach is to treat the corner as a **geographic circle, roughly 350m**, and collect reviews from the real businesses and the transit station standing inside it. The corner gets a voice by borrowing the voices of everything on it.

**`trudax/reddit-scraper-lite`, for Reddit.** Driven by **explicit `startUrls`** rather than the actor's search builder, which in the configuration used here enqueued zero requests and returned an empty dataset. Pointing it at specific threads is less elegant and completely reliable.

**Normalization.** The two output shapes have nothing in common: Google Maps nests `reviews[]` with `text`, `stars`, and `publishedAtDate`, while Reddit returns flat records with `title`, `body`, and `createdAt` and no rating at all. `tools/collect_voices.py` flattens both into one contract, `{source, stars, text, when}`, scoring each candidate on how directly it speaks to street safety and keeping both sources represented. Reviewer names are dropped on purpose, quotes are truncated, and HTML entities and Reddit's "submitted by" boilerplate are stripped.

**Serving.** Scraping happens ahead of the demo, never during one: actor runs take minutes and a page load cannot wait on one. `/api/voices` reads the selected quotes from Upstash Redis under `voices:16th-and-mission`, so refreshing the panel is a Redis write rather than a redeploy, and falls back to the normalized file baked into `public/data/` when Upstash is unreachable. `/api/health` reports the Upstash leg separately, so a missing key is visible rather than silently papered over.

**Honest limit.** Reviews at this corner skew heavily toward the BART station: escalators, cleanliness, policing, rather than crossing conditions. The quotes shown are real scrape output and thinner on traffic safety than the other four lanes. The letter therefore only quotes a resident when the quote is actually about the street, and otherwise quotes no one rather than inventing testimony. The fix is better targeting, not more code.

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
src/index.js   router, five data lanes, health, graceful degradation
src/page.js    the entire front end as one HTML string
src/data.js    corner registry, Supervisor roster, sample payloads
tools/         build-time pipelines: imagery generation, voices normalization
public/        generated imagery, normalized voices, logo
```

Adding a second corner is one object in `CORNERS` plus one imagery run.

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
- The voices lane is the thinnest of the five, and the reason is a finding rather than a bug. Both Apify actors ran and returned real data, but Google Maps reviews at this corner are overwhelmingly about the BART station (escalators, cleanliness, policing) and the Reddit search returned mostly off-corner noise. That is why selection moved out of the scrape and into Redis: the normalizer now scores quotes by how directly they speak to street safety rather than passing a flat keyword test, and the surviving set is curated into the key the Worker reads. Every quote shown is still real scrape output, never generated. The letter also only quotes a resident when the quote is actually about the street, and otherwise quotes no one rather than inventing testimony.
- One corner is wired tonight. The architecture generalizes, the validation does not yet.
