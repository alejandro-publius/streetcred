import { CORNERS } from "./data.js";

const LOGO = `<svg viewBox="0 0 64 64" width="38" height="38" aria-hidden="true">
  <rect width="64" height="64" rx="14" fill="#141B2D"/>
  <path d="M32 12v40M12 32h40" stroke="#F07E26" stroke-width="7" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="6.5" fill="#faf9f5"/>
  <circle cx="32" cy="32" r="3" fill="#F07E26"/>
</svg>`;

export const PAGE = (c) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreetCred, ${c.short}</title>
<link rel="icon" href="/logo.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Lora:ital@0;1&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#faf9f5; --panel:#fff; --card:#f4f2ec; --line:#e8e6dc;
  /* One step darker than --line, for panel edges that need to hold their own
     against the page rather than disappear into it. */
  --line2:#dcd9cc;
  --ink:#141B2D; --accent:#F07E26; --dim:#8a867c; --blue:#6a9bcc; --green:#788c5d;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Poppins,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:28px 22px 64px}
header{display:flex;align-items:center;gap:14px;padding-bottom:22px;flex-wrap:wrap}
.mark{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1}
.mark span{color:var(--accent)}
.switcher{display:flex;gap:7px;margin-left:22px}
.switcher a{font-size:12.5px;font-weight:600;text-decoration:none;color:var(--dim);
  background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 15px;white-space:nowrap}
.switcher a.on{background:var(--ink);border-color:var(--ink);color:#fff}
.find{display:flex;align-items:center;gap:7px;margin-left:12px;position:relative}
.find input{font-family:inherit;font-size:13px;color:var(--ink);background:var(--panel);
  border:1px solid var(--line);border-radius:999px;padding:8px 15px;width:200px;outline:none}
.find input:focus{border-color:var(--accent)}
.find input::placeholder{color:var(--dim)}
.find button{font-family:inherit;font-size:12.5px;font-weight:600;color:#fff;background:var(--ink);
  border:0;border-radius:999px;padding:9px 16px;cursor:pointer;white-space:nowrap}
.find button[disabled]{opacity:.5;cursor:default}
.findmsg{position:absolute;top:44px;left:0;font-size:12.5px;color:var(--ink);background:var(--panel);
  border:1px solid var(--line);border-radius:10px;padding:9px 13px;width:300px;line-height:1.5;
  z-index:6;box-shadow:0 6px 18px rgba(20,27,45,.09)}
.corner{margin-left:auto;text-align:right;font-size:13px;color:var(--dim);line-height:1.5}
.corner b{display:block;font-size:15px;color:var(--ink);font-weight:600}
.lede{font-size:15px;color:var(--dim);max-width:660px;margin:0 0 26px;line-height:1.6}

/* Danger Index. The grade chip and the severity ramp stay inside the existing
   palette: ink reads as most severe, then the accent, then two accent tints. No
   new hues, so the score cannot fight the rest of the page. */
.scorewrap{display:flex;gap:24px;align-items:center;background:var(--panel);border:1px solid var(--line2);
  border-top:2px solid var(--ink);border-radius:14px;padding:18px 20px;margin-bottom:12px;flex-wrap:wrap;
  transition:transform 150ms ease-out,box-shadow 150ms ease-out}
.scorefig{display:flex;align-items:center;gap:12px}
.scoren{font-size:50px;font-weight:700;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.scoren small{font-size:17px;font-weight:600;color:var(--dim);letter-spacing:0}
.scoreg{font-size:21px;font-weight:700;min-width:40px;height:40px;padding:0 9px;border-radius:11px;
  display:grid;place-items:center;color:#fff;background:var(--card);
  transition:background-color 2s ease-in,color 2s ease-in}
.scoreg.gA,.scoreg.gB{background:var(--green)}
.scoreg.gC{background:var(--blue)}
.scoreg.gD{background:rgba(240,126,38,.72)}
.scoreg.gF{background:var(--accent)}
.scoremeta{flex:1;min-width:230px}
.scorelabel{font-size:12.5px;font-weight:600;color:var(--ink);margin-bottom:9px}
.sevbar{display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--card);margin-bottom:9px}
.sevbar i{display:block;height:100%}
.sevbar i.f{background:var(--ink)}
.sevbar i.s{background:var(--accent)}
.sevbar i.o{background:rgba(240,126,38,.55)}
.sevbar i.p{background:rgba(240,126,38,.25)}
.sevkey{display:flex;gap:13px;flex-wrap:wrap;font-size:11.5px;color:var(--dim);margin-bottom:7px}
.sevkey b{font-weight:600;color:var(--ink)}
.scorecav{font-size:11.5px;color:var(--dim);line-height:1.5}

.toggle{display:flex;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;width:max-content;margin-bottom:16px}
.toggle button{font-family:inherit;font-size:14px;font-weight:600;color:var(--dim);background:none;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
.toggle button[disabled]{opacity:.42;cursor:default}
.toggle button[aria-pressed="true"]{background:var(--ink);color:#fff}
.toggle button:nth-child(2)[aria-pressed="true"]{background:var(--accent)}
.toggle button:nth-child(3)[aria-pressed="true"]{background:var(--green)}

.hero{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--card);aspect-ratio:640/400}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
#overlay{transition:opacity 200ms ease-out}
#overlay{clip-path:inset(0 0 0 50%)}
.hero.single #overlay{display:none}
.hero.single #handle{display:none}
#handle{position:absolute;top:0;bottom:0;left:50%;width:3px;background:#fff;box-shadow:0 0 0 1px rgba(20,27,45,.25);cursor:ew-resize;touch-action:none}
#handle::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:38px;height:38px;border-radius:50%;background:#fff;box-shadow:0 2px 10px rgba(20,27,45,.35)}
#handle::before{content:"‹ ›";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2;font-size:17px;font-weight:700;color:var(--ink);letter-spacing:2px}
.cap{display:flex;gap:10px;align-items:baseline;margin:12px 0 30px;font-size:13.5px;color:var(--dim);line-height:1.55}
.cap b{color:var(--ink);font-weight:600;white-space:nowrap}

.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:30px}
.stat{background:var(--panel);border:1px solid var(--line2);border-top:2px solid var(--ink);border-radius:14px;
  padding:20px 22px;min-width:0;transition:transform 150ms ease-out,box-shadow 150ms ease-out}
.stat .n{font-size:34px;font-weight:700;letter-spacing:-.02em;line-height:1.1;color:var(--accent)}
.stat .l{font-size:12.5px;color:var(--dim);margin-top:6px;line-height:1.45}

/* Lane eyebrow: the page is one long column, so each lane gets a small label
   and a hairline to separate it from the one above. */
.eyebrow{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;
  font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--dim);margin:0 0 13px;padding-bottom:7px}
.eyebrow::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--line2);
  transform:scaleX(0);transform-origin:left center;transition:transform 300ms ease-out}
.eyebrow.drawn::after{transform:scaleX(1)}
.lane[hidden]{display:none}

#mappanel[hidden]{display:none}
#mappanel{padding:18px 18px 14px}
.mapimg{display:block;width:100%;max-height:230px;object-fit:cover;object-position:center;border-radius:10px;border:1px solid var(--line)}
.mapfoot{font-size:11.5px;color:var(--dim);margin:9px 0 0}

.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.panel{background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:22px;margin-bottom:18px;
  transition:transform 150ms ease-out,box-shadow 150ms ease-out}
/* A 2px cap in the lane's own color. Reads as the tab on a file folder, which
   is the right metaphor for a page that is arguing from a case file. */
.panel.lane-record{border-top:2px solid var(--ink)}
.panel.lane-press{border-top:2px solid var(--blue)}
.panel.lane-ask{border-top:2px solid var(--green)}
.panel.lane-voices{border-top:2px solid var(--dim)}
.panel.lane-corner{border-top:2px solid var(--line2)}
.panel:hover,.stat:hover,.scorewrap:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(20,27,45,.07)}
.ph{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.ph h2{font-size:15px;font-weight:600;margin:0}
.tag{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;
  border-radius:5px;background:rgba(106,155,204,.14);color:var(--blue);border:1px solid transparent}
/* Dashed, so a sample or empty state is legible as provisional at a glance and
   never gets mistaken for a live figure. */
.tag.sample{background:rgba(240,126,38,.10);color:var(--accent);border:1px dashed rgba(240,126,38,.55)}

.news a{display:block;text-decoration:none;color:inherit;padding:13px 0;border-top:1px solid var(--line)}
.news a:first-of-type{border-top:0;padding-top:0}
.news .t{font-size:14px;font-weight:500;line-height:1.45}
.osrc{display:inline-block;font-size:9.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
  color:var(--dim);border:1px dashed var(--line2);border-radius:4px;padding:1px 5px;vertical-align:2px;white-space:nowrap}
.news a:hover .t{color:var(--accent)}
.news .m{font-size:11.5px;color:var(--dim);margin-top:5px}

.voice{background:var(--card);border-radius:11px;padding:15px 17px;margin-bottom:11px}
.voice p{margin:0;font-family:Lora,Georgia,serif;font-style:italic;font-size:14.5px;line-height:1.6}
.voice .m{font-size:11.5px;color:var(--dim);margin-top:9px;text-transform:capitalize}
.empty{margin:0;font-size:13.5px;color:var(--dim);line-height:1.55}

.fixrow{display:grid;grid-template-columns:1fr auto;gap:8px 18px;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--line)}
.fixrow .k{font-size:11.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.fixrow .v{font-size:14px;font-weight:500;line-height:1.45}
.fixrow .cost{font-size:19px;font-weight:700;color:var(--green);white-space:nowrap;text-align:right}
.letter{font-family:Lora,Georgia,serif;font-size:14.5px;line-height:1.72;white-space:pre-wrap}
.lfoot{display:flex;align-items:center;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
.lfoot button{font-family:inherit;font-size:13px;font-weight:600;background:var(--ink);color:#fff;border:0;border-radius:8px;padding:9px 18px;cursor:pointer}
.lfoot span{font-size:11.5px;color:var(--dim)}
.draft{font-size:11.5px;color:var(--accent);font-weight:600;margin-bottom:12px;letter-spacing:.03em}

.stack{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 26px;margin-top:8px}
.stack div{font-size:12.5px;color:var(--dim);line-height:1.5}
.stack b{display:block;font-size:13.5px;color:var(--ink);font-weight:600;margin-bottom:5px}
/* Fixed-height box so a blocked or failed logo cannot reflow the strip. Six
   brand palettes at full saturation would fight the page, so every mark renders
   flat ink at 70 percent and only returns to its own color on hover. */
.stack .lg{display:flex;align-items:center;height:20px;margin-bottom:5px;overflow:hidden}
.stack .lg img{height:20px;max-height:20px;width:auto;display:block;
  filter:brightness(0);opacity:.7;transition:filter 200ms ease-out,opacity 200ms ease-out}
.stack div:hover .lg img{filter:none;opacity:1}
footer{margin-top:34px;padding-top:20px;border-top:1px solid var(--line);font-size:12.5px;color:var(--dim);line-height:1.6}

.sk{background:linear-gradient(90deg,var(--card) 25%,#eeece4 50%,var(--card) 75%);background-size:200% 100%;animation:sh 1.3s infinite;border-radius:6px;height:13px;margin:9px 0}
@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}
/* The stat row holds three across well past the point the two-column body has to
   collapse, so it breaks on its own, later: 3 across, then 2+1, then stacked. */
/* Motion is decoration here, never information. Under reduced-motion the rules
   are already drawn, the numbers are already final, and the shimmer holds still.
   Nothing on the page becomes unreadable or unavailable. */
@media(prefers-reduced-motion:reduce){
  .sk{animation:none;background:var(--card)}
  .eyebrow::after{transform:scaleX(1);transition:none}
  .scoreg,.panel,.stat,.scorewrap,#overlay,.stack .lg img{transition:none}
  .panel:hover,.stat:hover,.scorewrap:hover{transform:none;box-shadow:none}
}

@media(max-width:860px){.cols,.stack{grid-template-columns:1fr}}
@media(max-width:600px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:400px){.stats{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
<header>
  ${LOGO}
  <div class="mark">Street<span>Cred</span></div>
  <nav class="switcher" aria-label="Choose a corner">
    ${Object.values(CORNERS)
      .map(
        (k) =>
          `<a href="/?x=${k.slug}"${k.slug === c.slug ? ' class="on" aria-current="page"' : ""}>${k.short}</a>`,
      )
      .join("")}
  </nav>
  <form class="find" id="find" role="search">
    <input id="q" type="search" placeholder="Try 24th and Valencia" autocomplete="off"
      aria-label="Check any San Francisco corner">
    <button type="submit" id="findgo">Check</button>
    <div class="findmsg" id="findmsg" role="status" hidden></div>
  </form>
  <div class="corner"><b>${c.name}</b>${c.city}${
    c.district ? `, District ${c.district}` : ", district unresolved"
  }</div>
</header>

<p class="lede">Every claim about a dangerous corner, graded and traced to its source, ending in a picture of the fix and a letter to the Supervisor.</p>

<div class="toggle" role="group" aria-label="Corner view">
  <button data-state="today" aria-pressed="true">Today</button>
  <button data-state="hazards" aria-pressed="false"${c.generated ? " disabled" : ""}>Hazards</button>
  <button data-state="fix" aria-pressed="false"${c.generated ? " disabled" : ""}>Proposed fix</button>
</div>

<div class="hero single" id="hero">
  <img id="base" alt="${c.name} today, from Street View">
  <img id="overlay" alt="">
  <div id="handle" role="separator" aria-label="Drag to compare"></div>
</div>
<p class="cap"><b id="capk">Today</b><span id="capv">The corner as Street View last photographed it. Imagery: Google.</span></p>

<div class="eyebrow"><span>Official record</span></div>
<div class="scorewrap" id="scorewrap" hidden>
  <div class="scorefig">
    <div class="scoren" id="scoren">0<small>/100</small></div>
    <div class="scoreg" id="scoreg"></div>
  </div>
  <div class="scoremeta">
    <div class="scorelabel">Danger Index, reported harm within 80 meters</div>
    <div class="sevbar" id="sevbar"></div>
    <div class="sevkey" id="sevkey"></div>
    <div class="scorecav" id="scorecav"></div>
  </div>
</div>
<div class="stats" id="stats">
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Injury collisions, last 5 years</div></div>
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Street-condition 311 reports, 3 years</div></div>
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Supervisor district</div></div>
</div>

<section class="lane" id="maplane" hidden>
  <div class="eyebrow"><span>The corner</span></div>
  <div class="panel lane-corner" id="mappanel">
    <img id="mapimg" class="mapimg" alt="Roadmap showing the location of ${c.name}, ${c.city}">
    <p class="mapfoot">${c.name}, District ${c.district}. Map data: Google.</p>
  </div>
</section>

<div class="cols">
  <div>
    <div class="eyebrow"><span id="newshead">Press coverage</span><span class="tag" id="newstag">found live, cited</span></div>
    <div class="panel lane-press">
      <div class="news" id="news"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
    </div>
    <div class="eyebrow"><span>Resident voices</span><span class="tag" id="voicestag">scraped</span></div>
    <div class="panel lane-voices">
      <div id="voices"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
    </div>
  </div>
  <div>
    <div class="eyebrow"><span>The ask</span><span class="tag" id="lettertag">drafted</span></div>
    <div class="panel lane-ask">
      <div class="fixrow">
        <div><div class="k">Proposed fix</div><div class="v" id="fixname">${c.fix.name}</div></div>
        <div class="cost" id="fixcost">${c.fix.cost}</div>
        <div><div class="k">Funding route</div><div class="v" id="fixgrant">${c.fix.grant}</div></div>
      </div>
      <div class="draft">DRAFT ONLY, NOT SENT TO ANY OFFICIAL</div>
      <div class="letter" id="letter"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
      <div class="lfoot"><button id="copy">Copy letter</button><span>drafted by Gemini</span></div>
    </div>
  </div>
</div>

<div class="panel">
  <div class="ph"><h2>The stack</h2></div>
  <div class="stack">
    <div><b>DataSF</b>Collisions and 311, queried by radius around the corner</div>
    <div><span class="lg"><img src="/logos/exa.svg" alt="Exa" width="64" height="20" loading="lazy"></span>Finds current press coverage of this intersection, cited</div>
    <div><span class="lg"><img src="/logos/apify.svg" alt="Apify" width="73" height="20" loading="lazy"></span>Scrapes what residents say on Reddit and Google Maps</div>
    <div><b>Gemini vision</b>Audits the real photo for hazards, renders the fix</div>
    <div><b>Gemini text</b>Turns four sources into one addressed letter</div>
    <div><span class="lg"><img src="/logos/cloudflare.svg" alt="Cloudflare" width="44" height="20" loading="lazy"></span>Workers serve the page, KV holds corners and imagery</div>
    <div><b>Google Maps</b>Street View frames and the corner thumbnail</div>
  </div>
</div>

<footer>Exa finds it, Apify hears it, Gemini shows it and writes it. Built at Build Club, August 17 2026.<br>
Hazard and proposed-fix images are AI generated from the Street View photograph. The proposed fix is a visualization, not a photograph of anything that exists. Nothing here is sent to any official.</footer>
</div>

<script>
const CAPS = {
  today:["Today","The corner as Street View last photographed it. Imagery: Google."],
  hazards:["Hazards","Gemini read the real photograph and marked the zones it flags as high risk: faded crosswalk markings in red, vehicle conflict zones in amber. Drag to compare."],
  fix:["Proposed fix","An AI visualization of continental crosswalks, a protected bike lane, and a corner curb extension. Not a photograph of anything that exists. Drag to compare."]
};
const X = "?x=${c.slug}";
let IMG = null, state = "today";

const el = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const mark = (id, src) => { const t = el(id); if (src !== "live" && src !== "cache") { t.textContent = "sample"; t.classList.add("sample"); } };

// Motion is decoration on this page, never information, so reduced-motion takes
// the short path everywhere: final values, drawn rules, no shimmer.
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// The stat numbers are the evidence, so they get the one piece of real motion:
// a single 600ms count up the first time they scroll into view.
function countUp(node, target){
  const n = Number(target);
  if(!Number.isFinite(n)){ node.textContent = target; return; }
  if(REDUCED || n === 0){ node.textContent = n.toLocaleString(); return; }
  const t0 = performance.now();
  (function step(t){
    const p = Math.min(1, (t - t0) / 600);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = Math.round(n * eased).toLocaleString();
    if(p < 1) requestAnimationFrame(step);
  })(t0);
}

// Fires a callback the first time an element is visible, once, and degrades to
// firing immediately where IntersectionObserver is missing.
function onFirstView(node, fn){
  if(!node) return;
  if(REDUCED || typeof IntersectionObserver === "undefined"){ fn(); return; }
  const io = new IntersectionObserver((entries) => {
    for(const e of entries){
      if(e.isIntersecting){ io.disconnect(); fn(); }
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  io.observe(node);
}

// Lane rules draw themselves left to right as you reach them. Document-like.
document.querySelectorAll(".eyebrow").forEach(e => onFirstView(e, () => e.classList.add("drawn")));

function render(){
  if(!IMG) return;
  const hero = el("hero");
  // A corner with no Street View coverage is still a corner with collisions.
  // Drop the stage, keep every records lane below it untouched.
  if(!IMG.today){
    hero.hidden = true;
    document.querySelector(".toggle").hidden = true;
    el("capk").textContent = "No photograph";
    el("capv").textContent = IMG.note || "Street View has no imagery for this corner.";
    return;
  }
  hero.hidden = false;
  el("base").src = IMG.today;
  if(state === "today" || !IMG[state]){ hero.classList.add("single"); }
  else {
    hero.classList.remove("single");
    // Crossfade rather than a hard swap, so switching states reads as the same
    // photograph being re-examined rather than as a different picture.
    const ov = el("overlay");
    if(ov.getAttribute("src") !== IMG[state]){
      if(!REDUCED) ov.style.opacity = "0";
      ov.onload = () => { ov.style.opacity = "1"; };
      ov.src = IMG[state];
    }
    setSplit(split);
  }
  el("capk").textContent = CAPS[state][0];
  el("capv").textContent = CAPS[state][1] + (state === "today" && IMG.note ? " " + IMG.note : "");
}
let split = 50;
function setSplit(pct){
  split = Math.max(0, Math.min(100, pct));
  el("overlay").style.clipPath = "inset(0 0 0 " + split + "%)";
  el("handle").style.left = split + "%";
}
document.querySelectorAll(".toggle button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".toggle button").forEach(o => o.setAttribute("aria-pressed", String(o === b)));
  state = b.dataset.state; split = 50; render();
}));
(function(){
  const hero = el("hero"); let drag = false;
  const move = e => { if(!drag) return; const r = hero.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    setSplit(x / r.width * 100); };
  el("handle").addEventListener("pointerdown", e => { drag = true; e.preventDefault(); });
  addEventListener("pointerup", () => drag = false);
  addEventListener("pointermove", move);
})();

// Imagery. A precomputed corner answers once with no status field and nothing
// below ever runs. A corner resolved from typed input answers immediately with
// the Street View frame and status "pending", then this polls until the two
// generated states land, enabling each button as it arrives without a repaint.
const LABELS = { hazards: "Hazards", fix: "Proposed fix" };
const POLL_MS = 3000, POLL_MAX = 30;   // 30 polls at 3s is a 90 second ceiling
let polls = 0;

function stateButton(s){ return document.querySelector('.toggle button[data-state="' + s + '"]'); }

function applyImagery(d){
  IMG = d;
  for(const s of ["hazards","fix"]){
    const b = stateButton(s);
    if(!b) continue;
    if(d[s]){ b.disabled = false; b.textContent = LABELS[s]; }
    else if(d.status === "pending"){ b.disabled = true; b.textContent = LABELS[s] + ", generating"; }
    else if(d.status === "atcapacity"){ b.disabled = true; b.textContent = LABELS[s] + ", at capacity"; }
    else if(d.status && d.status !== "ready"){ b.disabled = true; b.textContent = LABELS[s] + ", unavailable"; }
  }
  render();
}

function loadImagery(){
  fetch("/api/imagery" + X).then(r => r.json()).then(d => {
    applyImagery(d);
    const settled = !d.status || d.status !== "pending";
    if(settled) return;
    if(polls++ < POLL_MAX) setTimeout(loadImagery, POLL_MS);
    // Timed out rather than failed, but the honest label is the same either way.
    else applyImagery(Object.assign({}, d, { status: "failed" }));
  }).catch(() => {});
}
loadImagery();

// Free-text corner lookup. Resolve first, then navigate, so the address bar
// always matches what is on screen and the page is refreshable and linkable.
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
      if(d.ok){ location.href = "/?x=" + encodeURIComponent(d.slug); return; }
      reset();
      say(d.message || "That corner could not be found.");
    }).catch(() => { reset(); say("Lookup failed. Try again in a moment."); });
  });
  input.addEventListener("input", () => say(""));
})();

// The map panel stays out of the document until the thumbnail actually decodes.
// A failed Static Maps request removes it rather than leaving a broken image.
(function(){
  const img = el("mapimg");
  img.addEventListener("load", () => el("maplane").hidden = false);
  img.addEventListener("error", () => el("maplane").remove());
  img.src = "/map.jpg" + X;
})();

fetch("/api/stats" + X).then(r => r.json()).then(d => {
  // A null district means no clear majority, which prints as "n/a" rather than
  // as the 0 that Number(null) would quietly produce.
  const vals = [d.crashes, d.reports311, d.district];
  const l = ["Injury collisions, last 5 years" + (d.fatal ? ", including " + d.fatal + " fatal" : ""),
             "Street-condition 311 reports, 3 years","Supervisor district"];
  el("stats").innerHTML = vals.map((v,i) =>
    '<div class="stat"><div class="n" data-to="' + (v === null || v === undefined ? "" : v) + '">' +
    (v === null || v === undefined ? "n/a" : "0") + '</div><div class="l">' + l[i] +
    (d.source === "sample" && i === 0 ? ' <span class="tag sample">sample</span>' : '') + '</div></div>').join("");
  onFirstView(el("stats"), () => {
    el("stats").querySelectorAll(".n").forEach(node => {
      const to = node.getAttribute("data-to");
      if(to !== "") countUp(node, to);
    });
  });
});

// The Danger Index. Every number here came out of DataSF arithmetic, so the
// caveat travels with it on the page rather than being buried in the README.
fetch("/api/score" + X).then(r => r.json()).then(d => {
  if(!d || typeof d.index !== "number") return;
  el("scorewrap").hidden = false;
  el("scoren").innerHTML = d.index + '<small>/100</small>';
  const g = el("scoreg");
  g.textContent = d.grade;
  g.className = "scoreg g" + d.grade;
  const c = d.counts || {};
  const parts = [["f","Fatal",c.fatal],["s","Severe",c.severe],
                 ["o","Other visible",c.otherVisible],["p","Complaint of pain",c.pain]];
  const total = parts.reduce((n,[,,v]) => n + (v||0), 0);
  el("sevbar").innerHTML = total
    ? parts.filter(([,,v]) => v).map(([k,,v]) =>
        '<i class="' + k + '" style="width:' + (100*v/total) + '%"></i>').join("")
    : '';
  el("sevkey").innerHTML = parts.filter(([,,v]) => v)
    .map(([,label,v]) => '<span><b>' + v + '</b> ' + label + '</span>').join("")
    || '<span>No injury collisions recorded in 5 years</span>';
  el("scorecav").textContent = d.caveat || "";
});

fetch("/api/news" + X).then(r => r.json()).then(d => {
  mark("newstag", d.source);
  // Do not claim corner-level precision the result set does not support.
  if (d.heading) el("newshead").textContent = d.heading;
  el("news").innerHTML = (d.items||[]).map(x =>
    '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"><div class="t">' + esc(x.title) +
    // An agency page is the record, not reporting on the record. Tagged so it
    // reads as a primary source rather than as press coverage.
    (x.official ? ' <span class="osrc">official source</span>' : '') +
    '</div><div class="m">' + esc(x.domain) + (x.date ? " &middot; " + esc(x.date) : "") + '</div></a>').join("")
    || '<div class="m">No coverage found.</div>';
});

fetch("/api/voices" + X).then(r => r.json()).then(d => {
  const items = d.items || [];
  const tag = el("voicestag");
  if (!items.length) {
    // Say so plainly. An empty scrape is a real result, not a hole to fill.
    tag.textContent = "none found";
    tag.classList.add("sample");
    el("voices").innerHTML =
      '<p class="empty">No on-topic resident accounts found for this corner.</p>';
    return;
  }
  mark("voicestag", d.source);
  el("voices").innerHTML = items.map(v =>
    '<div class="voice"><p>&ldquo;' + esc(v.text) + '&rdquo;</p><div class="m">' +
    esc(String(v.source).replace("_"," ")) + (v.stars ? " &middot; " + v.stars + "&#9733;" : "") +
    (v.when ? " &middot; " + esc(v.when) : "") + '</div></div>').join("");
});

fetch("/api/letter" + X).then(r => r.json()).then(d => {
  mark("lettertag", d.source);
  el("letter").textContent = d.text || "";
  el("copy").addEventListener("click", () => {
    navigator.clipboard.writeText(d.text || "");
    el("copy").textContent = "Copied";
    setTimeout(() => el("copy").textContent = "Copy letter", 1400);
  });
});
</script>
</body>
</html>`;
