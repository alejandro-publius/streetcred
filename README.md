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

The query is constructed from the corner itself:

```
pedestrian safety OR crash OR traffic 16th Street and Mission Street San Francisco
```

sent to `POST https://api.exa.ai/search` with `type: "auto"`, `numResults: 8`, and 400 characters of page text. Results are then filtered to those whose title or URL actually names the intersection, sorted newest first, and capped at five.

What makes this an evidence lane rather than a search box: the panel renders the outlet domain and publication date next to every headline, and each headline links out. A judge, or a Supervisor's aide, can check any claim in one click. Tonight it surfaced Mission Local's report of a pedestrian struck and killed near 16th and Mission, which is the single most load-bearing fact on the page.

Exa is also load bearing on the final output. The top two headlines, with outlet and date, are passed into the letter prompt, so the drafted letter cites press coverage by name rather than gesturing at it.

## How we used Apify

Apify is the resident-voices lane: what people say about a corner in the places they actually say it, which is the one thing no government database records.

Two actors run against the corner:

- `compass/crawler-google-places` for reviews of the businesses and transit plaza at the intersection
- `trudax/reddit-scraper-lite` for posts and comments naming the intersection

Their output shapes are completely different, so `tools/collect_voices.py` flattens both into one contract, `{source, stars, text, when}`, and writes `public/data/voices-16th-mission.json`, which the Worker serves. The normalizer keeps only text that mentions the street environment (crosswalk, driver, crossing, signal, curb, and similar), so the panel shows what people say about the corner rather than what they say about the food. Reviewer names are dropped on purpose, quotes are truncated, and both sources are guaranteed representation.

Scraping happens ahead of the demo, never during one: actor runs take minutes and a page load cannot wait on one. The selected quotes are parked in Upstash Redis under `voices:16th-and-mission`, and `/api/voices` reads that key on request, so refreshing the panel is a Redis write rather than a redeploy. If Upstash is unreachable the endpoint degrades to the normalized file baked into `public/data/`, and `/api/health` reports the Upstash leg separately so a missing key is visible rather than silently papered over. This matches the Apify category criteria almost word for word, collecting and structuring data from the web and applying external information the product could not otherwise reach.

## How we used Gemini

Gemini does two different jobs here, and the first one is the reason this product exists.

**Vision: the corner seen three ways.** Not a before and after pair. A three state narrative, observation to diagnosis to prescription:

1. **Today.** The real Street View frame for the corner, fetched server side after the free metadata endpoint confirms coverage. Google attribution stays visible in the image.
2. **Hazards.** The Today frame goes to `gemini-3.1-flash-image`, which reads the actual photograph and returns it annotated: red hatching over sub-standard or faded crosswalk markings, amber over vehicle turning conflict zones, plus a legend naming the intersection. This is a reading of a real photo, not a fabrication. The overlay marks the zones the model flags as high risk. It is zonal, not surveyed.
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
