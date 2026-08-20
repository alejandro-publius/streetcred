// The letter prompt, as a pure function.
//
// Extracted from getLetter in index.js so the Worker and the offline generator
// in tools/generate_letters.mjs build byte-identical prompts. Two prompt
// builders that drift apart would mean the letters a local run produces are not
// the letters the site would have produced, and the verifier would be checking
// the wrong thing.
//
// No env, no fetch, no clock. Everything it needs arrives in ctx, which is the
// same shape getLetter already assembled.

import { supervisorFor, resolvedDistrict, addresseeFor } from "./data.js";
import { SCORE_CAVEAT } from "./score.js";

export function buildLetterPrompt(c, ctx) {
  const supervisor = supervisorFor(resolvedDistrict(c, ctx.stats));
  const headlines = (ctx.news?.items || [])
    .slice(0, 2)
    .map((n) => `"${n.title}" (${n.domain}${n.date ? ", " + n.date : ""})`)
    .join("; ");
  // Only feed the letter a resident quote that is actually about the street. The
  // scrape at this corner returns plenty of transit-station commentary, and a
  // letter quoting a review of the escalators would weaken the ask.
  const ONTOPIC = /crosswalk|crossing|pedestrian|sidewalk|driver|traffic|curb|intersection|corner/i;
  const quote = (ctx.voices?.items || []).map((v) => v.text).find((t) => t && ONTOPIC.test(t));
  // With no clear district majority the addressee is the citywide official, and
  // the letter must not invent a district number to sound authoritative. One
  // resolver, shared with every other path that names an official, because two
  // paths answering this differently is exactly how a District 2 corner got a
  // letter addressed to the Mayor.
  const dist = resolvedDistrict(c, ctx.stats);
  // addresseeFor carries the title rule: "Supervisor {name}" only when the
  // district maps to a real Supervisor, and the citywide official under their
  // own title otherwise, never "Supervisor Mayor Daniel Lurie".
  const addressee = addresseeFor(dist);
  const where = dist ? ` in District ${dist}` : " in San Francisco";
  const signoff = dist ? `A resident of District ${dist}` : "A resident of San Francisco";
  // The index only enters the letter when it actually computed. A letter that
  // cites a score the page could not produce is a letter citing nothing.
  // Each verdict gets its own licence. CONFIRMED may be stated as documented,
  // REPORTED belongs to the record rather than the photograph, and CANDIDATE is
  // an observation the letter must never dress up as established fact. Before
  // this existed the letter asserted the same hardcoded audit sentence at every
  // corner, including corners whose crosswalks are visibly in good condition.
  const hz = ctx.hazards?.items || [];
  const hazardLines = hz.length
    ? hz
        .map((h) => {
          const what = h.label.toLowerCase();
          if (h.verdict === "CONFIRMED")
            return `- The automated visual audit flagged ${what} in the Street View photograph, and city records corroborate it: ${h.detail}. You may present this as documented.`;
          if (h.verdict === "CANDIDATE")
            return `- The audit also flagged ${what}, which does not yet appear in city records. Present this as an observation from the photograph only. Never state it as established fact.`;
          return `- City records show ${h.detail} relating to ${what}, although the visual audit did not find it in the photograph. Attribute this to the records, not to the audit.`;
        })
        .join("\n")
    : "- No visual audit findings are available for this corner. Do not describe any audit.";

  // Phrased as a comparison rather than a raw score, because that is what the
  // number now is. "99 out of 100" invites a reader to imagine a scale that
  // stops somewhere; "worse than 99 percent of San Francisco intersections" is
  // the actual claim and it is the one a Supervisor can check.
  const scoreLine = ctx.score
    ? `- This intersection shows more reported harm than ${ctx.score.index} percent of San Francisco intersections, which is grade ${ctx.score.grade} on the Danger Index. State that comparison in those terms, not as a score out of 100, and immediately add this caveat in your own words: ${SCORE_CAVEAT}\n`
    : "";

  // Only when the history is long enough to mean something, and only ever as
  // coverage-we-can-find. Two years is the floor: one story last year and one
  // this year is not a decade of neglect and must not be dressed up as one.
  const yrs = ctx.timeline?.yearsReported;
  const longevityLine =
    Number.isFinite(yrs) && yrs >= 2
      ? `- Press coverage of safety problems at this intersection goes back at least ${yrs} years, to ${ctx.timeline.firstReportedYear}. State this as the earliest coverage we can find, never as the first time the problem was reported.\n`
      : "";

  const prompt = `Write a respectful one-page letter from a resident to San Francisco ${addressee} about the intersection of ${c.name}${where}.

Use these facts and cite them plainly:
- ${ctx.stats?.crashes ?? 0} injury collisions recorded by the city within 150 meters of this intersection in the last five years${ctx.stats?.fatal ? `, ${ctx.stats.fatal} of them fatal` : ""}. Do not describe this figure as covering any longer period. The first time you cite this count, state in the same sentence that it covers a 150 metre radius while the Danger Index grade is computed over a tighter 80 metre core, so the two figures are measured over different areas and a reader should not expect them to reconcile.
- ${ctx.stats?.reports311 ?? 0} street-condition 311 reports at this location in the last three years, counting street defects, sidewalk and curb, signs, streetlights and blocked sidewalks only.
${headlines ? `- Recent press coverage: ${headlines}.` : "- No press coverage was found for this corner. Do not cite or invent any news reporting."}
${scoreLine}${longevityLine}${hazardLines}
${quote ? `- A resident said: ${quote}` : "- Do not quote or invent any resident testimony."}
- The request: fund ${c.fix.name}, estimated ${c.fix.cost}, through the ${c.fix.grant}.

Rules: plain civic English. Under 220 words. Address only ${addressee}. Distinguish clearly between what city records document and what the visual audit merely observed. Never present an observation as a documented fact. No em dashes anywhere. No placeholders in brackets. Sign off as "${signoff}". Return only the letter text.`;

  return { prompt, addressee, supervisor, signoff, district: dist, quote, headlines };
}
