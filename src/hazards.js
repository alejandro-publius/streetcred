// Connecting the visual audit to the public record.
//
// Two halves, and only the first involves a model at all:
//
//   1. A structured audit pass asks Gemini which hazards from a fixed
//      vocabulary it can actually see in this corner's Street View frame. It
//      returns booleans, not prose.
//   2. Everything after that is arithmetic over DataSF. The labels CONFIRMED,
//      CANDIDATE and REPORTED are decided by the counts in `label()` below and
//      nowhere else, so the whole claim can be checked by reading one function.
//
// Why a separate audit call rather than reading the annotation pass: the image
// prompt names the two hazards it wants drawn, so it cannot discover anything.
// Corroborating a constant would prove nothing. This pass can come back with
// nothing flagged, which is the outcome that makes the flagged ones mean
// something.

import { soql } from "./resolve.js";

const DS_CRASHES = "ubvf-ztfx";
const DS_311 = "vw6y-z8j6";
const AUDIT_MODEL = "gemini-3.7-flash";
const RADIUS = 80;

// Bump when the vocabulary, the queries, or the thresholds change.
export const HAZARD_VERSION = "v1";

// Every crossing-pedestrian value in ped_action, listed exactly. DataSF carries
// case variants of the same label ("Crossing in" and "Crossing In"), so an
// exact IN list is safer here than a pattern match.
const CROSSING_ACTIONS = [
  "Crossing in Crosswalk at Intersection",
  "Crossing In Crosswalk at Intersection",
  "Crossing in Crosswalk Not at Intersection",
  "Crossing Not in Crosswalk",
];

// A 311 category needs this many reports in 12 months before it corroborates
// anything, or before it counts as something the record raised on its own.
const MIN_311 = 3;
// One pedestrian injury is not noise. It is the thing the page exists about.
const MIN_CRASH = 1;

// The controlled vocabulary. The model may only answer about these four, and
// each one carries the record query that can support or fail to support it.
export const HAZARDS = [
  {
    key: "faded_crosswalk",
    label: "Faded or sub-standard crosswalk markings",
    services: ["Street Defects", "Street Defect", "Sign Repair"],
    crossingCollisions: true,
  },
  {
    key: "turning_conflict",
    label: "Vehicle turning conflict zone",
    services: [],
    crossingCollisions: true,
  },
  {
    key: "lighting",
    label: "Inadequate street lighting",
    services: ["Streetlights"],
    crossingCollisions: false,
  },
  {
    key: "curb_sidewalk",
    label: "Curb or sidewalk in poor condition",
    services: ["Sidewalk or Curb", "Sidewalk and Curb", "Color Curb"],
    crossingCollisions: false,
  },
];

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

// The only model call in this file. It reports observations; it never labels.
export async function auditFrame(todayBytes, c, env) {
  const prompt =
    `This is a real Street View photograph of ${c.name} in San Francisco. ` +
    "You are performing a pedestrian safety audit of what is visible in this specific photograph. " +
    "For each of the four conditions below, answer whether you can actually see evidence of it in " +
    "this image. Answer false when you cannot see it, when the view is obstructed, or when you are " +
    "unsure. Do not assume a condition is present because the intersection looks busy. " +
    "Conditions: faded_crosswalk (crosswalk markings that are worn, faded, missing, or not high " +
    "visibility), turning_conflict (a place where turning vehicles cross the pedestrian path), " +
    "lighting (visibly inadequate or absent street lighting), curb_sidewalk (damaged, broken, or " +
    "obstructed curb or sidewalk). Return only JSON.";

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${AUDIT_MODEL}:generateContent`,
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
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: Object.fromEntries(
              HAZARDS.map((h) => [
                h.key,
                {
                  type: "OBJECT",
                  properties: {
                    present: { type: "BOOLEAN" },
                    note: { type: "STRING" },
                  },
                  required: ["present"],
                },
              ]),
            ),
            required: HAZARDS.map((h) => h.key),
          },
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`gemini audit ${r.status}`);
  const d = await r.json();
  const text = (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  const parsed = JSON.parse(text);
  return Object.fromEntries(
    HAZARDS.map((h) => [h.key, Boolean(parsed?.[h.key]?.present)]),
  );
}

// Counts the record has for each hazard. No model, no judgement, just queries.
async function evidenceFor(c) {
  const circle = `within_circle(point, ${c.lat}, ${c.lon}, ${RADIUS})`;
  const since1 = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);
  const since5 = new Date(Date.now() - 5 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 19);
  const crossings = CROSSING_ACTIONS.map((a) => `'${a}'`).join(",");

  const crossingQuery = soql(DS_CRASHES, {
    "$select": "count(*)",
    "$where": `${circle} AND collision_datetime > '${since5}' AND ped_action in(${crossings})`,
  })
    .then((r) => parseInt(r?.[0]?.count ?? 0, 10) || 0)
    .catch(() => 0);

  const serviceQueries = HAZARDS.map((h) =>
    h.services.length
      ? soql(DS_311, {
          "$select": "count(*)",
          "$where":
            `${circle} AND requested_datetime > '${since1}' ` +
            `AND service_name in(${h.services.map((s) => `'${s}'`).join(",")})`,
        })
          .then((r) => parseInt(r?.[0]?.count ?? 0, 10) || 0)
          .catch(() => 0)
      : Promise.resolve(0),
  );

  const [crossing, ...services] = await Promise.all([crossingQuery, ...serviceQueries]);
  return Object.fromEntries(
    HAZARDS.map((h, i) => [
      h.key,
      {
        reports311: services[i],
        crossingCollisions: h.crossingCollisions ? crossing : 0,
      },
    ]),
  );
}

// The whole labelling rule, in one place, so it can be read and disputed.
//
//   CONFIRMED  the model saw it and the record backs it
//   CANDIDATE  the model saw it and the record is silent
//   REPORTED   the model did not see it but the record raises it anyway
//
// A CANDIDATE is an observation, not a finding, and downstream copy has to keep
// treating it that way.
export function label(flagged, ev) {
  const supported =
    ev.reports311 >= MIN_311 || ev.crossingCollisions >= MIN_CRASH;
  if (flagged) return supported ? "CONFIRMED" : "CANDIDATE";
  return ev.reports311 >= MIN_311 ? "REPORTED" : null;
}

function detailFor(h, ev) {
  const bits = [];
  if (ev.reports311) bits.push(`${ev.reports311} 311 report${ev.reports311 === 1 ? "" : "s"} in 12 months`);
  if (ev.crossingCollisions)
    bits.push(
      `${ev.crossingCollisions} pedestrian crossing collision${ev.crossingCollisions === 1 ? "" : "s"} in 5 years`,
    );
  return bits.join(", ") || "no supporting records within 80 meters";
}

export async function corroborate(c, todayBytes, env) {
  // The audit and the record queries do not depend on each other, so they run
  // together. If the audit fails, the record half still produces REPORTED rows.
  const [flags, evidence] = await Promise.all([
    auditFrame(todayBytes, c, env).catch(() => null),
    evidenceFor(c),
  ]);

  const items = [];
  for (const h of HAZARDS) {
    const ev = evidence[h.key];
    const flagged = flags ? Boolean(flags[h.key]) : false;
    const verdict = label(flagged, ev);
    if (!verdict) continue;
    items.push({
      key: h.key,
      label: h.label,
      verdict,
      reports311: ev.reports311,
      crossingCollisions: ev.crossingCollisions,
      detail: detailFor(h, ev),
    });
  }

  const order = { CONFIRMED: 0, CANDIDATE: 1, REPORTED: 2 };
  items.sort((a, b) => order[a.verdict] - order[b.verdict]);

  return {
    source: "live",
    version: HAZARD_VERSION,
    audited: Boolean(flags),
    items,
    confirmed: items.filter((i) => i.verdict === "CONFIRMED").length,
    candidates: items.filter((i) => i.verdict === "CANDIDATE").length,
    reported: items.filter((i) => i.verdict === "REPORTED").length,
  };
}
