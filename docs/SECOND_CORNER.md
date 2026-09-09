# What the second corner exposed

Generalizing from one corner to two is where a demo either holds up or quietly starts lying. Three bugs only became visible under a second corner, and each one had been silently wrong the whole time.

**The district boundary bug.** The Supervisor lookup took the first row DataSF happened to return and read its `supervisor_district`. That works until the corner sits on a district line, and major streets very often are one. Within 150 meters of 6th and Market, DataSF holds 242 crash records in District 6 and 114 in District 5, so the answer depended entirely on row order. The lookup is now a grouped majority query, and the corner's configured district is authoritative with the majority as corroboration and fallback. A wrong answer here does not look like a bug, it looks like a letter confidently addressed to the wrong elected official.

**Hardcoded Exa relevance tokens.** The press filter tested titles against the literal strings `16th`, `mission`, and `sixteenth`. Every result for the second corner failed that test, so the lane discarded its entire result set and fell through to sample. Tokens now derive from the corner name.

**The sample quote fallback.** The last-resort resident quotes named 16th and Mission in their text. Under any other corner they would have been not merely generic but flatly, specifically wrong, and they would have rendered as testimony. That fallback is gone. A corner with no usable scrape now shows an empty state that says so.

**The related landmine, for anyone extending this:** `supervisor_district` comes back as `"11"` from the collisions dataset and `"9.00000"` from 311. Always `parseInt`.

**An honest empty state, live right now.** The Reddit scrape for 6th and Market returned 40 items and nothing that was actually about the street. That corner's voices panel says no on-topic resident accounts were found, and its letter quotes no resident at all. That is the correct output, not a gap waiting to be filled.

**Data corrections shipped at the same time.** The 311 filter had been substring matching on "Street", which swept in Street and Sidewalk Cleaning, a 3.4M row sanitation queue. That single bug inflated this corner from roughly 355 street-condition reports to 8,546. It is now an explicit allow list of service types. The collision count had also been unbounded back to 2005, describing two decades of a corner that has since been rebuilt; it is now bounded to five years and shows the fatal count alongside it.
