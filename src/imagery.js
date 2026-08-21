// On-demand imagery for corners that were never precomputed.
//
// The two derived states cost 10 to 20 seconds each of Gemini time, which is far
// longer than anyone will wait on a blank page. So nothing here is ever awaited
// by a page load: /api/imagery answers immediately with the Street View frame
// and a pending marker, generation runs in the background, and the page polls.
//
// The prompts are the same ones tools/generate_imagery.py uses at build time, so
// a corner generated on demand is indistinguishable from a precomputed one.

import {
  getImage, putImage, putImageryStatus, getImageryStatus, reserveGeneration,
  reservePhoto, photoBudget, getFrameIndex,
} from "./store.js";
import { skipsAudit } from "./city.js";

// ------------------------------------------------------------- provenance
//
// Where a corner's generated imagery came from, and it is not decoration.
//
// The 23 audited corners earned their renders through the daily cron, which
// admits a corner to the audited roster only once both generated states exist.
// A promoted corner did not: it was pulled out of the enriched pool because it
// had a stored Street View frame, given a proposed-fix render, and nothing
// else. It has no visual audit, no hazards pass, and it is not in the coverage
// layer. On a site whose entire claim is that it does not overstate what it
// checked, those two must not look the same on the page.
//
// The client used to decide the tier chip from imagery status alone:
// `IMG.status === "ready"` meant AUDITED. That would have flipped a promoted
// corner's chip to AUDITED the moment its render published, which is the exact
// confusion this field exists to prevent.
export const AUDITED = "audited";
export const PROMOTED_FROM_ENRICHED = "promoted-from-enriched";
const KNOWN_PROVENANCE = new Set([AUDITED, PROMOTED_FROM_ENRICHED]);

// Absent is not audited. A record written before this field existed carries no
// claim either way, and resolving that silence into the stronger of the two
// values is the same mistake as a gate that passes when it checked nothing.
// Callers get null and must say nothing rather than guess.
export function provenanceOf(status) {
  const p = status?.provenance;
  return KNOWN_PROVENANCE.has(p) ? p : null;
}

// The sentence a promoted corner owes its reader, directly under the render.
export const PROMOTED_NOTE =
  "This render was promoted from the enriched pool. This corner has not had a full visual audit " +
  "and is not counted in the audited coverage layer.";

export function provenanceNote(p) {
  return p === PROMOTED_FROM_ENRICHED ? PROMOTED_NOTE : "";
}

// What tier a corner may claim on the strength of its imagery. A promoted
// corner has a render and is still enriched, so imagery alone can never lift it.
export function tierFromImagery(status, provenance) {
  if (provenance === PROMOTED_FROM_ENRICHED) return "enriched";
  return status === "ready" ? "audited" : status ? "enriched" : null;
}

const MODEL = "gemini-3.1-flash-image";

const HAZARD_PROMPT = (name) =>
  `This is a real street-level photo of the intersection of ${name} in San Francisco. ` +
  "Annotate it as a professional traffic-safety audit: overlay semi-transparent RED " +
  "hatching on sub-standard or faded pedestrian crosswalk markings, and semi-transparent " +
  "AMBER hatching on vehicle turning and through-traffic conflict zones where cars cross " +
  "the pedestrian path. Add a small legend box in an upper corner with the heading " +
  `"Traffic Safety Audit: ${name}" and two entries: "RED: sub-standard / faded crosswalk ` +
  'markings" and "AMBER: vehicle conflict zone". Do not name any other street. Keep the ' +
  "underlying photograph completely unchanged and photorealistic underneath the overlay.";

const FIX_PROMPT = (name) =>
  `Edit this street-level photo of ${name} to show a proposed pedestrian safety upgrade. ` +
  "Keep all buildings, vehicles, people, sky, poles, overhead wires, and traffic signals " +
  "exactly as they are. Repave the roadway with fresh dark asphalt. Repaint all crosswalks " +
  "as bright white high-visibility continental (ladder) stripes. Add a green painted bike " +
  "lane with white flex posts. Add a concrete curb extension with low plantings at the " +
  "corner. Photorealistic, same camera angle, same lighting, same time of day. " +
  "Do not add any text, labels, or watermarks.";

// Chunked, because String.fromCharCode.apply on a 700KB array blows the stack.
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The metadata endpoint is free and does not count against the imagery quota,
// which is exactly why coverage is checked before anything is spent.
export async function hasCoverage(c, env) {
  try {
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${c.lat},${c.lon}&key=${env.GOOGLE_MAPS_API_KEY}`,
    );
    const d = await r.json();
    return d.status === "OK";
  } catch {
    return false;
  }
}

export async function fetchToday(c, env) {
  const url =
    "https://maps.googleapis.com/maps/api/streetview?size=640x400" +
    `&location=${c.lat},${c.lon}&heading=${c.heading ?? 0}&pitch=${c.pitch ?? 0}` +
    `&fov=90&key=${env.GOOGLE_MAPS_API_KEY}`;
  const r = await fetch(url);
  const type = r.headers.get("content-type") || "";
  if (!r.ok || !type.startsWith("image/")) throw new Error(`streetview ${r.status}`);
  return r.arrayBuffer();
}

async function generateOne(todayBytes, prompt, env) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: toBase64(todayBytes) } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    },
  );
  if (!r.ok) throw new Error(`gemini ${r.status}`);
  const d = await r.json();
  const parts = d?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error("gemini returned no image");
  return fromBase64(img.inlineData.data);
}

// Runs inside ctx.waitUntil, so it never delays a response. Both states are
// generated in parallel and each is stored the moment it lands, so a partial
// success still enables one button rather than throwing the pair away.
export async function generateStates(c, env) {
  try {
    const today = await getImage(env, c.slug, "today");
    if (!today) throw new Error("no today frame to work from");

    const jobs = [
      generateOne(today, HAZARD_PROMPT(c.name), env)
        .then(async (b) => {
          await putImage(env, c.slug, "hazards", b);
          return "hazards";
        })
        .catch(() => null),
      generateOne(today, FIX_PROMPT(c.name), env)
        .then(async (b) => {
          await putImage(env, c.slug, "fix", b);
          return "fix";
        })
        .catch(() => null),
    ];
    const done = (await Promise.all(jobs)).filter(Boolean);
    await putImageryStatus(env, c.slug, {
      status: done.length ? "ready" : "failed",
      states: done,
      at: Date.now(),
      // The Worker generating both states for a corner IS the audit path, so
      // anything written here is audited by construction. The promoted value is
      // only ever written by tools/promote_corners.mjs, which does not audit.
      provenance: AUDITED,
    });
  } catch {
    await putImageryStatus(env, c.slug, { status: "failed", states: [], at: Date.now() });
  }
}

// Decides what /api/imagery should say right now, and starts generation if this
// is the first ask. Never awaits generation itself.
const RECORDS_ONLY_NOTE =
  "This corner was warmed for its records only, so the visual audit was not generated. The Street View photograph is real.";

// Corners the citywide sweep graded but that no one has spent an audit on yet:
// the published score tier, and every other corner in the city shards behind
// it. The state must say "not yet" rather than "not ever", because these are
// exactly the corners the daily cron works through, worst first.
const SCORED_ONLY_NOTE =
  "Scored from city records. The visual audit has not run for this corner yet. The Street View photograph is real.";

export async function imageryFor(c, env, ctx, opts = {}) {
  const base = `/gen/${c.slug}`;
  const existing = await getImageryStatus(env, c.slug);

  if (existing?.status === "ready") {
    return {
      source: "cache",
      status: "ready",
      today: `${base}/today.jpg`,
      hazards: existing.states.includes("hazards") ? `${base}/hazards.jpg` : null,
      fix: existing.states.includes("fix") ? `${base}/fix.jpg` : null,
      // Travels to the client so the caption and the tier chip can both tell
      // the truth about a render that did not come from a full audit.
      provenance: provenanceOf(existing),
    };
  }
  if (existing?.status === "failed") {
    return {
      source: "live",
      status: "failed",
      note: "The visual audit could not be generated for this corner.",
      today: `${base}/today.jpg`,
      hazards: null,
      fix: null,
    };
  }
  if (existing?.status === "pending") {
    return { source: "live", status: "pending", today: `${base}/today.jpg`, hazards: null, fix: null };
  }
  if (existing?.status === "recordsonly") {
    return {
      source: "cache",
      status: "recordsonly",
      note: RECORDS_ONLY_NOTE,
      today: `${base}/today.jpg`,
      hazards: null,
      fix: null,
    };
  }
  if (existing?.status === "scoredonly") {
    return {
      source: "cache",
      status: "scoredonly",
      note: SCORED_ONLY_NOTE,
      today: `${base}/today.jpg`,
      hazards: null,
      fix: null,
    };
  }

  // A stored frame answers before anything is reserved or fetched.
  //
  // Without this, a scored corner whose frame was published in bulk had no
  // imgstatus record, fell through to the live path, reserved against the daily
  // photograph budget and re-fetched bytes that were already in KV. The index
  // is one read per isolate for the whole city.
  const framed = await getFrameIndex(env).catch(() => null);
  if (framed?.slugs?.has(c.slug)) {
    return {
      source: "cache",
      status: "scoredonly",
      note: SCORED_ONLY_NOTE,
      today: `${base}/today.jpg`,
      hazards: null,
      fix: null,
    };
  }

  // First ask for this corner. Confirm free things before spending anything.
  //
  // A corner that will not be audited still shows its real photograph, and the
  // metadata check below is free, but the frame itself is a billed Maps
  // request. There are 7,353 scored corners and one crawler is enough to fetch
  // all of them, so this lane reserves against a daily ceiling first. Nothing
  // is written when the reservation fails: the next visitor retries rather than
  // finding the corner pinned photoless forever.
  if (skipsAudit(c) && !(await reservePhoto(env))) {
    const b = await photoBudget(env);
    return {
      source: "live",
      status: "scoredonly",
      note:
        `${SCORED_ONLY_NOTE} The Street View frame is not loaded here yet: the daily photograph ` +
        `budget for scored corners is spent (${b.used} of ${b.cap}). It resets tomorrow.`,
      today: null,
      hazards: null,
      fix: null,
    };
  }

  if (!(await hasCoverage(c, env))) {
    await putImageryStatus(env, c.slug, { status: "nocoverage", states: [], at: Date.now() });
    return {
      source: "live",
      status: "nocoverage",
      note: "Street View has no imagery for this corner.",
      today: null,
      hazards: null,
      fix: null,
    };
  }

  let today;
  try {
    today = await fetchToday(c, env);
    await putImage(env, c.slug, "today", today);
  } catch {
    await putImageryStatus(env, c.slug, { status: "nocoverage", states: [], at: Date.now() });
    return {
      source: "live",
      status: "nocoverage",
      note: "Street View has no imagery for this corner.",
      today: null,
      hazards: null,
      fix: null,
    };
  }

  // A corner deliberately warmed for records only. The whole point of these is
  // to prove the grading scale has a bottom as well as a top, and that argument
  // is made entirely by the index and the collision record. Two billed image
  // generations per corner would buy nothing it needs, so they are not spent,
  // and the panel says so rather than showing an empty state that looks broken.
  if (skipsAudit(c)) {
    await putImageryStatus(env, c.slug, { status: "scoredonly", states: [], at: Date.now() });
    return {
      source: "live",
      status: "scoredonly",
      note: SCORED_ONLY_NOTE,
      today: `${base}/today.jpg`,
      hazards: null,
      fix: null,
    };
  }

  if (c.derived === false) {
    await putImageryStatus(env, c.slug, { status: "recordsonly", states: [], at: Date.now() });
    return {
      source: "live",
      status: "recordsonly",
      note: RECORDS_ONLY_NOTE,
      today: `${base}/today.jpg`,
      hazards: null,
      fix: null,
    };
  }

  // A corner whose records lanes are all empty is a strong signal the resolve
  // was wrong. Show the photograph, spend nothing on generating states for it.
  // Checked as a thunk so the stats query only runs on a corner's first ask.
  if (opts.recordsEmpty && (await opts.recordsEmpty())) {
    await putImageryStatus(env, c.slug, { status: "skipped", states: [], at: Date.now() });
    return {
      source: "live",
      status: "skipped",
      note: "No city records at this corner, so the visual audit was not generated.",
      today: `${base}/today.jpg`,
      hazards: null,
      fix: null,
    };
  }

  if (!(await reserveGeneration(env))) {
    await putImageryStatus(env, c.slug, { status: "atcapacity", states: [], at: Date.now() });
    return {
      source: "live",
      status: "atcapacity",
      note: "Daily image generation limit reached. Records and the photograph are unaffected.",
      today: `${base}/today.jpg`,
      hazards: null,
      fix: null,
    };
  }

  await putImageryStatus(env, c.slug, { status: "pending", states: [], at: Date.now() });
  ctx.waitUntil(generateStates(c, env));
  return { source: "live", status: "pending", today: `${base}/today.jpg`, hazards: null, fix: null };
}
