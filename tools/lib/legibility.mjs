// Did the text survive the render?
//
// The Workers AI pilot was rejected because Flux corrupted signage, street name
// plates and the Google watermark, and an evidence product cannot publish a
// photograph of a named intersection carrying a fabricated street sign. Any
// image model can do that, so the gate belongs in the pipeline rather than in
// the choice of vendor.
//
// The obvious gate is "OCR the render and check the text is legible". It does
// not work. Calibrated against the 23 known-good Street View frames already in
// KV, tesseract reads the Google watermark on only 9 of them: the mark is small,
// white, and sits on whatever the street happens to be. An absolute gate would
// have rejected 14 undamaged originals, which is a 61% false reject rate and a
// gate nobody would leave switched on.
//
// So the comparison is paired. Each corner is its own control: OCR the same
// region on the input frame and on the render, and fail only on demonstrated
// degradation. Where the input yields nothing legible the gate reports
// UNCHECKED for that signal rather than inventing a verdict, because "I could
// not read this either way" and "this render broke the text" are different
// findings and only one of them is a reason to hold a corner.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OCR_DIR = "scratch/ocr";

// Tesseract cannot read from the sandbox's /tmp, so scratch files go under the
// project. Found by watching leptonica report "image file not found" for a file
// that demonstrably existed.
function ocr(pngPath, psm = 7) {
  try {
    const r = execFileSync("tesseract", [pngPath, "stdout", "--psm", String(psm)], {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
    });
    return r.toString("utf8").replace(/\f/g, "").trim();
  } catch {
    return "";
  }
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// Crop, upscale and write a region for OCR. Upscaling matters: the watermark is
// a dozen pixels tall in the source and tesseract needs more than that.
async function regionPng(sharpLike, tag) {
  mkdirSync(OCR_DIR, { recursive: true });
  const p = join(OCR_DIR, `${tag}.png`);
  writeFileSync(p, sharpLike);
  return p;
}

// The two signals worth checking, as fractions of the image so they survive the
// input being 640x400 and the render being 1024x640.
export const REGIONS = {
  // Bottom left, where Street View puts its attribution.
  watermark: { x0: 0, y0: 0.9, x1: 0.36, y1: 1.0, psm: 7 },
  // Upper band, where overhead street name plates and speed limit signs sit.
  signage: { x0: 0.25, y0: 0.0, x1: 1.0, y1: 0.35, psm: 11 },
};

// Compare one region across input and render.
//
// Returns one of:
//   ok        the input was legible here and the render still is
//   degraded  the input was legible here and the render is not
//   unchecked the input was not legible here, so nothing can be concluded
export function compareRegion(inputText, renderText, expect) {
  const a = norm(inputText);
  const b = norm(renderText);
  const wanted = norm(expect || "");

  if (wanted) {
    const inputHas = a.includes(wanted);
    if (!inputHas) return { verdict: "unchecked", why: "the source frame does not read here either" };
    return b.includes(wanted)
      ? { verdict: "ok", why: `both read ${expect}` }
      : { verdict: "degraded", why: `source reads ${expect}, render reads ${JSON.stringify(renderText.slice(0, 40))}` };
  }

  return { verdict: "unchecked", why: "no expected text supplied for this region" };
}

// Run both regions over a pair of image buffers. `readRegion` is injected so the
// caller owns image decoding and this module stays testable without pixels.
export async function checkLegibility({ inputRead, renderRead, expectStreets = [] }) {
  const out = {};
  out.watermark = compareRegion(inputRead.watermark, renderRead.watermark, "Google");
  // Signage is checked ONLY against text we independently know belongs there:
  // this corner's own street names. The first version compared any three-letter
  // run in the source OCR against the render's, and on a 640x400 frame the
  // source "text" is mostly noise. It read 'N', 'as.', 'Ce', '"rst', 'aa' off a
  // clean photograph, called those six tokens, and then held the render for not
  // reproducing them. Comparing noise to noise and calling the difference
  // corruption is worse than not checking: it manufactures findings.
  out.signage = expectStreets && expectStreets.length
    ? compareRegion(inputRead.signage, renderRead.signage, expectStreets[0])
    : { verdict: "unchecked", why: "no street name legible in the source frame to check against" };

  const degraded = Object.entries(out).filter(([, v]) => v.verdict === "degraded");
  const checked = Object.entries(out).filter(([, v]) => v.verdict !== "unchecked");

  return {
    regions: out,
    // Three verdicts, not two.
    //
    // The first version returned pass whenever nothing was degraded, which
    // meant a render whose source frame was illegible in every region came back
    // "pass" with checked=[]. That is the gate reporting a clean bill of health
    // for an examination it never performed, and it is worse than a false
    // reject: a false reject wastes a render, this publishes an unverified
    // photograph of a named intersection and records that it was verified.
    //
    // Found by re-judging 6th-and-mission, which the old token-comparison gate
    // had held. Under the paired gate its source frame reads nothing at the
    // watermark and pure noise at the signage band, so both signals abstain and
    // the verdict was pass on zero evidence.
    //
    //   pass     at least one signal was readable in the source and survived
    //   hold     a signal that WAS readable stopped being readable
    //   abstain  nothing was checkable, so there is no verdict to give
    verdict: degraded.length ? "hold" : checked.length ? "pass" : "abstain",
    checked: checked.map(([k]) => k),
    unchecked: Object.entries(out).filter(([, v]) => v.verdict === "unchecked").map(([k]) => k),
    reasons: degraded.length
      ? degraded.map(([k, v]) => `${k}: ${v.why}`)
      : checked.length
        ? []
        : ["nothing legible in the source frame to check against, so this render is unverified rather than verified"],
  };
}

export { ocr, regionPng, norm };
