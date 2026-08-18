// The city view. One static map image, one KV read, no map SDK.
//
// The pins are drawn by Google Static Maps as part of the image. What sits on
// top is a set of transparent anchors positioned by the same Web Mercator math
// the server used to ask for the image, so a tap on a pin lands on that
// corner's page. Getting that math right is what buys a clickable map for the
// cost of a single image request.

import { LOGO, FONT_LINK, BASE_CSS } from "./page.js";

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

export const HOME = (corners, origin = "", cotd = [], suggestion = null) => {
  // A corner without finite geometry poisons every pin: fitView produces a NaN
  // center and every overlay lands at left:NaN%. One bad row on the board must
  // cost that row its pin, not the whole map its anchors. It happened: a board
  // restore once wrote a corner with no lat, and every pin on the homepage went
  // dead while the static image kept smiling underneath.
  const ranked = [...corners]
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .sort((a, b) => b.index - a.index);
  // Newest first. The log is append only, so the last entry is this morning's.
  const runs = [...cotd].filter((e) => e && e.slug).reverse();
  const today = runs[0] || null;
  const view = ranked.length ? fitView(ranked) : { center: { lat: 37.7749, lon: -122.4194 }, zoom: 12 };
  const title = "StreetCred, the San Francisco corner scoreboard";
  const desc = ranked.length
    ? `${ranked.length} San Francisco intersections graded on reported harm, worst first. Evidence traced to its source, letter drafted.`
    : "San Francisco intersections graded on reported harm, evidence traced to its source.";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreetCred</title>
<link rel="icon" href="/logo.svg">
<link rel="canonical" href="${origin}/">
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="StreetCred">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${origin}/">
${ranked.length ? `<meta property="og:image" content="${origin}/og.jpg?x=${ranked[0].slug}">` : ""}
<meta name="twitter:card" content="summary_large_image">
${FONT_LINK}
<style>
${BASE_CSS}
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
.lpop{font-family:Poppins,system-ui,sans-serif;font-size:12.5px;line-height:1.5;color:var(--ink)}
.lpop-g{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:6px;color:#fff;font-weight:700;font-size:11px;padding:0 4px}
.lpop-s{color:var(--dim);font-size:11.5px}
.lpop a{color:var(--accent);font-weight:600;text-decoration:none}
.leafshell{transition:opacity 300ms ease-out;z-index:1}
.cotdi{display:inline-flex;align-items:center;gap:5px;text-decoration:none;color:var(--dim);
  font-size:10.5px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:3px 9px}
.cotdi:hover{color:var(--ink);border-color:var(--line3)}
.cotdi i{width:7px;height:7px;border-radius:50%;display:block;background:var(--dim)}
.cotdc{font-size:10.5px;color:var(--dim);letter-spacing:.03em}
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
@media(max-width:600px){
  .row{grid-template-columns:26px 1fr auto;gap:10px}
  .ridx{display:none}
}
</style>
</head>
<body>
<div class="wrap">
<header>
  ${LOGO}
  <div class="mark">Street<span>Cred</span></div>
  <form class="find" id="find" role="search">
    <input id="q" type="search" placeholder="Try 24th and Valencia" autocomplete="off"
      aria-label="Check any San Francisco corner">
    <button type="submit" id="findgo">Check</button>
    <div class="findmsg" id="findmsg" role="status" hidden></div>
  </form>
  <div class="corner"><b>San Francisco</b>${ranked.length} corners graded</div>
</header>
<main>
<h1 class="vh">StreetCred, the San Francisco corner scoreboard</h1>

<p class="lede">Every claim about a dangerous corner, graded and traced to its source, ending in a picture of the fix and a letter to the Supervisor. <button class="nudge" id="nudge" type="button">Check your own corner</button></p>

${
  today
    ? `<a class="cotd" href="/c/${esc(today.slug)}">
  <span class="cotdk">Corner of the day</span>
  <span class="cotdn">${esc(today.name || today.slug)}</span>
  <span class="cotds">Audited autonomously this morning, ${esc(today.date)}${today.status === "partial" ? ", with some lanes degraded" : ""}</span>
  <span class="cotdg g${esc(today.grade || "A")}">${esc(today.grade || "?")}</span>
</a>
${
  runs.length
    ? `<div class="cotdlog">${runs
        .slice(0, 14)
        .map(
          (e) =>
            `<a class="cotdi" href="/c/${esc(e.slug)}" title="${esc(e.name || e.slug)}, ${esc(e.date)}"><i class="g${esc(e.grade || "A")}"></i><span>${esc(String(e.date).slice(5))}</span></a>`,
        )
        .join("")}<span class="cotdc">${runs.length} audited without a human so far</span></div>`
    : ""
}`
    : ""
}

${
  ranked.length
    ? `<div class="hero-map" id="map">
  <img src="/citymap.jpg" width="${MAP_W}" height="${MAP_H}"
    alt="Map of San Francisco with ${ranked.length} graded intersections marked">
  ${ranked
    .map((c) => {
      const p = pinPosition(c, view);
      return `<a class="pin" href="/c/${esc(c.slug)}" style="left:${p.xPct.toFixed(3)}%;top:${p.yPct.toFixed(3)}%" title="${esc(c.name)}, ${c.index}/100">${esc(c.name)}</a>`;
    })
    .join("\n  ")}
</div>
<p class="mapfoot" id="maplegend" hidden>
  <span class="key"><i style="background:none;border:2px solid var(--dim);width:7px;height:7px"></i>scored, audit pending</span>
  <span>Dots show intersections with reported harm; unmarked intersections had none in the record.</span>
</p>
<p class="mapfoot">
  <span class="key"><i style="background:var(--green)"></i>A</span>
  <span class="key"><i style="background:rgba(120,140,93,.62)"></i>B</span>
  <span class="key"><i style="background:var(--blue)"></i>C</span>
  <span class="key"><i style="background:rgba(240,126,38,.7)"></i>D</span>
  <span class="key"><i style="background:var(--accent)"></i>F</span>
  <span id="mapdata">Map data: Google. Danger Index ranks reported harm, not risk per crossing.</span>
</p>`
    : ""
}

${
  suggestion && suggestion.slug
    ? `<p class="lead"><b>Worth auditing next</b> ${esc(suggestion.name)}. Exa found it in coverage related to <a href="${esc(suggestion.seed.url)}" target="_blank" rel="noopener">${esc(suggestion.seed.domain)}</a>, and the city's intersection table confirms the crossing exists. This is a suggestion, not an audit: nothing has been run on it. <a class="leadgo" href="/c/${esc(suggestion.slug)}">Audit it</a></p>`
    : ""
}
<div class="eyebrow"><span>The scoreboard</span><span class="tag">Danger Index, worst first</span></div>
${
  ranked.length
    ? `<div class="board">
${ranked
  .map(
    (c, i) => `  <a class="row" href="/c/${esc(c.slug)}">
    <span class="rank">${i + 1}</span>
    <span><span class="rname">${esc(c.name)}</span><span class="rsev">${esc(severityLine(c))}${c.verdict ? ` &middot; ${esc(c.verdict)}` : ""}</span></span>
    <span class="ridx">${c.index}</span>
    <span class="rg g${esc(c.grade)}">${esc(c.grade)}</span>
  </a>`,
  )
  .join("\n")}
</div>`
    : `<p class="emptyboard">No corners have been warmed yet. Type an intersection above and it will be graded on the spot.</p>`
}

<div class="panel">
  <div class="phs"><h2>Powered by</h2></div>
  <div class="pbody">
  <div class="stack">
    <div><span class="lg"><img src="/logos/gemini.svg" alt="Google Gemini" width="24" height="24" loading="lazy"><b>Gemini</b></span>Audits the real Street View frame for hazards, renders the fix, writes the letter</div>
    <div><span class="lg"><img src="/logos/exa.svg" alt="Exa" width="77" height="24" loading="lazy"></span>Finds current press coverage of this intersection, cited</div>
    <div><span class="lg"><img src="/logos/apify.svg" alt="Apify" width="87" height="24" loading="lazy"></span>Scrapes what residents say on Reddit and Google Maps</div>
    <div><span class="lg"><img src="/logos/googlemaps.svg" alt="Google Maps" width="24" height="24" loading="lazy"><b>Google Maps</b></span>Street View frames, the corner thumbnail, and the city map</div>
    <div><span class="lg"><img src="/logos/cloudflare.svg" alt="Cloudflare" width="52" height="24" loading="lazy"><b>Cloudflare</b></span>Workers serve the page, KV holds corners, imagery and grades</div>
    <div><span class="lg"><b>DataSF</b></span>Collisions and 311, queried by radius around the corner</div>
  </div>
  </div>
</div>

</main>
<footer>Exa finds it, Apify hears it, Gemini shows it and writes it. Built at Build Club, August 17 2026.<br>
Hazard and proposed-fix images are AI generated from the Street View photograph. The proposed fix is a visualization, not a photograph of anything that exists. Nothing here is sent to any official.<br><a href="/methodology">Methodology</a> &middot; <a href="/changes">Grade changes</a> &middot; <a href="/status">Status</a> &middot; <a href="/watchdog">The watchdog</a></footer>
</div>

<script>
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
var AUDITED = ${JSON.stringify(
    ranked.map((c) => ({ slug: c.slug, name: c.name, lat: c.lat, lon: c.lon, grade: c.grade, index: c.index })),
  )};
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
          audited: AUDITED, scored: scored, heatUrl: "/data/heat.json",
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
