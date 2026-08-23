// Promote enriched corners by generating their proposed-fix render.
//
// Runs on a maintainer's machine against Vertex under Application Default
// Credentials. The Worker holds no model credential and is not involved.
//
//   node tools/promote_corners.mjs --plan
//   node tools/promote_corners.mjs --generate --n=7
//   node tools/promote_corners.mjs --publish
//
// The full lane, which is what the morning cron runs and what earns AUDITED:
//
//   node tools/promote_corners.mjs --full --plan --n=25
//   node tools/promote_corners.mjs --full --generate --n=25
//   node tools/promote_corners.mjs --full --publish
//
// --full runs the visual audit on the frame (the same prompt and schema the
// Worker's src/hazards.js asks, through Vertex under ADC because the Worker's
// own key path is billing-blocked), the record corroboration, the hazards
// overlay render and the proposed-fix render, each through the legibility gate.
// A corner that completes all three is written with provenance "audited" and
// moved onto the audited roster, exactly as the cron does it. A corner that
// passes only a render stays "promoted-from-enriched". A corner that passes
// nothing publishes nothing. The pool widens to every corner with a stored
// Street View frame, enriched or scored, worst first by the board's own points;
// a scored corner is promoted into a stored record first, which is the same
// step the cron takes before it audits (HANDOFF gotcha 16).
//
// Idempotent and skip-existing by construction: a corner that already has a
// stored fix render is never regenerated and never overwritten. The 23 audited
// corners keep the renders they have.
//
// The render is gated on text survival. An image model that corrupts a street
// name plate or the Google watermark has produced a photograph of a named
// intersection carrying a fabricated sign, which is the failure that killed the
// Workers AI pilot and is not a vendor problem. See tools/lib/legibility.mjs for
// why the gate is paired against the source frame rather than absolute.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkLegibility, ocr, REGIONS } from "./lib/legibility.mjs";
import { kvEnv } from "./lib/kvenv.mjs";
import { cityCornerFor } from "../src/city.js";
import { CORNERS, canonicalSlug } from "../src/data.js";
import { HAZARD_VERSION, AUDIT_PROMPT, AUDIT_SCHEMA, flagsFrom, evidenceFor, assemble } from "../src/hazards.js";
import { HAZARD_PROMPT, AUDITED } from "../src/imagery.js";
import { computeScore, SCORE_VERSION } from "../src/score.js";
import { getStats } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(ROOT, "scratch", "imagery");
const FRAMES = join(STAGE, "frames");
// Frames the city fetch staged (tools/fetch_frames.mjs). Read before KV, so a
// frame that is staged but not yet published can still condition a render.
const CITY_FRAMES = join(ROOT, "scratch", "frames");
const HAZARDS_STAGE = join(ROOT, "scratch", "hazards");
const CORNERS_STAGE = join(ROOT, "scratch", "corners");
const SCORES_STAGE = join(ROOT, "scratch", "scores");
const OCRDIR = join(ROOT, "scratch", "ocr");
const GCLOUD = process.env.GCLOUD_BIN || "/opt/homebrew/share/google-cloud-sdk/bin/gcloud";

const PROJECT = process.env.VERTEX_PROJECT || "streetcred-506117";
// The image model serves on the GLOBAL endpoint, not us-central1. Probed
// 2026-08-20: locations/global answers 200, us-central1 answers 404. The
// publisher-models listing shows it in both, which is why the listing cannot be
// used to decide availability.
const LOCATION = "global";
const MODEL = process.env.VERTEX_IMAGE_MODEL || "gemini-3.1-flash-image";
const VERTEX_URL =
  `https://aiplatform.googleapis.com/v1/projects/${PROJECT}` +
  `/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`;

// The audit model. The Worker asks gemini-3.7-flash through its own key path.
// On Vertex in this project every 3.x text model answers 404 (re-probed
// 2026-08-22 on both global and us-central1: 3.7-flash, 3.1-flash-lite and
// 3-flash-preview all NOT_FOUND; 2.5-flash answers). Same deviation the letter
// fleet records in tools/generate_letters.mjs, stated rather than silently
// applied, and the model is written into every hazards record this produces.
const AUDIT_LOCATION = process.env.VERTEX_REGION || "us-central1";
const AUDIT_MODEL = process.env.VERTEX_AUDIT_MODEL || "gemini-2.5-flash";
const AUDIT_URL =
  `https://aiplatform.googleapis.com/v1/projects/${PROJECT}` +
  `/locations/${AUDIT_LOCATION}/publishers/google/models/${AUDIT_MODEL}:generateContent`;

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argOf = (n, d) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const N = Number(argOf("n", "7"));
const DO_GENERATE = has("--generate");
const DO_PUBLISH = has("--publish");
const DO_FULL = has("--full");
// Which corners may be picked. "enriched" is the original pool; "framed" is
// every corner with a stored Street View frame, enriched or scored. The full
// lane defaults to the wider pool because that is where the unworked head of
// the queue is; the render-only lane keeps its original pool.
const POOL = argOf("pool", DO_FULL ? "framed" : "enriched");
// A corner the preflight has already refused is a decided verdict, not a
// candidate: the frame is fixed, tesseract is deterministic, and re-picking it
// fills a batch slot with a hold that costs nothing and audits nothing. Pass
// --retry-held to re-pick them anyway, after a frame has been re-fetched.
const RETRY_HELD = has("--retry-held");
// Fill the batch with corners the preflight can check, rather than with the
// next N by rank. The preflight is the pipeline's own first gate (see
// sourceIsCheckable); applying it at selection time gives the same verdict a
// slot earlier, and every corner it refuses on the way is recorded as a held
// outcome at no cost, with the reason and the unblock. Without this, a run
// over the head of the queue on 2026-08-22 would have refused 17 of 25 slots
// before spending and attempted 8.
const ATTEMPTABLE = has("--attemptable");
// Lane-level skip-existing, for resuming a full-lane batch that lost some
// lanes to a fault. A staged hazards record is a bought audit and a staged
// hazards render is a bought render: with --topup the run reuses both from
// the prior row and buys only what is missing, which is the same rule
// skip-existing already applies to a staged fix render.
const TOPUP = has("--topup");
// Corners excluded by a standing ruling rather than by the pipeline, named on
// the command line so the exclusion is in the run log and not in the code.
const SKIP = (argOf("skip", "") || "").split(",").map((x) => x.trim()).filter(Boolean);

// Ours, not Cloudflare's: the public daily image cap the Worker enforces. An
// offline run must not quietly exceed what the site would allow itself.
const DAILY_GENERATION_CAP = 25;

// Cloudflare's own message for a spent daily KV write allowance, which is
// account wide on the free plan and resets at 00:00 UTC. An ordinary operating
// condition, not a fault, and worth recognising by name so the tool can say so
// instead of surfacing a stringified stderr dump.
export const KV_CAP_SPENT = /free usage limit for this operation|code: *10048/i;

// Retry shape. MAX_ATTEMPTS covers both a legibility retry and a quota retry,
// which is why it is 3 rather than 2: a corner that loses one attempt to a rate
// window still gets its two real tries at the gate.
const MAX_ATTEMPTS = Number(process.env.RENDER_MAX_ATTEMPTS || 3);
const SPACING_MS = Number(process.env.RENDER_SPACING_MS || 20_000);

// A named subset, for retrying exactly the corners a quota window cost without
// paying again for the ones that already published.
const ONLY = (argOf("only", "") || "").split(",").map((x) => x.trim()).filter(Boolean);

// Transient CLI failures are retried; a refused write is not. Under load this
// CLI returns 401 Unauthorized and 5xx on calls that succeed a second later
// (tools/lib/kvenv.mjs records the same), and one such answer used to end a
// fifty-minute plan with a stack trace. The daily-cap refusal and a 404 are
// answers, and pass straight through.
const TRANSIENT = /401: Unauthorized|5\d\d:|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i;
const kv = (a, tries = 3) => {
  for (let i = 1; ; i += 1) {
    try {
      return execFileSync("npx", ["wrangler", ...a], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 600_000,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const msg = String(e.stderr || e.message || e);
      if (i < tries && TRANSIENT.test(msg) && !KV_CAP_SPENT.test(msg)) {
        const wait = 2000 * i;
        console.log(`      wrangler: transient failure on ${a.slice(0, 4).join(" ")}, retrying in ${wait / 1000}s`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
        continue;
      }
      throw e;
    }
  }
};

// Binary safe. The text helper above decodes as utf8, which silently mangles a
// JPEG; the frames have to come back as raw bytes and be written by us. An
// earlier version called wrangler and discarded the output entirely, which
// presented as every corner skipping for "no frame" while spending nothing.
function kvBytes(key) {
  return execFileSync("npx", ["wrangler", "kv", "key", "get", key, "--binding", "STORE", "--remote"], {
    cwd: ROOT,
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function mintToken() {
  return execFileSync(GCLOUD, ["auth", "application-default", "print-access-token"], {
    encoding: "utf8",
    timeout: 120_000,
  }).trim();
}

// An ADC access token lives about an hour. The 2026-08-22 batch minted one at
// the top and ran for four hours: every model call after minute sixty was
// refused "invalid authentication credentials", and 22 of 25 corners lost
// their renders to a credential that had simply aged out. Minted on demand
// now, re-minted at 45 minutes, and dropped on the first auth refusal so the
// retry runs on a fresh one.
const TOKEN_LIFE_MS = 45 * 60 * 1000;
let TOKEN = { value: null, at: 0 };
function accessToken() {
  if (!TOKEN.value || Date.now() - TOKEN.at > TOKEN_LIFE_MS) {
    TOKEN = { value: mintToken(), at: Date.now() };
    console.log(`      ADC token minted, ${TOKEN.value.length} chars, not stored`);
  }
  return TOKEN.value;
}
export const AUTH_STALE = /invalid authentication|UNAUTHENTICATED|ACCESS_TOKEN_EXPIRED|401/i;
function dropToken() {
  TOKEN = { value: null, at: 0 };
}

// ------------------------------------------------------------------ pool

// Eligible: enriched, has a stored Street View frame to condition on, and has
// NO stored fix render. Worst first by the same points the board ranks on.
// Can this corner's render ever be verified?
//
// The gate is PAIRED: it compares each region on the render against the same
// region on the source frame, and reports "unchecked" wherever the source was
// not legible. So a corner whose source frame reads nothing in every region can
// never produce a passing render. Not "is unlikely to": cannot. The source is
// fixed in KV and tesseract is deterministic, so the verdict is decided before
// a single token is spent.
//
// 6th-and-mission is exactly that corner. Its source watermark reads nothing
// and its signage band reads OCR noise, so both signals abstain and the gate
// returns "abstain" no matter what the model draws. It was re-rendered twice on
// 2026-08-20 and held both times, and a third render would have held too.
//
// Refusing here turns money into a sentence. The corner is not broken and the
// model is not at fault: the SOURCE PHOTOGRAPH is unreadable, and the fix is a
// better Street View frame, not another render.
export function sourceIsCheckable(before, expectStreets) {
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const watermark = norm(before?.watermark).includes("google");
  const street = (expectStreets || []).some((n) => norm(before?.signage).includes(norm(n)));
  return {
    checkable: watermark || street,
    watermark,
    street,
    why: watermark || street
      ? ""
      : "the source frame is unreadable in every checked region, so no render of it can be verified; " +
        "re-fetch the Street View frame rather than re-rendering",
  };
}

// Exponential backoff with a floor, for a quota that is a short rate window
// rather than a daily cap. Probed 2026-08-20: a call that returned RESOURCE
// EXHAUSTED succeeded on a later attempt with no quotaId in the error, which is
// the signature of a per-minute limit and not an allowance that is gone.
export const backoffMs = (attempt, base = 20_000, cap = 240_000) =>
  Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------- the render log, accumulated
//
// Two files, for the same reason the letter fleet keeps two. `_results.json` is
// per corner state, latest run wins. `_runs.json` is append only, one entry per
// invocation, and it is where spend lives: token counts are only knowable while
// the response is in hand, and a corner re-rendered tomorrow does not unspend
// the calls made on it today.

const RENDER_RESULTS = join(STAGE, "_results.json");
const RENDER_RUNS = join(STAGE, "_runs.json");

export function readRenderResults() {
  try {
    return JSON.parse(readFileSync(RENDER_RESULTS, "utf8"));
  } catch {
    return [];
  }
}

export function readRenderRuns() {
  try {
    return JSON.parse(readFileSync(RENDER_RUNS, "utf8"));
  } catch {
    return [];
  }
}

export function mergeRenderResults(prior, fresh) {
  const by = new Map((prior || []).map((r) => [r.slug, r]));
  for (const row of fresh || []) {
    const was = by.get(row.slug);
    by.set(row.slug, was ? { ...row, rerenders: (was.rerenders || 0) + 1 } : row);
  }
  return [...by.values()].sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
}

function appendRenderRun(entry) {
  const all = readRenderRuns();
  all.push(entry);
  writeFileSync(RENDER_RUNS, JSON.stringify(all, null, 2));
}

// Which staged files become KV entries.
//
// The same guarantee stagedLetterFiles gives the letter fleet, for the same
// reason. A render that passed the gate is written to `{slug}.fix.jpg`; a
// render that was held leaves `{slug}.attempt1.jpg` and `{slug}.attempt2.jpg`
// behind for diagnosis and no `.fix.jpg` at all. Selecting on that suffix is
// what makes "a held render cannot publish" structural rather than a promise
// that the loop above got its branches right.
//
// The leading-dot and leading-underscore exclusions are not decoration either.
// The letter publish path carried a hand-rolled copy of its own filter that
// omitted the dot check, and on its first real run it published 11 of the
// tool's own scratch files to KV as letters. One filter, exported, tested, and
// called by the publish path itself.
export function stagedRenderFiles(names) {
  return (names || []).filter(
    (f) => f.endsWith(".fix.jpg") && !f.startsWith(".") && !f.startsWith("_"),
  );
}

export const slugOfRender = (f) => f.replace(/\.fix\.jpg$/, "");

// The imgstatus record a promoted render produces, merged onto whatever the
// corner already had.
//
// Merged, not replaced: a corner that somehow already carries a hazards state
// must not lose it because a fix render published. And `states` is a set, so
// republishing the same render twice cannot produce ["fix","fix"].
export function promotedStatus(existing, { at, model, via, attempt, usd, gate }) {
  const prior = existing && typeof existing === "object" ? existing : {};
  const states = [...new Set([...(Array.isArray(prior.states) ? prior.states : []), "fix"])];
  return {
    ...prior,
    status: "ready",
    states,
    at: at ?? Date.now(),
    // The whole point of the field. A corner promoted out of the enriched pool
    // is not audited and must never read as audited, whatever its imagery says.
    provenance: "promoted-from-enriched",
    // Per image attribution, written in the same record as the provenance so
    // the two can never disagree about the same render.
    render: {
      ...(prior.render && typeof prior.render === "object" ? prior.render : {}),
      fix: {
        model,
        via,
        attempt: attempt ?? null,
        at: new Date(at ?? Date.now()).toISOString(),
        usd: usd ?? 0,
        // What the legibility gate actually checked, kept beside the image. A
        // render that passed because nothing was checkable is a different fact
        // from one that passed a watermark comparison, and the record says which.
        gateChecked: gate?.checked || [],
        gateUnchecked: gate?.unchecked || [],
        gateVerdict: gate?.verdict || null,
      },
    },
  };
}

// Staged file selection for the other generated state. Same rule, same
// reason: a held hazards render never gets a `.hazards.jpg`.
export function stagedHazardFiles(names) {
  return (names || []).filter(
    (f) => f.endsWith(".hazards.jpg") && !f.startsWith(".") && !f.startsWith("_"),
  );
}
export const slugOfHazardRender = (f) => f.replace(/\.hazards\.jpg$/, "");

// One attribution block per render, the same shape promotedStatus writes for
// the fix render, so the two states of one corner are described the same way.
function renderAttribution(prior, { model, via, attempt, at, usd, gate }) {
  return {
    ...(prior && typeof prior === "object" ? prior : {}),
    model,
    via,
    attempt: attempt ?? null,
    at: new Date(at ?? Date.now()).toISOString(),
    usd: usd ?? 0,
    gateChecked: gate?.checked || [],
    gateUnchecked: gate?.unchecked || [],
    gateVerdict: gate?.verdict || null,
  };
}

// The imgstatus record for a corner that completed the full lane: the visual
// audit ran and produced a record, and BOTH generated states passed the gate.
//
// This is the only place in the offline tooling that may write provenance
// "audited", and it refuses unless all three are present. The cron's rule for
// the audited roster is "both generated states exist as bytes"; this is that
// rule plus the audit itself, which is stricter and never looser. A caller
// with a fix render and no hazards render gets promotedStatus, not this.
export function fullLaneStatus(existing, { at, model, via, fix, hazards, audit }) {
  if (!fix || !hazards || !audit?.ok) {
    throw new Error("fullLaneStatus requires a passed fix render, a passed hazards render and a completed audit");
  }
  const prior = existing && typeof existing === "object" ? existing : {};
  const states = [...new Set([...(Array.isArray(prior.states) ? prior.states : []), "hazards", "fix"])];
  const priorRender = prior.render && typeof prior.render === "object" ? prior.render : {};
  return {
    ...prior,
    status: "ready",
    states,
    at: at ?? Date.now(),
    provenance: AUDITED,
    // Which lane produced this. The cron leaves no such field because the
    // cron is the default; a batch says so, so a reader of the record knows
    // the audit was an operator-authorized batch and not the unattended
    // morning, and the audited index can label its date accordingly.
    lane: "batch-full",
    audit: {
      model: audit.model,
      via: audit.via,
      at: audit.at,
      version: HAZARD_VERSION,
    },
    render: {
      ...priorRender,
      hazards: renderAttribution(priorRender.hazards, { model, via, at, ...hazards }),
      fix: renderAttribution(priorRender.fix, { model, via, at, ...fix }),
    },
  };
}

// A corner that passed one render but did not complete the lane. Promoted, by
// the same rule as a fix-only promotion: it has a render and no audit, and it
// must never read as audited. `states` names which renders passed.
export function partialStatus(existing, { at, model, via, fix, hazards }) {
  if (!fix && !hazards) throw new Error("partialStatus needs at least one passed render");
  const prior = existing && typeof existing === "object" ? existing : {};
  const had = Array.isArray(prior.states) ? prior.states : [];
  const states = [...new Set([...had, ...(hazards ? ["hazards"] : []), ...(fix ? ["fix"] : [])])];
  const priorRender = prior.render && typeof prior.render === "object" ? prior.render : {};
  return {
    ...prior,
    status: "ready",
    states,
    at: at ?? Date.now(),
    provenance: "promoted-from-enriched",
    render: {
      ...priorRender,
      ...(hazards ? { hazards: renderAttribution(priorRender.hazards, { model, via, at, ...hazards }) } : {}),
      ...(fix ? { fix: renderAttribution(priorRender.fix, { model, via, at, ...fix }) } : {}),
    },
  };
}

// Decide a corner's published status from its run row and what is staged.
// Returns { kind: "audited" | "promoted" | null, status }.
export function statusFor(existing, row, staged, base) {
  const fixOk = staged.fix && row?.state === "passed";
  const hazOk = staged.hazards && row?.hazardsRender?.state === "passed";
  const auditOk = Boolean(row?.audit?.ok);
  if (fixOk && hazOk && auditOk) {
    return {
      kind: "audited",
      status: fullLaneStatus(existing, {
        ...base,
        fix: { attempt: row.attempt, usd: row.fixUsd ?? row.usd, gate: row.gate },
        hazards: { attempt: row.hazardsRender.attempt, usd: row.hazardsRender.usd, gate: row.hazardsRender.gate },
        audit: row.audit,
      }),
    };
  }
  if (fixOk || hazOk) {
    return {
      kind: "promoted",
      status: partialStatus(existing, {
        ...base,
        fix: fixOk ? { attempt: row.attempt, usd: row.fixUsd ?? row.usd, gate: row.gate } : null,
        hazards: hazOk ? { attempt: row.hazardsRender.attempt, usd: row.hazardsRender.usd, gate: row.hazardsRender.gate } : null,
      }),
    };
  }
  return { kind: null, status: null };
}

// The render ledger: one record holding a line per render.
//
// Deliberately its own key rather than a section of budget:gemini. That record
// is written by tools/generate_letters.mjs, and having two tools write two
// halves of one value is how one of them ends up clobbering the other's half.
// Both derive from the same scratch/imagery/_results.json, so they cannot
// disagree about the totals.
export function buildRenderLedger(rows, opts = {}) {
  const src = rows || [];
  const spend = imagerySpend(src) || {
    model: opts.model || MODEL,
    via: `vertex:${opts.location || LOCATION}`,
    attempted: 0, published: 0, held: 0, heldOnGate: 0, heldOnApi: 0,
    promptTokens: 0, outputTokens: 0, estUsd: 0,
    basis: "estimated from token counts; held renders are counted, because they were billed",
  };
  // Money comes from the run log when one is supplied, not from the per corner
  // rows. A row only ever holds the most recent run's figures for a corner, so
  // summing rows forgets every call an earlier pass paid for on a corner that
  // was later re-rendered. larkin-and-myrtle is exactly that corner: held on a
  // quota refusal at 00:20 and re-rendered at 05:54, billed both times.
  const runs = opts.runs || null;
  const money = runs
    ? {
        estUsd: Math.round(runs.reduce((a, r) => a + (r.estUsd || 0), 0) * 1e6) / 1e6,
        promptTokens: runs.reduce((a, r) => a + (r.promptTokens || 0), 0),
        outputTokens: runs.reduce((a, r) => a + (r.outputTokens || 0), 0),
      }
    : {};
  return {
    ...spend,
    ...money,
    ...(runs
      ? {
          runs: runs.map((r) => ({ at: r.at, label: r.label, corners: r.corners, estUsd: r.estUsd, ...(r.note ? { note: r.note } : {}) })),
        }
      : {}),
    updated: opts.now || new Date().toISOString(),
    project: opts.project || PROJECT,
    auth: "application default credentials, no api key",
    provenance: "promoted-from-enriched",
    // A line per render, held ones included, because a held render was billed
    // and a ledger that lists only what shipped makes the gate look free.
    perRender: src.map((r) => ({
      slug: r.slug,
      state: r.state,
      attempt: r.attempt ?? null,
      usd: r.usd ?? 0,
      why: r.state === "held" ? String(r.why || "").slice(0, 200) : undefined,
      // The full lane's other two results, when the row ran it. Absent on a
      // render-only row rather than null, so an old ledger line and a new one
      // read the same where they mean the same.
      ...(r.lane === "full"
        ? {
            lane: "full",
            hazards: r.hazardsRender
              ? { state: r.hazardsRender.state, attempt: r.hazardsRender.attempt ?? null, usd: r.hazardsRender.usd ?? 0, why: r.hazardsRender.state === "held" ? String(r.hazardsRender.why || "").slice(0, 200) : undefined }
              : null,
            audit: r.audit ? { ok: Boolean(r.audit.ok), model: r.audit.model ?? null, usd: r.audit.usd ?? 0, why: r.audit.ok ? undefined : String(r.audit.why || "").slice(0, 200) } : null,
          }
        : {}),
    })),
  };
}

// What the render stage cost, for the letter ledger to carry.
//
// A held render is a paid render. The model was called, the tokens were spent,
// and the gate rejected what came back: reporting only the published ones would
// make the gate look free. `published` is what a visitor can actually see, and
// it is deliberately a different number from `attempted`.
export function imagerySpend(rows) {
  const src = rows || [];
  if (!src.length) return null;
  const spent = src.reduce((a, r) => a + (r.usd || 0), 0);
  const held = src.filter((r) => r.state === "held");
  // When these renders were attempted. The block used to carry counts and
  // dollars with no timestamp at all, sitting inside a ledger whose `period` is
  // a calendar month, so nothing on the record said which day the money was
  // spent. Read off the run rows rather than stamped at read time, because the
  // question is when the calls happened and not when the ledger was rebuilt.
  const stamps = src.map((r) => r.at || r.regatedAt).filter(Boolean).sort();
  return {
    model: MODEL,
    via: `vertex:${LOCATION}`,
    at: stamps.length ? stamps[stamps.length - 1] : null,
    attempted: src.length,
    published: src.filter((r) => r.state === "passed").length,
    held: held.length,
    // Why they were held, split, because a render the gate rejected and a
    // render the API never returned are different findings and only one of them
    // is about the image.
    heldOnGate: held.filter((r) => !/render error/i.test(String(r.why || ""))).length,
    heldOnApi: held.filter((r) => /render error/i.test(String(r.why || ""))).length,
    promptTokens: src.reduce((a, r) => a + (r.promptTokens || 0), 0),
    outputTokens: src.reduce((a, r) => a + (r.outputTokens || 0), 0),
    estUsd: Math.round(spent * 1e6) / 1e6,
    basis: "estimated from token counts; held renders are counted, because they were billed",
  };
}

export function eligible(meta, keyNames, sweepRows, limit, only = [], stagedSlugs = [], opts = {}) {
  const enr = new Set(meta.enriched || []);
  const aud = new Set(meta.audited || []);
  const today = new Set(keyNames.filter((n) => /^img:.+:today$/.test(n)).map((n) => n.split(":")[1]));
  // Frames the city fetch staged but has not published yet count as stored
  // for the purpose of picking: the bytes exist and will condition the render.
  for (const s of opts.stagedFrames || []) today.add(s);
  const fix = new Set(keyNames.filter((n) => /^img:.+:fix$/.test(n)).map((n) => n.split(":")[1]));
  // Skip-existing has to mean the staging directory too, not only KV.
  //
  // The skip was written against stored renders, which is right until a publish
  // window closes. With KV writes spent, four renders sat on disk paid for and
  // unpublished, and the next run would have regenerated every one of them
  // because KV had not heard about them yet. A render this tool has already
  // bought is a render it must not buy again.
  const staged = new Set(stagedSlugs);
  // A verdict the preflight already gave. Excluded unless the caller asks for
  // them back, because the frame that produced the verdict has not changed.
  const decided = new Set(opts.decided || []);
  // The wider pool: every framed corner that is not already audited. The
  // enriched roster is always in; scored corners join when the caller supplies
  // them (from img:index, the staged city frames, or both).
  const base = opts.pool === "framed"
    ? new Set([...enr, ...(opts.framed || [])].filter((s) => !aud.has(s)))
    : enr;
  // A flagship alias is the same crossing as a registry corner that is
  // already audited: 16th-and-mission is 16th-mission under its sweep name.
  // Rendering it would put a second audited page on one crossing. A shard row
  // marked alias is the same thing for a slug collision.
  const aliased = (s) => canonicalSlug(s) !== s || Boolean(sweepRows[s]?.alias);
  const pool = [...base].filter((s) => today.has(s) && !fix.has(s) && !staged.has(s) && !decided.has(s) && !aliased(s));
  // A named subset picks out of the SAME pool rather than around it. The skip
  // on an existing fix render is what makes this tool idempotent, and a retry
  // must not be able to overwrite a render that already published.
  if (only.length) {
    const want = new Set(only);
    return pool.filter((s) => want.has(s)).sort((a, b) => a.localeCompare(b));
  }
  const pts = (s) => sweepRows[s]?.points ?? 0;
  return pool.sort((a, b) => pts(b) - pts(a) || a.localeCompare(b)).slice(0, limit);
}

// Which tier a pick comes from, for the plan and the report. "audited" cannot
// occur here because eligible() excludes the audited roster.
export function tierOf(meta, slug) {
  if ((meta.audited || []).includes(slug)) return "audited";
  if ((meta.enriched || []).includes(slug)) return "enriched";
  return "scored";
}

// ------------------------------------------------------------------ render

const FIX_PROMPT = (name, fix) =>
  `Edit this real street-level photograph of ${name} in San Francisco to show a proposed ` +
  "pedestrian safety upgrade. Keep every building, vehicle, person, pole, overhead wire, " +
  "traffic signal, street name sign and watermark exactly as it appears, unchanged and legible. " +
  `The proposed upgrade is: ${fix}. Repaint the crosswalks as bright white high-visibility ` +
  "continental ladder stripes. Photorealistic, same camera angle, same lighting, same time of day. " +
  "Do not alter, redraw or invent any text anywhere in the image. Do not add labels or watermarks.";

async function render(token, frameB64, prompt) {
  const r = await fetch(VERTEX_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: "image/jpeg", data: frameB64 } }, { text: prompt }],
        },
      ],
      // Ample, per the thinking-token lesson: 2.5-and-later models spend
      // reasoning tokens out of the same budget, and a tight ceiling returns
      // MAX_TOKENS with nothing rendered.
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], maxOutputTokens: 32768 },
    }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(String(d?.error?.message || `vertex ${r.status}`).slice(0, 200));
  const parts = d?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error(`no image in response (finish=${d?.candidates?.[0]?.finishReason})`);
  const u = d?.usageMetadata || {};
  return {
    b64: img.inlineData.data,
    promptTokens: u.promptTokenCount || 0,
    outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
  };
}

// The hazards overlay, drawn with the cron's own words (src/imagery.js
// HAZARD_PROMPT) plus the text-preservation sentence the fix prompt above
// carries. The overlay adds a legend box by design, so the instruction is not
// "add no text": it is that nothing already in the photograph may change.
const HAZARD_RENDER_PROMPT = (name) =>
  HAZARD_PROMPT(name) +
  " Keep every existing street name sign, speed limit sign and the watermark exactly as it " +
  "appears, unchanged and legible. Do not alter, redraw or invent any text that is already " +
  "in the photograph.";

// The visual audit, through Vertex under ADC. Same prompt, same response
// schema and the same reduction to four booleans as src/hazards.js auditFrame;
// only the transport and the model differ, and the model is recorded.
async function auditViaVertex(token, frameB64, corner) {
  const r = await fetch(AUDIT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: "image/jpeg", data: frameB64 } }, { text: AUDIT_PROMPT(corner) }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: AUDIT_SCHEMA,
        // 2.5 models spend thinking tokens from the same budget; a tight
        // ceiling returns MAX_TOKENS with no JSON at all.
        maxOutputTokens: 8192,
      },
    }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(String(d?.error?.message || `vertex ${r.status}`).slice(0, 200));
  const text = (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  const fin = d?.candidates?.[0]?.finishReason;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`audit returned no JSON (finish=${fin})`);
  }
  const u = d?.usageMetadata || {};
  return {
    flags: flagsFrom(parsed),
    notes: Object.fromEntries(Object.entries(parsed || {}).map(([k, v]) => [k, String(v?.note || "").slice(0, 200)])),
    promptTokens: u.promptTokenCount || 0,
    outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
  };
}

// Text pricing for the audit call, the letter fleet's figures.
const auditUsd = (p, o) => Math.round(((p / 1e6) * 0.3 + (o / 1e6) * 2.5) * 1e6) / 1e6;

const TRANSIENT_RENDER = /fetch failed|no image in response|vertex 5\d\d|ECONNRESET|ETIMEDOUT|socket hang up|UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL/i;

// One render through the gate, up to MAX_ATTEMPTS, with the quota backoff.
// Shared by the two generated states so they cannot be gated differently.
async function renderGated({ frame, prompt, before, wantStreets, slug, tag, stagedPath }) {
  let done = null;
  let tok = { promptTokens: 0, outputTokens: 0 };
  let held = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt += 1) {
    attempts = attempt;
    let out;
    try {
      out = await render(accessToken(), frame.toString("base64"), prompt);
    } catch (e) {
      held = `render error: ${e.message}`;
      // Two kinds of failure are retried, and they are named apart because
      // they wait for different reasons. A quota refusal is a rate window. A
      // transient failure is the network dropping the call ("fetch failed"),
      // the service answering 5xx, or the model returning a text part and no
      // image, which on 2026-08-22 cost two corners their renders at no
      // charge and no second try. Neither is a verdict on the frame.
      const msg = String(e.message);
      if (AUTH_STALE.test(msg) && attempt < MAX_ATTEMPTS) {
        console.log(`      ${tag}: stale credential on attempt ${attempt}, re-minting`);
        dropToken();
        continue;
      }
      if (/exhaust|quota|RESOURCE|429/i.test(msg) && attempt < MAX_ATTEMPTS) {
        const wait = backoffMs(attempt);
        console.log(`      ${tag}: quota refusal on attempt ${attempt}, waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (TRANSIENT_RENDER.test(msg) && attempt < MAX_ATTEMPTS) {
        const wait = Math.min(60_000, 10_000 * attempt);
        console.log(`      ${tag}: transient failure on attempt ${attempt} (${msg.slice(0, 50)}), waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      break;
    }
    tok = { promptTokens: tok.promptTokens + out.promptTokens, outputTokens: tok.outputTokens + out.outputTokens };
    const cand = join(STAGE, `${slug}.${tag}.attempt${attempt}.jpg`);
    writeFileSync(cand, Buffer.from(out.b64, "base64"));
    const after = readRegions(cand, `${slug}_${tag}_out${attempt}`);
    const gate = await checkLegibility({ inputRead: before, renderRead: after, expectStreets: wantStreets });
    if (gate.verdict === "pass") {
      writeFileSync(stagedPath, Buffer.from(out.b64, "base64"));
      done = { attempt, gate };
    } else {
      held = `${gate.reasons.join("; ")}`;
    }
  }
  const usd = Math.round(((tok.promptTokens / 1e6) * 0.3 + (tok.outputTokens / 1e6) * 2.5) * 1e6) / 1e6;
  return done
    ? { state: "passed", attempt: done.attempt, gate: done.gate, usd, ...tok }
    : { state: "held", why: held, attempts, usd, ...tok };
}

// The street names an overhead plate at this corner would carry, longest
// first, so the comparison uses the most distinctive token available rather
// than "6TH", which OCR finds in noise.
export function streetNames(name) {
  return String(name || "")
    .split(/\s+and\s+/i)
    .map((part) => part.replace(/\b(street|avenue|boulevard|drive|way|road|place|lane|terrace|st|ave|blvd)\b\.?/gi, "").trim())
    .filter((x) => x.length >= 4)
    .sort((a, b) => b.length - a.length)
    .map((x) => x.toUpperCase());
}

// Read the two checked regions off an image file, via PIL for the crop and
// tesseract for the text.
function readRegions(imgPath, tag) {
  mkdirSync(OCRDIR, { recursive: true });
  const py = `
from PIL import Image, ImageOps
im = Image.open(${JSON.stringify(imgPath)}).convert("L")
w,h = im.size
import json
R = json.loads(${JSON.stringify(JSON.stringify(REGIONS))})
for name, r in R.items():
    c = im.crop((int(w*r["x0"]), int(h*r["y0"]), int(w*r["x1"]), int(h*r["y1"])))
    c = c.resize((max(1,c.width*4), max(1,c.height*4)), Image.LANCZOS)
    c.save(${JSON.stringify(OCRDIR)} + "/" + ${JSON.stringify(tag)} + "_" + name + ".png")
`;
  execFileSync("python3", ["-c", py], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] });
  const out = {};
  for (const [name, r] of Object.entries(REGIONS)) {
    out[name] = ocr(join(OCRDIR, `${tag}_${name}.png`), r.psm);
  }
  return out;
}

// ------------------------------------------------------------------ run

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// Frame bytes for a corner: the city staging directory first, then the local
// copy this tool keeps, then KV. A wrangler error page is not a JPEG, so the
// magic bytes are checked whichever way the bytes arrived.
function frameFor(slug) {
  const local = join(FRAMES, `${slug}.jpg`);
  const city = join(CITY_FRAMES, `${slug}.jpg`);
  let source = null;
  if (existsSync(city)) source = city;
  else if (existsSync(local)) source = local;
  else {
    try {
      writeFileSync(local, kvBytes(`img:${slug}:today`));
      source = local;
    } catch {
      return { frame: null, path: null, from: null };
    }
  }
  try {
    const frame = readFileSync(source);
    if (frame.length < 1024 || frame[0] !== 0xff || frame[1] !== 0xd8) return { frame: null, path: null, from: null };
    return { frame, path: source, from: source === city ? "staged" : source === local ? "local" : "kv" };
  } catch {
    return { frame: null, path: null, from: null };
  }
}

function readJsonOr(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

if (IS_MAIN) {
  mkdirSync(STAGE, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });
  if (DO_FULL) {
    mkdirSync(HAZARDS_STAGE, { recursive: true });
    mkdirSync(CORNERS_STAGE, { recursive: true });
    mkdirSync(SCORES_STAGE, { recursive: true });
  }

  const keyOut = kv(["kv", "key", "list", "--binding", "STORE", "--remote"]);
  const keyNames = JSON.parse(keyOut.slice(keyOut.indexOf("["))).map((k) => k.name);
  const keySet = new Set(keyNames);
  // The live roster, not the committed file. The cron moves a corner between
  // rosters every morning and the file is a snapshot of the build; a pick made
  // against the snapshot can re-audit a corner the cron audited yesterday.
  let meta;
  try {
    const m = kv(["kv", "key", "get", "city:meta", "--binding", "STORE", "--remote", "--text"]);
    meta = JSON.parse(m.slice(m.indexOf("{")));
  } catch {
    meta = JSON.parse(readFileSync(join(ROOT, "data", "city", "meta.json"), "utf8"));
    console.log("city:meta could not be read from KV, using the committed snapshot");
  }
  const sweep = JSON.parse(readFileSync(join(ROOT, "sweep-results.json"), "utf8")).corners;
  const rows = {};
  for (const r of Array.isArray(sweep) ? sweep : Object.values(sweep)) if (r?.slug) rows[r.slug] = r;

  // The framed pool: img:index plus whatever the city fetch has staged.
  let framed = [];
  let stagedFrames = [];
  if (POOL === "framed") {
    try {
      const o = kv(["kv", "key", "get", "img:index", "--binding", "STORE", "--remote", "--text"]);
      framed = JSON.parse(o.slice(o.indexOf("{"))).slugs || [];
    } catch {
      framed = [];
    }
    if (existsSync(CITY_FRAMES)) {
      stagedFrames = readdirSync(CITY_FRAMES)
        .filter((f) => f.endsWith(".jpg") && !f.startsWith(".") && !f.startsWith("_"))
        .map((f) => f.replace(/\.jpg$/, ""));
    }
    framed = [...new Set([...framed, ...stagedFrames])];
  }

  const priorRows = readRenderResults();
  const decided = RETRY_HELD
    ? []
    : priorRows.filter((r) => r.state === "held" && r.preflight).map((r) => r.slug);

  // A named subset overrides the ranked selection. eligible() skips corners that
  // already have a stored fix render, which is what makes the tool idempotent,
  // and a retry of corners a quota window cost has to bypass the ranking
  // without bypassing that skip.
  const stagedAlready = stagedRenderFiles(readdirSync(STAGE)).map(slugOfRender);
  const poolOpts = { pool: POOL, framed, stagedFrames, decided: [...decided, ...SKIP] };
  let picks = ONLY.length
    ? eligible(meta, keyNames, rows, 0, ONLY, TOPUP ? [] : stagedAlready, poolOpts)
    : eligible(meta, keyNames, rows, ATTEMPTABLE ? 0 : N, [], stagedAlready, poolOpts);
  if (ATTEMPTABLE && !ONLY.length) picks = eligible(meta, keyNames, rows, Number.MAX_SAFE_INTEGER, [], stagedAlready, poolOpts);
  if (stagedAlready.length) {
    console.log(`skipping ${stagedAlready.length} already staged and awaiting publish: ${stagedAlready.join(", ")}`);
  }
  if (SKIP.length) console.log(`skipping ${SKIP.length} by ruling, named on the command line: ${SKIP.join(", ")}`);
  if (decided.length) {
    const pts = (s) => rows[s]?.points ?? 0;
    const shown = [...decided].sort((a, b) => pts(b) - pts(a));
    console.log(`skipping ${decided.length} held by a decided preflight (frame unreadable; re-fetch the frame, or --retry-held): ${shown.join(", ")}`);
  }
  console.log(`model:  ${MODEL} on Vertex locations/${LOCATION}, ADC, no api key`);
  if (DO_FULL) console.log(`audit:  ${AUDIT_MODEL} on Vertex locations/${AUDIT_LOCATION}, ADC, hazards ${HAZARD_VERSION}`);
  console.log(`pool:   ${POOL}${POOL === "framed" ? ` (${framed.length} framed corners known, ${stagedFrames.length} of them staged)` : ""}`);
  // The preflight at selection time. Walks the ranked pool, reads each frame
  // offline, and keeps the first N the gate could ever pass. Refusals are
  // kept with their reason so the run log and the report carry them.
  const refusedAtSelection = [];
  const preflightCache = new Map();
  if (ATTEMPTABLE && !ONLY.length) {
    const kept = [];
    for (const slug of picks) {
      if (kept.length >= N) break;
      const { frame, path } = frameFor(slug);
      if (!frame) {
        refusedAtSelection.push({ slug, why: "no stored Street View frame" });
        continue;
      }
      const name = CORNERS[slug]?.name || readJsonOr(join(CORNERS_STAGE, `${slug}.json`), null)?.name || rows[slug]?.name || slug.replace(/-and-/, " and ");
      const before = readRegions(path, `${slug}_in`);
      const pre = sourceIsCheckable(before, streetNames(name));
      preflightCache.set(slug, { before, pre });
      if (pre.checkable) kept.push(slug);
      else refusedAtSelection.push({ slug, why: `unrenderable: ${pre.why}` });
    }
    picks = kept;
    if (refusedAtSelection.length) {
      console.log(`refused at selection, ${refusedAtSelection.length} corners ranked above or among the picks (no spend; the unblock is a re-fetched frame):`);
      for (const r of refusedAtSelection) console.log(`  ${r.slug.padEnd(28)} ${String(rows[r.slug]?.points ?? "?").padStart(6)} points  ${r.why.slice(0, 60)}`);
    }
  }

  console.log(`picks:  ${picks.length} corners with a frame and no fix render, worst first${DO_FULL ? ", full lane" : ""}${ATTEMPTABLE ? ", attemptable" : ""}`);
  for (const s of picks) {
    console.log(`  ${s.padEnd(28)} ${String(rows[s]?.points ?? "?").padStart(6)} points  ${tierOf(meta, s)}`);
  }
  console.log();

  if (picks.length > DAILY_GENERATION_CAP) {
    console.log(`refusing: ${picks.length} exceeds the site's own DAILY_GENERATION_CAP of ${DAILY_GENERATION_CAP}`);
    process.exit(1);
  }

  // The corner record a lane reads. Registry, then KV, then (full lane only)
  // the city shard, in which case the corner is promoted into a stored record
  // exactly as the cron promotes it: the tier tag and the sweep block come
  // off, and the record is staged for publish before any lane reads it.
  const env = kvEnv(ROOT);
  async function cornerFor(slug) {
    if (CORNERS[slug]) return { corner: CORNERS[slug], promoted: false };
    const stagedPath = join(CORNERS_STAGE, `${slug}.json`);
    if (existsSync(stagedPath)) return { corner: readJsonOr(stagedPath, null), promoted: true };
    if (keySet.has(`corner:${slug}`)) {
      const raw = kv(["kv", "key", "get", `corner:${slug}`, "--binding", "STORE", "--remote", "--text"]);
      return { corner: JSON.parse(raw.slice(raw.indexOf("{"))), promoted: false };
    }
    if (!DO_FULL) return { corner: null, promoted: false };
    const city = await cityCornerFor(env, slug);
    if (!city) return { corner: null, promoted: false };
    const { tier, sweep: sw, ...promoted } = city;
    void tier;
    void sw;
    writeFileSync(stagedPath, JSON.stringify(promoted));
    return { corner: promoted, promoted: true };
  }

  // The plan for the full lane carries the preflight verdict, because that is
  // the difference between a slot that will be attempted and one that will be
  // refused for free, and the operator should see it before spending.
  if (!DO_GENERATE && !DO_PUBLISH) {
    if (DO_FULL) {
      console.log("preflight (offline OCR of the stored frame, nothing called):");
      for (const slug of picks) {
        const { frame, path, from } = frameFor(slug);
        if (!frame) {
          console.log(`  ${slug.padEnd(28)} NO FRAME`);
          continue;
        }
        let pre = preflightCache.get(slug)?.pre;
        if (!pre) {
          const name = CORNERS[slug]?.name || rows[slug]?.name || (await cornerFor(slug)).corner?.name || slug.replace(/-and-/, " and ");
          const before = readRegions(path, `${slug}_in`);
          pre = sourceIsCheckable(before, streetNames(name));
        }
        console.log(`  ${slug.padEnd(28)} frame ${from.padEnd(6)} ${pre.checkable ? `checkable (${[pre.watermark && "watermark", pre.street && "signage"].filter(Boolean).join(", ")})` : "UNREADABLE, would be refused before spending"}`);
      }
    }
    console.log("\nplan only, nothing called and nothing written");
    process.exit(0);
  }

  const results = [];

  if (DO_GENERATE) {

    // Selection-time refusals are outcomes of this run, at no cost.
    for (const r of refusedAtSelection) {
      results.push({ slug: r.slug, state: "held", why: r.why, usd: 0, promptTokens: 0, outputTokens: 0, preflight: true, at: new Date().toISOString() });
    }

    for (const [i, slug] of picks.entries()) {
      const staged = join(STAGE, `${slug}.fix.jpg`);
      const fixStaged = existsSync(staged);
      if (fixStaged && !TOPUP) {
        console.log(`  [${i + 1}/${picks.length}] ${slug}: already staged, skipping`);
        continue;
      }
      const { frame, path: framePath } = frameFor(slug);
      if (!frame) {
        results.push({ slug, state: "skipped", why: "no stored Street View frame" });
        console.log(`  [${i + 1}/${picks.length}] ${slug}: skipped, no usable frame`);
        continue;
      }

      const { corner, promoted } = await cornerFor(slug);
      if (!corner) {
        results.push({ slug, state: "skipped", why: "no corner record and no shard row" });
        console.log(`  [${i + 1}/${picks.length}] ${slug}: skipped, no corner record`);
        continue;
      }
      const prompt = FIX_PROMPT(corner.name, corner.fix?.name || "continental crosswalks and corner daylighting");

      const before = preflightCache.get(slug)?.before || readRegions(framePath, `${slug}_in`);
      const wantStreets = streetNames(corner.name);

      // Refuse before spending. A corner whose source frame is unreadable in
      // every checked region cannot produce a passing render, so a call here
      // buys a hold that was already decided.
      const pre = sourceIsCheckable(before, wantStreets);
      if (!pre.checkable) {
        results.push({ slug, state: "held", why: `unrenderable: ${pre.why}`, usd: 0, promptTokens: 0, outputTokens: 0, preflight: true, at: new Date().toISOString() });
        console.log(`  [${i + 1}/${picks.length}] ${slug}: SKIPPED before spending, ${pre.why.slice(0, 80)}`);
        continue;
      }

      const frameB64 = frame.toString("base64");
      let audit = null;
      let hazardsRender = null;
      const priorRow = TOPUP ? priorRows.find((r) => r.slug === slug) : null;

      if (DO_FULL) {
        // Lane 1: the visual audit, then the record corroboration, assembled
        // by the Worker's own function. Stored only when the model answered:
        // an audited:false record would pin the corner to "no audit ran" and
        // block the retry that a later window could make.
        // Bought already: the staged record and the prior row carry the audit.
        if (priorRow?.audit?.ok && existsSync(join(HAZARDS_STAGE, `${slug}.json`))) {
          audit = { ...priorRow.audit, reused: true };
          console.log(`      audit: staged from ${audit.at}, reused (${audit.confirmed}c/${audit.candidates}k/${audit.reported}r)`);
        }
        let auditOut = null;
        let auditErr = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !auditOut && !audit; attempt += 1) {
          try {
            auditOut = await auditViaVertex(accessToken(), frameB64, corner);
          } catch (e) {
            auditErr = e.message;
            if (AUTH_STALE.test(String(e.message)) && attempt < MAX_ATTEMPTS) {
              console.log(`      audit: stale credential on attempt ${attempt}, re-minting`);
              dropToken();
              continue;
            }
            if (/exhaust|quota|RESOURCE|429/i.test(String(e.message)) && attempt < MAX_ATTEMPTS) {
              const wait = backoffMs(attempt);
              console.log(`      audit: quota refusal on attempt ${attempt}, waiting ${Math.round(wait / 1000)}s`);
              await sleep(wait);
            } else break;
          }
        }
        if (auditOut && !audit) {
          const evidence = await evidenceFor(corner);
          const record = {
            ...assemble(auditOut.flags, evidence),
            // Provenance on the record itself: which model looked, through
            // what, and when. The Worker's path writes none of these because
            // the Worker is the default; a batch says so.
            model: AUDIT_MODEL,
            via: `vertex:${AUDIT_LOCATION}`,
            lane: "batch-full",
            at: new Date().toISOString(),
            flags: auditOut.flags,
            notes: auditOut.notes,
          };
          writeFileSync(join(HAZARDS_STAGE, `${slug}.json`), JSON.stringify(record));
          audit = {
            ok: true,
            model: AUDIT_MODEL,
            via: `vertex:${AUDIT_LOCATION}`,
            at: record.at,
            flags: auditOut.flags,
            confirmed: record.confirmed,
            candidates: record.candidates,
            reported: record.reported,
            usd: auditUsd(auditOut.promptTokens, auditOut.outputTokens),
            promptTokens: auditOut.promptTokens,
            outputTokens: auditOut.outputTokens,
          };
          console.log(`      audit: ${record.confirmed} confirmed, ${record.candidates} candidate, ${record.reported} reported`);
        } else if (!audit) {
          audit = { ok: false, why: `audit error: ${auditErr}`, usd: 0 };
          console.log(`      audit: FAILED, ${String(auditErr).slice(0, 80)}`);
        }

        // Lane 2: the hazards overlay, through the same gate. A staged
        // overlay is a bought render and is reused with its attribution.
        if (priorRow?.hazardsRender?.state === "passed" && existsSync(join(STAGE, `${slug}.hazards.jpg`))) {
          hazardsRender = { ...priorRow.hazardsRender, reused: true };
          console.log(`      hazards render: staged, reused (attempt ${hazardsRender.attempt})`);
        } else hazardsRender = await renderGated({
          frame, prompt: HAZARD_RENDER_PROMPT(corner.name), before, wantStreets, slug,
          tag: "hazards", stagedPath: join(STAGE, `${slug}.hazards.jpg`),
        });
        if (!hazardsRender.reused) {
          console.log(
            hazardsRender.state === "passed"
              ? `      hazards render: passed attempt ${hazardsRender.attempt}, checked [${hazardsRender.gate.checked.join(",")}]`
              : `      hazards render: HELD, ${String(hazardsRender.why).slice(0, 80)}`,
          );
          await sleep(SPACING_MS);
        }
      }

      // Lane 3: the proposed fix. Staged and previously passed means bought:
      // reused with its attribution, like the other two lanes.
      const fix = fixStaged && priorRow?.state === "passed"
        ? { state: "passed", attempt: priorRow.attempt ?? null, gate: priorRow.gate ?? null, usd: priorRow.fixUsd ?? priorRow.usd ?? 0, promptTokens: 0, outputTokens: 0, reused: true }
        : await renderGated({
            frame, prompt, before, wantStreets, slug, tag: "fix", stagedPath: staged,
          });
      if (fix.reused) console.log(`      fix render: staged, reused (attempt ${fix.attempt})`);

      // Spacing between corners, on top of the per attempt backoff above. The
      // five quota holds on 2026-08-20 all landed inside the same minute.
      if (i < picks.length - 1) await sleep(SPACING_MS);

      // A reused lane's money is in the run log entry that bought it; adding
      // it to tonight's entry would bill it twice. The lane object keeps its
      // own usd for the per-corner record either way.
      const spentNow = (x) => (x && !x.reused ? x.usd || 0 : 0);
      const usd = Math.round((spentNow(fix) + spentNow(hazardsRender) + spentNow(audit)) * 1e6) / 1e6;
      const tokOf = (x, f) => (x && !x.reused ? x[f] || 0 : 0);
      const tok = {
        promptTokens: tokOf(fix, "promptTokens") + tokOf(hazardsRender, "promptTokens") + tokOf(audit, "promptTokens"),
        outputTokens: tokOf(fix, "outputTokens") + tokOf(hazardsRender, "outputTokens") + tokOf(audit, "outputTokens"),
      };
      const laneBits = DO_FULL
        ? { lane: "full", promoted, audit, hazardsRender: hazardsRender && { ...hazardsRender, gate: hazardsRender.gate || undefined }, fixUsd: fix.usd }
        : {};
      const full = DO_FULL && audit?.ok && hazardsRender?.state === "passed" && fix.state === "passed";

      if (fix.state === "passed") {
        writeFileSync(
          join(STAGE, `${slug}.meta.json`),
          JSON.stringify({
            slug,
            model: MODEL,
            via: `vertex:${LOCATION}`,
            attempt: fix.attempt,
            checked: fix.gate.checked,
            unchecked: fix.gate.unchecked,
            promotedFrom: tierOf(meta, slug),
            lane: full ? "full" : "fix-only",
            at: new Date().toISOString(),
            usd,
          }),
        );
        results.push({ slug, state: "passed", attempt: fix.attempt, usd, ...tok, gate: fix.gate, at: new Date().toISOString(), ...laneBits });
        console.log(
          `  [${i + 1}/${picks.length}] ${slug}: fix passed attempt ${fix.attempt}, checked [${fix.gate.checked.join(",")}] unchecked [${fix.gate.unchecked.join(",")}]` +
            (DO_FULL ? `  -> ${full ? "FULL LANE, audited" : "partial, promoted-from-enriched"}` : ""),
        );
      } else {
        results.push({ slug, state: "held", why: fix.why, usd, ...tok, at: new Date().toISOString(), ...laneBits });
        console.log(`  [${i + 1}/${picks.length}] ${slug}: fix HELD, ${String(fix.why).slice(0, 90)}` + (DO_FULL && hazardsRender?.state === "passed" ? "  -> hazards only, promoted-from-enriched" : ""));
      }
    }
    // Merge, never replace. This is burn 26 in the sibling tool, and it was
    // fixed there and missed here: a `--only=` retry of one corner wrote its
    // single row over the six the pass before it had recorded, and the ledger
    // built from that file then reported one render attempted and $0.0095 for
    // a night that attempted six and spent $0.0222. The published ledger's
    // perRender lines were the only surviving copy.
    //
    // Same shape as the letter fleet: per corner state merges by slug with the
    // latest run winning, and the money lives in an append only run log beside
    // it, because a corner re-rendered tomorrow overwrites its own verdict but
    // does not unspend today's calls.
    writeFileSync(
      join(STAGE, "_results.json"),
      JSON.stringify(mergeRenderResults(readRenderResults(), results), null, 2),
    );
    appendRenderRun({
      at: new Date().toISOString(),
      label: (ONLY.length ? `re-render of ${ONLY.length} named corners` : `pass over ${picks.length} corners`) + (DO_FULL ? ", full lane" : ""),
      corners: results.length,
      calls: results.reduce((a, r) => a + (r.attempt || r.attempts || 0) + (r.hazardsRender?.attempt || r.hazardsRender?.attempts || 0) + (r.audit?.ok ? 1 : 0), 0),
      promptTokens: results.reduce((a, r) => a + (r.promptTokens || 0), 0),
      outputTokens: results.reduce((a, r) => a + (r.outputTokens || 0), 0),
      estUsd: Math.round(results.reduce((a, r) => a + (r.usd || 0), 0) * 1e6) / 1e6,
      model: MODEL,
      ...(DO_FULL ? { auditModel: AUDIT_MODEL } : {}),
    });
  }

  // ---------------------------------------------------------------- publish

  let published = 0;
  let audited = 0;
  let kvWrites = 0;
  let publishNote = null;

  if (DO_PUBLISH) {
    const rowsNow = results.length ? results : readRenderResults();
    const byslug = new Map(rowsNow.map((r) => [r.slug, r]));

    const names = readdirSync(STAGE);
    const fixFiles = stagedRenderFiles(names);
    const hazFiles = stagedHazardFiles(names);
    const fixSlugs = new Set(fixFiles.map(slugOfRender));
    const hazSlugs = new Set(hazFiles.map(slugOfHazardRender));
    const slugs = [...new Set([...fixSlugs, ...hazSlugs])].sort();
    console.log(`\npublishing ${fixFiles.length} fix render${fixFiles.length === 1 ? "" : "s"}, ${hazFiles.length} hazards render${hazFiles.length === 1 ? "" : "s"}`);

    // Stops on the daily cap, like every other lane. Returns false when the
    // cap is hit so the caller can stop rather than spend more failed calls.
    let capped = false;
    const putFile = (key, file) => {
      if (capped) return false;
      try {
        kv(["kv", "key", "put", key, "--path", file, "--binding", "STORE", "--remote"]);
        kvWrites += 1;
        return true;
      } catch (e) {
        const msg = String(e.message || e);
        if (KV_CAP_SPENT.test(msg)) {
          capped = true;
          publishNote = "the account's daily KV write allowance is spent; the staged state on disk is correct and a republish after the 00:00 UTC reset carries the rest";
          console.log(`  ${key}: REFUSED, daily KV write allowance spent`);
        } else {
          console.log(`  ${key}: FAILED, ${msg.slice(0, 90)}`);
        }
        return false;
      }
    };
    const putBulk = (entries, label) => {
      if (capped || !entries.length) return false;
      const f = join(STAGE, `.bulk-${label}-${entries.length}.json`);
      writeFileSync(f, JSON.stringify(entries));
      try {
        kv(["kv", "bulk", "put", f, "--binding", "STORE", "--remote"]);
        kvWrites += entries.length;
        return true;
      } catch (e) {
        const msg = String(e.message || e);
        capped = KV_CAP_SPENT.test(msg);
        publishNote = capped
          ? `${label}: the daily KV write allowance is spent; nothing in this step was written and a republish after the 00:00 UTC reset carries it`
          : `${label}: bulk write failed: ${msg.slice(0, 160)}`;
        console.log(`\n${label.toUpperCase()} NOT WRITTEN: ${publishNote}`);
        return false;
      }
    };

    // Records before bytes, bytes before status. A status claiming a render
    // that is not stored is a broken image on a live page; a record with no
    // status pointing at it is invisible and harmless, so that is the safer
    // order to fail in.
    //
    // 1. Promoted corner records and their scores: the corner the lanes read.
    const cornerEntries = [];
    const scoreEntries = [];
    if (DO_FULL || existsSync(CORNERS_STAGE)) {
      for (const slug of slugs) {
        const cf = join(CORNERS_STAGE, `${slug}.json`);
        if (existsSync(cf) && !keySet.has(`corner:${slug}`)) {
          cornerEntries.push({ key: `corner:${slug}`, value: readFileSync(cf, "utf8") });
        }
        // A promoted scored corner has no score record; the audited index
        // reads one for its grade. Computed by the Worker's own function.
        if (existsSync(cf) && !keySet.has(`score:${slug}`)) {
          const sf = join(SCORES_STAGE, `${slug}.json`);
          if (!existsSync(sf)) {
            try {
              const c = readJsonOr(cf, null);
              const sc = await computeScore(c);
              writeFileSync(sf, JSON.stringify(sc));
            } catch (e) {
              console.log(`  ${slug}: score not computed, ${String(e.message || e).slice(0, 80)}`);
            }
          }
          if (existsSync(sf)) scoreEntries.push({ key: `score:${slug}`, value: readFileSync(sf, "utf8") });
        }
      }
    }
    if (cornerEntries.length && putBulk(cornerEntries, "corners")) console.log(`  ${cornerEntries.length} promoted corner record${cornerEntries.length === 1 ? "" : "s"} written`);
    if (scoreEntries.length && putBulk(scoreEntries, "scores")) console.log(`  ${scoreEntries.length} score record${scoreEntries.length === 1 ? "" : "s"} written (${SCORE_VERSION})`);

    // 2. Hazards records, for the corners whose audit ran.
    const hazardEntries = [];
    if (existsSync(HAZARDS_STAGE)) {
      for (const slug of slugs) {
        const hf = join(HAZARDS_STAGE, `${slug}.json`);
        const row = byslug.get(slug);
        if (existsSync(hf) && row?.audit?.ok) hazardEntries.push({ key: `hazards:${slug}`, value: readFileSync(hf, "utf8") });
      }
    }
    if (hazardEntries.length && putBulk(hazardEntries, "hazards")) console.log(`  ${hazardEntries.length} hazards record${hazardEntries.length === 1 ? "" : "s"} written`);

    // 3. Bytes, then 4. status, per corner.
    const statusEntries = [];
    const auditedSlugs = [];
    const promotedSlugs = [];
    if (slugs.length) {
      const keyFile = join(STAGE, `.imgkeys-${slugs.length}.json`);
      writeFileSync(keyFile, JSON.stringify(slugs.map((x) => `imgstatus:${x}`)));
      let existing = {};
      try {
        const out = kv(["kv", "bulk", "get", keyFile, "--binding", "STORE", "--remote"]);
        existing = JSON.parse(out.slice(out.indexOf("{")));
      } catch (e) {
        console.log(`  could not read existing imgstatus, treating all as new: ${String(e.message || e).slice(0, 90)}`);
      }

      for (const slug of slugs) {
        if (capped) break;
        const row = byslug.get(slug) || {};
        const hasFix = fixSlugs.has(slug);
        const hasHaz = hazSlugs.has(slug);
        if (hasFix && row.state === "held") {
          // Cannot happen through stagedRenderFiles, which selects only
          // `.fix.jpg` and a held render never gets one. Asserted anyway,
          // because "cannot happen" is what the letter publish said too.
          console.log(`  ${slug}: REFUSING, the run log says this fix render was held`);
          publishNote = `refused to publish ${slug}, held in the run log`;
          continue;
        }
        if (hasHaz && row.hazardsRender?.state === "held") {
          console.log(`  ${slug}: REFUSING, the run log says this hazards render was held`);
          publishNote = `refused to publish ${slug}, hazards render held in the run log`;
          continue;
        }
        // Bytes already in KV are not re-put: a republish after a capped
        // window must carry only what is missing.
        let okFix = !hasFix || keySet.has(`img:${slug}:fix`);
        let okHaz = !hasHaz || keySet.has(`img:${slug}:hazards`);
        if (hasHaz && !okHaz) okHaz = putFile(`img:${slug}:hazards`, join(STAGE, `${slug}.hazards.jpg`));
        if (hasFix && !okFix) okFix = putFile(`img:${slug}:fix`, join(STAGE, `${slug}.fix.jpg`));
        if (capped) break;
        let prior = existing[`imgstatus:${slug}`] ?? null;
        if (typeof prior === "string") { try { prior = JSON.parse(prior); } catch { prior = null; } }
        const { kind, status } = statusFor(
          prior,
          row,
          { fix: hasFix && okFix, hazards: hasHaz && okHaz },
          { at: Date.now(), model: MODEL, via: `vertex:${LOCATION}` },
        );
        if (!kind) {
          console.log(`  ${slug}: nothing publishable (fix ${hasFix ? row.state : "none"}, hazards ${hasHaz ? row.hazardsRender?.state : "none"})`);
          continue;
        }
        statusEntries.push({ key: `imgstatus:${slug}`, value: JSON.stringify(status) });
        if (kind === "audited") auditedSlugs.push(slug);
        else promotedSlugs.push(slug);
        published += 1;
        console.log(`  ${slug}: ${kind === "audited" ? "published, provenance audited (full lane)" : "published, provenance promoted-from-enriched"}`);
      }

      if (statusEntries.length && !capped) {
        if (!putBulk(statusEntries, "status")) {
          // The bytes are already stored and the record that points at them is
          // not. That is the recoverable direction, but it must be said out
          // loud rather than crashing: an image with no status record is
          // invisible to the site, which is harmless and also not what the run
          // just claimed to have done.
          published = 0;
          auditedSlugs.length = 0;
          promotedSlugs.length = 0;
          publishNote = capped
            ? "the image bytes were stored but the status records were refused: the daily KV write allowance is spent. Nothing is visible on the site until a republish after the 00:00 UTC reset."
            : publishNote;
        }
      }
      audited = auditedSlugs.length;

      // 5. The rosters, one write. Full-lane corners join the audited roster
      // and leave enriched; a promoted scored corner joins enriched. The same
      // rule the cron applies, from the same record.
      if (!capped && (auditedSlugs.length || promotedSlugs.length)) {
        try {
          const m = kv(["kv", "key", "get", "city:meta", "--binding", "STORE", "--remote", "--text"]);
          const live = JSON.parse(m.slice(m.indexOf("{")));
          const aud = new Set(live.audited || []);
          const enr = new Set(live.enriched || []);
          for (const s of auditedSlugs) { aud.add(s); enr.delete(s); }
          for (const s of promotedSlugs) if (!aud.has(s)) enr.add(s);
          const next = {
            ...live,
            audited: [...aud].sort(),
            enriched: [...enr].sort(),
            totalAudited: aud.size,
            totalEnriched: enr.size,
          };
          const changed = next.audited.length !== (live.audited || []).length || next.enriched.length !== (live.enriched || []).length;
          if (changed) {
            const mf = join(STAGE, ".citymeta.json");
            writeFileSync(mf, JSON.stringify(next));
            if (putFile("city:meta", mf)) console.log(`  city:meta rosters: audited ${aud.size}, enriched ${enr.size}`);
          }
        } catch (e) {
          console.log(`  city:meta NOT updated: ${String(e.message || e).slice(0, 120)}`);
        }
      }
    }

    // 6. The warmed roster list (hin:list), one write. The cron adds a row
    // for the corner it audits so the board, the city map and /api/board (the
    // watchdog's baseline) carry it by morning; a batch-audited corner is owed
    // the same row. No cotd date on it: that field records the morning cron.
    if (!capped && audited) {
      try {
        const raw = kv(["kv", "key", "get", "hin:list", "--binding", "STORE", "--remote", "--text"]);
        // Wrangler prints the value with its own trailing chatter; slice to
        // the outermost brackets rather than trusting the tail.
        const list = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
        const have = new Set(list.map((c) => c.slug));
        const want = slugs.filter((s) => !have.has(s) && statusEntries.some((e) => e.key === `imgstatus:${s}` && JSON.parse(e.value).provenance === AUDITED));
        const added = [];
        for (const slug of want) {
          const { corner } = await cornerFor(slug);
          if (!corner) continue;
          let score = null;
          const sf = join(SCORES_STAGE, `${slug}.json`);
          if (existsSync(sf)) score = readJsonOr(sf, null);
          else if (keySet.has(`score:${slug}`)) {
            const sr = kv(["kv", "key", "get", `score:${slug}`, "--binding", "STORE", "--remote", "--text"]);
            score = JSON.parse(sr.slice(sr.indexOf("{")));
            if (score?.version !== SCORE_VERSION) score = null;
          }
          const stats = await getStats(corner).catch(() => null);
          added.push({
            slug,
            name: corner.name,
            lat: corner.lat,
            lon: corner.lon,
            district: stats?.district ?? corner.district ?? null,
            index: score?.index ?? 0,
            grade: score?.grade ?? "A",
            counts: score?.counts ?? {},
            points: score?.points ?? rows[slug]?.points ?? 0,
            collisions: stats?.crashes ?? 0,
            fatal: stats?.fatal ?? 0,
            auditedBy: "batch-full",
          });
        }
        if (added.length) {
          const merged = [...list, ...added].sort((a, b) => b.index - a.index || (b.points || 0) - (a.points || 0));
          const hf = join(STAGE, ".hinlist.json");
          writeFileSync(hf, JSON.stringify(merged));
          if (putFile("hin:list", hf)) console.log(`  hin:list: ${added.length} row${added.length === 1 ? "" : "s"} added, ${merged.length} total`);
        }
      } catch (e) {
        console.log(`  hin:list NOT updated: ${String(e.message || e).slice(0, 120)}`);
      }
    }

    // The ledger, one record holding a line per render, held ones included.
    if (!capped) {
      const ledger = buildRenderLedger(rowsNow, { now: new Date().toISOString(), runs: readRenderRuns() });
      const lf = join(STAGE, ".renderledger.json");
      writeFileSync(lf, JSON.stringify([{ key: "budget:renders", value: JSON.stringify(ledger) }]));
      try {
        kv(["kv", "bulk", "put", lf, "--binding", "STORE", "--remote"]);
        kvWrites += 1;
        console.log(`  budget:renders written, ${ledger.published} published of ${ledger.attempted} attempted, $${(ledger.estUsd || 0).toFixed(4)}`);
      } catch (e) {
        const msg = String(e.message || e);
        publishNote = KV_CAP_SPENT.test(msg)
          ? "the account's daily KV write allowance is spent, so the ledger was not updated; the staged results are correct and a republish after the 00:00 UTC reset will carry them"
          : `ledger write failed: ${msg.slice(0, 160)}`;
        console.log(`\nLEDGER NOT WRITTEN: ${publishNote}`);
      }
    }
  }

  const src = results.length ? results : readRenderResults();
  const passed = src.filter((r) => r.state === "passed");
  const held = src.filter((r) => r.state === "held");
  const usd = src.reduce((a, r) => a + (r.usd || 0), 0);

  console.log("\n| metric | value |");
  console.log("|---|---|");
  console.log(`| corners attempted | ${src.length} |`);
  console.log(`| fix render passed the legibility gate | ${passed.length} |`);
  console.log(`| fix render held | ${held.length} |`);
  if (DO_FULL || src.some((r) => r.lane === "full")) {
    const fullRows = src.filter((r) => r.lane === "full");
    console.log(`| full lane: audit ran | ${fullRows.filter((r) => r.audit?.ok).length} of ${fullRows.length} |`);
    console.log(`| full lane: hazards render passed | ${fullRows.filter((r) => r.hazardsRender?.state === "passed").length} of ${fullRows.length} |`);
    console.log(`| full lane: completed all three | ${fullRows.filter((r) => r.audit?.ok && r.hazardsRender?.state === "passed" && r.state === "passed").length} of ${fullRows.length} |`);
  }
  console.log(`| estimated spend | $${usd.toFixed(4)} |`);
  console.log(`| published to kv | ${published} |`);
  if (audited) console.log(`| published as audited | ${audited} |`);
  console.log(`| kv writes consumed | ${kvWrites} |`);
  if (held.length) {
    console.log("\nheld, with reasons and the frame kept for diagnosis:");
    for (const h of held) console.log(`  ${h.slug}: ${h.why}`);
  }
  if (publishNote) console.log(`\npublish: ${publishNote}`);
  console.log(`\nstaged at ${STAGE}`);
}
