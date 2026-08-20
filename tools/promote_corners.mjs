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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
export function eligible(meta, keyNames, sweepRows, limit) {
  const enr = new Set(meta.enriched || []);
  const today = new Set(keyNames.filter((n) => /^img:.+:today$/.test(n)).map((n) => n.split(":")[1]));
  const fix = new Set(keyNames.filter((n) => /^img:.+:fix$/.test(n)).map((n) => n.split(":")[1]));
  const pool = [...enr].filter((s) => today.has(s) && !fix.has(s));
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

  const picks = eligible(meta, keyNames, rows, N);
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
      let done = null;
      let tok = { promptTokens: 0, outputTokens: 0 };
      let held = null;

      for (let attempt = 1; attempt <= 2 && !done; attempt += 1) {
        let out;
        try {
          out = await render(token, frame.toString("base64"), prompt);
        } catch (e) {
          held = `render error: ${e.message}`;
          break;
        }
        tok = { promptTokens: tok.promptTokens + out.promptTokens, outputTokens: tok.outputTokens + out.outputTokens };
        const cand = join(STAGE, `${slug}.attempt${attempt}.jpg`);
        writeFileSync(cand, Buffer.from(out.b64, "base64"));
        const after = readRegions(cand, `${slug}_out${attempt}`);
        const gate = await checkLegibility({ inputRead: before, renderRead: after });
        if (gate.verdict === "pass") {
          writeFileSync(staged, Buffer.from(out.b64, "base64"));
          done = { attempt, gate };
        } else {
          held = `${gate.reasons.join("; ")}`;
        }
      }

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
  if (held.length) {
    console.log("\nheld, with reasons and the frame kept for diagnosis:");
    for (const h of held) console.log(`  ${h.slug}: ${h.why}`);
  }
  console.log(`\nstaged at ${STAGE}`);
}
