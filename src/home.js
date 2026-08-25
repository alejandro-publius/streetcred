// The city view. One static map image, one KV read, no map SDK.
//
// The pins are drawn by Google Static Maps as part of the image. What sits on
// top is a set of transparent anchors positioned by the same Web Mercator math
// the server used to ask for the image, so a tap on a pin lands on that
// corner's page. Getting that math right is what buys a clickable map for the
// cost of a single image request.

import { FONT_LINK, BASE_CSS, META, MASTHEAD, FOOTER, STATBAND, HERO_CORNER, PACIFIC_DAY_JS } from "./page.js";
import { pacificToday } from "./data.js";

// The streak, newest first, with no chip dated beyond today in
// America/Los_Angeles. The store clamps new entries, so the filter only fires
// on a record written before that guard existed, and hiding one stale-future
// chip is better than the homepage claiming an audit that has not happened
// yet. Exported for the test that pins it.
// The funnel sentence's cleared count, linked to the corners that actually
// carry a cleared account, so a judge is one click from live scraper output.
// Read from the stored summary's per-corner map; with no map the count stands
// unlinked rather than pointing anywhere it cannot prove.

// Monochrome marks for the pipeline rows that have no product logo: a
// database for the city's records, a shield for the deterministic gate, a
// person for the reader. Drawn in currentColor so they take the row's ink
// and can never read as a brand another sponsor did not get.
const GLYPH = {
  db: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg>`,
  gate: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z"/><path d="M8.5 12l2.5 2.5 4.5-4.5"/></svg>`,
  you: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20.5c1.2-3.8 3.9-5.5 7-5.5s5.8 1.7 7 5.5"/></svg>`,
};

// What the scrapes actually produced, in the site's own vocabulary.
//
// The plain sentence counts corners whose scrape kept an account. Once the
// corner check has run there are three different things to count and merging
// them reads as a stronger claim than the evidence supports: an account about
// this exact crossing, an account about one of its streets, and an account
// that named a different crossing and is withheld. `check` is a stamped
// snapshot written by tools/recount_voices.mjs; it is deliberately dropped by
// the next ingest rather than carried forward, because a stale breakdown is
// worse than none, and this falls back to the plain sentence when it is gone.
export const voicesFunnel = (voices) => {
  const c = voices?.check;
  const num = (v, href) => `<a href="${href}">${Number(v).toLocaleString("en-US")}</a>`;
  if (!c) {
    return `${num(voices?.withQuote ?? 0, "/audited")} cleared the relevance filter, the rest recorded as scraped and empty, a result rather than a gap.`;
  }
  const bits = [];
  if (c.crossing) bits.push(`${num(c.crossing, "/audited")} describe the crossing itself`);
  if (c.corridor) bits.push(`${num(c.corridor, "/c/24th-and-valencia")} ${c.crossing ? "" : "account "}${c.corridor === 1 ? "is" : "are"} published as corridor evidence, about the street rather than the crossing`);
  if (c.withheld) bits.push(`${c.withheld} named a different crossing and ${c.withheld === 1 ? "is" : "are"} withheld`);
  const empty = Math.max(0, Number(voices.commissioned || 0) - Number(c.crossing || 0) - Number(c.corridor || 0) - Number(c.withheld || 0));
  if (empty) bits.push(`the other ${empty} scraped empty, a result rather than a gap`);
  return `${bits.join("; ")}.`;
};

export const visibleRuns = (cotd, cap = pacificToday()) =>
  [...(cotd || [])].filter((e) => e && e.slug && (!e.date || String(e.date) <= cap)).reverse();
import { TIER_LABEL, TIER_NOTE, CITY_BOUNDS } from "./city.js";

const MAP_W = 640;
const MAP_H = 520;
const PAD = 58; // keep pins off the edges when fitting the viewport

// Web Mercator, the projection Google Static Maps uses.
//
//   x = 256 * (0.5 + lon/360)
//   y = 256 * (0.5 - ln((1+sin lat)/(1-sin lat)) / 4pi)
//
// Those are world coordinates at zoom 0. Multiplying by 2^zoom gives pixels at
// that zoom, so a point's offset from the map centre in image pixels is
// (world(point) - world(centre)) * 2^zoom. Identical here and in the browser.
function project(lat, lon) {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: 256 * (0.5 + lon / 360),
    y: 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

// Smallest integer zoom that fits every corner inside the image with padding.
export function fitView(corners) {
  const lats = corners.map((c) => c.lat);
  const lons = corners.map((c) => c.lon);
  const center = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
  const a = project(Math.min(...lats), Math.min(...lons));
  const b = project(Math.max(...lats), Math.max(...lons));
  const spanX = Math.abs(b.x - a.x) || 0.0001;
  const spanY = Math.abs(b.y - a.y) || 0.0001;
  let zoom = 12;
  for (let z = 16; z >= 9; z--) {
    if (spanX * 2 ** z <= MAP_W - PAD * 2 && spanY * 2 ** z <= MAP_H - PAD * 2) {
      zoom = z;
      break;
    }
  }
  return { center, zoom };
}

export function pinPosition(corner, view) {
  const p = project(corner.lat, corner.lon);
  const c = project(view.center.lat, view.center.lon);
  const scale = 2 ** view.zoom;
  return {
    xPct: ((MAP_W / 2 + (p.x - c.x) * scale) / MAP_W) * 100,
    yPct: ((MAP_H / 2 + (p.y - c.y) * scale) / MAP_H) * 100,
  };
}

// Matches the grade chips on the corner page exactly. B is a muted green so
// that A and B stop reading as the same grade on the map and the board.
const GRADE_HEX = { A: "0x788c5d", B: "0xa3b088", C: "0x6a9bcc", D: "0xe89a5f", F: "0xF07E26" };

// One image request for the whole city: markers batched by color, since Static
// Maps takes repeated `markers` params each carrying many points.
export function staticMapPath(corners, view) {
  const byColor = new Map();
  for (const c of corners) {
    const hex = GRADE_HEX[c.grade] || "0x8a867c";
    if (!byColor.has(hex)) byColor.set(hex, []);
    byColor.get(hex).push(`${c.lat.toFixed(6)},${c.lon.toFixed(6)}`);
  }
  const params = [
    `center=${view.center.lat.toFixed(6)},${view.center.lon.toFixed(6)}`,
    `zoom=${view.zoom}`,
    `size=${MAP_W}x${MAP_H}`,
    "scale=2",
    "maptype=roadmap",
  ];
  for (const [hex, points] of byColor) {
    params.push(`markers=${encodeURIComponent(`color:${hex}|size:small|`)}${points.join(encodeURIComponent("|"))}`);
  }
  return params.join("&");
}

const esc = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

function severityLine(c) {
  const k = c.counts || {};
  const bits = [];
  if (k.fatal) bits.push(`${k.fatal} fatal`);
  if (k.severe) bits.push(`${k.severe} severe`);
  if (k.otherVisible) bits.push(`${k.otherVisible} other visible`);
  if (k.pain) bits.push(`${k.pain} complaint of pain`);
  return bits.length ? bits.join(", ") : "no injury collisions in 5 years";
}

export const HOME = (corners, origin = "", cotd = [], suggestion = null, preview = false, city = null, watchlist = null, voices = null, press = null, spendUsd = null, embed = null, tiers = null, coverage = null) => {
  // A corner without finite geometry poisons every pin: fitView produces a NaN
  // center and every overlay lands at left:NaN%. One bad row on the board must
  // cost that row its pin, not the whole map its anchors. It happened: a board
  // restore once wrote a corner with no lat, and every pin on the homepage went
  // dead while the static image kept smiling underneath.
  const ranked = [...corners]
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .sort((a, b) => b.index - a.index);
  // Newest first. The log is append only, so the last entry is this morning's.
  const runs = visibleRuns(cotd);
  const today = runs[0] || null;
  const view = ranked.length ? fitView(ranked) : { center: { lat: 37.7749, lon: -122.4194 }, zoom: 12 };
  const title = "StreetCred: every SF intersection, graded";
  // The counter is the city's own count, read from city:meta, not a sum of
  // whatever happens to be loaded on this page. A number the page derives from
  // its own contents drifts the moment a layer fails to load.
  const scored = city?.meta?.totalScored ?? 0;
  const auditedCount = city?.meta?.totalAudited ?? ranked.length;
  // One source of truth for the two audited numbers, used by the subtitle, the
  // stat tile, the ticker and the map alt text. A corner counts as fully
  // audited only when both generated frames are stored; the rest are audited
  // from the records with imagery pending. When the imagery lane backfills,
  // textAudited falls to zero and every sentence below degrades back to the
  // simpler one without an edit.
  const fullyAudited = typeof tiers?.fullyAudited === "number" ? tiers.fullyAudited : auditedCount;
  const textAudited = typeof tiers?.textAudited === "number" ? tiers.textAudited : 0;
  const n = (v) => Number(v).toLocaleString("en-US");
  // The Danger Index, which is what the board is sorted by and what actually
  // differs between rows. The percentile that used to sit here is 99 for every
  // corner on the first page, so it ranked nothing and said nothing; it now sits
  // in the list header once, where a shared fact belongs. Display only: this
  // reads the same stored `points` the sort already used.
  const idx = (c) =>
    typeof c?.points === "number" ? String(Math.round(c.points * 10) / 10) : String(c?.index ?? "");
  const pendingClause = textAudited ? `${n(textAudited)} more with imagery pending, ` : "";
  const scopeLine = scored
    ? `${n(scored)} intersections graded citywide, <a class="subaud" href="/audited">${n(fullyAudited)} fully audited</a>, ${pendingClause}one attempted every morning.`
    : `<a class="subaud" href="/audited">${n(fullyAudited)} intersections fully audited</a>, ${pendingClause}one attempted every morning.`;
  // The coverage layer, and the two numbers the legend prints. Both are counted
  // off the discs actually drawn rather than off a roster length, so the legend
  // cannot claim a disc the map is not showing.
  const discs = Array.isArray(coverage?.discs) ? coverage.discs : [];
  const coverRadiusM = coverage?.radiusM || 80;
  const coverRendered = discs.filter((d) => d.rendered).length;
  const coverPending = discs.length - coverRendered;
  const board = city?.top?.length ? city.top : ranked;
  const boardIsCity = Boolean(city?.top?.length);
  // Built from the same live count the page prints, never a second copy of it.
  const desc = scored
    ? `${n(scored)} San Francisco intersections scored for street danger from the city's own crash and 311 records, with press coverage, resident voices, and a drafted letter to the right Supervisor.`
    : ranked.length
    ? `${ranked.length} San Francisco intersections scored for street danger from the city's own crash and 311 records, with press coverage, resident voices, and a drafted letter to the right Supervisor.`
    : "San Francisco intersections scored for street danger from the city's own crash and 311 records.";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/logo.svg">
${META({ title, description: desc, url: `${origin}/`, card: ranked.length ? "summary_large_image" : "summary" })}
${ranked.length ? `<meta property="og:image" content="${origin}/og.jpg?x=${ranked[0].slug}">` : ""}
${FONT_LINK}
<style>
${BASE_CSS}
.askhero{text-align:center;padding:26px 0 30px}
.askq{font-size:clamp(26px, 4.5vw, 40px);font-weight:700;letter-spacing:-.02em;margin:0 0 18px}
.findbig{margin:0 auto;max-width:520px;display:flex;justify-content:center;position:relative}
.findbig input{width:100%;max-width:380px;font-size:15px;padding:13px 20px}
.findbig button{font-size:14px;padding:13px 24px}
.findbig .ta{top:52px;text-align:left}
.scope{font-size:12.5px;color:var(--dim);margin:14px 0 0}
/* The city label moved out of the top right corner and under the search, into
   the space the hero already had. The bridge sits behind it, wider than the
   label and centred on it, at an opacity chosen by measuring the contrast of
   the text over its busiest crossing rather than by eye. It never reaches the
   input or the button: the mark starts below them and the drawing is clipped
   to its own box. */
/* The mark spans its column rather than a fixed 520, and the drawing is sized
   against that column and clipped to it. At 140 percent of a 362px phone
   container the bridge reached 29px past each edge of the wrap and gave the
   whole homepage a horizontal scrollbar. Decorative artwork must not be able
   to widen the document. */
/* Powered by.
   Hazard tape, reused. The stripe means one thing everywhere else on this site:
   somebody outside this project is saying this corner is dangerous, which is
   why it frames the press card and nothing else. It does not mean that here.
   The operator asked for this treatment on this card deliberately, and the note
   is in specs/HANDOFF.md rather than only in a commit message, because the next
   person to add a striped card will read the rule and not the exception.

   It sits in the left column's own whitespace rather than under the pair. The
   hero card is 635px against the left column's 394 at 1280, so there are 241px
   of nothing beneath the bridge. Making the hero span both grid rows puts this
   card inside that gap: row one is the left column's natural height, row two is
   this card, and the container is still as tall as the hero. Nothing below it
   moves. A third grid item without the span would have added a row to both
   columns and pushed the fold by its own height plus the 32px gap.

   Source order is askhero, hero, card, so the single-column layout below 900px
   needs no reordering at all: the card falls after the hero card on a phone,
   which is where it was asked for. */
.pby{margin-bottom:0}
@media(min-width:901px){
  .herohead > .herocorner{grid-column:2;grid-row:1 / span 2}
  .pby{grid-column:1;grid-row:2}
}
.pbycard{margin-bottom:0;padding:14px 16px;text-align:center}
.pbylabel{margin:0;font-size:10px;font-weight:700;letter-spacing:.13em;
  text-transform:uppercase;color:var(--dim)}
/* One mark per cell and no text beside it. The wordmarks already carry the
   names, so a label next to them would be the doubled label the case strip
   rules refuse. The names are said once, below, where they are also the links. */
.pbymarks{display:flex;align-items:center;justify-content:center;gap:26px;margin:11px 0 9px}
.pbymark{display:flex;align-items:center;justify-content:center;height:20px}
/* Matched on height, not on width. The two wordmarks have different aspect
   ratios, and matching width would print one of them half the size of the
   other. */
.pbymark img{height:20px;width:auto;display:block;opacity:.85}
.pbynote{margin:0;font-size:11.5px;color:var(--dim);line-height:1.5}
.pbynote a{color:var(--dim);text-decoration:underline;text-underline-offset:2px}
.pbynote a:hover{color:var(--ink)}
@media(max-width:900px){
  .pbycard{padding:13px 14px}
  .pbymarks{gap:22px}
}

.sfmark{position:relative;margin:34px auto 0;padding:26px 0 8px;isolation:isolate;overflow:clip}
/* Opacity chosen by measurement, not by eye. The counter is small text on
   --dim and starts at 5.04:1 over the bare page, so the bridge has very little
   room to spend: at 13 percent it drops to 4.44 and fails AA, at 11 it scrapes
   4.51. Nine leaves real margin at 4.61 and is still inside the range the mark
   was designed for. The big line never had a problem, sitting above 14:1
   throughout. */
.ggb{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(620px,100%);height:auto;opacity:.09;z-index:0;pointer-events:none}
.sfmark .corner{position:relative;z-index:1;margin:0 auto;text-align:center}
.sfmark .corner > b{font-size:26px;letter-spacing:-.01em;line-height:1.15}
.sfmark .corner > .csub{margin-top:2px;font-size:13px}
@media(max-width:600px){
  .sfmark{margin-top:26px;padding:20px 0 6px}
  .ggb{width:min(420px,100%);opacity:.08}
  .sfmark .corner > b{font-size:22px}
}
.mine{margin:0 0 22px}
.mhead{display:flex;align-items:baseline;gap:10px;margin:0 0 10px}
.mhead h2{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0}
.mnote{font-size:11px;color:var(--dim)}
.mclear{margin-left:auto;font-family:inherit;font-size:11.5px;color:var(--dim);background:none;
  border:1px solid var(--line2);border-radius:999px;padding:4px 11px;cursor:pointer}
.mclear:hover{color:var(--ink);border-color:var(--ink)}
.mrow{display:flex;gap:9px;flex-wrap:wrap}
.mcard{display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:inherit;
  background:var(--panel);border:1.5px solid var(--line3);border-radius:10px;padding:8px 13px;font-size:13px}
.mcard b{font-weight:600}
.mg{font-size:11px;font-weight:700;min-width:20px;height:20px;border-radius:6px;display:grid;
  place-items:center;color:#fff;background:var(--dimline)}
.mg.gA{background:var(--green)} .mg.gB{background:#a3b088} .mg.gC{background:var(--blue)}
.mg.gD{background:#e89a5f} .mg.gF{background:var(--accent)}
.mdot{width:7px;height:7px;border-radius:50%;background:var(--accent);display:inline-block}
.vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.hero-map{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line2);
  background:var(--card);margin:0 0 8px;
  /* The container owns its height, not the image inside it. When the Leaflet
     upgrade removes the static image, an auto-height container collapses to
     zero and takes the mounted map with it, invisibly: the DOM dump shows a
     working map and the screen shows nothing. */
  aspect-ratio:640/520}
.hero-map img{display:block;width:100%;height:auto}
/* Google anchors a marker's tip at the coordinate and draws the body above it,
   so the tap target is biased upward to sit on the part you can actually see. */
.pin{position:absolute;width:36px;height:36px;margin:-27px 0 0 -18px;border-radius:50%;
  display:block;text-indent:-9999px;overflow:hidden}
.pin:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.mapfoot{font-size:11.5px;color:var(--dim);margin:0 0 30px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.key{display:inline-flex;align-items:center;gap:5px}
.key i{width:9px;height:9px;border-radius:50%;display:block}
/* The A..F row under the map used to be five tiny dots beside five dim
   letters, which read as plain text at a glance. The letter itself is now the
   swatch, in the same .gA..gF colours the board rows and the corner pages use,
   so there is one source of grade colour on the site. */
/* The audited coverage legend. Deliberately not a grade colour: this layer is
   about how much of the city has been looked at, not about how dangerous a
   corner is, and borrowing the A to F palette would say the second thing. Ink
   at low opacity reads as territory. */
.covfoot{margin-top:-22px;align-items:baseline}
.covkey{width:13px;height:13px;border-radius:50%;display:block;flex:0 0 13px}
.covkey-on{background:rgba(20,27,45,.20);border:1.5px solid rgba(20,27,45,.55)}
.subaud{color:inherit;text-decoration:none;border-bottom:1px solid var(--line2)}
.subaud:hover{border-bottom-color:var(--ink)}
.covcount{font-variant-numeric:tabular-nums;color:var(--ink);font-weight:600;text-decoration:none;
  border-bottom:1px solid var(--line2)}
.covcount:hover{border-bottom-color:var(--ink)}
.covnote{flex-basis:100%;color:var(--dim);line-height:1.6;max-width:640px}
/* The layer toggle, sitting in the map's own control column. */
.covtoggle{font-family:Poppins,system-ui,sans-serif;font-size:11.5px;font-weight:600;
  color:var(--ink);background:var(--panel);border:1px solid var(--line2);border-radius:999px;
  padding:6px 12px;cursor:pointer;box-shadow:0 1px 3px rgba(20,27,45,.12);
  display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.covtoggle:hover{border-color:var(--ink)}
.covtoggle:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.covtoggle i{width:11px;height:11px;border-radius:50%;display:block;flex:0 0 11px;
  background:rgba(20,27,45,.20);border:1.5px solid rgba(20,27,45,.55)}
.covtoggle[aria-pressed="false"] i{background:none;border-color:var(--line2)}
.covtoggle[aria-pressed="false"]{color:var(--dim)}
@media(max-width:600px){
  /* Reachable on a phone: the control column is narrow, so the label shortens
     rather than wrapping the button off the map. */
  .covtoggle{font-size:11px;padding:6px 10px}
  .covtoggle .covlabel-long{display:none}
}
.gk{font-size:11px;font-weight:700;min-width:19px;height:19px;border-radius:5px;
  display:inline-grid;place-items:center;color:#fff;letter-spacing:0}
.board{border-top:1px solid var(--line2)}
.row{display:grid;grid-template-columns:34px 1fr auto auto;gap:14px;align-items:center;
  padding:13px 4px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit;
  transition:background-color 150ms ease-out}
.row:hover{background:var(--card)}
.rank{font-size:12.5px;font-weight:600;color:var(--dim);font-variant-numeric:tabular-nums}
/* Both are spans, so they need to be told to stack. Left inline they run
   together and the margin does nothing, which put every corner's name and its
   severity mix on one unbroken line. */
.rname{display:block;font-size:14.5px;font-weight:600;line-height:1.35}
.rsev{display:block;font-size:11.5px;color:var(--dim);margin-top:2px;line-height:1.4}
/* Which tier each row is in. The board is the whole city now, so a row has to
   say how much of it has actually been checked. */
.rt{display:inline-block;margin-left:8px;font-size:9px;font-weight:700;letter-spacing:.11em;
  padding:2px 6px;border-radius:999px;border:1px solid var(--line2);color:var(--dim);vertical-align:1px}
.rt.t-audited{border-color:var(--ink);color:var(--ink)}
.rt.t-scored{border-style:dashed}
.boardmore{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 4px 0;margin:0 0 30px}
.showall,.pbtn{font-size:12.5px;font-weight:600;color:var(--ink);background:var(--panel);
  border:1.5px solid var(--line3);border-radius:999px;padding:8px 16px;cursor:pointer}
.showall:hover,.pbtn:hover{border-color:var(--ink)}
.pbtn[disabled]{opacity:.45;cursor:not-allowed}
.pager{display:flex;align-items:center;gap:12px}
.pnum{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.ridx{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.rg{font-size:13px;font-weight:700;min-width:28px;height:28px;border-radius:8px;display:grid;
  place-items:center;color:#fff;background:var(--dim)}
.rg.gA{background:var(--green)}
.rg.gB{background:rgba(120,140,93,.62)}
.rg.gC{background:var(--blue)}
.rg.gD{background:rgba(240,126,38,.7)}
.rg.gF{background:var(--accent)}
/* Corner of the day. The one part of this page that changes while nobody is
   watching, so it says which morning it ran and by what. */
.cotd{display:flex;align-items:center;gap:14px;text-decoration:none;color:inherit;
  background:var(--panel);border:1.5px solid var(--line3);border-top:3px solid var(--accent);
  border-radius:12px;padding:15px 18px;margin:0 0 10px;box-shadow:0 1px 3px rgba(20,27,45,.06);
  transition:transform 150ms ease-out,box-shadow 150ms ease-out;flex-wrap:wrap}
.cotd:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(20,27,45,.10)}
.cotdk{font-size:10px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#b0560e}
.cotdn{font-size:16px;font-weight:600}
.cotds{font-size:11.5px;color:var(--dim);flex:1;min-width:180px}
.cotdg{font-size:13px;font-weight:700;min-width:28px;height:28px;border-radius:8px;display:grid;
  place-items:center;color:#fff;background:var(--dim)}
.cotdlog{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:0 0 26px}
/* The operations band, moved from under the hero to the foot of the page. It
   is what the machine has counted, spent, queued and audited unwatched, which
   reads beside Powered by and interrupted the search box where it used to sit.
   The rule is the seam: the page above it is for a visitor, below it is the
   machine talking about itself. */
.opsband{margin:34px 0 0;padding-top:26px;border-top:1px solid var(--line)}
.opsband .statband{margin-bottom:20px}
.opsband .cotdlog:last-child{margin-bottom:0}
.cotdq{font-size:11.5px;color:var(--dim);margin:0 0 10px;padding-left:2px}
.lpop{font-family:Poppins,system-ui,sans-serif;font-size:12.5px;line-height:1.5;color:var(--ink)}
.lpop-g{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:6px;color:#fff;font-weight:700;font-size:11px;padding:0 4px}
.lpop-s{color:var(--dim);font-size:11.5px}
.lpop a{color:var(--accent);font-weight:600;text-decoration:none}
/* Leaflet pins an inline width on the popup measured with white-space:nowrap
   and clamped to its own maxWidth, then its stylesheet adds 44px of horizontal
   margin on top. Sizing the popup to the map element is the real fix, in
   public/leafmap.js; this is the belt to that pair of braces, so a long
   crossing name wraps inside the box rather than being clipped by it. */
.leaflet-popup-content{width:auto !important;max-width:100%;margin:12px 16px}
.lpop{overflow-wrap:anywhere}
.leafshell{transition:opacity 300ms ease-out;z-index:1}
.cotdi{display:inline-flex;align-items:center;gap:5px;text-decoration:none;color:var(--dim);
  font-size:10.5px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:3px 9px}
.cotdi:hover{color:var(--ink);border-color:var(--line3)}
.cotdi i{width:7px;height:7px;border-radius:50%;display:block;background:var(--dim)}
.cotdc{font-size:10.5px;color:var(--dim);letter-spacing:.03em}
.caseline{list-style:none;margin:0;padding:0}
.caseline li + li{border-top:1px solid var(--line)}
.cfrow{display:grid;grid-template-columns:20px 24px 108px 1fr;align-items:center;column-gap:12px;
  padding:8px 6px;text-decoration:none;color:inherit;font-size:12.5px;line-height:1.5;border-radius:8px}
a.cfrow:hover{background:var(--card)}
a.cfrow:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.cfn{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;
  background:var(--ink);color:#fff;font-weight:700;font-size:10.5px}
.cfnblank{background:transparent}
.cfmark{width:24px;height:24px;display:grid;place-items:center;color:var(--dim)}
.cfmark img,.cfmark svg{display:block;max-width:24px;max-height:24px}
.cfname{font-weight:600}
.cfdesc{color:var(--ink)}
.cfinfra{margin:14px 0 0;padding-top:10px;border-top:1px solid var(--line);color:var(--dim)}
.cfinfra .cfname,.cfinfra .cfdesc{color:var(--dim)}
.cfinfra .cfrow{padding:0 6px}
@media (max-width:430px){
  .cfrow{grid-template-columns:20px 24px 1fr;row-gap:2px}
  .cfdesc{grid-column:3}
}
.gA{background:var(--green)}
.gB{background:rgba(120,140,93,.62)}
.gC{background:var(--blue)}
.gD{background:rgba(240,126,38,.7)}
.gF{background:var(--accent)}
/* A lead, never a finding. It only renders when Exa surfaced a crossing that
   the city's own intersection table recognises, and it says in its own text
   that nothing has been run on it. An empty result renders nothing at all
   rather than an apologetic panel. */
.lead{font-size:12.5px;color:var(--dim);line-height:1.6;margin:0 0 18px;padding:13px 16px;
  background:var(--card);border:1px solid var(--line2);border-radius:10px}
.lead b{color:var(--ink);font-weight:600}
.lead a{color:var(--dim);text-decoration:none;border-bottom:1px solid var(--line2)}
.lead a.leadgo{color:var(--accent);border-color:var(--accent);font-weight:600;white-space:nowrap}
.emptyboard{font-size:13.5px;color:var(--dim);line-height:1.6;padding:22px 0}
.boardkey{font-size:11.5px;color:var(--dim);line-height:1.6;margin:-4px 0 12px;padding-left:2px;max-width:640px}
.boardkey b{color:var(--ink);font-weight:600}
@media(max-width:600px){
  .row{grid-template-columns:26px 1fr auto auto;gap:9px}
  /* The index used to be hidden here, which left every phone row reading the
     same F with nothing to tell them apart. It is the column that ranks, so it
     shrinks instead of vanishing. */
  .ridx{font-size:15px}
}
</style>
</head>
<body>
<div class="wrap">
${MASTHEAD({ scored, active: "" })}
<main>

<div class="herohead">
<section class="askhero">
  <h1 class="askq">What's your corner's grade?</h1>
  <form class="find findbig" id="find" role="search">
    <input id="q" type="search" placeholder="Try 24th and Valencia" autocomplete="off"
      aria-label="Check any San Francisco corner">
    <button type="submit" id="findgo">Check</button>
    <div class="findmsg" id="findmsg" role="status" hidden></div>
  </form>
  <p class="scope" id="scope">${scopeLine}</p>
  <div class="sfmark">
    <svg class="ggb" viewBox="0 0 600 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <!-- Drawn, not traced: two towers, the main cable and its side spans, and
           suspenders placed on the curve rather than eyeballed. Decorative only,
           so it is aria-hidden and takes no pointer events. -->
      <g fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round">
        <!-- main cable, then the two side spans down to the anchorages -->
        <path d="M150,34 Q300,132 450,34"/>
        <path d="M0,86 Q75,52 150,34"/>
        <path d="M450,34 Q525,52 600,86"/>
        <!-- the deck -->
        <path d="M0,150 L600,150"/>
        <path d="M0,157 L600,157" stroke-width="1.4"/>
        <!-- towers: legs to the deck and below it, with their crossbeams -->
        <path d="M143,176 L143,26 M157,176 L157,26 M143,26 L157,26"/>
        <path d="M443,176 L443,26 M457,176 L457,26 M443,26 L457,26"/>
        <path d="M143,58 L157,58 M143,92 L157,92 M143,124 L157,124" stroke-width="1.6"/>
        <path d="M443,58 L457,58 M443,92 L457,92 M443,124 L457,124" stroke-width="1.6"/>
      </g>
      <g fill="none" stroke="var(--accent)" stroke-width="1.1" stroke-linecap="round">
        <line x1="167.6" y1="44.9" x2="167.6" y2="150.0"/>
        <line x1="185.3" y1="54.3" x2="185.3" y2="150.0"/>
        <line x1="202.9" y1="62.5" x2="202.9" y2="150.0"/>
        <line x1="220.6" y1="69.3" x2="220.6" y2="150.0"/>
        <line x1="238.2" y1="74.7" x2="238.2" y2="150.0"/>
        <line x1="255.9" y1="78.8" x2="255.9" y2="150.0"/>
        <line x1="273.5" y1="81.5" x2="273.5" y2="150.0"/>
        <line x1="291.2" y1="82.8" x2="291.2" y2="150.0"/>
        <line x1="308.8" y1="82.8" x2="308.8" y2="150.0"/>
        <line x1="326.5" y1="81.5" x2="326.5" y2="150.0"/>
        <line x1="344.1" y1="78.8" x2="344.1" y2="150.0"/>
        <line x1="361.8" y1="74.7" x2="361.8" y2="150.0"/>
        <line x1="379.4" y1="69.3" x2="379.4" y2="150.0"/>
        <line x1="397.1" y1="62.5" x2="397.1" y2="150.0"/>
        <line x1="414.7" y1="54.3" x2="414.7" y2="150.0"/>
        <line x1="432.4" y1="44.9" x2="432.4" y2="150.0"/>
        <line x1="25.0" y1="75.1" x2="25.0" y2="150.0"/>
        <line x1="50.0" y1="65.1" x2="50.0" y2="150.0"/>
        <line x1="75.0" y1="56.0" x2="75.0" y2="150.0"/>
        <line x1="100.0" y1="47.8" x2="100.0" y2="150.0"/>
        <line x1="125.0" y1="40.4" x2="125.0" y2="150.0"/>
        <line x1="475.0" y1="40.4" x2="475.0" y2="150.0"/>
        <line x1="500.0" y1="47.8" x2="500.0" y2="150.0"/>
        <line x1="525.0" y1="56.0" x2="525.0" y2="150.0"/>
        <line x1="550.0" y1="65.1" x2="550.0" y2="150.0"/>
        <line x1="575.0" y1="75.1" x2="575.0" y2="150.0"/>
      </g>
    </svg>
    <div class="corner"><b>San Francisco</b><span class="csub">${scored ? `${n(scored)} corners graded` : `${ranked.length} corners audited`}</span></div>
  </div>
</section>
${HERO_CORNER(embed)}
<section class="tape pby" aria-label="Powered by">
  <div class="panel pbycard">
    <p class="pbylabel">Powered by</p>
    <div class="pbymarks">
      <span class="pbymark"><img src="/logos/exa.svg" alt="Exa" width="77" height="24" loading="lazy"></span>
      <span class="pbymark"><img src="/logos/apify.svg" alt="Apify" width="87" height="24" loading="lazy"></span>
    </div>
    <p class="pbynote">Press discovery via <a href="/watchlist">Exa</a>. Resident voices via <a href="/c/24th-and-valencia">Apify</a>.</p>
  </div>
</section>
</div>
<section class="mine" id="mine" hidden aria-label="Corners you have checked">
  <div class="mhead"><h2>Your corners</h2><span class="mnote">Saved on this device only</span>
    <button class="mclear" id="mclear" type="button">Clear</button></div>
  <div class="mrow" id="mrow"></div>
</section>

${
  ranked.length
    ? `<div class="hero-map" id="map">
  <img src="/citymap.jpg" width="${MAP_W}" height="${MAP_H}"
    alt="Map of San Francisco with ${n(scored || ranked.length)} graded intersections marked, ${n(fullyAudited)} fully audited${
      textAudited ? ` and ${n(textAudited)} with imagery pending` : ""
    }">
  ${ranked
    .map((c) => {
      const p = pinPosition(c, view);
      return `<a class="pin" href="/c/${esc(c.slug)}" style="left:${p.xPct.toFixed(3)}%;top:${p.yPct.toFixed(3)}%" title="${esc(c.name)}, ${c.index}/100">${esc(c.name)}</a>`;
    })
    .join("\n  ")}
</div>
<p class="mapfoot" id="maplegend" hidden>
  <span class="key"><i style="background:var(--dim)"></i>AUDITED, every lane checked</span>
  <span class="key"><i style="background:none;border:2px solid var(--dim);width:7px;height:7px"></i>ENRICHED, records and index, no visual audit</span>
  <span class="key"><i style="background:var(--dim);opacity:.4;width:5px;height:5px"></i>SCORED, graded against the census</span>
</p>
<p class="mapfoot">
  <span class="key"><b class="gk gA">A</b></span>
  <span class="key"><b class="gk gB">B</b></span>
  <span class="key"><b class="gk gC">C</b></span>
  <span class="key"><b class="gk gD">D</b></span>
  <span class="key"><b class="gk gF">F</b></span>
  <span id="mapdata">Map data: Google.</span>
</p>${
  discs.length
    ? `
<p class="mapfoot covfoot" id="covlegend">
  <span class="key"><i class="covkey covkey-on"></i>Audited coverage: the ${coverRadiusM}m core around each fully audited corner (<a class="covcount" href="/audited">${n(discs.length)}</a>${
        coverPending ? `, ${n(coverPending)} awaiting a render` : ""
      }), one more every morning. <a href="/methodology#map">How this map is drawn</a></span>
</p>`
    : ""
}`
    : ""
}

${
  watchlist?.entries?.length
    ? `<p class="lead"><b>On the press watchlist</b> ${esc(watchlist.entries[0].name)}, graded ${esc(watchlist.entries[0].grade)}. Named in ${esc(watchlist.entries[0].article.domain)} coverage and confirmed against the city index${watchlist.entries.length > 1 ? `, with ${watchlist.entries.length - 1} more` : ""}. These are leads, not audits: nothing has been run on them. <a class="leadgo" href="/watchlist">See the watchlist</a></p>`
    : suggestion && suggestion.slug
    ? `<p class="lead"><b>Worth auditing next</b> ${esc(suggestion.name)}. Exa found it in coverage related to <a href="${esc(suggestion.seed.url)}" target="_blank" rel="noopener">${esc(suggestion.seed.domain)}</a>, and the city's intersection table confirms the crossing exists. This is a suggestion, not an audit: nothing has been run on it. <a class="leadgo" href="/c/${esc(suggestion.slug)}">Audit it</a></p>`
    : ""
}
<div class="eyebrow"><span>The scoreboard</span><span class="tag">Danger Index, worst first</span></div>
<p class="boardkey">Ranked by <b>Danger Index</b>. Every corner on this page is 99th percentile, which is why they all read F. <a href="/methodology#percentiles">Why percentiles</a></p>
${
  board.length
    ? `<div class="board" id="board">
${board
  .map(
    (c, i) => `  <a class="row" href="/c/${esc(c.slug)}">
    <span class="rank">${i + 1}</span>
    <span><span class="rname">${esc(c.name)}${c.tier ? `<span class="rt t-${esc(c.tier)}" title="${esc(TIER_NOTE[c.tier] || "")}">${esc(TIER_LABEL[c.tier])}</span>` : ""}</span><span class="rsev">${esc(severityLine(c))}${c.verdict ? ` &middot; ${esc(c.verdict)}` : ""}</span></span>
    <span class="ridx" title="Danger Index: reported harm within the scoring radius, weighted by severity">${idx(c)}</span>
    <span class="rg g${esc(c.grade)}" title="Worse than ${c.index}% of San Francisco intersections">${esc(c.grade)}</span>
  </a>`,
  )
  .join("\n")}
</div>
${
  boardIsCity
    ? `<div class="boardmore">
  <button class="showall" id="showall" type="button">Show all ${n(scored)} graded corners</button>
  <div class="pager" id="pager" hidden>
    <button class="pbtn" id="pprev" type="button">Previous</button>
    <span class="pnum" id="pnum" role="status"></span>
    <button class="pbtn" id="pnext" type="button">Next</button>
  </div>
</div>`
    : ""
}`
    : `<p class="emptyboard">No corners have been warmed yet. Type an intersection above and it will be graded on the spot.</p>`
}

<div class="opsband">
${STATBAND({
  scored,
  audited: fullyAudited,
  headlines: (press?.headlines || 0) + (press?.checkCitations || 0),
  headlinesAsOf: press?.asOf || null,
  spendUsd,
})}

${
  today
    ? `${city?.queueLength ? `<p class="cotdq">${n(city.queueLength)} corners in the audit queue, worst first.</p>` : ""}
${
  voices?.commissioned
    ? `<p class="cotdq">Resident voices commissioned autonomously at <a href="/status">${n(voices.commissioned)} corner${voices.commissioned === 1 ? "" : "s"}</a>; ${voicesFunnel(voices)}</p>`
    : ""
}
${
  runs.length
    ? `<div class="cotdlog">${runs
        .slice(0, 14)
        .map(
          (e) =>
            `<a class="cotdi" href="/c/${esc(e.slug)}" title="${esc(e.name || e.slug)}, ${esc(e.date)}"><i class="g${esc(e.grade || "A")}"></i><span>${esc(String(e.date).slice(5))}</span></a>`,
        )
        .join("")}<span class="cotdc">${runs.length} audited without a human so far${
          textAudited ? `, ${n(textAudited)} still waiting on imagery` : ""
        }</span></div>`
    : ""
}`
    : ""
}
</div>

<div class="panel">
  <div class="phs"><h2>How a corner becomes a case</h2></div>
  <div class="pbody">
  <ol class="caseline" aria-label="The pipeline, in causal order">
    <li><a class="cfrow" href="/methodology"><span class="cfn">1</span><span class="cfmark">${GLYPH.db}</span><b class="cfname">DataSF</b><span class="cfdesc">scores it from the city's own records</span></a></li>
    <li><a class="cfrow" href="/c/16th-mission"><span class="cfn">2</span><span class="cfmark"><img src="/logos/googlemaps.svg" alt="" width="24" height="24" loading="lazy"></span><b class="cfname">Google Maps</b><span class="cfdesc">photographs it</span></a></li>
    <li><a class="cfrow" href="/watchlist"><span class="cfn">3</span><span class="cfmark"><img src="/logos/exa-icon.svg" alt="" width="20" height="24" loading="lazy"></span><b class="cfname">Exa</b><span class="cfdesc">reads twelve years of news about it</span></a></li>
    <li><a class="cfrow" href="/c/24th-and-valencia"><span class="cfn">4</span><span class="cfmark"><img src="/logos/apify-icon.svg" alt="" width="24" height="24" loading="lazy"></span><b class="cfname">Apify</b><span class="cfdesc">listens to its residents</span></a></li>
    <li><a class="cfrow" href="/audited"><span class="cfn">5</span><span class="cfmark"><img src="/logos/gemini.svg" alt="" width="24" height="24" loading="lazy"></span><b class="cfname">Gemini</b><span class="cfdesc">audits the frame, draws the fix, writes the letter</span></a></li>
    <li><a class="cfrow" href="/methodology#gate"><span class="cfn">6</span><span class="cfmark">${GLYPH.gate}</span><b class="cfname">The gate</b><span class="cfdesc">a deterministic gate verifies every claim or the letter does not serve</span></a></li>
    <li><a class="cfrow" href="/c/16th-mission#letterpanel"><span class="cfn">7</span><span class="cfmark">${GLYPH.you}</span><b class="cfname">You</b><span class="cfdesc">send it: the letter is drafted, never sent by us</span></a></li>
  </ol>
  <p class="cfinfra"><span class="cfrow"><span class="cfn cfnblank" aria-hidden="true"></span><span class="cfmark"><img src="/logos/cloudflare.svg" alt="" width="24" height="24" loading="lazy"></span><b class="cfname">Cloudflare</b><span class="cfdesc">Workers serve the page, KV holds corners, imagery and grades</span></span></p>
  </div>
</div>

</main>
${preview ? '<div class="pvw">Preview</div>' : ''}
${FOOTER()}
</div>

<script>
${PACIFIC_DAY_JS}
const el = id => document.getElementById(id);
document.querySelectorAll(".eyebrow").forEach(e => e.classList.add("drawn"));

(function(){
  const form = el("find"), input = el("q"), go = el("findgo"), msg = el("findmsg");
  const say = t => { msg.textContent = t || ""; msg.hidden = !t; };
  form.addEventListener("submit", e => {
    e.preventDefault();
    const q = input.value.trim();
    if(!q) return;
    say(""); go.disabled = true; go.textContent = "Checking";
    const reset = () => { go.disabled = false; go.textContent = "Check"; };
    fetch("/api/resolve?q=" + encodeURIComponent(q)).then(r => r.json()).then(d => {
      if(d.ok){ location.href = "/c/" + encodeURIComponent(d.slug); return; }
      reset(); say(d.message || "That corner could not be found.");
    }).catch(() => { reset(); say("Lookup failed. Try again in a moment."); });
  });
  input.addEventListener("input", () => say(""));
  const nudge = el("nudge");
  if(nudge) nudge.addEventListener("click", () => { input.focus(); input.select(); });
})();

var VIEW = {lat: ${view.center.lat}, lon: ${view.center.lon}, zoom: ${view.zoom}};
// [south, west, north, east] from the corner index. The static image keeps
// VIEW, because that frame was computed for its exact pixel size; the
// interactive map fits these instead, for its own.
var CITY_BOUNDS = ${JSON.stringify(CITY_BOUNDS)};
// The audited zone. One entry per corner in the audited roster, drawn as a disc
// of COVERAGE_R metres, which is the radius the grade is computed over.
var COVERAGE = ${JSON.stringify(discs)};
var COVERAGE_R = ${coverRadiusM};
var AUDITED = ${JSON.stringify(
    ranked.map((c) => ({ slug: c.slug, name: c.name, lat: c.lat, lon: c.lon, grade: c.grade, index: c.index })),
  )};
// The scope line is server-rendered from city:meta and is not touched here.
// It used to be recomputed in the browser by adding two loaded layers
// together, which meant the headline number described whichever assets
// happened to arrive rather than what the city actually holds.

// Show all: page through the whole graded city, 50 rows at a time, one KV
// read per page behind /api/city. The top 25 are already in the HTML, so this
// only runs if somebody asks for more.
(function(){
  var btn = document.getElementById("showall");
  var board = document.getElementById("board");
  if(!btn || !board) return;
  var pager = document.getElementById("pager"), pnum = document.getElementById("pnum");
  var prev = document.getElementById("pprev"), next = document.getElementById("pnext");
  var page = 1, pages = 1, busy = false;
  var GRADE_TITLE = "Worse than ";
  function esc(t){ return String(t == null ? "" : t).replace(/[&<>"]/g, function(m){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]; }); }
  function severity(c){
    var k = c.counts || {}, bits = [];
    if(k.fatal) bits.push(k.fatal + " fatal");
    if(k.severe) bits.push(k.severe + " severe");
    if(k.otherVisible) bits.push(k.otherVisible + " other visible");
    if(k.pain) bits.push(k.pain + " complaint of pain");
    return bits.length ? bits.join(", ") : "no injury collisions in 5 years";
  }
  // Same rule as the server's idx(): the Danger Index, one decimal, falling
  // back to the percentile only if a row somehow has no points.
  function cidx(c){
    return (typeof c.points === "number") ? String(Math.round(c.points * 10) / 10) : String(c.index);
  }
  function draw(d){
    var start = (d.page - 1) * d.size;
    board.innerHTML = d.rows.map(function(c, i){
      return '<a class="row" href="/c/' + esc(c.slug) + '">' +
        '<span class="rank">' + (start + i + 1) + '</span>' +
        '<span><span class="rname">' + esc(c.name) +
        '<span class="rt t-' + esc(c.tier) + '">' + esc(String(c.tier).toUpperCase()) + '</span></span>' +
        '<span class="rsev">' + esc(severity(c)) + '</span></span>' +
        '<span class="ridx" title="Danger Index: reported harm within the scoring radius, weighted by severity">' + cidx(c) + '</span>' +
        '<span class="rg g' + esc(c.grade) + '" title="' + GRADE_TITLE + c.index +
        '% of San Francisco intersections">' + esc(c.grade) + '</span></a>';
    }).join("");
    page = d.page; pages = d.pages;
    pnum.textContent = "Page " + d.page + " of " + d.pages + ", " + d.total.toLocaleString("en-US") + " corners";
    prev.disabled = d.page <= 1;
    next.disabled = d.page >= d.pages;
  }
  function load(n){
    if(busy) return;
    busy = true;
    fetch("/api/city?page=" + n).then(function(r){ return r.json(); }).then(function(d){
      busy = false;
      if(!d || !d.rows) return;
      draw(d);
      board.scrollIntoView({behavior: "auto", block: "start"});
    }).catch(function(){ busy = false; });
  }
  btn.addEventListener("click", function(){
    btn.hidden = true;
    pager.hidden = false;
    load(1);
  });
  prev.addEventListener("click", function(){ if(page > 1) load(page - 1); });
  next.addEventListener("click", function(){ if(page < pages) load(page + 1); });
})();

// Your corners: what this browser has checked, kept only in this browser.
(function(){
  var wrap = document.getElementById("mine"), row = document.getElementById("mrow");
  if(!wrap || !row) return;
  var visits = [];
  try { visits = JSON.parse(localStorage.getItem("sc:visits") || "[]"); } catch(e){ visits = []; }
  if(!visits.length) return;
  var current = {};
  AUDITED.forEach(function(c){ current[c.slug] = c.grade; });
  fetch("/data/scoretier.json").then(function(r){return r.ok?r.json():{corners:[]};}).catch(function(){return {corners:[]};})
  .then(function(t){
    (t.corners||[]).forEach(function(c){ if(!(c.slug in current)) current[c.slug] = c.grade; });
    row.innerHTML = visits.slice(0, 12).map(function(v){
      var now = current[v.slug] || v.gradeSeen;
      var changed = current[v.slug] && v.gradeSeen && current[v.slug] !== v.gradeSeen;
      // Pacific, not UTC. toISOString here stamped tomorrow's date on every
      // corner checked after 5pm Pacific, so a chip and the Corner of the Day
      // block disagreed by a day on the same screen.
      var when = ptDay(v.at);
      return '<a class="mcard" href="/c/' + v.slug + '"><span class="mg g' + now + '">' + now + '</span><b>' +
        (v.name || v.slug) + '</b>' +
        (changed ? '<span class="mdot" title="Grade changed since you last looked: was ' + v.gradeSeen + '"></span>' : '') +
        (when ? '<span style="font-size:11px;color:var(--dim)">' + when + '</span>' : '') + '</a>';
    }).join("");
    wrap.hidden = false;
  });
  document.getElementById("mclear").addEventListener("click", function(){
    localStorage.removeItem("sc:visits");
    wrap.hidden = true;
  });
})();

// Interactive map, progressive enhancement. The static image and its anchor
// pins are the baseline; Leaflet replaces them in place only once tiles have
// actually arrived. Failure at any step leaves the baseline untouched.
(function(){
  var mapEl = document.getElementById("map");
  if(!mapEl || !window.fetch) return;
  var s = document.createElement("script");
  s.src = "/leafmap.js"; s.defer = true;
  s.onload = function(){
    StreetMap.whenNear(mapEl, function(){
      fetch("/data/scoretier.json").then(function(r){return r.ok?r.json():{corners:[]};}).catch(function(){return {corners:[]};})
      .then(function(tier){
        var auditedSlugs = new Set(AUDITED.map(function(c){return c.slug;}));
        var scored = (tier.corners||[]).filter(function(c){return !auditedSlugs.has(c.slug);});
        StreetMap.upgrade(mapEl, {
          center: [VIEW.lat, VIEW.lon], zoom: VIEW.zoom,
          // First paint only. Everything after it is the reader's: fitBounds
          // sets the opening frame and then zoom and pan behave exactly as
          // they did before.
          bounds: CITY_BOUNDS, boundsPadding: 14,
          coverage: COVERAGE, coverageRadiusM: COVERAGE_R,
          audited: AUDITED, scored: scored, heatUrl: "/data/city/dots.json",
          tapAnywhere: true,
          onReady: function(map){
            var md = document.getElementById("mapdata");
            if(md) md.textContent = "Map data (c) OpenStreetMap contributors (c) CARTO. Danger Index ranks reported harm, not risk per crossing.";
            var lg = document.getElementById("maplegend");
            if(lg) lg.hidden = false;
          }
        });
      });
    });
  };
  document.head.appendChild(s);
})();
</script>
<script src="/typeahead.js" defer></script>
</body>
</html>`;
};
