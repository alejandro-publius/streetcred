// Promote enriched corners by generating their proposed-fix render.
//
// Runs on a maintainer's machine against Vertex under Application Default
// Credentials. The Worker holds no model credential and is not involved.
//
//   node tools/promote_corners.mjs --plan
//   node tools/promote_corners.mjs --generate --n=7
//   node tools/promote_corners.mjs --publish
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(ROOT, "scratch", "imagery");
const FRAMES = join(STAGE, "frames");
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

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const argOf = (n, d) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const N = Number(argOf("n", "7"));
const DO_GENERATE = has("--generate");
const DO_PUBLISH = has("--publish");

// Ours, not Cloudflare's: the public daily image cap the Worker enforces. An
// offline run must not quietly exceed what the site would allow itself.
const DAILY_GENERATION_CAP = 25;

// Retry shape. MAX_ATTEMPTS covers both a legibility retry and a quota retry,
// which is why it is 3 rather than 2: a corner that loses one attempt to a rate
// window still gets its two real tries at the gate.
const MAX_ATTEMPTS = Number(process.env.RENDER_MAX_ATTEMPTS || 3);
const SPACING_MS = Number(process.env.RENDER_SPACING_MS || 20_000);

// A named subset, for retrying exactly the corners a quota window cost without
// paying again for the ones that already published.
const ONLY = (argOf("only", "") || "").split(",").map((x) => x.trim()).filter(Boolean);

const kv = (a) =>
  execFileSync("npx", ["wrangler", ...a], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

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

function accessToken() {
  return execFileSync(GCLOUD, ["auth", "application-default", "print-access-token"], {
    encoding: "utf8",
    timeout: 120_000,
  }).trim();
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
  return {
    ...spend,
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
  return {
    model: MODEL,
    via: `vertex:${LOCATION}`,
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

export function eligible(meta, keyNames, sweepRows, limit, only = []) {
  const enr = new Set(meta.enriched || []);
  const today = new Set(keyNames.filter((n) => /^img:.+:today$/.test(n)).map((n) => n.split(":")[1]));
  const fix = new Set(keyNames.filter((n) => /^img:.+:fix$/.test(n)).map((n) => n.split(":")[1]));
  const pool = [...enr].filter((s) => today.has(s) && !fix.has(s));
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

if (IS_MAIN) {
  mkdirSync(STAGE, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });

  const keyOut = kv(["kv", "key", "list", "--binding", "STORE", "--remote"]);
  const keyNames = JSON.parse(keyOut.slice(keyOut.indexOf("["))).map((k) => k.name);
  const meta = JSON.parse(readFileSync(join(ROOT, "data", "city", "meta.json"), "utf8"));
  const sweep = JSON.parse(readFileSync(join(ROOT, "sweep-results.json"), "utf8")).corners;
  const rows = {};
  for (const r of Array.isArray(sweep) ? sweep : Object.values(sweep)) if (r?.slug) rows[r.slug] = r;

  // A named subset overrides the ranked selection. eligible() skips corners that
  // already have a stored fix render, which is what makes the tool idempotent,
  // and a retry of corners a quota window cost has to bypass the ranking
  // without bypassing that skip.
  const picks = ONLY.length ? eligible(meta, keyNames, rows, 0, ONLY) : eligible(meta, keyNames, rows, N);
  console.log(`model:  ${MODEL} on Vertex locations/${LOCATION}, ADC, no api key`);
  console.log(`picks:  ${picks.length} enriched corners with a frame and no fix render, worst first`);
  for (const s of picks) console.log(`  ${s.padEnd(26)} ${rows[s]?.points ?? "?"} points`);
  console.log();

  if (picks.length > DAILY_GENERATION_CAP) {
    console.log(`refusing: ${picks.length} exceeds the site's own DAILY_GENERATION_CAP of ${DAILY_GENERATION_CAP}`);
    process.exit(1);
  }
  if (!DO_GENERATE && !DO_PUBLISH) {
    console.log("plan only, nothing called and nothing written");
    process.exit(0);
  }

  const results = [];

  if (DO_GENERATE) {
    const token = accessToken();
    console.log(`ADC token minted, ${token.length} chars, not stored\n`);

    for (const [i, slug] of picks.entries()) {
      const staged = join(STAGE, `${slug}.fix.jpg`);
      if (existsSync(staged)) {
        console.log(`  [${i + 1}/${picks.length}] ${slug}: already staged, skipping`);
        continue;
      }
      const framePath = join(FRAMES, `${slug}.jpg`);
      if (!existsSync(framePath)) {
        try {
          writeFileSync(framePath, kvBytes(`img:${slug}:today`));
        } catch {
          /* falls through to the check below */
        }
      }
      let frame = null;
      try {
        frame = readFileSync(framePath);
        // A wrangler error page is not a JPEG. Checking the magic bytes is what
        // stops a failed read being fed to the model as if it were a frame.
        if (frame.length < 1024 || frame[0] !== 0xff || frame[1] !== 0xd8) frame = null;
      } catch {
        frame = null;
      }
      if (!frame) {
        results.push({ slug, state: "skipped", why: "no stored Street View frame" });
        console.log(`  [${i + 1}/${picks.length}] ${slug}: skipped, no usable frame`);
        continue;
      }

      const cornerRaw = kv(["kv", "key", "get", `corner:${slug}`, "--binding", "STORE", "--remote", "--text"]);
      const corner = JSON.parse(cornerRaw.slice(cornerRaw.indexOf("{")));
      const prompt = FIX_PROMPT(corner.name, corner.fix?.name || "continental crosswalks and corner daylighting");

      const before = readRegions(framePath, `${slug}_in`);
      const wantStreets = streetNames(corner.name);

      // Refuse before spending. A corner whose source frame is unreadable in
      // every checked region cannot produce a passing render, so a call here
      // buys a hold that was already decided.
      const pre = sourceIsCheckable(before, wantStreets);
      if (!pre.checkable) {
        results.push({ slug, state: "held", why: `unrenderable: ${pre.why}`, usd: 0, promptTokens: 0, outputTokens: 0, preflight: true });
        console.log(`  [${i + 1}/${picks.length}] ${slug}: SKIPPED before spending, ${pre.why.slice(0, 80)}`);
        continue;
      }

      let done = null;
      let tok = { promptTokens: 0, outputTokens: 0 };
      let held = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt += 1) {
        let out;
        try {
          out = await render(token, frame.toString("base64"), prompt);
        } catch (e) {
          held = `render error: ${e.message}`;
          // A quota refusal is a rate window, not a spent allowance. Back off
          // and try again rather than burning the corner on one bad minute.
          if (/exhaust|quota|RESOURCE/i.test(String(e.message)) && attempt < MAX_ATTEMPTS) {
            const wait = backoffMs(attempt);
            console.log(`      quota refusal on attempt ${attempt}, waiting ${Math.round(wait / 1000)}s`);
            await sleep(wait);
            continue;
          }
          break;
        }
        tok = { promptTokens: tok.promptTokens + out.promptTokens, outputTokens: tok.outputTokens + out.outputTokens };
        const cand = join(STAGE, `${slug}.attempt${attempt}.jpg`);
        writeFileSync(cand, Buffer.from(out.b64, "base64"));
        const after = readRegions(cand, `${slug}_out${attempt}`);
        const gate = await checkLegibility({
          inputRead: before,
          renderRead: after,
          // The signage signal was dead until this was passed. checkLegibility
          // only compares the upper band against text it independently knows
          // belongs there, and with no street names supplied it abstained every
          // time, so the gate had been running on the watermark alone.
          expectStreets: wantStreets,
        });
        if (gate.verdict === "pass") {
          writeFileSync(staged, Buffer.from(out.b64, "base64"));
          done = { attempt, gate };
        } else {
          held = `${gate.reasons.join("; ")}`;
        }
      }

      // Spacing between corners, on top of the per attempt backoff above. The
      // five quota holds on 2026-08-20 all landed inside the same minute.
      if (i < picks.length - 1) await sleep(SPACING_MS);

      const usd = Math.round(((tok.promptTokens / 1e6) * 0.3 + (tok.outputTokens / 1e6) * 2.5) * 1e6) / 1e6;
      if (done) {
        writeFileSync(
          join(STAGE, `${slug}.meta.json`),
          JSON.stringify({
            slug,
            model: MODEL,
            via: `vertex:${LOCATION}`,
            attempt: done.attempt,
            checked: done.gate.checked,
            unchecked: done.gate.unchecked,
            promotedFrom: "enriched",
            at: new Date().toISOString(),
            usd,
          }),
        );
        results.push({ slug, state: "passed", attempt: done.attempt, usd, ...tok, gate: done.gate });
        console.log(
          `  [${i + 1}/${picks.length}] ${slug}: passed attempt ${done.attempt}, checked [${done.gate.checked.join(",")}] unchecked [${done.gate.unchecked.join(",")}]`,
        );
      } else {
        results.push({ slug, state: "held", why: held, usd, ...tok });
        console.log(`  [${i + 1}/${picks.length}] ${slug}: HELD, ${String(held).slice(0, 90)}`);
      }
    }
    writeFileSync(join(STAGE, "_results.json"), JSON.stringify(results, null, 2));
  }

  // ---------------------------------------------------------------- publish

  let published = 0;
  let kvWrites = 0;
  let publishNote = null;

  if (DO_PUBLISH) {
    const rows = results.length
      ? results
      : existsSync(join(STAGE, "_results.json"))
        ? JSON.parse(readFileSync(join(STAGE, "_results.json"), "utf8"))
        : [];
    const byslug = new Map(rows.map((r) => [r.slug, r]));

    const files = stagedRenderFiles(readdirSync(STAGE));
    const slugs = files.map(slugOfRender);
    console.log(`\npublishing ${slugs.length} render${slugs.length === 1 ? "" : "s"}`);

    if (slugs.length) {
      // Read the existing imgstatus for each, so the merge cannot drop a state
      // the corner already had.
      const keyFile = join(STAGE, `.imgkeys-${slugs.length}.json`);
      writeFileSync(keyFile, JSON.stringify(slugs.map((x) => `imgstatus:${x}`)));
      let existing = {};
      try {
        const out = kv(["kv", "bulk", "get", keyFile, "--binding", "STORE", "--remote"]);
        existing = JSON.parse(out.slice(out.indexOf("{")));
      } catch (e) {
        console.log(`  could not read existing imgstatus, treating all as new: ${String(e.message || e).slice(0, 90)}`);
      }

      // Two writes per render: the bytes, then the record that says the bytes
      // exist and where they came from. The bytes go first. A record claiming a
      // render that is not stored is a broken image on a live page; bytes with
      // no record are invisible and harmless, so that is the safer order to
      // fail in.
      const statusEntries = [];
      for (const f of files) {
        const slug = slugOfRender(f);
        const row = byslug.get(slug) || {};
        if (row.state === "held") {
          // Cannot happen through stagedRenderFiles, which selects only
          // `.fix.jpg` and a held render never gets one. Asserted anyway,
          // because "cannot happen" is what the letter publish said too.
          console.log(`  ${slug}: REFUSING, the run log says this render was held`);
          publishNote = `refused to publish ${slug}, held in the run log`;
          continue;
        }
        try {
          kv(["kv", "key", "put", `img:${slug}:fix`, "--path", join(STAGE, f), "--binding", "STORE", "--remote"]);
          kvWrites += 1;
        } catch (e) {
          console.log(`  ${slug}: image write FAILED, ${String(e.message || e).slice(0, 90)}`);
          publishNote = `image write failed for ${slug}`;
          continue;
        }
        let prior = existing[`imgstatus:${slug}`] ?? null;
        if (typeof prior === "string") { try { prior = JSON.parse(prior); } catch { prior = null; } }
        statusEntries.push({
          key: `imgstatus:${slug}`,
          value: JSON.stringify(
            promotedStatus(prior, {
              at: Date.now(),
              model: MODEL,
              via: `vertex:${LOCATION}`,
              attempt: row.attempt ?? null,
              usd: row.usd ?? 0,
              gate: row.gate || null,
            }),
          ),
        });
        published += 1;
        console.log(`  ${slug}: published, provenance promoted-from-enriched`);
      }

      if (statusEntries.length) {
        const bulk = join(STAGE, `.imgbulk-${statusEntries.length}.json`);
        writeFileSync(bulk, JSON.stringify(statusEntries));
        kv(["kv", "bulk", "put", bulk, "--binding", "STORE", "--remote"]);
        kvWrites += statusEntries.length;
      }
    }

    // The ledger, one record holding a line per render, held ones included.
    const ledger = buildRenderLedger(rows, { now: new Date().toISOString() });
    const lf = join(STAGE, ".renderledger.json");
    writeFileSync(lf, JSON.stringify([{ key: "budget:renders", value: JSON.stringify(ledger) }]));
    kv(["kv", "bulk", "put", lf, "--binding", "STORE", "--remote"]);
    kvWrites += 1;
    console.log(`  budget:renders written, ${ledger.published} published of ${ledger.attempted} attempted, $${(ledger.estUsd || 0).toFixed(4)}`);
  }

  const src = results.length
    ? results
    : existsSync(join(STAGE, "_results.json"))
      ? JSON.parse(readFileSync(join(STAGE, "_results.json"), "utf8"))
      : [];
  const passed = src.filter((r) => r.state === "passed");
  const held = src.filter((r) => r.state === "held");
  const usd = src.reduce((a, r) => a + (r.usd || 0), 0);

  console.log("\n| metric | value |");
  console.log("|---|---|");
  console.log(`| renders attempted | ${src.length} |`);
  console.log(`| passed the legibility gate | ${passed.length} |`);
  console.log(`| held | ${held.length} |`);
  console.log(`| estimated spend | $${usd.toFixed(4)} |`);
  console.log(`| published to kv | ${published} |`);
  console.log(`| kv writes consumed | ${kvWrites} |`);
  if (held.length) {
    console.log("\nheld, with reasons and the frame kept for diagnosis:");
    for (const h of held) console.log(`  ${h.slug}: ${h.why}`);
  }
  if (publishNote) console.log(`\npublish: ${publishNote}`);
  console.log(`\nstaged at ${STAGE}`);
}
