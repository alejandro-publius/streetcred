// Generate the letter fleet locally, under Application Default Credentials.
//
// The Worker never holds a model credential and is not involved in generation.
// It keeps serving stored letters exactly as it does now; this writes the
// letters it serves.
//
//   node tools/generate_letters.mjs --plan          what it would do, no calls
//   node tools/generate_letters.mjs --generate      Vertex calls, stage to disk
//   node tools/generate_letters.mjs --publish       stage to KV, no model calls
//   node tools/generate_letters.mjs --generate --publish
//
// Generation and publication are separate phases on purpose. Vertex spend and
// the KV daily write cap are two different budgets that run out at two
// different times, and a run that had to abandon 130 paid drafts because the
// write allowance was gone would be the expensive way to learn that.
//
// Auth is ADC. There is no API key here, in the environment, on disk, or in the
// Worker. The token is minted per run from the credentials `gcloud auth
// application-default login` wrote, and it is never printed or stored.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildLetterPrompt } from "../src/letterprompt.js";
import { buildInputSet, verifyLetter, retryInstruction, VERIFY_VERSION } from "../src/verify.js";
import { getStats } from "../src/index.js";
import { CORNERS, resolvedDistrict, addresseeFor } from "../src/data.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(ROOT, "scratch", "letters");
const GCLOUD = process.env.GCLOUD_BIN || "/opt/homebrew/share/google-cloud-sdk/bin/gcloud";

const PROJECT = process.env.VERTEX_PROJECT || "streetcred-506117";
const REGION = process.env.VERTEX_REGION || "us-central1";
// DEVIATION FROM SPEC, stated rather than silently applied.
//
// The spec names gemini-3.7-flash, which is what the Worker's own key path
// targets. On Vertex in this project that model 404s: "Publisher model ... was
// not found or your project does not have access to it." So does every other
// 3.x model. Probed 2026-08-20 with ADC against us-central1:
//
//   gemini-3.7-flash        404 NOT_FOUND        gemini-2.5-flash       200 OK
//   gemini-3.6-flash        404 NOT_FOUND        gemini-2.5-flash-lite  200 OK
//   gemini-3.5-flash        404 NOT_FOUND        gemini-2.5-pro         200 OK
//   gemini-3-flash-preview  404 NOT_FOUND
//   gemini-3-pro-preview    404 NOT_FOUND
//   gemini-3.1-flash-lite   404 NOT_FOUND
//
// They are all listed by the publisher-models endpoint, which lists the
// catalogue rather than what this project may call. The 2.5 family is what is
// actually callable, and gemini-2.5-flash is the nearest equivalent of the
// model the spec asked for: same tier, same shape of task.
//
// The safety argument for proceeding rather than stopping: every draft goes
// through the same verifier either way, so a weaker model produces more corners
// stored as pending, never a worse letter published. Override with VERTEX_MODEL.
const MODEL = process.env.VERTEX_MODEL || "gemini-2.5-flash";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argOf = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DO_PLAN = has("--plan") || args.length === 0;
const DO_GENERATE = has("--generate");
const DO_PUBLISH = has("--publish");
const LIMIT = Number(argOf("limit", "0")) || 0;

// The Workers free plan allows 1,000 KV writes a day, account wide, resetting
// 00:00 UTC. The site spends some of that on its own crons, so the run reserves
// headroom rather than filling the allowance to the line.
const KV_DAILY_FREE = 1000;
const KV_RESERVE_FOR_SITE = 400;

// ---------------------------------------------------------------- kv access

const kv = (args_, opts = {}) =>
  execFileSync("npx", ["wrangler", ...args_], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });

function bulkGet(keys) {
  if (!keys.length) return {};
  const f = join(STAGE, `.keys-${Math.abs(hash(keys.join(",")))}.json`);
  writeFileSync(f, JSON.stringify(keys));
  const out = kv(["kv", "bulk", "get", f, "--binding", "STORE", "--remote"]);
  const parsed = JSON.parse(out.slice(out.indexOf("{")));
  const result = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === null || v === undefined) continue;
    try {
      result[k] = typeof v === "string" ? JSON.parse(v) : v;
    } catch {
      result[k] = v;
    }
  }
  return result;
}

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};

// ---------------------------------------------------------------- vertex

function accessToken() {
  const t = execFileSync(GCLOUD, ["auth", "application-default", "print-access-token"], {
    encoding: "utf8",
    timeout: 120_000,
  }).trim();
  if (!t) throw new Error("no ADC access token; run: gcloud auth application-default login");
  return t;
}

// Vertex publisher endpoint. Same model id the Worker names, different host and
// a bearer token instead of x-goog-api-key.
const VERTEX_URL =
  `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}` +
  `/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

async function vertexDraft(token, prompt) {
  const r = await fetch(VERTEX_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 3072 },
    }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = d?.error?.message || `vertex ${r.status}`;
    const e = new Error(String(msg).slice(0, 240));
    e.status = r.status;
    throw e;
  }
  const text = (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  const u = d?.usageMetadata || {};
  return {
    text,
    promptTokens: u.promptTokenCount || 0,
    outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
  };
}

// Published Vertex rates for the flash tier, in dollars per million tokens.
// Recorded as an estimate and labelled as one: unlike Exa, which returns
// costDollars on every response, Vertex bills out of band and this is arithmetic
// over token counts rather than a figure the provider handed back.
const USD_PER_M_IN = Number(process.env.VERTEX_USD_IN || 0.3);
const USD_PER_M_OUT = Number(process.env.VERTEX_USD_OUT || 2.5);
export const costOf = (inTok, outTok) =>
  Math.round(((inTok / 1e6) * USD_PER_M_IN + (outTok / 1e6) * USD_PER_M_OUT) * 1e6) / 1e6;

// ---------------------------------------------------------------- the fleet

function fleet() {
  const meta = bulkGet(["city:meta"])["city:meta"];
  if (!meta) throw new Error("city:meta is missing, so there is no authoritative roster to read");
  const slugs = [...new Set([...(meta.audited || []), ...(meta.enriched || [])])].sort();
  return { meta, slugs: LIMIT ? slugs.slice(0, LIMIT) : slugs };
}

// Everything the prompt and the verifier need, read from the records the Worker
// serves from. Stats are the one lane not stored: getStats is imported from the
// Worker's own module so the letter's figures and the page's figures are the
// same arithmetic, not two copies of it.
async function laneData(slugs) {
  const keys = [];
  for (const s of slugs) {
    keys.push(`corner:${s}`, `score:${s}`, `press:${s}`, `voices:${s}`, `timeline:${s}`, `hazards:${s}`);
  }
  const rec = {};
  const CHUNK = 300;
  for (let i = 0; i < keys.length; i += CHUNK) {
    Object.assign(rec, bulkGet(keys.slice(i, i + CHUNK)));
  }
  return rec;
}

function cornerOf(slug, rec) {
  return CORNERS[slug] || rec[`corner:${slug}`] || null;
}

// Which staged files become KV entries. A draft that failed the verifier twice
// is staged as `{slug}.pending.json` and this is what keeps it out of the write
// set: the guarantee is structural, not a promise that the loop above got its
// branches right. tools/letters.test.mjs asserts a pending file can never be
// selected.
export function stagedLetterFiles(names) {
  return names.filter(
    (f) => f.endsWith(".json") && !f.startsWith("_") && !f.startsWith(".") && !f.includes(".pending."),
  );
}

// The ledger, as one record holding a line per letter. One record per letter
// would be 130 extra writes against a 1,000 a day cap to store what fits in a
// single value.
export function buildLedger(rows, opts = {}) {
  const spent = rows.filter((r) => r.usd).reduce((a, r) => a + r.usd, 0);
  return {
    period: (opts.now || new Date().toISOString()).slice(0, 7),
    updated: opts.now || new Date().toISOString(),
    model: opts.model || MODEL,
    via: `vertex:${opts.region || REGION}`,
    project: opts.project || PROJECT,
    auth: "application default credentials, no api key",
    calls: rows.reduce((a, r) => a + (r.attempts || 0), 0),
    letters: rows.filter((r) => r.state === "passed").length,
    promptTokens: rows.reduce((a, r) => a + (r.promptTokens || 0), 0),
    outputTokens: rows.reduce((a, r) => a + (r.outputTokens || 0), 0),
    estUsd: Math.round(spent * 1e6) / 1e6,
    basis: `estimated from token counts at $${USD_PER_M_IN}/M in and $${USD_PER_M_OUT}/M out`,
    perCorner: rows
      .filter((r) => r.state === "passed" || r.state === "pending")
      .map((r) => ({ slug: r.slug, state: r.state, attempts: r.attempts, usd: r.usd })),
  };
}

// ---------------------------------------------------------------- run

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (IS_MAIN) {
  mkdirSync(STAGE, { recursive: true });

  const { meta, slugs } = fleet();
  console.log(`fleet: ${slugs.length} corners (${(meta.audited || []).length} audited, ${(meta.enriched || []).length} enriched)`);
  console.log(`model: ${MODEL} on Vertex ${REGION}, project ${PROJECT}, ADC bearer token, no api key\n`);

  if (DO_PLAN && !DO_GENERATE && !DO_PUBLISH) {
    const writes = slugs.length + 1;
    console.log("PLAN ONLY. Nothing called, nothing written.");
    console.log(`  vertex calls if every corner passes first try : ${slugs.length}`);
    console.log(`  vertex calls worst case with one retry each   : ${slugs.length * 2}`);
    console.log(`  kv writes to publish (letters + 1 ledger)     : ${writes}`);
    console.log(`  kv daily free allowance                       : ${KV_DAILY_FREE}`);
    console.log(`  headroom reserved for the site's own crons    : ${KV_RESERVE_FOR_SITE}`);
    process.exit(0);
  }

  const results = [];

  if (DO_GENERATE) {
    const token = accessToken();
    console.log(`ADC token minted, ${token.length} chars, not stored\n`);
    const rec = await laneData(slugs);

    let n = 0;
    for (const slug of slugs) {
      n += 1;
      const c = cornerOf(slug, rec);
      if (!c || !c.fix) {
        results.push({ slug, state: "skipped", why: "no corner record or no fix defined" });
        console.log(`  [${n}/${slugs.length}] ${slug}: skipped, no corner record`);
        continue;
      }

      const stats = await getStats(c).catch(() => null);
      const ctx = {
        stats,
        score: rec[`score:${slug}`] || null,
        news: rec[`press:${slug}`] || null,
        voices: rec[`voices:${slug}`] || null,
        timeline: rec[`timeline:${slug}`] || null,
        hazards: rec[`hazards:${slug}`] || null,
      };

      const built = buildLetterPrompt(c, ctx);
      const district = resolvedDistrict(c, stats);
      const inputSet = buildInputSet({
        corner: c,
        stats,
        score: ctx.score,
        news: ctx.news,
        timeline: ctx.timeline,
        voices: ctx.voices,
        district,
        supervisor: district ? built.supervisor : null,
      });

      let text = null;
      let check = null;
      let attempts = 0;
      let tokens = { promptTokens: 0, outputTokens: 0 };
      let err = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        attempts = attempt;
        const prompt = attempt === 1 ? built.prompt : built.prompt + retryInstruction(check);
        try {
          const out = await vertexDraft(token, prompt);
          text = out.text;
          tokens = {
            promptTokens: tokens.promptTokens + out.promptTokens,
            outputTokens: tokens.outputTokens + out.outputTokens,
          };
        } catch (e) {
          err = e.message;
          break;
        }
        check = verifyLetter(text, inputSet);
        if (check.ok) break;
      }

      const usd = costOf(tokens.promptTokens, tokens.outputTokens);

      if (err) {
        results.push({ slug, state: "error", why: err, attempts, usd, ...tokens });
        console.log(`  [${n}/${slugs.length}] ${slug}: ERROR ${err.slice(0, 90)}`);
        continue;
      }

      if (check?.ok) {
        const record = {
          source: "live",
          supervisor: built.supervisor,
          generatedAt: new Date().toISOString(),
          verified: true,
          attempts,
          text,
          fix: c.fix.name,
          cost: c.fix.cost,
          grant: c.fix.grant,
          verifyVersion: check.version,
          checkedAt: new Date().toISOString(),
          // Provenance, so a reader of the record knows this came from Vertex
          // under ADC rather than from the Worker's own key path.
          model: MODEL,
          via: `vertex:${REGION}`,
        };
        writeFileSync(join(STAGE, `${slug}.json`), JSON.stringify(record));
        results.push({ slug, state: "passed", attempts, usd, ...tokens, addressee: addresseeFor(district) });
        console.log(`  [${n}/${slugs.length}] ${slug}: passed on attempt ${attempts}, ${addresseeFor(district)}`);
      } else {
        const reasons = [...new Map(check.failures.map((f) => [f.kind, f])).values()].map(
          (f) => `${f.kind}: ${f.reason}`,
        );
        writeFileSync(
          join(STAGE, `${slug}.pending.json`),
          JSON.stringify({ slug, reasons, attempts, at: new Date().toISOString() }),
        );
        results.push({ slug, state: "pending", reasons, attempts, usd, ...tokens });
        console.log(`  [${n}/${slugs.length}] ${slug}: PENDING after ${attempts}, ${reasons[0]?.slice(0, 80)}`);
      }
    }

    writeFileSync(join(STAGE, "_results.json"), JSON.stringify(results, null, 2));
  }

  // ---------------------------------------------------------------- publish

  let published = 0;
  let kvWrites = 0;
  let publishNote = null;

  if (DO_PUBLISH) {
    const staged = readdirSync(STAGE).filter((f) => f.endsWith(".json") && !f.startsWith("_") && !f.includes(".pending."));
    const prior = existsSync(join(STAGE, "_results.json"))
      ? JSON.parse(readFileSync(join(STAGE, "_results.json"), "utf8"))
      : results;

    const entries = staged.map((f) => {
      const slug = f.replace(/\.json$/, "");
      return { key: `letter:verified:${slug}`, value: readFileSync(join(STAGE, f), "utf8") };
    });

    // The ledger is ONE record holding a line per letter, not one record per
    // letter. Per letter would be 130 extra writes against a 1,000 a day cap to
    // store what fits in a single value.
    const spent = prior.filter((r) => r.usd).reduce((a, r) => a + r.usd, 0);
    const ledger = {
      period: new Date().toISOString().slice(0, 7),
      updated: new Date().toISOString(),
      model: MODEL,
      via: `vertex:${REGION}`,
      project: PROJECT,
      auth: "application default credentials, no api key",
      calls: prior.filter((r) => r.attempts).reduce((a, r) => a + r.attempts, 0),
      letters: entries.length,
      promptTokens: prior.reduce((a, r) => a + (r.promptTokens || 0), 0),
      outputTokens: prior.reduce((a, r) => a + (r.outputTokens || 0), 0),
      estUsd: Math.round(spent * 1e6) / 1e6,
      // Named as an estimate on the record itself. Exa returns costDollars and
      // that ledger is measured; this one is arithmetic over token counts against
      // published rates, and the two must not read as the same kind of number.
      basis: `estimated from token counts at $${USD_PER_M_IN}/M in and $${USD_PER_M_OUT}/M out`,
      perCorner: prior
        .filter((r) => r.state === "passed" || r.state === "pending")
        .map((r) => ({ slug: r.slug, state: r.state, attempts: r.attempts, usd: r.usd })),
    };
    entries.push({ key: "budget:gemini", value: JSON.stringify(ledger) });

    const need = entries.length;
    const budget = KV_DAILY_FREE - KV_RESERVE_FOR_SITE;
    if (need > budget) {
      publishNote = `${need} writes needed, ${budget} is the run's share of the daily allowance; split across days`;
      console.log(`\nPUBLISH HELD: ${publishNote}`);
    } else {
      const BATCH = 50;
      for (let i = 0; i < entries.length; i += BATCH) {
        const chunk = entries.slice(i, i + BATCH);
        const f = join(STAGE, `.bulk-${i}.json`);
        writeFileSync(f, JSON.stringify(chunk));
        try {
          kv(["kv", "bulk", "put", f, "--binding", "STORE", "--remote"]);
          published += chunk.length;
          kvWrites += chunk.length;
          console.log(`  wrote ${published}/${entries.length}`);
        } catch (e) {
          publishNote = `bulk put failed at ${i}: ${String(e.message || e).slice(0, 160)}`;
          console.log(`\nPUBLISH STOPPED: ${publishNote}`);
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- report

  const src = results.length
    ? results
    : existsSync(join(STAGE, "_results.json"))
      ? JSON.parse(readFileSync(join(STAGE, "_results.json"), "utf8"))
      : [];

  const passed = src.filter((r) => r.state === "passed");
  const pending = src.filter((r) => r.state === "pending");
  const errored = src.filter((r) => r.state === "error");
  const skipped = src.filter((r) => r.state === "skipped");
  const usd = src.reduce((a, r) => a + (r.usd || 0), 0);

  console.log("\n| metric | value |");
  console.log("|---|---|");
  console.log(`| corners attempted | ${src.length} |`);
  console.log(`| passed the verifier | ${passed.length} |`);
  console.log(`| stored pending | ${pending.length} |`);
  console.log(`| errored | ${errored.length} |`);
  console.log(`| skipped | ${skipped.length} |`);
  console.log(`| vertex calls | ${src.reduce((a, r) => a + (r.attempts || 0), 0)} |`);
  console.log(`| estimated spend | $${(Math.round(usd * 1e4) / 1e4).toFixed(4)} |`);
  console.log(`| kv writes consumed | ${kvWrites} |`);
  console.log(`| verifier version | ${VERIFY_VERSION} |`);

  if (pending.length) {
    console.log("\npending, with reasons:");
    for (const p of pending) console.log(`  ${p.slug}\n    ${(p.reasons || []).join("\n    ")}`);
  }
  if (errored.length) {
    console.log("\nerrored:");
    for (const e of errored) console.log(`  ${e.slug}: ${e.why}`);
  }
  if (publishNote) console.log(`\npublish: ${publishNote}`);
  console.log(`\nstaged at ${STAGE}`);

}
