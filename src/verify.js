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

export const VERIFY_VERSION = "v1";

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
export function buildInputSet({ corner, stats, score, news, timeline, supervisor }) {
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
  // five year collision window, the three year report window, the 150 metre
  // radius. All appear as digits in nearly every draft.
  addNum(311);
  addNum(3);
  addNum(5);
  addNum(150);

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

  return {
    numbers,
    streets,
    domains,
    supervisor: supervisor || null,
    grant: corner?.fix?.grant || null,
  };
}

// ------------------------------------------------------------------ checks

// Street-ish proper nouns the letter asserts. Narrow on purpose: a generic
// capitalised-word scan flags every sentence opener and produces a verifier
// nobody trusts, which is worse than no verifier at all.
const STREET_MENTION =
  /\b([A-Z][a-zA-Z]+|\d{1,3}(?:st|nd|rd|th))\s+(Street|Avenue|Boulevard|Road|Way|Drive)\b/g;

const SUPERVISOR_MENTION = /\bSupervisor\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/g;

const DOMAIN_MENTION = /\b([a-z0-9-]+\.(?:org|com|net|gov|edu))\b/gi;

// Words that pass the street shape but are structural, not place names.
const NOT_A_PLACE = new Set(["the", "this", "that", "a", "an", "one", "main", "our", "your"]);

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

  return {
    version: VERIFY_VERSION,
    ok: failures.length === 0,
    failures,
    checked: {
      numbers: new Set(claimedNumbers).size,
      supervisor: Boolean(inputs.supervisor),
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
