// The ingest gate. One test per way the agent can be wrong.
//
// This endpoint is the only one on StreetCred that accepts facts from outside
// the building, so it is the only one written on the assumption that its caller
// is wrong. The agent is not an adversary, but an agent with a bug is
// indistinguishable from one, and the site's whole argument is that it checks
// rather than trusts.
//
// The rule these tests are really about: a refusal is stored and published, not
// counted. Rejections used to increment an integer, which is enough to notice
// that something was refused and useless for saying what. That put the agent's
// failures in the one place this project refuses to put anything, which is out
// of sight.
//
//   node --test tools/agentgate.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { handleAgentReport, REJECT, TOOLS, pacificDay, unverifiableConsequences } from "../src/agent.js";

const TOKEN = "test-token-0123456789";

function harness({ corners = ["6th-and-mission"], journal = [], consequences = new Set() } = {}) {
  const state = { journal: [...journal], rejects: [], counted: 0 };
  const deps = {
    countReject: async () => { state.counted += 1; },
    recordReject: async (_e, r) => { state.rejects.push(r); state.counted += 1; },
    journalEntries: async () => state.journal,
    consequencesFor: async () => consequences,
    appendJournal: async (_e, rec) => { state.journal.push(rec); return { count: state.journal.length }; },
    cornerFor: async (slug) => (corners.includes(slug) ? { slug, name: slug } : null),
    putAgentRescore: async () => {},
    putAgentLetter: async () => {},
    putAgentFlag: async () => {},
    statsFor: async () => null,
    scoreFor: async () => null,
    timelineFor: async () => null,
  };
  return { state, deps };
}

function post(body, { token = TOKEN, method = "POST" } = {}) {
  return new Request("https://x/api/agent/report", {
    method,
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    body: JSON.stringify(body),
  });
}

const env = { WATCHDOG_INGEST_TOKEN: TOKEN };

function entry(over = {}) {
  return {
    kind: "journal_entry",
    decisionId: "run1:6th-and-mission:2026-08-20T10:00:00Z",
    slug: "6th-and-mission",
    name: "6th and Mission",
    ts: "2026-08-20T10:00:00Z",
    delta: "311 reports rose by 4.",
    trigger: "cron",
    tier1: { significant: false, reason: "Ordinary week to week variance at a corner this busy.", byRule: false },
    tier2: null,
    actions: [],
    ...over,
  };
}

// ==================================================================== the token

test("no token is refused, and refused first", async () => {
  const { deps, state } = harness();
  const out = await handleAgentReport(post(entry(), { token: "" }), env, deps);
  assert.equal(out.status, 401);
  assert.equal(state.journal.length, 0, "nothing may be stored on an unauthenticated call");
});

test("a wrong token is refused and echoes nothing back", async () => {
  const { deps } = harness();
  const out = await handleAgentReport(post(entry(), { token: "wrong-token-000000000" }), env, deps);
  assert.equal(out.status, 401);
  assert.equal(out.body.error, "unauthorized");
  assert.ok(!JSON.stringify(out.body).includes("6th-and-mission"), "a rejection must not be an oracle");
});

test("a missing secret shuts the endpoint rather than opening it", async () => {
  const { deps } = harness();
  const out = await handleAgentReport(post(entry()), {}, deps);
  assert.equal(out.status, 503);
});

test("every verb other than POST is refused", async () => {
  const { deps } = harness();
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const r = new Request("https://x/api/agent/report", {
      method,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const out = await handleAgentReport(r, env, deps);
    assert.equal(out.status, 405, `${method} must be refused`);
  }
});

// ============================================================ the happy path

test("a well formed decline is accepted and stored", async () => {
  const { deps, state } = harness();
  const out = await handleAgentReport(post(entry()), env, deps);
  assert.equal(out.status, 200);
  assert.equal(out.body.accepted, true);
  assert.equal(state.journal.length, 1);
  assert.equal(state.rejects.length, 0);
});

test("the stored record carries the tier and the tool, not just the prose", async () => {
  const { deps, state } = harness();
  await handleAgentReport(post(entry({ tool: "decline", model: "gemini-3.5-flash", latencyMs: 1840 })), env, deps);
  const rec = state.journal[0];
  assert.equal(rec.tool, "decline");
  assert.equal(rec.tier, "reflex");
  assert.equal(rec.model, "gemini-3.5-flash");
  assert.equal(rec.latencyMs, 1840);
});

test("a rule-settled entry says rule, not reflex", async () => {
  const { deps, state } = harness();
  await handleAgentReport(post(entry({ tier1: { significant: true, reason: "A new fatality is significant by rule.", byRule: true } })), env, deps);
  assert.equal(state.journal[0].tier, "rule");
});

// ======================================================= the rejection classes

test("an unknown corner is refused and the refusal is stored", async () => {
  const { deps, state } = harness();
  const out = await handleAgentReport(post(entry({ slug: "not-a-real-corner" })), env, deps);
  assert.equal(out.status, 400);
  assert.equal(out.body.why, REJECT.UNKNOWN_CORNER);
  assert.equal(state.journal.length, 0);
  assert.equal(state.rejects.length, 1, "a refusal is stored, not counted");
  assert.equal(state.rejects[0].why, REJECT.UNKNOWN_CORNER);
});

test("a decided_at in the future in Pacific is refused", async () => {
  const { deps, state } = harness();
  const tomorrow = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const out = await handleAgentReport(post(entry({ ts: tomorrow })), env, deps);
  assert.equal(out.body.why, REJECT.FUTURE_DATE);
  assert.equal(state.rejects.length, 1);
});

test("today in Pacific is not the future", async () => {
  // The boundary that matters: a decision stamped this morning must not be
  // refused because the server is already on tomorrow in UTC.
  const { deps, state } = harness();
  const out = await handleAgentReport(post(entry({ ts: new Date().toISOString() })), env, deps);
  assert.equal(out.status, 200, `today was refused: ${JSON.stringify(out.body)}`);
  assert.equal(state.rejects.length, 0);
});

test("a decline with no reasoning is refused", async () => {
  const { deps, state } = harness();
  const out = await handleAgentReport(
    post(entry({ tier2: { reasoning: "", actions: [] }, actions: [] })),
    env,
    deps,
  );
  assert.equal(out.body.why, REJECT.DECLINE_NO_REASON);
  assert.equal(state.rejects.length, 1);
});

test("a tool outside the known set is refused, not quietly dropped", async () => {
  // The dangerous one. This used to filter the list, so a decision claiming a
  // tool this site has never heard of published with fewer actions than the
  // agent reported, and the page showed a smaller true-looking version of
  // something false.
  const { deps, state } = harness();
  const out = await handleAgentReport(post(entry({ actions: ["rescore", "delete_the_corner"] })), env, deps);
  assert.equal(out.body.why, REJECT.UNKNOWN_TOOL);
  assert.equal(state.journal.length, 0, "a partial version must not be stored");
  assert.equal(state.rejects.length, 1);
});

test("decline is a known tool, because doing nothing is a decision", async () => {
  assert.ok(TOOLS.has("decline"));
  for (const t of ["rescore", "regenerate_letter", "reaudit_imagery", "flag"]) assert.ok(TOOLS.has(t));
});

test("a consequence this site cannot verify is refused", async () => {
  const { deps, state } = harness({ consequences: new Set() });
  const out = await handleAgentReport(
    post(entry({ actions: ["rescore"], tier2: { reasoning: "The score inputs moved.", actions: ["rescore"] } })),
    env,
    deps,
  );
  assert.equal(out.body.why, REJECT.UNVERIFIABLE_CONSEQUENCE);
  assert.equal(state.rejects.length, 1);
});

test("the same consequence is accepted once the site holds the artefact", async () => {
  const { deps, state } = harness({ consequences: new Set(["rescore"]) });
  const out = await handleAgentReport(
    post(entry({ actions: ["rescore"], tier2: { reasoning: "The score inputs moved.", actions: ["rescore"] } })),
    env,
    deps,
  );
  assert.equal(out.status, 200);
  assert.equal(state.journal.length, 1);
});

test("a duplicate decision id is accepted once and stored once", async () => {
  // The actor retries with backoff. A retry that lands twice would publish one
  // decision as two, and the restraint rate is a ratio over that count.
  const { deps, state } = harness();
  const first = await handleAgentReport(post(entry()), env, deps);
  const second = await handleAgentReport(post(entry()), env, deps);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true, "the second landing must say it was a duplicate");
  assert.equal(state.journal.length, 1, "one decision, one entry");
});

test("two different decisions at the same corner both store", async () => {
  const { deps, state } = harness();
  await handleAgentReport(post(entry({ decisionId: "run1:a" })), env, deps);
  await handleAgentReport(post(entry({ decisionId: "run2:b" })), env, deps);
  assert.equal(state.journal.length, 2);
});

// ==================================================================== helpers

test("pacificDay is the timezone every date claim on this site is about", () => {
  const d = pacificDay(Date.parse("2026-08-26T05:00:00Z")); // 22:00 on the 25th in PT
  assert.equal(d, "2026-08-25");
});

test("unverifiableConsequences names what is missing rather than how many", () => {
  const missing = unverifiableConsequences(["rescore", "flag"], new Set(["flag"]));
  assert.deepEqual(missing, ["rescore"]);
  assert.deepEqual(unverifiableConsequences([], new Set()), []);
});
