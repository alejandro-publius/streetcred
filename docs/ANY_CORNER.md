# Any corner

Type two cross streets and the whole page rebuilds around them. The registry is now a fast path, not the whole product.

**Geocoding uses the city's own data, not a general geocoder.** San Francisco publishes `gmfx-8h6i`, 18,546 rows, keyless and unthrottled. Those rows are not 18,546 intersections. Its shape is not obvious: it stores **one row per street leg**, so an intersection is two or three rows sharing a `cnn` and an identical point, and grouping them gives the 8,254 crossings the census is built from. Matching a typed pair is therefore a self-join, expressed as one grouped query with `count(distinct st_name) > 1`. The dataset agrees with the hand-configured 16th and Mission coordinates to about two meters. Nominatim stays as a fallback with a real User-Agent and an SF viewbox, but it cannot resolve intersection-style queries at all, so in practice DataSF answers or nobody does.

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

