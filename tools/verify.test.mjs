// The doctored-letter cases, frozen. Each one is a way a letter could lie, and
// each must fail with the offending token named, because a verifier that says
// "something is wrong somewhere" teaches the retry nothing. No network, no key:
// `node tools/verify.test.mjs`.

import { buildInputSet, verifyLetter, retryInstruction } from "../src/verify.js";

const inputs = buildInputSet({
  corner: {
    name: "Taylor Street and Turk Street",
    short: "Taylor & Turk",
    fix: { cost: "$265,000 estimated", grant: "Caltrans HSIP" },
  },
  stats: { crashes: 41, fatal: 1, reports311: 214, district: 5 },
  score: { index: 88, percentile: 88 },
  news: {
    items: [{ domain: "sfstandard.com", title: "Pedestrian struck at Taylor and Turk", date: "2026-03-04" }],
  },
  timeline: { firstReportedYear: 2016, yearsReported: 10, years: [{ year: 2016 }, { year: 2026 }] },
  supervisor: "Bilal Mahmood",
});

const clean = `Dear Supervisor Mahmood,

City records show 41 injury collisions within 150 meters of Taylor Street and Turk Street
over five years, 1 of them fatal, and 214 street-condition 311 reports in three years.
Coverage goes back to 2016. Please fund the crossing upgrade, estimated at $265,000.

Sincerely, a District 5 resident`;

const cases = [
  ["clean letter passes", clean, true, null],
  ["invented collision count", clean.replace("41 injury", "412 injury"), false, "412"],
  ["misspelled Supervisor surname", clean.replace("Supervisor Mahmood", "Supervisor Mahmoud"), false, "Mahmoud"],
  ["street not part of the corner", clean.replace("Turk Street\nover", "Larkin Street\nover"), false, "Larkin Street"],
  ["domain never fetched", clean.replace("Coverage goes back to 2016.", "As sfgate.com reported, coverage goes back to 2016."), false, "sfgate.com"],
  ["year outside the timeline", clean.replace("back to 2016", "back to 1987"), false, "1987"],
];

let failed = 0;
for (const [label, text, expectOk, expectToken] of cases) {
  const r = verifyLetter(text, inputs);
  const okMatch = r.ok === expectOk;
  const tokenMatch = expectOk || r.failures.some((f) => f.token === expectToken);
  const pass = okMatch && tokenMatch;
  if (!pass) failed++;
  console.log(
    `${pass ? "pass" : "FAIL"}  ${label}` +
      (expectOk ? "" : `  (named: ${r.failures.map((f) => f.token).join(", ") || "nothing"})`),
  );
}

// The retry instruction must name the token, or the retry re-rolls the dice.
const bad = verifyLetter(cases[1][1], inputs);
const retry = retryInstruction(bad);
if (!retry.includes('"412"')) {
  failed++;
  console.log("FAIL  retry instruction does not name the failing token");
} else {
  console.log("pass  retry instruction names the failing token");
}

if (failed) {
  console.error(`\n${failed} verifier case(s) failed`);
  process.exit(1);
}
console.log("\nall verifier cases hold");
