// Workers AI imagery pilot. Renders locally, judges nothing, ships nothing.
//
// The question this exists to answer is narrow: conditioned on a corner's real
// Street View frame, is a Flux model on Workers AI good enough for the hazard
// and proposed-fix panels? Only a person looking at the output can answer that,
// so this produces files and a table and stops.
//
//   1. npx wrangler dev --remote -c tools/pilot/wrangler.jsonc --port 8799
//   2. node tools/imagery_pilot.mjs
//
// Zero KV writes by construction: the pilot Worker has no STORE binding, and
// the frames are read out of band with `wrangler kv key get` into
// scratch/imagery-pilot/frames/ before this runs. Zero dollars: every image is
// costed against the free daily neuron allocation before it is requested, and
// the run stops rather than crossing it.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = join(ROOT, "scratch", "imagery-pilot");
const FRAMES = join(SCRATCH, "frames");
const ENDPOINT = process.env.PILOT_ENDPOINT || "http://127.0.0.1:8799";

// ------------------------------------------------------------------ budget
//
// Workers AI gives every account 10,000 neurons a day, resetting 00:00 UTC.
// Neuron cost is not returned on the response, so it is computed here from the
// published per-model rates and the tile geometry. Tiles are 512x512 and a
// partial tile counts as a whole one.
const DAILY_FREE_NEURONS = 10000;

// Reserve a fifth of the day's allocation rather than spending to the line. A
// pilot that leaves nothing behind cannot be re-run after a bad prompt, and the
// cron lanes may want neurons later in the same UTC day.
const PILOT_CEILING = Number(process.env.PILOT_CEILING || 3000);

const MODELS = {
  "@cf/black-forest-labs/flux-2-klein-4b": {
    imageInput: true,
    // 5.37 neurons per input 512x512 tile, 26.05 per output tile. Fixed 4 step
    // model, so steps do not enter the cost.
    neurons: ({ inTiles, outTiles }) => 5.37 * inTiles + 26.05 * outTiles,
    steps: null,
  },
  "@cf/black-forest-labs/flux-2-dev": {
    imageInput: true,
    // 18.75 per input tile PER STEP, 37.50 per output tile PER STEP. The per
    // step multiplier is what makes this model expensive enough to matter.
    neurons: ({ inTiles, outTiles, steps }) => (18.75 * inTiles + 37.5 * outTiles) * steps,
    steps: 25,
  },
  "@cf/black-forest-labs/flux-1-schnell": {
    imageInput: false,
    // 4.80 per output tile, 9.60 per step. Text to image only: it cannot be
    // conditioned on the corner's frame, so it is the fallback and not the
    // candidate.
    neurons: ({ outTiles, steps }) => 4.8 * outTiles + 9.6 * steps,
    steps: 4,
  },
};

const tiles = (w, h) => Math.ceil(w / 512) * Math.ceil(h / 512);

// ------------------------------------------------------------------ corners

const CORNERS = [
  { slug: "16th-and-potrero", name: "16th and Potrero", note: "has Gemini-era renders stored" },
  { slug: "16th-mission", name: "16th Street and Mission Street", note: "flagship, has Gemini-era renders stored" },
  { slug: "6th-and-mission", name: "6th and Mission", note: "worst corner in the city, never had generated imagery" },
];

const readJson = (p) => {
  const t = readFileSync(p, "utf8");
  return JSON.parse(t.slice(t.indexOf("{")));
};

// The fix list for the two flagships lives in the registry rather than in KV,
// so it is read from the source of truth rather than guessed.
function fixFor(slug) {
  const fallback = "Continental crosswalks, corner daylighting, and a leading pedestrian interval";
  const p = join(FRAMES, `${slug}.corner.json`);
  if (existsSync(p)) {
    try {
      return readJson(p)?.fix?.name || fallback;
    } catch {
      /* registry corners are not in KV; fall through */
    }
  }
  const src = readFileSync(join(ROOT, "src", "data.js"), "utf8");
  const block = src.slice(src.indexOf(`"${slug}"`));
  const m = block.match(/name:\s*"([^"]*crosswalk[^"]*|[^"]*lane[^"]*|[^"]*interval[^"]*)"/i);
  return m ? m[1] : fallback;
}

function hazardLabels(slug) {
  const p = join(FRAMES, `${slug}.hazards.json`);
  if (!existsSync(p)) return [];
  try {
    return (readJson(p).items || [])
      .filter((i) => i.verdict === "CONFIRMED" || i.verdict === "CANDIDATE" || i.verdict === "REPORTED")
      .map((i) => ({ label: i.label, verdict: i.verdict }));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ prompts
//
// Deliberately close to the prompts the Gemini lane uses in src/imagery.js, so
// the comparison a human makes is about the model rather than about the wording.
// The difference is that the hazard list here is the corner's actual audited
// list rather than a generic instruction.

const hazardPrompt = (name, hazards) =>
  `This is a real street-level photograph of the intersection of ${name} in San Francisco. ` +
  "Annotate it as a professional traffic safety audit. Keep the underlying photograph " +
  "completely unchanged and photorealistic underneath the overlay. " +
  "Overlay semi-transparent RED hatching on sub-standard or faded pedestrian crosswalk " +
  "markings, and semi-transparent AMBER hatching on vehicle turning and through-traffic " +
  "conflict zones where cars cross the pedestrian path. " +
  (hazards.length
    ? `The audit at this corner found: ${hazards.map((h) => `${h.label} (${h.verdict})`).join("; ")}. `
    : "") +
  "Do not name any other street. Do not invent hazards that are not visible in the photograph.";

const fixPrompt = (name, fix) =>
  `Edit this street-level photograph of ${name} in San Francisco to show a proposed ` +
  "pedestrian safety upgrade. Keep all buildings, vehicles, people, sky, poles, overhead " +
  "wires and traffic signals exactly as they are. Same camera angle, same lighting, same " +
  `time of day, photorealistic. The proposed upgrade is: ${fix}. ` +
  "Repaint the crosswalks as bright white high-visibility continental ladder stripes. " +
  "Do not add any text, labels or watermarks.";

// ------------------------------------------------------------------ frames

// Flux 2 requires every input image to be smaller than 512x512, so the 640x400
// Street View frame is downscaled before it is sent rather than after it is
// rejected. Pillow is already a dependency of tools/make_grade_cards.py.
function prepareFrame(slug) {
  const src = join(FRAMES, `${slug}.orig.jpg`);
  const out = join(FRAMES, `${slug}.in.jpg`);
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(src)})
im.thumbnail((448, 448), Image.LANCZOS)
im.save(${JSON.stringify(out)}, "JPEG", quality=88)
print("%d %d" % im.size)
`;
  const size = execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim().split(" ").map(Number);
  return { path: out, width: size[0], height: size[1], b64: readFileSync(out).toString("base64") };
}

// ------------------------------------------------------------------ the run

const OUT_W = 1024;
const OUT_H = 640; // the frame is 16:10, so a square output would crop the street

async function render({ model, prompt, frame, attempt }) {
  const spec = MODELS[model];
  const body = {
    model,
    prompt,
    width: OUT_W,
    height: OUT_H,
    ...(spec.steps ? { steps: spec.steps } : {}),
    ...(spec.imageInput && frame ? { frameB64: frame.b64 } : {}),
  };
  const t0 = Date.now();
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({ ok: false, error: `non-json response ${r.status}` }));
  return { ...d, seconds: Math.round((Date.now() - t0) / 100) / 10, attempt };
}

function costOf(model, frame) {
  const spec = MODELS[model];
  return (
    Math.round(
      spec.neurons({
        inTiles: spec.imageInput && frame ? tiles(frame.width, frame.height) : 0,
        outTiles: tiles(OUT_W, OUT_H),
        steps: spec.steps || 0,
      }) * 100,
    ) / 100
  );
}

const MODEL = process.env.PILOT_MODEL || "@cf/black-forest-labs/flux-2-klein-4b";

mkdirSync(SCRATCH, { recursive: true });

const rows = [];
let spent = 0;
let stopped = null;

console.log(`model:   ${MODEL}`);
console.log(`output:  ${OUT_W}x${OUT_H} (${tiles(OUT_W, OUT_H)} tiles of 512x512)`);
console.log(`ceiling: ${PILOT_CEILING} neurons of the ${DAILY_FREE_NEURONS} free per day\n`);

for (const corner of CORNERS) {
  const frame = prepareFrame(corner.slug);
  const panels = [
    { panel: "hazards", prompt: hazardPrompt(corner.name, hazardLabels(corner.slug)) },
    { panel: "fix", prompt: fixPrompt(corner.name, fixFor(corner.slug)) },
  ];

  for (const { panel, prompt } of panels) {
    const cost = costOf(MODEL, frame);
    let done = false;

    for (let attempt = 1; attempt <= 2 && !done; attempt += 1) {
      // The guard the rules require: cost the image before requesting it, and
      // stop the run rather than cross the line.
      if (spent + cost > PILOT_CEILING) {
        stopped = `would have spent ${(spent + cost).toFixed(2)} of a ${PILOT_CEILING} neuron ceiling`;
        break;
      }

      process.stdout.write(`  ${corner.slug} ${panel} attempt ${attempt} ... `);
      const res = await render({ model: MODEL, prompt, frame, attempt });
      spent += cost;

      if (res.ok && res.image) {
        const nm = `${corner.slug}__${panel}__${MODEL.split("/").pop()}__${cost}n.jpg`;
        writeFileSync(join(SCRATCH, nm), Buffer.from(res.image, "base64"));
        rows.push({ image: nm, model: MODEL.split("/").pop(), neurons: cost, seconds: res.seconds, attempt, ok: true });
        console.log(`ok, ${res.seconds}s, ${cost} neurons`);
        done = true;
      } else {
        rows.push({
          image: `${corner.slug} ${panel} (attempt ${attempt})`,
          model: MODEL.split("/").pop(),
          neurons: cost,
          seconds: res.seconds,
          attempt,
          ok: false,
          error: String(res.error || "unknown").slice(0, 120),
        });
        console.log(`FAILED: ${String(res.error || "unknown").slice(0, 100)}`);
      }
    }
    if (stopped) break;
  }
  if (stopped) break;
}

// ------------------------------------------------------------------ report

console.log("\n| image | model | neurons | seconds |");
console.log("|---|---|---|---|");
for (const r of rows) {
  console.log(`| ${r.ok ? r.image : r.image + " FAILED"} | ${r.model} | ${r.neurons} | ${r.seconds} |`);
}
console.log(`\nneurons spent: ${spent.toFixed(2)} of ${DAILY_FREE_NEURONS} free today`);
console.log(`images written: ${rows.filter((r) => r.ok).length}, failures: ${rows.filter((r) => !r.ok).length}`);
if (stopped) console.log(`STOPPED EARLY: ${stopped}`);
console.log(`\noutputs: ${SCRATCH}`);

writeFileSync(join(SCRATCH, "pilot-results.json"), JSON.stringify({ model: MODEL, spent, rows, stopped }, null, 2));
