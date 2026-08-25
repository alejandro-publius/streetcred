// Who a letter is addressed to, down every path that can produce one.
//
// The bug: the fillmore-and-lombard letter opened "Dear Mayor Daniel Lurie"
// while the page beside it resolved the corner to District 2 and named
// Supervisor Stephen Sherrill. Nothing was invented and nothing was misspelled,
// so no rule in the verifier had an opinion about it.
//
// The cause was two ways of answering one question. The ordinary letter path
// read the district off `stats`, which getStats resolves as `corner.district`
// falling back to the crash-data majority. The backoff path read the raw
// `corner.district`, which is absent for any corner that resolved from a city
// shard rather than from the registry. Absent district, citywide fallback,
// Mayor. The two paths agreed at the flagships, where the registry carries a
// district, and disagreed everywhere else.
//
// So the test is not "does the backoff branch work". It is "do the paths
// agree", because agreeing is the property that was missing.

import test from "node:test";
import assert from "node:assert/strict";
import { resolvedDistrict, addresseeFor, supervisorFor, hasSupervisor, SUPERVISORS } from "../src/data.js";
import { buildInputSet, verifyLetter } from "../src/verify.js";
import { sampleLetter, LETTER_PENDING_NOTE } from "../src/index.js";

// A corner as the shard resolver produces it: no district on the object. This
// is the shape that triggered the bug, and it is the common shape, since 7,355
// of the city's corners come from shards and 2 come from the registry.
const shardCorner = {
  slug: "fillmore-and-lombard",
  name: "Fillmore Street and Lombard Street",
  short: "Fillmore & Lombard",
  lat: 37.8,
  lon: -122.436,
  radiusMeters: 150,
  fix: { name: "Daylighting", cost: "$120,000", grant: "Caltrans HSIP" },
};

// What getStats resolves for it.
const stats = { source: "live", crashes: 30, fatal: 0, reports311: 44, district: 2 };

test("the corner object alone does not carry the district, which is the trap", () => {
  assert.equal(shardCorner.district, undefined);
  assert.equal(resolvedDistrict(shardCorner, null), null);
});

test("both letter paths resolve the same district for the same corner", () => {
  // The ordinary path had stats in hand; the backoff path had only the corner.
  // Now both ask the same function, and it is given both.
  assert.equal(resolvedDistrict(shardCorner, stats), 2);
  assert.equal(resolvedDistrict({ ...shardCorner, district: 2 }, null), 2);
  assert.equal(resolvedDistrict({ ...shardCorner, district: 2 }, stats), 2);
});

test("the addressee for a resolved district is that district's sitting Supervisor", () => {
  assert.equal(addresseeFor(resolvedDistrict(shardCorner, stats)), "Supervisor Stephen Sherrill");
  assert.equal(supervisorFor(2), "Stephen Sherrill");
});

test("no district resolves to the citywide official, under their own title", () => {
  // Never "Supervisor Mayor Daniel Lurie", which is what a naive prefix gives.
  assert.equal(addresseeFor(null), "Mayor Daniel Lurie");
  assert.doesNotMatch(addresseeFor(null), /Supervisor/);
});

test("every district in the table produces a titled Supervisor", () => {
  for (const d of Object.keys(SUPERVISORS)) {
    assert.ok(hasSupervisor(d), `district ${d} should map to a Supervisor`);
    assert.equal(addresseeFor(d), `Supervisor ${SUPERVISORS[d]}`);
  }
});

// The rule, on the letter the bug actually produced.
test("a letter naming the wrong official fails the addressee rule by name", () => {
  const inputs = buildInputSet({
    corner: shardCorner,
    stats,
    news: { items: [] },
    voices: { items: [] },
    supervisor: supervisorFor(2),
  });
  assert.equal(inputs.district, 2);
  assert.equal(inputs.addressee, "Supervisor Stephen Sherrill");

  // sampleLetter(c, c.district) with an absent district is exactly what the
  // backoff branch used to do.
  const wrong = sampleLetter(shardCorner, shardCorner.district);
  assert.match(wrong.text, /^Dear Mayor Daniel Lurie,/);

  const failures = verifyLetter(wrong.text, inputs).failures.filter((f) => f.kind === "addressee");
  assert.equal(failures.length, 1, "the wrong addressee must fail, exactly once");
  assert.match(failures[0].reason, /District 2/);
  assert.match(failures[0].reason, /Stephen Sherrill/);
});

test("the same letter with the district resolved passes the addressee rule", () => {
  const inputs = buildInputSet({
    corner: shardCorner,
    stats,
    news: { items: [] },
    voices: { items: [] },
    supervisor: supervisorFor(2),
  });
  const right = sampleLetter(shardCorner, resolvedDistrict(shardCorner, stats));
  assert.match(right.text, /^Dear Supervisor Stephen Sherrill,/);
  assert.equal(verifyLetter(right.text, inputs).failures.filter((f) => f.kind === "addressee").length, 0);
});

// The right person under the wrong office is still the wrong addressee, and the
// existing surname rule cannot see it.
test("the right name under the wrong office fails", () => {
  const inputs = buildInputSet({
    corner: shardCorner,
    stats,
    news: { items: [] },
    voices: { items: [] },
    supervisor: supervisorFor(2),
  });
  const r = verifyLetter("Dear Mayor Stephen Sherrill,\n\nPlease fund it.", inputs);
  assert.ok(
    r.failures.some((f) => f.kind === "addressee"),
    "the office is half of who someone is",
  );
});

// A letter may mention the Mayor without being addressed to them.
test("mentioning the Mayor in the body is not a wrong addressee", () => {
  const inputs = buildInputSet({
    corner: shardCorner,
    stats,
    news: { items: [] },
    voices: { items: [] },
    supervisor: supervisorFor(2),
  });
  const text =
    "Dear Supervisor Stephen Sherrill,\n\n" +
    "Mayor Daniel Lurie has named this corridor a priority. Please fund the work.";
  assert.equal(verifyLetter(text, inputs).failures.filter((f) => f.kind === "addressee").length, 0);
});

// And the backoff branch, which is what the reader actually hits today: it
// serves no letter at all, so it names no official and cannot name a wrong one.
test("the backoff path names no official, because it serves no letter", () => {
  assert.match(LETTER_PENDING_NOTE, /queued behind generation/);
  // The pending payload is the shape the branch returns. Asserting on the
  // exported note keeps this honest if the branch is ever restructured: the
  // copy a reader sees is the contract, not the function that builds it.
  assert.doesNotMatch(LETTER_PENDING_NOTE, /Mayor|Supervisor/);
});

// ----------------------------------------------- the "Dear" bypass
//
// The salutation pattern required the literal word "Dear", and the addressee
// check ran inside `if (match)`. A letter opening "Supervisor Dorsey," matched
// nothing, so the check did not run at all: dropping one word skipped the gate
// entirely. Four letters in the first fleet of 116 opened exactly that way.
// Every one of them named the right person, which is how it stayed invisible.

test("a salutation without Dear is still checked, not skipped", () => {
  const inputs = buildInputSet({
    corner: { slug: "x", name: "A and B", fix: { name: "f", cost: "$1", grant: "g" } },
    stats: { crashes: 10, district: 9 },
    news: { items: [] },
    voices: { items: [] },
    district: 9,
    supervisor: "Jackie Fielder",
  });

  // Right person, no "Dear": accepted.
  const right = verifyLetter("Supervisor Jackie Fielder,\n\nCity records show 10 injury collisions.", inputs);
  assert.ok(!right.failures.some((f) => f.kind === "addressee"), "the correct addressee must not be rejected");

  // Wrong person, no "Dear": this used to pass by omission.
  const wrong = verifyLetter("Supervisor Bilal Mahmood,\n\nCity records show 10 injury collisions.", inputs);
  assert.ok(
    wrong.failures.some((f) => f.kind === "addressee"),
    "a District 9 corner addressed to another district's supervisor must fail with or without Dear",
  );

  // And the wrong office, no "Dear".
  const office = verifyLetter("Mayor Jackie Fielder,\n\nCity records show 10 injury collisions.", inputs);
  assert.ok(office.failures.some((f) => f.kind === "addressee"), "the office must not vary either");
});

test("the bare salutation must be its own line, not a phrase mid-sentence", () => {
  const inputs = buildInputSet({
    corner: { slug: "x", name: "A and B", fix: { name: "f", cost: "$1", grant: "g" } },
    stats: { crashes: 10, district: 9 },
    news: { items: [] },
    voices: { items: [] },
    district: 9,
    supervisor: "Jackie Fielder",
  });
  // "I wrote to Supervisor Bilal Mahmood, who referred me on" is prose, not an
  // addressee, and must not be read as one.
  const r = verifyLetter(
    "Dear Supervisor Jackie Fielder,\n\nI wrote to Supervisor Bilal Mahmood, who referred me on.",
    inputs,
  );
  assert.ok(!r.failures.some((f) => f.kind === "addressee"), "the real salutation wins");
});
