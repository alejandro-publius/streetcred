# How we used Gemini

Gemini does two distinct jobs here, on two different models, and the first one is the reason this product exists.

| Role | Model | Job |
| --- | --- | --- |
| Vision | `gemini-3.1-flash-image` | Reads the real Street View frame, returns it annotated with hazard zones and a legend. Also renders the proposed-fix visualization. |
| Text | `gemini-3.7-flash` | Turns collisions, 311 counts, press headlines, resident quotes, and the audit findings into a letter to the correct District Supervisor, citing each source. |

**Vision: the corner seen three ways.** Not a before and after pair. A three state narrative, observation to diagnosis to prescription:

1. **Today.** The real Street View frame for the corner, fetched server side after the free metadata endpoint confirms coverage. Google attribution stays visible in the image.
2. **Hazards.** The Today frame goes to `gemini-3.1-flash-image`, which reads the actual photograph and returns it annotated: red hatching over sub-standard or faded crosswalk markings, amber over vehicle turning conflict zones, plus a legend naming the intersection. The distinction that matters is that this is an **audit of a real photograph**, not an invented scene: the model is finding the hazards in a specific corner that exists, and the annotation is rendered onto that frame. The overlay marks the zones the model flags as high risk. It is zonal, not surveyed, and it does not measure anything.
3. **Proposed fix.** The same Today frame, edited to hold everything constant (buildings, vehicles, people, sky, poles, signals, camera angle, lighting) while changing only the safety infrastructure: fresh asphalt, high visibility continental crosswalks, a green painted bike lane with white flex posts, and a concrete curb extension with plantings. Labeled on the page as an AI visualization of a proposed fix, never as a photograph of something that exists.

Both derived states are generated in parallel, on demand, the first time a corner is opened, and stored in Cloudflare KV keyed by corner and state. A page never blocks on generation: the imagery lane returns `pending` immediately and the panel polls until the frames land, usually within ten seconds. Nothing regenerates for a corner that already has frames, which is what keeps a public, billed image model from being an open tap.

The pipeline is not tuned to one corner. It was validated first on a completely different intersection, Telegraph Avenue and Durant Avenue in Berkeley, producing the same three states from the same code path. Any intersection with Street View coverage works, typed into the search box, with no code change.

**Text: the ask.** `gemini-3.7-flash` receives the corner, the district, the Supervisor's name, the live collision and 311 counts, the top two Exa headlines with outlets, one resident quote, the hazards the visual audit named, and the costed fix with its grant program. It returns a letter under 220 words in plain civic English.

The sentence only this product can write is the audit finding, and the whole discipline of the letter is in how much licence that finding gets. A separate structured audit pass looks at the Today frame and answers yes or no to each hazard in a fixed vocabulary. Each answer is then checked against the city's own records for the same corner, and the letter is told what it may say: a CONFIRMED hazard, seen in the photograph and corroborated by records, may be presented as documented; a REPORTED one belongs to the records rather than the photograph; a CANDIDATE is an observation the letter is explicitly forbidden to dress up as fact. The letter earlier in this project's life asserted one hardcoded audit sentence at every corner, including corners whose crosswalks are visibly in good condition. That is the failure this replaced.

The letter renders as a draft with a copy button. **Nothing is ever sent to any official, and no email addresses appear anywhere in this product.**
