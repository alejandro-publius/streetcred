// The city map is one flat image with transparent anchors laid over it, so the
// only thing standing between a tap and the right corner is this projection.
// It runs without a network or a key: `node tools/pin.test.mjs`.

import { fitView, pinPosition } from "../src/home.js";

const corners = [
  { slug: "a", name: "A", lat: 37.765051, lon: -122.419669, grade: "F", index: 100 },
  { slug: "b", name: "B", lat: 37.782210, lon: -122.410375, grade: "F", index: 95 },
  { slug: "c", name: "C", lat: 37.735000, lon: -122.494900, grade: "C", index: 42 },
  { slug: "d", name: "D", lat: 37.800000, lon: -122.408000, grade: "B", index: 25 },
];

let fail = 0;
const check = (name, cond, detail = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

// A corner sitting exactly at the map centre must land dead centre.
const single = [{ ...corners[0] }];
const v1 = fitView(single);
const p1 = pinPosition(single[0], v1);
check("lone corner sits at the centre", Math.abs(p1.xPct - 50) < 0.001 && Math.abs(p1.yPct - 50) < 0.001,
  `x=${p1.xPct.toFixed(3)}% y=${p1.yPct.toFixed(3)}%`);

// Every corner in a real spread must land inside the image, with the padding
// the fit was computed for.
const view = fitView(corners);
let inside = true;
for (const c of corners) {
  const p = pinPosition(c, view);
  if (p.xPct < 0 || p.xPct > 100 || p.yPct < 0 || p.yPct > 100) inside = false;
}
check("every pin lands inside the image", inside, `zoom=${view.zoom}`);

// North is up and east is right: higher latitude must sit higher on screen,
// greater longitude further right. Getting this backwards is the classic
// Mercator mistake and it would put every pin on the wrong corner.
const north = pinPosition({ lat: 37.80, lon: -122.44 }, view);
const south = pinPosition({ lat: 37.72, lon: -122.44 }, view);
check("higher latitude is higher on screen", north.yPct < south.yPct,
  `north=${north.yPct.toFixed(2)}% south=${south.yPct.toFixed(2)}%`);

const east = pinPosition({ lat: 37.76, lon: -122.39 }, view);
const west = pinPosition({ lat: 37.76, lon: -122.50 }, view);
check("greater longitude is further right", east.xPct > west.xPct,
  `east=${east.xPct.toFixed(2)}% west=${west.xPct.toFixed(2)}%`);

// The projection must be monotonic, so ordering on screen matches ordering on
// the ground for any pair.
const ordered = [37.72, 37.75, 37.78, 37.81].map((lat) => pinPosition({ lat, lon: -122.44 }, view).yPct);
check("latitude ordering is monotonic", ordered.every((v, i) => i === 0 || v < ordered[i - 1]),
  ordered.map((v) => v.toFixed(1)).join(" > "));

console.log(fail ? `\n${fail} FAILED` : "\npin projection holds");
process.exit(fail ? 1 : 0);
