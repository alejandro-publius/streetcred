// The corroboration rule is the product's core claim, so it gets a test that
// runs without a network, a key, or a Worker. `node tools/label.test.mjs`.
import { label } from "../src/hazards.js";

const cases = [
  ["model flagged, 311 backs it",        true,  { reports311: 5, crossingCollisions: 0 }, "CONFIRMED"],
  ["model flagged, one ped collision",   true,  { reports311: 0, crossingCollisions: 1 }, "CONFIRMED"],
  ["model flagged, records silent",      true,  { reports311: 0, crossingCollisions: 0 }, "CANDIDATE"],
  ["model flagged, 311 below threshold", true,  { reports311: 2, crossingCollisions: 0 }, "CANDIDATE"],
  ["not flagged, record raises it",      false, { reports311: 9, crossingCollisions: 0 }, "REPORTED"],
  ["not flagged, record quiet",          false, { reports311: 1, crossingCollisions: 0 }, null],
];
let fail = 0;
for (const [name, flagged, ev, want] of cases) {
  const got = label(flagged, ev);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} -> ${String(got).padEnd(10)} (want ${want})`);
}
console.log(fail ? `\n${fail} FAILED` : "\nall labelling rules hold");
