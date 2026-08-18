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
  --ink:#141B2D; --accent:#F07E26; --dim:#8a867c; --blue:#6a9bcc; --green:#788c5d;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Poppins,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:28px 22px 64px}
header{display:flex;align-items:center;gap:14px;padding-bottom:22px}
.mark{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1}
.mark span{color:var(--accent)}
.switcher{display:flex;gap:7px;margin-left:22px}
.switcher a{font-size:12.5px;font-weight:600;text-decoration:none;color:var(--dim);
  background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 15px;white-space:nowrap}
.switcher a.on{background:var(--ink);border-color:var(--ink);color:#fff}
.corner{margin-left:auto;text-align:right;font-size:13px;color:var(--dim);line-height:1.5}
.corner b{display:block;font-size:15px;color:var(--ink);font-weight:600}
.lede{font-size:15px;color:var(--dim);max-width:660px;margin:0 0 26px;line-height:1.6}

.toggle{display:flex;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;width:max-content;margin-bottom:16px}
.toggle button{font-family:inherit;font-size:14px;font-weight:600;color:var(--dim);background:none;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
.toggle button[aria-pressed="true"]{background:var(--ink);color:#fff}
.toggle button:nth-child(2)[aria-pressed="true"]{background:var(--accent)}
.toggle button:nth-child(3)[aria-pressed="true"]{background:var(--green)}

.hero{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--card);aspect-ratio:640/400}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
#overlay{clip-path:inset(0 0 0 50%)}
.hero.single #overlay{display:none}
.hero.single #handle{display:none}
#handle{position:absolute;top:0;bottom:0;left:50%;width:3px;background:#fff;box-shadow:0 0 0 1px rgba(20,27,45,.25);cursor:ew-resize;touch-action:none}
#handle::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:38px;height:38px;border-radius:50%;background:#fff;box-shadow:0 2px 10px rgba(20,27,45,.35)}
#handle::before{content:"‹ ›";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2;font-size:17px;font-weight:700;color:var(--ink);letter-spacing:2px}
.cap{display:flex;gap:10px;align-items:baseline;margin:12px 0 30px;font-size:13.5px;color:var(--dim);line-height:1.55}
.cap b{color:var(--ink);font-weight:600;white-space:nowrap}

.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:30px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px;min-width:0}
.stat .n{font-size:34px;font-weight:700;letter-spacing:-.02em;line-height:1.1;color:var(--accent)}
.stat .l{font-size:12.5px;color:var(--dim);margin-top:6px;line-height:1.45}

/* Lane eyebrow: the page is one long column, so each lane gets a small label
   and a hairline to separate it from the one above. */
.eyebrow{display:flex;align-items:center;justify-content:space-between;gap:12px;
  font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--dim);margin:0 0 13px;padding-bottom:7px;border-bottom:1px solid var(--line)}
.lane[hidden]{display:none}

#mappanel[hidden]{display:none}
#mappanel{padding:18px 18px 14px}
.mapimg{display:block;width:100%;max-height:230px;object-fit:cover;object-position:center;border-radius:10px;border:1px solid var(--line)}
.mapfoot{font-size:11.5px;color:var(--dim);margin:9px 0 0}

.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:18px}
.ph{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.ph h2{font-size:15px;font-weight:600;margin:0}
.tag{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:5px;background:rgba(106,155,204,.14);color:var(--blue)}
.tag.sample{background:rgba(240,126,38,.14);color:var(--accent)}

.news a{display:block;text-decoration:none;color:inherit;padding:13px 0;border-top:1px solid var(--line)}
.news a:first-of-type{border-top:0;padding-top:0}
.news .t{font-size:14px;font-weight:500;line-height:1.45}
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

.stack{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 26px;margin-top:8px}
.stack div{font-size:12.5px;color:var(--dim);line-height:1.5}
.stack b{display:block;font-size:13.5px;color:var(--ink);font-weight:600}
footer{margin-top:34px;padding-top:20px;border-top:1px solid var(--line);font-size:12.5px;color:var(--dim);line-height:1.6}

.sk{background:linear-gradient(90deg,var(--card) 25%,#eeece4 50%,var(--card) 75%);background-size:200% 100%;animation:sh 1.3s infinite;border-radius:6px;height:13px;margin:9px 0}
@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}
/* The stat row holds three across well past the point the two-column body has to
   collapse, so it breaks on its own, later: 3 across, then 2+1, then stacked. */
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
  <div class="corner"><b>${c.name}</b>${c.city}, District ${c.district}</div>
</header>

<p class="lede">Every claim about a dangerous corner, graded and traced to its source, ending in a picture of the fix and a letter to the Supervisor.</p>

<div class="toggle" role="group" aria-label="Corner view">
  <button data-state="today" aria-pressed="true">Today</button>
  <button data-state="hazards" aria-pressed="false">Hazards</button>
  <button data-state="fix" aria-pressed="false">Proposed fix</button>
</div>

<div class="hero single" id="hero">
  <img id="base" alt="${c.name} today, from Street View">
  <img id="overlay" alt="">
  <div id="handle" role="separator" aria-label="Drag to compare"></div>
</div>
<p class="cap"><b id="capk">Today</b><span id="capv">The corner as Street View last photographed it. Imagery: Google.</span></p>

<div class="eyebrow"><span>Official record</span></div>
<div class="stats" id="stats">
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Collisions on record within 150m</div></div>
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Street-related 311 reports, 3 years</div></div>
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Supervisor district</div></div>
</div>

<section class="lane" id="maplane" hidden>
  <div class="eyebrow"><span>The corner</span></div>
  <div class="panel" id="mappanel">
    <img id="mapimg" class="mapimg" alt="Roadmap showing the location of ${c.name}, ${c.city}">
    <p class="mapfoot">${c.name}, District ${c.district}. Map data: Google.</p>
  </div>
</section>

<div class="cols">
  <div>
    <div class="eyebrow"><span>Press coverage</span><span class="tag" id="newstag">found live, cited</span></div>
    <div class="panel">
      <div class="news" id="news"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
    </div>
    <div class="eyebrow"><span>Resident voices</span><span class="tag" id="voicestag">scraped</span></div>
    <div class="panel">
      <div id="voices"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
    </div>
  </div>
  <div>
    <div class="eyebrow"><span>The ask</span><span class="tag" id="lettertag">drafted</span></div>
    <div class="panel">
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
    <div><b>Exa</b>Finds current press coverage of this intersection, cited</div>
    <div><b>Apify</b>Scrapes what residents say on Reddit and Google Maps</div>
    <div><b>Gemini vision</b>Audits the real photo for hazards, renders the fix</div>
    <div><b>Gemini text</b>Turns four sources into one addressed letter</div>
    <div><b>Cloudflare Workers</b>Serves the page and every endpoint at the edge</div>
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

function render(){
  if(!IMG) return;
  const hero = el("hero");
  el("base").src = IMG.today;
  if(state === "today"){ hero.classList.add("single"); }
  else { hero.classList.remove("single"); el("overlay").src = IMG[state]; setSplit(split); }
  el("capk").textContent = CAPS[state][0];
  el("capv").textContent = CAPS[state][1];
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

fetch("/api/imagery" + X).then(r => r.json()).then(d => { IMG = d; render(); });

// The map panel stays out of the document until the thumbnail actually decodes.
// A failed Static Maps request removes it rather than leaving a broken image.
(function(){
  const img = el("mapimg");
  img.addEventListener("load", () => el("maplane").hidden = false);
  img.addEventListener("error", () => el("maplane").remove());
  img.src = "/map.jpg" + X;
})();

fetch("/api/stats" + X).then(r => r.json()).then(d => {
  const n = [d.crashes, d.reports311, d.district].map(v => Number(v).toLocaleString());
  const l = ["Collisions on record within 150m","Street-related 311 reports, 3 years","Supervisor district"];
  el("stats").innerHTML = n.map((v,i) =>
    '<div class="stat"><div class="n">' + v + '</div><div class="l">' + l[i] +
    (d.source === "sample" && i === 0 ? ' <span class="tag sample">sample</span>' : '') + '</div></div>').join("");
});

fetch("/api/news" + X).then(r => r.json()).then(d => {
  mark("newstag", d.source);
  el("news").innerHTML = (d.items||[]).map(x =>
    '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"><div class="t">' + esc(x.title) +
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
