// The Corner Watchdog's ingest boundary.
//
// An autonomous agent running on Google Cloud writes here. That makes this the
// only endpoint on StreetCred that accepts facts from outside the building, so
// it is the only one that has to assume its caller is wrong or hostile.
//
// Two rails, deliberately independent of each other:
//
//   1. A bearer token nobody else holds. Without it the request dies at 401
//      having produced exactly one side effect: a counter. No IP, no body, no
//      echo of what was sent, because a detailed rejection is an oracle for
//      guessing the token.
//   2. Every number in an agent-written letter is checked against the corner's
//      own DataSF record before the letter is stored. The agent may declare it
//      verified its own output. That claim is recorded and then ignored in
//      favour of the arithmetic in this file. An agent allowed to mark its own
//      homework is not being supervised, and this product is an argument about
//      evidence before it is anything else.
//
// Nothing here calls a model, and nothing here calls DataSF directly. The
// router hands in the readers it already has, which keeps this file testable
// and keeps the two systems from ever disagreeing about a number.

import { buildInputSet, verifyLetter } from "./verify.js";
import { supervisorFor } from "./data.js";

export const AGENT_VERSION = "v1";

// The journal is the demo. It is also the only durable record of a decline,
// which is the outcome the whole design exists to make visible, so it is capped
// generously rather than tightly.
export const JOURNAL_CAP = 300;

const MAX_BODY = 64 * 1024;

const KINDS = new Set(["journal_entry", "rescore", "letter", "flag"]);
const ACTIONS = new Set(["rescore", "reaudit_imagery", "regenerate_letter", "flag"]);
const GRADES = new Set(["A", "B", "C", "D", "F"]);

// Every tool the agent may report having called, including the one that does
// nothing. `decline` is a tool here for the same reason it is a tool there: an
// agent that ends a deliberation by returning an empty list has not decided
// anything, and this endpoint refuses to record an absence as a decision.
export const TOOLS = new Set([...ACTIONS, "decline"]);

// Why an ingest was refused. Named rather than free text so /watchdog can group
// them and so a test can assert on the class rather than on a sentence.
export const REJECT = {
  UNKNOWN_CORNER: "unknown corner",
  FUTURE_DATE: "decided_at is in the future",
  DECLINE_NO_REASON: "decline carries no reasoning",
  UNKNOWN_TOOL: "tool outside the known set",
  UNVERIFIABLE_CONSEQUENCE: "claimed consequence this site cannot verify",
  DUPLICATE: "duplicate decision id",
  SHAPE: "malformed record",
};

// Today in Pacific, which is the timezone every date claim on this site is
// about. A decision stamped tomorrow is either a clock fault or a fabrication
// and neither belongs in a journal that reads as a record of what happened.
export function pacificDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function isFuture(ts, now = Date.now()) {
  if (!ts) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  return pacificDay(d.getTime()) > pacificDay(now);
}

// What the agent says it did, and whether this site can see it. A consequence
// is verifiable when the site holds the artefact the agent claims to have
// produced: a rescore it stored, a letter it stored, a flag it stored. An
// action claimed with nothing behind it is a promise, and a promise published
// as a decision is the thing this whole project argues against.
//
// `decline` and an empty action list are always verifiable, because the claim
// being made is that nothing happened, and nothing is what the site can see.
export function unverifiableConsequences(actions, seen) {
  return (actions || []).filter((a) => !seen.has(a));
}

// Length-independent comparison. Workers has no timingSafeEqual, so this is the
// honest version: fold every byte into an accumulator and compare once at the
// end. It leaks the length of the configured token and nothing else.
function tokenMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const str = (v, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v) => {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------------ numbers

// Deliberately not a second implementation. The serving path and this path call
// the same verifier over the same input set, because a rail the agent can route
// around is not a rail, and two verifiers that drift apart are worse than one.
// buildInputSet and verifyLetter both live in verify.js.

// ------------------------------------------------------------------ payloads

// Each shape is validated into a clean record rather than stored as received,
// so a field the agent invents cannot reach the page by riding along in the
// payload. Returns { error } or { record }.
function validate(kind, body) {
  const slug = str(body.slug, 80).replace(/[^A-Za-z0-9-]/g, "");
  const needsSlug = kind !== "journal_entry";
  if (needsSlug && !slug) return { error: "slug required" };

  if (kind === "journal_entry") {
    // An unknown tool is refused, not dropped.
    //
    // This used to filter the list, so a decision reporting a tool this site
    // has never heard of published as a decision with fewer actions than the
    // agent claimed. Silently agreeing with a caller about a smaller version of
    // what it said is the quietest way to publish something false.
    const claimed = Array.isArray(body.actions) ? body.actions.map((a) => str(a, 40)) : [];
    const unknown = claimed.filter((a) => !TOOLS.has(a));
    if (unknown.length) {
      return { error: `${REJECT.UNKNOWN_TOOL}: ${unknown.slice(0, 3).join(", ")}`, why: REJECT.UNKNOWN_TOOL };
    }
    const tool = str(body.tool, 40);
    if (tool && !TOOLS.has(tool)) {
      return { error: `${REJECT.UNKNOWN_TOOL}: ${tool}`, why: REJECT.UNKNOWN_TOOL };
    }
    const actions = [...new Set(claimed.filter((a) => ACTIONS.has(a)))];

    if (!str(body.tier1?.reason) && !str(body.tier2?.reasoning)) {
      return { error: "an entry must carry a reason from at least one tier", why: REJECT.SHAPE };
    }

    // A decline is the outcome this whole page exists to make legible, and a
    // decline with no reasoning is indistinguishable from a lane that fell over.
    // Deliberated means tier two answered; the reasoning is what it answered.
    const declined = Boolean(body.tier2) && actions.length === 0;
    if (declined && !str(body.tier2?.reasoning)) {
      return { error: REJECT.DECLINE_NO_REASON, why: REJECT.DECLINE_NO_REASON };
    }
    if (tool === "decline" && !str(body.tier2?.reasoning) && !str(body.tier1?.reason)) {
      return { error: REJECT.DECLINE_NO_REASON, why: REJECT.DECLINE_NO_REASON };
    }

    const ts = str(body.ts, 40) || str(body.decided_at, 40) || new Date().toISOString();
    if (isFuture(ts)) {
      return { error: `${REJECT.FUTURE_DATE}: ${ts}`, why: REJECT.FUTURE_DATE };
    }

    return {
      record: {
        // The agent's own id for this decision, which is what makes a repost
        // idempotent. Derived here when absent so an older agent build still
        // gets deduplicated on the fields it does send.
        decisionId:
          str(body.decisionId, 120) ||
          `${str(body.runId, 60) || "norun"}:${slug || "noslug"}:${ts}`,
        ts,
        tool: tool || (actions.length ? actions[0] : declined ? "decline" : null),
        // Which tier settled it, in the vocabulary the brief asked for. byRule
        // means the deterministic floor answered before any tier was consulted.
        tier: body.tier1?.byRule ? "rule" : body.tier2 ? "judgment" : "reflex",
        // What ran, structured rather than buried in the degraded sentence, so
        // the inspector can render it without parsing prose.
        model: str(body.model, 80) || null,
        modelVersion: str(body.modelVersion, 40) || null,
        latencyMs: int(body.latencyMs),
        cost: body.cost && typeof body.cost === "object" ? body.cost : null,
        runId: str(body.runId, 60) || null,
        slug: slug || null,
        name: str(body.name, 120) || null,
        delta: str(body.delta, 600),
        trigger: str(body.trigger, 40) || "unknown",
        tier1: {
          significant: Boolean(body.tier1?.significant),
          reason: str(body.tier1?.reason, 600),
          // A rule firing before any model is consulted is the deterministic
          // floor, and the diary says so rather than crediting a model.
          byRule: Boolean(body.tier1?.byRule),
          confidence: typeof body.tier1?.confidence === "number" ? body.tier1.confidence : null,
        },
        // Absent when the reflex tier declined, which is the common case and
        // the one the restraint rate is counting.
        tier2: body.tier2
          ? { reasoning: str(body.tier2.reasoning, 1200), actions }
          : null,
        actions,
        // An intent is an action the budget refused. Journaled, never hidden.
        intents: Array.isArray(body.intents)
          ? body.intents.map((i) => str(i, 120)).filter(Boolean).slice(0, 6)
          : [],
        degraded: str(body.degraded, 300) || null,
      },
    };
  }

  if (kind === "rescore") {
    const index = int(body.index);
    const grade = str(body.grade, 1).toUpperCase();
    if (index === null || index < 0 || index > 100) return { error: "index must be 0 to 100" };
    if (!GRADES.has(grade)) return { error: "grade must be one of A B C D F" };
    return { record: { slug, index, grade, at: new Date().toISOString() } };
  }

  if (kind === "letter") {
    const text = str(body.text, 8000);
    if (text.length < 40) return { error: "letter text too short to verify" };
    return { record: { slug, text, claimedVerified: Boolean(body.verified) } };
  }

  if (kind === "flag") {
    const reason = str(body.reason, 600);
    if (!reason) return { error: "flag requires a reason" };
    return { record: { slug, reason, at: new Date().toISOString() } };
  }

  return { error: "unknown kind" };
}

// ------------------------------------------------------------------ handler

// deps supplies the readers the router already owns: statsFor, scoreFor,
// cornerFor, timelineFor, and the four store writers. Injected rather than
// imported so this file never reaches back into the entry module.
export async function handleAgentReport(request, env, deps) {
  const expected = env.WATCHDOG_INGEST_TOKEN;

  // A missing secret means the endpoint is shut, never that it is open. A
  // deploy that forgets the binding must not silently publish a write path.
  if (!expected) {
    await deps.countReject(env);
    return { status: 503, body: { error: "ingest not configured" } };
  }

  const auth = request.headers.get("authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!tokenMatches(given, expected)) {
    await deps.countReject(env);
    return { status: 401, body: { error: "unauthorized" } };
  }

  if (request.method !== "POST") return { status: 405, body: { error: "POST only" } };

  const raw = await request.text();
  if (raw.length > MAX_BODY) return { status: 413, body: { error: "payload too large" } };

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: "invalid json" } };
  }

  const kind = str(body?.kind, 40);
  if (!KINDS.has(kind)) {
    return { status: 400, body: { error: `kind must be one of ${[...KINDS].join(", ")}` } };
  }

  // Every refusal from here down is stored with its reason and published on
  // /watchdog. A rejection nobody can read is a rejection nobody can check, and
  // this endpoint is the one place on the site that accepts facts from outside.
  const refuse = async (why, detail, extra = {}) => {
    await deps.recordReject(env, {
      at: new Date().toISOString(),
      kind,
      why,
      detail: str(detail, 300),
      slug: str(body?.slug, 80) || null,
      decisionId: str(body?.decisionId, 120) || null,
      ...extra,
    });
    return { status: 400, body: { accepted: false, error: detail, why } };
  };

  const v = validate(kind, body);
  if (v.error) return await refuse(v.why || REJECT.SHAPE, v.error);
  const record = v.record;

  if (kind === "journal_entry") {
    // The corner has to be one this site knows. An entry about a slug that
    // resolves to nothing is a decision about a street that, as far as this
    // product is concerned, does not exist, and it would render as a dead link
    // beside real ones.
    if (record.slug) {
      const known = await deps.cornerFor(record.slug).catch(() => null);
      if (!known) return await refuse(REJECT.UNKNOWN_CORNER, `${REJECT.UNKNOWN_CORNER}: ${record.slug}`);
    }

    // Idempotent on the agent's own decision id. The actor retries with backoff
    // and a retry that lands twice would publish one decision as two, which
    // moves the restraint rate.
    const existing = await deps.journalEntries(env).catch(() => []);
    if (record.decisionId && existing.some((e) => e.decisionId === record.decisionId)) {
      return {
        status: 200,
        body: { accepted: true, duplicate: true, kind, decisionId: record.decisionId },
      };
    }

    // A claimed consequence this site cannot see is not published as one. The
    // artefacts it can see are the ones it stored itself.
    if (record.actions.length) {
      const seen = await deps.consequencesFor(env, record.slug).catch(() => new Set());
      const missing = unverifiableConsequences(record.actions, seen);
      if (missing.length) {
        return await refuse(
          REJECT.UNVERIFIABLE_CONSEQUENCE,
          `${REJECT.UNVERIFIABLE_CONSEQUENCE}: ${missing.join(", ")}`,
        );
      }
    }

    const entry = await deps.appendJournal(env, record);
    return { status: 200, body: { accepted: true, kind, entries: entry.count, decisionId: record.decisionId } };
  }

  if (kind === "rescore") {
    await deps.putAgentRescore(env, record);
    return { status: 200, body: { accepted: true, kind, slug: record.slug, index: record.index } };
  }

  if (kind === "flag") {
    await deps.putAgentFlag(env, record);
    return { status: 200, body: { accepted: true, kind, slug: record.slug } };
  }

  // letter. The expensive path, and the only one that can be rejected on the
  // content of what it carries rather than on its shape.
  const [stats, score, corner, timeline] = await Promise.all([
    deps.statsFor(record.slug).catch(() => null),
    deps.scoreFor(record.slug).catch(() => null),
    deps.cornerFor(record.slug).catch(() => null),
    deps.timelineFor(record.slug).catch(() => null),
  ]);

  // No record to check against is not permission to skip checking. A corner
  // this instance has never resolved cannot ground anybody's arithmetic.
  if (!stats) {
    return { status: 409, body: { error: "no stats for this corner, cannot verify", accepted: false } };
  }

  const inputSet = buildInputSet({
    corner,
    stats,
    score,
    timeline,
    // The agent posts no press lane of its own, so any domain it cites is
    // unsourced by definition and the verifier will say so.
    news: null,
    // Same argument, and it now has teeth: with no voices lane, a letter the
    // agent submits that describes resident accounts is describing a lane it
    // never ran.
    voices: null,
    // The agent posts no hazards lane either, so any audit figure it cites is
    // unsourced by the same argument.
    hazards: null,
    supervisor: stats?.district ? supervisorFor(stats.district) : null,
  });
  const check = verifyLetter(record.text, inputSet);

  await deps.putAgentLetter(env, {
    slug: record.slug,
    text: record.text,
    verified: check.ok,
    claimedVerified: record.claimedVerified,
    // Recorded when the agent's self-assessment and this file's arithmetic
    // disagree. A run of these is the most interesting number in the project.
    selfReportDisputed: record.claimedVerified !== check.ok,
    failures: check.failures.slice(0, 8),
    numbersChecked: check.checked.numbers,
    at: new Date().toISOString(),
  });

  return {
    status: 200,
    body: {
      accepted: true,
      kind,
      slug: record.slug,
      verified: check.ok,
      numbersChecked: check.checked.numbers,
      failures: check.failures.slice(0, 8),
      selfReportDisputed: record.claimedVerified !== check.ok,
    },
  };
}

// ------------------------------------------------------------------ readout

// Both public stats, computed from the journal and nowhere else, so anyone can
// recount them from /api/agent/journal.
export function journalStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const evaluated = list.length;
  const escalated = list.filter((e) => e.tier1?.significant).length;
  const acted = list.filter((e) => (e.actions || []).length > 0).length;
  const declined = list.filter((e) => e.tier2 && (e.actions || []).length === 0).length;
  const byRule = list.filter((e) => e.tier1?.byRule).length;
  const intents = list.filter((e) => (e.intents || []).length > 0).length;

  return {
    evaluated,
    escalated,
    acted,
    declined,
    byRule,
    intents,
    // Share of evaluations that ended in no action at all. Presented as the
    // headline because an agent that acts on everything is not deciding.
    restraintPct: evaluated ? Math.round((100 * (evaluated - acted)) / evaluated) : null,
    // Of the deltas the reflex escalated, how many the judgment tier agreed
    // were worth acting on. Rises when triage gets better at the middle.
    precisionPct: escalated ? Math.round((100 * acted) / escalated) : null,
  };
}
