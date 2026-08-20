// The letter verifier. One function, two callers.
//
// A letter is the only artifact on this site a person might actually send to an
// elected official with their name on it. Everything else can be wrong and
// merely embarrassing; a letter that cites a collision count the city never
// recorded, or addresses the wrong Supervisor, is a person being made to look
// careless in public by software they trusted. So the letter is the one lane
// that is not allowed to be approximately right.
//
// This is deterministic. No model checks another model's work here, because a
// second model has exactly the same failure mode as the first and agreeing with
// each other is not evidence. Every check below is arithmetic or set
// membership over the same inputs that were fed to the prompt.
//
// Called by the serving path in index.js and by the agent ingest path in
// agent.js. Deliberately one function: a verifier the agent can route around is
// not a rail, and two verifiers that drift apart are worse than one.

import { isStreetQuote } from "./cred.js";
import { resolvedDistrict, addresseeFor } from "./data.js";

export const VERIFY_VERSION = "v2";

// Numbers below this are prose, not claims. "one page", "two of them", "a
// three year window" get spelled out by the model often enough that digits
// under this threshold carry no evidentiary weight, and flagging them produced
// nothing but false failures.
const TRIVIAL_MAX = 2;

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ------------------------------------------------------------------ inputs

// Everything the letter is permitted to assert, assembled from the same objects
// the prompt was built from. If a fact is not in here, the letter may not state
// it, which is the entire contract.
export function buildInputSet({ corner, stats, score, news, timeline, supervisor, voices, district, hazards }) {
  const numbers = new Set();
  const addNum = (n) => {
    const v = typeof n === "number" ? n : parseInt(n, 10);
    if (Number.isFinite(v)) numbers.add(v);
  };

  addNum(stats?.crashes);
  addNum(stats?.fatal);
  addNum(stats?.reports311);
  addNum(stats?.district);
  addNum(score?.index);
  addNum(score?.percentile);

  // Constants the prompt states, not model output: the 311 dataset's name, the
  // five year collision window, the three year report window, and BOTH radii.
  // All appear as digits in nearly every draft.
  //
  // 80 was missing until 2026-08-20 and it is the prompt's own instruction:
  // "the Danger Index grade is computed over a tighter 80 metre core". A model
  // that followed that instruction had its draft rejected for citing a figure
  // the records do not support, which is the verifier failing a letter for
  // obeying the prompt. Found by the first offline fleet run, where both
  // corners in the sample failed on exactly this.
  addNum(311);
  addNum(3);
  addNum(5);
  addNum(150);
  addNum(80);
  // The hazard lane counts 311 over twelve months where the stats tiles count
  // three years, and it says so in h.detail: "3 street-condition 311 reports in
  // 12 months". The window travels with the number, so the window is a sourced
  // constant too.
  addNum(12);

  // The hazard lane's own evidence figures.
  //
  // The prompt does not merely mention these, it hands them to the model inside
  // h.detail and instructs it to "present this as documented": "3
  // street-condition 311 reports in 12 months", "5 pedestrian crossing
  // collisions in 5 years". They were never in the sourced set, so a draft that
  // did exactly what the prompt asked was rejected for citing an unsupported
  // figure. Sixteen of the first fleet run's twenty-one number failures traced
  // here. Same class as the missing 80 above, and larger.
  for (const h of hazards?.items || []) {
    addNum(h?.reports311);
    addNum(h?.crossingCollisions);
  }

  // The district the letter states, from whichever source resolved it. stats
  // .district was listed; a corner whose district comes off its own record was
  // not, so "in District 4" failed at exactly those corners.
  addNum(district);
  addNum(corner?.district);

  addNum(timeline?.firstReportedYear);
  addNum(timeline?.yearsReported);
  for (const y of timeline?.years || []) addNum(y?.year ?? y);

  // Figures from the corner's own funding ask, which the letter quotes back.
  for (const m of String(corner?.fix?.cost || "").matchAll(/\d[\d,]*/g)) {
    addNum(parseInt(m[0].replace(/,/g, ""), 10));
  }

  // Dates inside cited headlines are quotable, so their years are sourced.
  for (const item of news?.items || news || []) {
    const d = String(item?.date || "");
    const y = parseInt(d.slice(0, 4), 10);
    if (Number.isFinite(y)) numbers.add(y);
  }

  // Street words this corner is actually made of. A letter naming a street that
  // is not part of this intersection and not part of a cited headline is
  // describing somewhere else.
  const streets = new Set();
  for (const w of norm(corner?.name).split(" ")) if (w.length > 1) streets.add(w);
  for (const w of norm(corner?.short).split(" ")) if (w.length > 1) streets.add(w);

  const domains = new Set();
  for (const item of news?.items || news || []) {
    if (item?.domain) domains.add(String(item.domain).toLowerCase());
    // Headline text is quoted verbatim, so words inside a cited headline are
    // sourced by definition and must not be flagged as invented streets.
    for (const w of norm(item?.title).split(" ")) if (w.length > 1) streets.add(w);
  }

  // ---------------------------------------------------------------- lanes
  //
  // What the page's other lanes actually found, so the letter cannot describe a
  // lane that came back empty. The counting rules are borrowed from the Cred
  // Check rather than reinvented: if the verifier and the panel beside it
  // disagreed about whether this corner has resident accounts, one of them
  // would be lying to the same reader on the same screen.

  // A scraped account that is about the street. Same filter the Cred Check's
  // resident lane counts with, from src/cred.js.
  const quotes = (voices?.items || []).filter((v) => isStreetQuote(v?.text));
  const voicesCount = quotes.length;

  // Coverage, not records. An agency bulletin is the record; reporting on it is
  // the coverage. Same exclusion the Cred Check's press lane makes.
  const items = news?.items || news || [];
  const citedPressCount = items.filter((i) => !i?.official && i?.corroborates).length;

  // ------------------------------------------------------------- displayed
  //
  // The numbers a reader can actually see on this corner's page, kept apart
  // from `numbers` on purpose. `numbers` is everything the prompt was allowed
  // to mention, and it holds 311, 3, 5 and 150 as bare constants; a magnitude
  // word checked against that set would find 150 and conclude "hundreds" was
  // supported at a corner displaying 65 collisions. This is counts of harm
  // only: no district number, no percentile, no radius, no dataset name.
  // Keyed by what the figure counts, not by the figure. "Hundreds of
  // collisions" is a claim about collisions, and a corner displaying 41
  // collisions beside 214 street-condition reports does not support it: a
  // magnitude rule that only asked "is any displayed number at least 100" would
  // have found the 214 and waved it through.
  const displayed = new Map();
  const show = (key, v, label) => {
    const num = typeof v === "number" ? v : parseInt(v, 10);
    if (Number.isFinite(num) && num > 0) displayed.set(key, { value: num, label });
  };
  show("crashes", stats?.crashes, "injury collisions in 5 years");
  show("fatal", stats?.fatal, "fatal collisions");
  show("reports311", stats?.reports311, "street-condition 311 reports in 3 years");
  show("yearsReported", timeline?.yearsReported, "years with reported harm");
  show("voices", voicesCount, "resident accounts about the street");
  show("press", citedPressCount, "cited press items");

  // The district this corner actually resolves to, and the official that
  // entails, from the site's own table. Passed in when the caller knows it,
  // derived the same way the rest of the site derives it when not, so a caller
  // that forgets cannot silently disable the rule.
  const dist = district ?? resolvedDistrict(corner, stats);

  return {
    numbers,
    streets,
    domains,
    district: dist,
    // What the salutation has to say, title included. Always present: a corner
    // with no resolved district is addressed to the citywide official, which is
    // a real expectation and not an absent one.
    addressee: addresseeFor(dist),
    // Unchanged. Rule 2 checks "Supervisor X" mentions anywhere in the body and
    // is only armed when the caller supplies a name; deriving one here would
    // arm it on the agent path, which passes what it knows and nothing more.
    supervisor: supervisor || null,
    grant: corner?.fix?.grant || null,
    voicesCount,
    pressCount: items.length,
    citedPressCount,
    displayed,
  };
}

// ------------------------------------------------------------------ checks

// Street-ish proper nouns the letter asserts. Narrow on purpose: a generic
// capitalised-word scan flags every sentence opener and produces a verifier
// nobody trusts, which is worse than no verifier at all.
const STREET_MENTION =
  /\b([A-Z][a-zA-Z]+|\d{1,3}(?:st|nd|rd|th))\s+(Street|Avenue|Boulevard|Road|Way|Drive)\b/g;

const SUPERVISOR_MENTION = /\bSupervisor\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/g;

// The salutation, and only the salutation.
//
// Rule 2 above catches a misspelled or swapped Supervisor surname. It cannot
// catch a letter that names the right person under the wrong office, or the
// citywide fallback at a corner that resolves to a district with a sitting
// Supervisor: the fillmore-and-lombard letter opened "Dear Mayor Daniel Lurie"
// while the page beside it said District 2, and no rule here had an opinion,
// because nothing was misspelled and nothing was invented.
//
// Scoped to the opening line on purpose. A letter may legitimately mention the
// Mayor in passing, and flagging that would be a false failure; who it is
// addressed TO is a different claim and the one a reader acts on.
const SALUTATION = /^\s*Dear\s+([^,\n]+?)\s*[,:]/m;

// An addressee split into the office and the person, so the two can be checked
// on their own terms. "Supervisor Mahmood" and "Supervisor Bilal Mahmood" are
// the same addressee; "Mayor Bilal Mahmood" is not.
function splitAddressee(raw) {
  const t = norm(raw);
  const title = /^supervisor\b/.test(t) ? "supervisor" : /^mayor\b/.test(t) ? "mayor" : "";
  const name = t.replace(/^(supervisor|mayor)\s+/, "");
  return { title, name, last: name.split(" ").slice(-1)[0] || "" };
}

const DOMAIN_MENTION = /\b([a-z0-9-]+\.(?:org|com|net|gov|edu))\b/gi;

// Words that pass the street shape but are structural, not place names.
const NOT_A_PLACE = new Set(["the", "this", "that", "a", "an", "one", "main", "our", "your"]);

// -------------------------------------------------------- lane consistency
//
// The number checker cannot see any of what follows, because none of these
// claims contains a checkable digit. That is how a served letter came to say
// residents describe the problem on a page whose voices lane reads NONE FOUND,
// and "hundreds of collisions" on a page displaying 65. Both sentences were
// true-shaped and unfalsifiable by arithmetic, so arithmetic passed them.
//
// These rules are sentence-scoped rather than document-scoped: the unit a
// reader believes is the sentence, and naming the whole letter back to a retry
// tells it nothing about which claim to drop.

// Sentences, roughly. Good enough for prose that has no abbreviations in it,
// and the letter prompt forbids the ones that would break this.
const sentencesOf = (body) =>
  String(body || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

// Referring to what people who live there said. Both halves have to be present:
// "residents" alone is a noun the letter may legitimately use ("residents
// deserve a safe crossing"), and it is only an evidentiary claim once it is
// attached to an act of speaking.
// "locals" only in the plural noun form. The adjective is a different word
// doing a different job: "Local reporting has covered this corridor" is a press
// claim, and an optional-s here made it read as a resident claim as well, which
// is the sort of double failure that teaches a reader to ignore the verifier.
const RESIDENT_WHO =
  /\b(residents?|neighbou?rs?|locals|people who live|those who live|community members?)\b/i;
const RESIDENT_SAID =
  /\b(describ\w+|say|says|said|report\w*|tell|tells|told|complain\w*|recount\w*|testif\w+|account|accounts|testimony|in their own words|write|writes|wrote)\b/i;

// Referring to journalism. Deliberately not "reported", which the records lane
// also uses ("311 reports"); the tokens here can only mean a newsroom.
const PRESS_MENTION =
  /\b(local reporting|news coverage|press coverage|media coverage|newspapers?|journalists?|reporters?|the press|the media|has been covered|been covered by|covered by (?:local )?(?:news|press|media)|coverage of this (?:corner|intersection|corridor))\b/i;

// Magnitude words, and the smallest displayed count that would justify each.
//
// Conservative by design. Frequency words like "repeatedly" and "continuously"
// are left out: they are claims about pattern rather than about quantity, and
// flagging them produces the kind of false failure that gets a verifier
// switched off. A word here has to be one whose whole job is to assert a size.
const MAGNITUDES = [
  { re: /\bhundreds of thousands\b/i, word: "hundreds of thousands", min: 100000 },
  { re: /\btens of thousands\b/i, word: "tens of thousands", min: 10000 },
  { re: /\bthousands\b/i, word: "thousands", min: 1000 },
  { re: /\bhundreds\b/i, word: "hundreds", min: 100 },
  { re: /\bscores of\b/i, word: "scores of", min: 40 },
  { re: /\bdozens\b/i, word: "dozens", min: 24 },
  // No floor of their own: they assert "too many to count", so they need some
  // displayed count to be about at all.
  { re: /\bcountless\b/i, word: "countless", min: null },
  { re: /\binnumerable\b/i, word: "innumerable", min: null },
  { re: /\buntold\b/i, word: "untold", min: null },
  { re: /\bmyriad\b/i, word: "myriad", min: null },
];

// What a magnitude word is counting. Matched inside the same sentence, so the
// claim is checked against the figure it is actually about.
const SUBJECTS = [
  { key: "crashes", re: /\b(collisions?|crashes|wrecks?|casualt\w+)\b/i },
  { key: "fatal", re: /\b(fatal\w*|deaths?|killed|fatalities)\b/i },
  { key: "reports311", re: /\b(311 reports?|reports? to 311|service requests?|complaints?)\b/i },
  { key: "yearsReported", re: /\byears?\b/i },
  { key: "voices", re: /\b(residents?|neighbou?rs?|accounts?|testimon\w+)\b/i },
  { key: "press", re: /\b(articles?|stories|headlines?|outlets?)\b/i },
];

// The failure message names what the page does show, because "hundreds is not
// supported" sends a retry looking for a bigger number, and "the page displays
// 65 injury collisions in 5 years" sends it looking for a different sentence.
const describeDisplayed = (displayed, subject) => {
  if (subject && displayed?.has(subject.key)) {
    const d = displayed.get(subject.key);
    return `this page displays ${d.value} ${d.label}`;
  }
  if (subject) return `this page displays no count of that at all`;
  if (!displayed || displayed.size === 0) return "this page displays no counts at all";
  const best = [...displayed.values()].sort((a, b) => b.value - a.value)[0];
  return `the largest figure this page displays is ${best.value} ${best.label}`;
};

export function verifyLetter(text, inputs) {
  const body = String(text || "");
  const failures = [];

  // 1. Numbers. Every digit sequence the letter states must trace to an input.
  const claimedNumbers = [...body.matchAll(/\b\d[\d,]*\b/g)]
    .map((m) => parseInt(m[0].replace(/,/g, ""), 10))
    .filter((n) => Number.isFinite(n));
  for (const n of new Set(claimedNumbers)) {
    if (n <= TRIVIAL_MAX) continue;
    if (!inputs.numbers.has(n)) {
      failures.push({
        token: String(n),
        kind: "number",
        reason: `the figure ${n} does not appear in this corner's records`,
      });
    }
  }

  // 2. The addressee. Addressing the wrong official is the failure a reader is
  // least able to catch and most embarrassed by.
  if (inputs.supervisor) {
    const expected = norm(inputs.supervisor);
    const expectedLast = expected.split(" ").slice(-1)[0];
    for (const m of body.matchAll(SUPERVISOR_MENTION)) {
      const named = norm(m[1]);
      const namedLast = named.split(" ").slice(-1)[0];
      // Accept the full name or the surname alone, reject anything else,
      // including a near miss, because a misspelled surname is still wrong.
      if (named !== expected && namedLast !== expectedLast) {
        failures.push({
          token: m[1],
          kind: "supervisor",
          reason: `addressed to Supervisor ${m[1]}, but this corner's Supervisor is ${inputs.supervisor}`,
        });
      }
    }
  }

  // 3. Streets. Anything named as a street must belong to this corner or to a
  // headline the letter is quoting.
  for (const m of body.matchAll(STREET_MENTION)) {
    const word = norm(m[1]);
    if (!word || NOT_A_PLACE.has(word)) continue;
    if (!inputs.streets.has(word)) {
      failures.push({
        token: `${m[1]} ${m[2]}`,
        kind: "street",
        reason: `${m[1]} ${m[2]} is not part of this intersection and was not in any cited coverage`,
      });
    }
  }

  // 4. Cited domains must come from the press lane.
  for (const m of body.matchAll(DOMAIN_MENTION)) {
    const d = m[1].toLowerCase();
    if (!inputs.domains.has(d)) {
      failures.push({
        token: d,
        kind: "source",
        reason: `${d} was not among the sources fetched for this corner`,
      });
    }
  }

  // 4a. Em dashes. The prompt forbids them and the house style forbids them, so
  // a draft carrying one is a draft that did not follow its instructions, which
  // is worth knowing about a model even when the sentence around it is true.
  // En dashes count: the failure mode is a model reaching for typographic
  // punctuation, and which one it reached for is not the point.
  for (const m of body.matchAll(/[^\s]*\s*[\u2014\u2013]\s*[^\s]*/g)) {
    failures.push({
      token: m[0].trim().slice(0, 60),
      kind: "emdash",
      reason: "the letter uses an em or en dash, which the prompt forbids and the house style does not use",
    });
    break; // one verdict per letter; the retry fixes all of them or none
  }

  // 4b. The addressee. Who the letter is addressed TO, against the sitting
  // representative of the district this corner resolves to, per the site's own
  // table. Compared on the whole salutation, title included, because "Mayor
  // Daniel Lurie" and "Supervisor Stephen Sherrill" are two different people
  // and "Supervisor Daniel Lurie" is neither.
  if (inputs.addressee) {
    const m = body.match(SALUTATION);
    if (m) {
      // Title and name are checked separately, because they fail differently.
      // "Dear Supervisor Mahmood" is correct and ordinary English, so a whole
      // string comparison against "Supervisor Bilal Mahmood" would reject the
      // right addressee. What must not vary is the office, and which person.
      const got = splitAddressee(m[1]);
      const want = splitAddressee(inputs.addressee);
      const titleWrong = got.title !== want.title;
      const personWrong = got.last !== want.last && got.name !== want.name;
      if (titleWrong || personWrong) {
        failures.push({
          token: m[1],
          kind: "addressee",
          reason:
            `addressed to ${m[1]}, but this corner resolves to ` +
            `${inputs.district === null ? "no district" : `District ${inputs.district}`}` +
            `, whose representative is ${inputs.addressee}`,
        });
      }
    }
  }

  // 5, 6 and 7. Lane consistency. One pass over the sentences, because all
  // three rules ask about a sentence's relationship to a lane rather than about
  // a token, and re-splitting the letter three times to ask three questions of
  // the same sentence is the slower way to the same answer.
  const sentences = sentencesOf(body);
  let magnitudesChecked = 0;

  for (const sentence of sentences) {
    // 5. Resident accounts. The lane either found something or it did not, and
    // a letter may not describe what an empty lane heard.
    if (RESIDENT_WHO.test(sentence) && RESIDENT_SAID.test(sentence) && !(inputs.voicesCount > 0)) {
      failures.push({
        token: sentence,
        kind: "voices",
        reason:
          "this sentence describes what residents said, and no scraped account at this corner is about the street, so the voices lane reads NONE FOUND",
      });
    }

    // 6. Press coverage. The same argument, one lane over. The domain rule
    // above catches an invented source; this catches an asserted one that was
    // never named, which is the version with no digits in it to check.
    if (PRESS_MENTION.test(sentence) && !(inputs.citedPressCount > 0)) {
      failures.push({
        token: sentence,
        kind: "press",
        reason:
          "this sentence cites press coverage, and no coverage naming this corner was found, so the letter has nothing to cite",
      });
    }

    // 7. Magnitude words. A size claim with no digits in it is still a size
    // claim, and the number checker is blind to it by construction.
    for (const m of MAGNITUDES) {
      if (!m.re.test(sentence)) continue;
      magnitudesChecked += 1;

      // What is being counted, if the sentence says. When it does, the claim is
      // checked against that figure alone. When it does not, fall back to the
      // whole set: a rule that fires on a sentence it cannot understand is how
      // false failures get in.
      const subject = SUBJECTS.find((sub) => sub.re.test(sentence)) || null;
      const entry = subject ? inputs.displayed?.get(subject.key) : null;
      const values = subject
        ? entry
          ? [entry.value]
          : []
        : [...(inputs.displayed?.values() || [])].map((d) => d.value);
      const supported = m.min === null ? values.length > 0 : values.some((v) => v >= m.min);

      if (!supported) {
        failures.push({
          token: m.word,
          kind: "magnitude",
          reason:
            m.min === null
              ? `"${m.word}" claims a quantity too large to count, and ${describeDisplayed(inputs.displayed, subject)}`
              : `"${m.word}" claims at least ${m.min}, and ${describeDisplayed(inputs.displayed, subject)}`,
        });
      }
      // One magnitude verdict per sentence. "hundreds of thousands" also
      // matches "thousands" and "hundreds", and three failures for one phrase
      // crowds the retry prompt with the same complaint said three ways.
      break;
    }
  }

  return {
    version: VERIFY_VERSION,
    ok: failures.length === 0,
    failures,
    checked: {
      numbers: new Set(claimedNumbers).size,
      supervisor: Boolean(inputs.supervisor),
      sentences: sentences.length,
      magnitudes: magnitudesChecked,
      voices: inputs.voicesCount ?? null,
      press: inputs.citedPressCount ?? null,
    },
  };
}

// The sentence handed back to the model on a retry. Naming the specific token
// that failed is the difference between a retry that fixes the problem and a
// retry that reshuffles the same invention into a new sentence.
export function retryInstruction(result) {
  const named = result.failures
    .slice(0, 6)
    .map((f) => `"${f.token}" (${f.reason})`)
    .join("; ");
  return (
    `\n\nYour previous draft was rejected by an automatic check for stating something the ` +
    `records do not support: ${named}. Rewrite it without that claim. Do not substitute a ` +
    `different figure for it, and do not restate it in words instead of digits. If a fact is ` +
    `not in the list above, leave it out entirely.`
  );
}
