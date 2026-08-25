import { CORNERS } from "./data.js";
import { DISTRIBUTION } from "./score.js";
import { TIER_LABEL, TIER_NOTE } from "./city.js";
// Imported rather than restated. The homepage hero and the corner page must
// make the same claim in the same words, and the client-side copy inside PAGE
// is pinned to this one by tools/provenance.test.mjs.
import { PROMOTED_NOTE } from "./imagery.js";

// The citywide distribution strip, built once at module load from the frozen
// array rather than shipped to the browser as 600 numbers on every page. The
// bars are identical on every corner, so only the marker moves.
//
// Bar i is the points value at percentile i/BARS. The horizontal axis is
// therefore percentile, which is exactly what the grade is, so a corner's
// marker sits at its own index with no further arithmetic.
const DIST_BARS = 64;
function distributionSvg() {
  const n = DISTRIBUTION.length;
  const top = Math.sqrt(DISTRIBUTION[n - 1]) || 1;
  const w = 100 / DIST_BARS;
  const rects = Array.from({ length: DIST_BARS }, (_, i) => {
    const v = DISTRIBUTION[Math.min(n - 1, Math.floor((i / DIST_BARS) * n))];
    // A floor of 1.2 so the calm half of the city stays visible as a baseline
    // rather than vanishing into the panel.
    const h = Math.max(1.2, (Math.sqrt(v) / top) * 30);
    return `<rect x="${(i * w).toFixed(3)}" y="${(30 - h).toFixed(2)}" width="${(w - 0.35).toFixed(3)}" height="${h.toFixed(2)}"/>`;
  }).join("");
  return `<svg class="dist" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
}
const DIST_SVG = distributionSvg();

export const LOGO = `<svg viewBox="0 0 64 64" width="38" height="38" aria-hidden="true">
  <rect width="64" height="64" rx="14" fill="#141B2D"/>
  <path d="M32 12v40M12 32h40" stroke="#F07E26" stroke-width="7" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="6.5" fill="#faf9f5"/>
  <circle cx="32" cy="32" r="3" fill="#F07E26"/>
</svg>`;

// Shared with the city view in home.js, so the two pages cannot drift apart
// on type, palette, or spacing.
// One meta block for every route, so a tag added here reaches all nine page
// types and a count is never written down twice.
//
// Text only. No og:image is emitted from here: the corner page carries its own
// card and adds those tags itself, and no other route has an image worth
// promising. card defaults to summary because a page with no image should not
// ask a reader's client to reserve a large one.
export const META = ({ title, description, url, card = "summary" }) => {
  const e = (t) => String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  return `<title>${e(title)}</title>
<link rel="canonical" href="${e(url)}">
<meta name="description" content="${e(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="StreetCred">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta name="twitter:card" content="${e(card)}">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">`;
};

// Four numbers under the masthead on the root, each one a link to the surface
// that proves it. Nothing here is computed in the template: every value is
// passed in from what the site already stores, so a number on this band and
// the number on the page it links to cannot disagree.
export const STATBAND = ({ scored = 0, audited = 0, headlines = 0, headlinesAsOf = null, spendUsd = null } = {}) => {
  const n = (v) => Number(v).toLocaleString("en-US");
  const cell = (href, value, label, note) =>
    `<a class="sbcell" href="${href}"><span class="sbnum">${value}</span><span class="sblabel">${label}</span><span class="sbnote">${note}</span></a>`;
  return `<section class="statband" aria-label="StreetCred at a glance">
  ${cell("/methodology", n(scored), "intersections graded", "from the city's own records")}
  ${
    // The surface that proves this number is the audited index, row for row.
    // It linked to "/" for a while, which is the page the band is on.
    cell("/audited", n(audited), "fully audited", "every evidence lane checked")
  }
  ${
    // The figure was a snapshot written by a tool run and nothing updated it,
    // so it read the same all day while the batch lane found hundreds more.
    // It counts two sources now and carries the time it was true.
    cell(
      "/watchlist",
      n(headlines),
      "press citations found",
      headlinesAsOf
        ? `coverage timelines plus press checks, as of ${headlinesAsOf}`
        : "across the coverage timelines",
    )
  }
  ${
    spendUsd === null
      ? cell("/status", "0", "letters sent to officials", "this is a drafting tool")
      // The figure is the provider's invoice for the current billing cycle, so
      // the note says cycle. It read "published per run" for a while, which
      // described a period total as though it were the price of one run.
      : cell("/status", `$${Number(spendUsd).toFixed(2)}`, "spent running itself", "this billing cycle, each run in the ledger")
  }
</section>`;
};

// The AI imagery disclosure, defined once. The footer says it on every page and
// the hero embed says it beside the render itself. Two copies of a sentence
// like this is one copy too many: they drift, and the drift is the product
// quietly softening its own disclosure.
// What to say when there is no photograph on the page.
//
// "Street View has no photograph of this corner" is a claim about Google's
// coverage, and it was rendering for every falsy frame: a corner we simply had
// not fetched yet, a generation still running, a probe that errored. Only one
// stored status actually establishes absence, and that is the one where the
// probe ran and came back empty. Everything else is our gap, and our gap must
// not be reported as somebody else's.
export const IMAGERY_ABSENT_CONFIRMED = "nocoverage";
export function emptyImageryNote(status) {
  if (status === IMAGERY_ABSENT_CONFIRMED) return "Street View has no photograph of this corner.";
  if (status === "pending" || !status) return "Loading the Street View photograph for this corner.";
  return "No photograph stored for this corner yet.";
}

export const AI_DISCLAIMER =
  "The proposed fix is a visualization, not a photograph of anything that exists.";

// The corner page's own summary of what the record holds, so the embed states
// the corner's evidence in the corner page's words rather than composing a
// second claim about the same numbers.
export const evidenceLine = (cred, district) => {
  const records = cred?.lanes?.find((l) => l.key === "records");
  return [records?.detail, district ? `District ${district}` : null]
    .filter(Boolean)
    .join(". ")
    .replace(/\.\./g, ".");
};

// The corner of the day, embedded and alive in the homepage hero.
//
// The best thing this site does was behind a click: a thin strip that named the
// corner and left the render, the grade and the evidence on the other side of a
// navigation most visitors never make. This puts the corner itself in the hero,
// already open, with the proposed fix showing.
//
// Assembled entirely from KV by the caller. No provider call happens here or
// anywhere downstream of here: the frames are stored bytes served by /gen, the
// grade and the evidence line come from records the audit already wrote.
// The comparison slider, markup half.
//
// Ids are passed in rather than baked in, because the corner page's script
// addresses its own elements by name and predates this extraction. Both mounts
// get the same element order, the same classes and the same handle semantics,
// so the CSS above and the behavior below apply to either without a branch.
export const SLIDER = ({
  root,
  base,
  ov,
  hdl,
  // A mount that can never compare gets no second pane and no handle at all.
  // The corner page always can, once its imagery lane answers; the homepage
  // hero knows at render time whether the corner has a second frame, and a
  // corner that has only its photograph must not carry an empty image element
  // and a hidden handle around as evidence of a slider that is not there.
  compare = true,
  single = false,
  hidden = false,
  imgHidden = false,
  baseSrc = "",
  baseAlt = "",
  ovSrc = "",
  ovAlt = "",
  w = 640,
  h = 400,
  priority = false,
} = {}) => {
  const img = (id, cls, src, alt) =>
    `<img class="${cls}" id="${id}"${imgHidden ? " hidden" : ""}${src ? ` src="${src}"` : ""}` +
    ` width="${w}" height="${h}" alt="${alt}"${priority ? ' fetchpriority="high"' : ""}>`;
  return `<div class="hero${single ? " single" : ""}" id="${root}"${hidden ? " hidden" : ""}>
      ${img(base, "sbase", baseSrc, baseAlt)}${
        compare
          ? `
      ${img(ov, "sov", ovSrc, ovAlt)}
      <div class="shdl" id="${hdl}" role="separator" tabindex="0" aria-label="Comparison slider, arrow keys move it" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>`
          : ""
      }
    </div>`;
};

// The comparison slider, behavior half. Inlined into whichever script mounts
// it, so there is exactly one implementation of the drag in the codebase.
// Pointer drag, touch drag and arrow keys all end in the same setter, which is
// the only reason the three input paths cannot drift apart.
// The same Pacific-day rule as the server's, for the scripts that stamp a date
// in the browser. A visitor's own clock is irrelevant here: the claim is about
// San Francisco, so the render is San Francisco's date whether the reader is in
// Berlin or in the Sunset. Inlined rather than imported because these run inside
// the page's own <script>, and duplicated text is cheaper than a second request.
export const PACIFIC_DAY_JS = `
// YYYY-MM-DD in America/Los_Angeles. "" for anything unparseable.
function ptDay(ts){
  if(ts === null || ts === undefined || ts === "") return "";
  var d = (ts instanceof Date) ? ts : new Date(ts);
  if(isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {timeZone:"America/Los_Angeles",
      year:"numeric", month:"2-digit", day:"2-digit"}).format(d);
  } catch(e) {
    // No Intl timezone data is a browser old enough that a wrong date is worse
    // than none, so this says nothing rather than saying UTC.
    return "";
  }
}
`;

export const SLIDER_JS = `
function mountSlider(root, ov, hdl, onSplit){
  if(!root || !ov || !hdl) return null;
  var split = 50, drag = false;
  function set(pct){
    split = Math.max(0, Math.min(100, pct));
    ov.style.clipPath = "inset(0 0 0 " + split + "%)";
    hdl.style.left = split + "%";
    hdl.setAttribute("aria-valuenow", String(Math.round(split)));
    if(onSplit) onSplit(split);
  }
  function move(e){
    if(!drag) return;
    var r = root.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    set(x / r.width * 100);
  }
  hdl.addEventListener("pointerdown", function(e){ drag = true; e.preventDefault(); });
  // Keyboard control: 5 percent per press, Home and End jump. The slider was
  // the one piece of the page a keyboard user literally could not operate.
  hdl.addEventListener("keydown", function(e){
    if(e.key === "ArrowLeft" || e.key === "ArrowDown"){ e.preventDefault(); set(split - 5); }
    else if(e.key === "ArrowRight" || e.key === "ArrowUp"){ e.preventDefault(); set(split + 5); }
    else if(e.key === "Home"){ e.preventDefault(); set(0); }
    else if(e.key === "End"){ e.preventDefault(); set(100); }
  });
  addEventListener("pointerup", function(){ drag = false; });
  addEventListener("pointermove", move);
  set(split);
  return { set: set, get: function(){ return split; } };
}`;

// The corner of the day, embedded in the homepage hero.
//
// The imagery is the slider, not a still: the photograph on the left, the
// proposal on the right, the handle in the middle. That is the one thing a
// first-time visitor plays with without being told to, and it was the reason
// the corner page held attention while the homepage did not.
export const HERO_CORNER = (e) => {
  if (!e || !e.slug) return "";
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  // Values that travel into the inline script. JSON alone is not enough: a
  // corner name carrying a closing tag would end the script element early.
  const js = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
  const frames = e.frames || {};
  const LABEL = { today: "Today", hazards: "Hazards", fix: "Proposed fix" };
  const CAP = {
    today: "The corner as Street View last photographed it. Imagery: Google.",
    hazards:
      "Gemini read the real photograph and marked the zones it flags as high risk: faded crosswalk markings in red, vehicle conflict zones in amber. Drag to compare.",
    fix: "An AI visualization of continental crosswalks, a protected bike lane, and a corner curb extension. Drag to compare.",
  };
  const ALT = {
    today: `${e.name} today, photographed by Google Street View`,
    hazards: `Automated hazard audit of ${e.name}, with high risk zones marked`,
    fix: `AI visualization of a proposed fix at ${e.name}. Not a photograph.`,
  };

  // Which frame sits under the right-hand pane on load. A slider needs two
  // frames, so it exists only when the photograph has something to be compared
  // against. The proposal is the default because it is the thing worth
  // dragging to; the hazard audit stands in when a corner has that but no
  // render. A corner with only its photograph gets the photograph, never a
  // slider with a missing pane.
  const compare = frames.today && frames.fix ? "fix" : frames.today && frames.hazards ? "hazards" : null;

  // Chips, in the order they read: back to the slider, the other overlay, the
  // unedited photograph for anyone who wants to see what is actually there.
  const views = [];
  if (compare) views.push(["Compare", compare]);
  if (frames.hazards && compare !== "hazards") views.push(["Hazards", "hazards"]);
  if (frames.today) views.push(["Today", "today"]);
  const firstState = views.length ? views[0][1] : null;

  const stage = frames.today
    ? SLIDER({
        root: "hchero",
        base: "hcbase",
        ov: "hcov",
        hdl: "hchdl",
        compare: Boolean(compare),
        single: !compare,
        priority: true,
        baseSrc: esc(frames.today),
        baseAlt: esc(ALT.today),
        ovSrc: compare ? esc(frames[compare]) : "",
        ovAlt: compare ? esc(ALT[compare]) : "",
      })
    : `<div class="hcnone">
      <span class="hcnonel">Imagery audit pending</span>
      <p class="hcnonen">${
        e.state === "text-only"
          ? "This corner was audited from the city's records. The visual audit has not been generated for it."
          : "No photograph is stored for this corner yet."
      }</p>
    </div>`;

  const caption = firstState
    ? `<p class="hccap"><b id="hccapk">${esc(LABEL[firstState])}</b> <span id="hccapv">${esc(CAP[firstState])}</span></p>`
    : "";
  // One chip is not a choice, so a corner with a single frame gets its caption
  // and nothing to press.
  const stageControls =
    views.length > 1
      ? `<div class="hctoggle" role="group" aria-label="Corner view">
      ${views
        .map(
          ([label, state]) =>
            `<button type="button" data-state="${state}" aria-pressed="${state === firstState}">${label}</button>`,
        )
        .join("")}
    </div>
    ${caption}`
      : caption;

  return `<section class="herocorner" aria-label="Corner of the day">
  <div class="hchead">
    <span class="hceyebrow">Corner of the day</span>
    <a class="hcname" href="/c/${esc(e.slug)}">${esc(e.name)}</a>
    ${e.grade ? `<span class="hcgrade g${esc(e.grade)}">${esc(e.grade)}</span>` : ""}
  </div>
  <p class="hcwhen">${
    // "This morning" is a claim about today and is only made when it is true.
    // An older corner states its real date and drops the claim rather than
    // softening it into something that still sounds like today.
    e.auditedToday
      ? `Audited autonomously this morning, ${esc(e.date)}`
      : `Audited autonomously ${esc(e.date)}`
  }${e.partial ? ". Records audited; visual lanes pending" : ""}</p>
  ${
    // The newer audit this card is not featuring. The card features the newest
    // corner that can actually be dragged, so on any morning whose imagery has
    // not landed the newest audit is not the one on screen. Saying so here is
    // what keeps the page to one answer about what was audited most recently,
    // and it links, so the claim is checkable in one tap.
    e.pending
      ? `<p class="hcpending">${
          e.pending.auditedToday
            ? "Latest audit this morning: "
            : `Latest audit ${esc(e.pending.date)}: `
        }<a href="/c/${esc(e.pending.slug)}">${esc(e.pending.name)}</a>, visual lanes pending</p>`
      : ""
  }
  ${stage}
  ${
    // The sentence is about the proposed fix, so it appears when the proposed
    // fix does and not otherwise. On a corner whose render was never generated
    // it disclaimed an image that is not on the page, which reads as a site
    // hedging by reflex rather than telling you something about what you are
    // looking at. Still never behind a tooltip, still directly under the image
    // so a phone shows it without a scroll, and it follows the view: hidden on
    // the unedited photograph and on the hazard overlay, both of which have
    // their own honest captions.
    frames.fix
      ? `<p class="hcdisclaim" id="hcdisc"${compare === "fix" ? "" : " hidden"}>${AI_DISCLAIMER}${
          // Where this particular render came from. Follows the same visibility
          // rule as the disclaimer above it, because it is a claim about the
          // proposed-fix frame and about nothing else on the page.
          e.provenance === "promoted-from-enriched" ? ` ${PROMOTED_NOTE}` : ""
        }</p>`
      : ""
  }
  ${
    // Audited from the records with no visual audit generated. The photograph
    // is real and stays; the page says what is missing rather than letting the
    // single frame imply the other two are coming.
    frames.today && !frames.hazards && !frames.fix
      ? `<p class="hcpending">Imagery audit pending. This corner was audited from the city's records; the visual audit has not been generated for it.</p>`
      : ""
  }
  ${stageControls}
  ${e.evidence ? `<p class="hcev">${esc(e.evidence)}</p>` : ""}
  <div class="hcact">
    <a class="hcgo" href="/c/${esc(e.slug)}">See the full audit</a>
    <a class="hcletter" href="/c/${esc(e.slug)}#letterpanel">Get the letter</a>
  </div>
</section>
<script>
(function(){
  var root=document.currentScript.previousElementSibling;
  if(!root) return;
  var stage=root.querySelector("#hchero");
  if(!stage) return;
${SLIDER_JS}
  var ov=root.querySelector("#hcov"),hdl=root.querySelector("#hchdl");
  // Mounted only when there are two panes to compare. A single-frame corner
  // has no chips either, so nothing below can ask for a drag that cannot exist.
  var SL=stage.classList.contains("single")?null:mountSlider(stage,ov,hdl);
  var SRC=${js({ hazards: frames.hazards || "", fix: frames.fix || "" })};
  var CAP=${js(CAP)},LAB=${js(LABEL)},ALT=${js(ALT)};
  var btns=root.querySelectorAll(".hctoggle button");
  btns.forEach(function(b){
    b.addEventListener("click",function(){
      var st=b.getAttribute("data-state");
      var disc=root.querySelector("#hcdisc");
      if(disc) disc.hidden = st!=="fix";
      if(st==="today"){ stage.classList.add("single"); }
      else{
        stage.classList.remove("single");
        if(ov.getAttribute("src")!==SRC[st]){
          ov.style.opacity="0";
          ov.onload=function(){ ov.style.opacity="1"; };
          ov.src=SRC[st];
          ov.alt=ALT[st]||"";
        }
        // Every switch returns the handle to the middle, so each state opens
        // the way the page did.
        if(SL) SL.set(50);
      }
      btns.forEach(function(o){ o.setAttribute("aria-pressed",String(o===b)); });
      var k=root.querySelector("#hccapk"),v=root.querySelector("#hccapv");
      if(k) k.textContent=LAB[st]||"";
      if(v) v.textContent=CAP[st]||"";
    });
  });
})();
</script>`;
};

// The footer, one component for every route.
//
// Three columns of orientation, then the honesty lines, which close the page
// unchanged on every route. Those lines are the product's contract with the
// reader: what the imagery is, and that nothing here is sent to anybody. They
// are reproduced verbatim and they stay last, where a reader finishes.
//
// The event line finally earns its click: "Built at Build Club, August 17 2026"
// is the anchor for the repository, because that sentence was the one place the
// page claimed provenance and offered no way to check it.
export const FOOTER = () => `<footer>
<div class="fcols">
  <div class="fcol">
    <span class="fh">Product</span>
    <a href="/#find">Find your corner</a>
    <a href="/audited">Audited corners</a>
    <a href="/watchlist">Watchlist</a>
    <a href="/methodology">How it is scored</a>
  </div>
  <div class="fcol">
    <span class="fh">Trust</span>
    <a href="/radar">Press radar</a>
    <a href="/status">Status and cost ledger</a>
    <a href="/changes">Changes</a>
    <a href="/watchdog">Watchdog</a>
  </div>
  <div class="fcol">
    <span class="fh">Source</span>
    <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub repo</a>
    <a href="https://data.sfgov.org/Public-Safety/Traffic-Crashes-Resulting-in-Injury/ubvf-ztfx" target="_blank" rel="noopener">DataSF collisions</a>
    <a href="https://data.sfgov.org/City-Infrastructure/311-Cases/vw6y-z8j6" target="_blank" rel="noopener">DataSF 311 cases</a>
  </div>
</div>
<p class="fhonest">Exa finds it, Apify hears it, Gemini shows it and writes it. <a href="${REPO_URL}" target="_blank" rel="noopener">Built at Build Club, August 17 2026</a>.<br>
Hazard and proposed-fix images are AI generated from the Street View photograph. ${AI_DISCLAIMER} Nothing here is sent to any official.</p>
</footer>`;

export const REPO_URL = "https://github.com/alejandro-publius/streetcred";

// The product level band, above every page's own header.
//
// It exists because the trust surfaces were reachable only from a footer, and
// a judge who lands on a corner page had no way to see that a watchlist, a
// methodology and a cost ledger exist at all. The count comes from the caller
// so it is the same live number the page prints rather than a second copy.
//
// The search here is a link rather than a second typeahead. public/typeahead.js
// binds to one input by id, so mounting a compact second instance would need
// the component to support multiple mounts, which is a behaviour change and
// this pass is visual only. The link lands on the real search on the root.
export const MASTHEAD = ({ scored = 0, active = "" } = {}) => {
  const n = (v) => Number(v).toLocaleString("en-US");
  const link = (href, label, key) =>
    `<a href="${href}"${key === active ? ' class="on" aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="mast" aria-label="StreetCred">
  <a class="mastmark" href="/" aria-label="StreetCred home">Street<span>Cred</span></a>
  ${scored ? `<span class="mastcount">${n(scored)} SF intersections scored</span>` : ""}
  <a class="mastfind" href="/#find">Find your corner</a>
  <nav class="mastnav" aria-label="Trust surfaces">
    ${link("/audited", "Audited", "audited")}
    ${link("/watchlist", "Watchlist", "watchlist")}
    ${link("/methodology", "Methodology", "methodology")}
    ${link("/status", "Status", "status")}
    ${link("/changes", "Changes", "changes")}
  </nav>
  <a class="mastgh" href="${REPO_URL}" target="_blank" rel="noopener" aria-label="Source on GitHub">
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
  </a>
  <button class="mastmenu" id="mastmenu" type="button" aria-expanded="false" aria-controls="mastnav-collapsed">Menu</button>
</nav>
<nav class="mastdrop" id="mastnav-collapsed" hidden aria-label="Trust surfaces">
  ${link("/audited", "Audited", "audited")}
  ${link("/watchlist", "Watchlist", "watchlist")}
  ${link("/methodology", "Methodology", "methodology")}
  ${link("/status", "Status", "status")}
  ${link("/changes", "Changes", "changes")}
  <a href="/#find">Find your corner</a>
  <a href="${REPO_URL}" target="_blank" rel="noopener">Source on GitHub</a>
</nav>
<script>
(function(){
  var b=document.getElementById("mastmenu"),d=document.getElementById("mastnav-collapsed");
  if(!b||!d) return;
  b.addEventListener("click",function(){
    var open=d.hidden===false;
    d.hidden=open;
    b.setAttribute("aria-expanded",String(!open));
  });
})();
</script>`;
};

export const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Lora:ital@0;1&display=swap" rel="stylesheet">`;

// A corner that does not exist gets told so. Previously this path rendered the
// default corner's page under the requested name, which is the most confident
// way software can be wrong: no error, no empty state, just the wrong corner's
// collision record presented as the answer.
export const NOT_FOUND = (slug, origin = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Corner not found</title>
<link rel="icon" href="/logo.svg">
<meta name="robots" content="noindex">
${FONT_LINK}
<style>
${BASE_CSS}
.nf{max-width:560px;margin:0 auto;padding:64px 0 0}
.nf h1{font-size:26px;letter-spacing:-.02em;margin:0 0 12px}
.nf p{font-size:14.5px;color:var(--dim);line-height:1.65;margin:0 0 22px}
.nf code{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:2px 7px;font-size:13px}
.nf a{display:inline-block;font-size:13px;font-weight:600;color:#fff;background:var(--ink);
  border-radius:999px;padding:10px 18px;text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
<header>
  ${LOGO}
  <div class="mark">Street<span>Cred</span></div>
</header>
<main>
<div class="nf">
  <h1>No corner by that name</h1>
  <p>Nothing here matches <code>${String(slug || "").replace(/[&<>"]/g, "")}</code>.
  It may be misspelled, or it may not be an intersection the city's records describe.
  Rather than show you another corner's numbers, this page shows you nothing.</p>
  <a href="${origin}/">Check a corner</a>
</div>
</div>
</body>
</html>`;

export const BASE_CSS = `:root{
  --bg:#faf9f5; --panel:#fff; --card:#f4f2ec; --line:#e8e6dc;
  /* One step darker than --line, for panel edges that need to hold their own
     against the page rather than disappear into it. */
  --line2:#dcd9cc;
  /* Darker again, and the one every panel edge actually uses. On a #faf9f5
     ground a white panel with a #e8e6dc hairline reads as floating text rather
     than as a container, which is the whole problem this fixes. */
  --line3:#d6d2c4;
  --ink:#141B2D; --accent:#F07E26; --blue:#6a9bcc; --green:#788c5d;
  /* Dim text was #8a867c, 3.45:1 against the page ground, an AA failure on
     every caption on the site. #6f6b61 is the same warm gray darkened until it
     clears 4.5:1 on the ground (5.04), the panel (5.31) and the card (4.75).
     Decorative uses that need the old lightness read --dimline instead. */
  --dim:#6f6b61; --dimline:#8a867c;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Poppins,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:28px 22px 64px}
/* The product level band. Slim, above every page's own header, existing palette
   only. Below 700px it keeps the wordmark and the count and hands the links to
   a disclosure button, because five links and a count do not fit a phone
   without either wrapping into a second band or shrinking past legibility. */
.mast{display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  padding:8px 0 16px;margin-bottom:16px;border-bottom:1px solid var(--line)}
.mastmark{font-size:15px;font-weight:700;letter-spacing:-.01em;text-decoration:none;color:var(--ink);white-space:nowrap}
.mastmark span{color:#a04d0c}
.mastcount{font-size:12px;color:var(--dim);white-space:nowrap;font-variant-numeric:tabular-nums}
.mastfind{font-size:12px;font-weight:600;text-decoration:none;color:var(--ink);
  border:1px solid var(--line2);border-radius:999px;padding:4px 11px;white-space:nowrap}
.mastfind:hover{border-color:var(--ink)}
.mastnav{display:flex;gap:16px;margin-left:auto;flex-wrap:wrap}
.mastnav a{font-size:12px;font-weight:600;text-decoration:none;color:var(--dim);white-space:nowrap}
.mastnav a:hover{color:var(--ink)}
.mastnav a.on{color:var(--ink)}
.mastgh{display:inline-flex;align-items:center;color:var(--dim)}
.mastgh:hover{color:var(--ink)}
.mastmenu{display:none;margin-left:auto;font-family:inherit;font-size:12px;font-weight:600;
  color:var(--ink);background:var(--card);border:1px solid var(--line2);border-radius:999px;
  padding:5px 13px;cursor:pointer}
.mastdrop{display:none}
@media(max-width:700px){
  .mastnav,.mastfind{display:none}
  .mastmenu{display:block}
  .mastdrop:not([hidden]){display:flex;flex-direction:column;gap:2px;margin:-8px 0 18px;
    padding:10px 0;border-bottom:1px solid var(--line)}
  .mastdrop a{font-size:13px;font-weight:600;text-decoration:none;color:var(--ink);padding:7px 2px}
}

/* The header wraps rather than stacking. Separate row and column gaps do the
   work: items sitting together get 14px, and anything that wraps onto its own
   row clears 24px, which is the gap the title block has to keep from the
   nearest control.

   Column direction was tried and was wrong sitewide. Only corner pages have a
   control wrapper to stack against; on /methodology, /status, /changes and
   /watchdog the header's children are the logo, the wordmark and the nav, and
   forcing a column put each of those on its own line. */
header{display:flex;align-items:center;column-gap:14px;row-gap:24px;padding-bottom:22px;flex-wrap:wrap}
/* Corner pages: the controls take a full row, so the title block takes the
   next one. One row was tried and cannot hold. The content column is capped at
   1120px minus padding, and at the longest warmed corner name ("16th Street
   and Mission Street") the controls plus the title block need more than that,
   so the title had nowhere to go but into the buttons: the clear gap measured
   14px at every width from 360 to 1600. */
.hctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1 0 100%}
.hctl ~ .corner{flex:1 0 100%;margin-left:0}
.mark{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1}
.mark span{color:var(--accent)}
.switcher{display:flex;gap:7px;margin-left:14px}
.switcher a{font-size:12.5px;font-weight:600;text-decoration:none;color:var(--dim);
  background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 15px;white-space:nowrap}
.switcher a.on{background:var(--ink);border-color:var(--ink);color:#fff}
.find{display:flex;align-items:center;gap:7px;margin-left:6px;position:relative}
.find input{font-family:inherit;font-size:13px;color:var(--ink);background:var(--panel);
  border:1px solid var(--line);border-radius:999px;padding:8px 15px;width:200px}
.find input:focus{border-color:var(--accent)}
.find input::placeholder{color:var(--dim)}
/* Typeahead. A listbox under the find input, same vocabulary as the board:
   solid chip = audited grade, hollow dot = scored and waiting for its audit. */
.ta{position:absolute;top:44px;left:0;right:0;margin:0;padding:5px;list-style:none;z-index:7;
  background:var(--panel);border:1px solid var(--line2);border-radius:10px;
  box-shadow:0 6px 18px rgba(20,27,45,.09);min-width:260px}
.ta li{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;
  font-size:13px;cursor:pointer}
.ta li.on,.ta li:hover{background:var(--card)}
.ta li[aria-disabled]{color:var(--dim);cursor:default}
.ta li[aria-disabled]:hover{background:none}
.ta-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ta-n b{font-weight:700}
.ta-g{display:inline-grid;place-items:center;min-width:19px;height:19px;border-radius:6px;
  color:#fff;font-weight:700;font-size:10.5px;padding:0 4px}
.ta-dot{display:inline-block;width:9px;height:9px;border-radius:50%;border:2px solid var(--dim);
  background:none}
.find button{font-family:inherit;font-size:12.5px;font-weight:600;color:#fff;background:var(--ink);
  border:0;border-radius:999px;padding:9px 16px;cursor:pointer;white-space:nowrap}
.find button[disabled]{opacity:.5;cursor:default}
.findmsg{position:absolute;top:44px;left:0;font-size:12.5px;color:var(--ink);background:var(--panel);
  border:1px solid var(--line);border-radius:10px;padding:9px 13px;width:300px;line-height:1.5;
  z-index:6;box-shadow:0 6px 18px rgba(20,27,45,.09)}
.share{font-family:inherit;font-size:12.5px;font-weight:600;color:var(--dim);background:var(--card);
  border:1px solid var(--line);border-radius:999px;padding:8px 15px;cursor:pointer;white-space:nowrap;
  transition:color 150ms ease-out,border-color 150ms ease-out}
.share:hover{color:var(--ink);border-color:var(--ink)}
.share.ghost{background:none;border-color:var(--line2)}

/* The replay. A terminal log of what the tools actually did on this corner,
   read from the stored run manifest and never recomputed. It is theatre, and it
   says so twice: it names the date of the run it is replaying and it states
   that the timings are for display. An animation that implied these tools ran
   in five seconds would be a lie told with CSS. */
.replay{background:var(--ink);border:1.5px solid var(--ink);border-radius:12px;
  padding:0;margin:0 0 20px;overflow:hidden;box-shadow:0 1px 3px rgba(20,27,45,.06)}
.rhead{display:flex;align-items:center;gap:10px;padding:11px 16px;
  background:rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.12)}
.rttl{font-size:11.5px;color:rgba(255,255,255,.72);letter-spacing:.02em}
.rttl b{color:#fff;font-weight:600}
.rtrig{font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
  color:var(--accent);border:1px solid rgba(240,126,38,.5);border-radius:4px;padding:2px 7px;white-space:nowrap}
.rgrow{flex:1}
.rbtn{font-family:inherit;font-size:11.5px;font-weight:600;color:rgba(255,255,255,.72);
  background:none;border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:5px 13px;cursor:pointer}
.rbtn:hover{color:#fff;border-color:#fff}
.rlog{padding:14px 16px;min-height:150px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:12px;line-height:1.5}
.rline{display:flex;gap:10px;padding:4px 0;color:rgba(255,255,255,.86);
  opacity:0;transform:translateY(4px);transition:opacity 150ms ease-out,transform 150ms ease-out}
.rline.in{opacity:1;transform:none}
.rline b{display:block;width:3px;flex:0 0 3px;border-radius:2px;background:var(--dimline);margin-top:3px;align-self:stretch}
.rline.record b{background:#fff}
.rline.press b{background:var(--blue)}
.rline.voices b{background:var(--dimline)}
.rline.vision b{background:var(--accent)}
.rline.index b{background:var(--accent)}
.rline.ask b{background:var(--green)}
.rline.off{color:rgba(255,255,255,.5)}
.rline a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(240,126,38,.5)}
.rfoot{font-size:10.5px;color:rgba(255,255,255,.5);margin:0;padding:0 16px 13px;line-height:1.5}
@media(prefers-reduced-motion:reduce){
  .rline{opacity:1;transform:none;transition:none}
}
/* Header text blocks, one pattern for every page.
   Every line inside one is its own block element with a 4px rhythm, and a bare
   text node never sits beside another line. That is not a style preference:
   "San Francisco" followed by a bare counter rendered as
   "San Francisco7,355 corners graded" the moment the <b> stopped being a
   block, because two separate sentences were sharing an inline run with
   nothing between them. Give every line an element of its own and that failure
   cannot recur. */
.corner{margin-left:auto;text-align:right;font-size:13px;color:var(--dim);line-height:1.5}
.corner > b,.corner > .csub,.corner > .cmeta,.corner > .ctwin,.corner > .auto{display:block}
.corner > b{font-size:15px;color:var(--ink);font-weight:600}
.corner > .csub,.corner > .cmeta{margin-top:4px}
/* The name and its tier chip are siblings in a flex row, never one inside the
   other. The chip used to live inside the h1, whose only child was a block
   element, so the two boxes overlapped and the page read "Market StreetAUDITED"
   at every width. Wrapping is allowed: when the name takes the full line the
   chip drops to its own line rather than squeezing. */
.ctitle{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}
/* Said on the page, because the alternative is a page that quietly answers
   about a crossing four kilometres from the one somebody meant. Only the few
   slugs two different pairs of streets produce ever show this. */
.ctwin{margin-top:6px;font-size:11.5px;line-height:1.5;color:var(--dim)}
.ctwin a{color:var(--accent);text-decoration:none;font-weight:600}
.ctwin a:hover{text-decoration:underline}
/* Only present on a corner the scheduled handler audited by itself. It is a
   claim about the product rather than about the corner, so it appears only when
   the run record says so and never as decoration. */
.corner .auto{display:block;font-size:10.5px;font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;color:var(--accent);margin-top:3px}
.lede{font-size:15px;color:var(--dim);max-width:660px;margin:0 0 26px;line-height:1.6}
.nudge{font-family:inherit;font-size:inherit;color:#b0560e;background:none;border:0;padding:0;
  cursor:pointer;text-decoration:underline;text-underline-offset:3px}

/* Danger Index. The grade chip and the severity ramp stay inside the existing
   palette: ink reads as most severe, then the accent, then two accent tints. No
   new hues, so the score cannot fight the rest of the page. */
.scorewrap{display:flex;gap:24px;align-items:center;background:var(--panel);border:1.5px solid var(--line3);
  border-top:3px solid var(--ink);border-radius:12px;padding:18px 20px;margin-bottom:12px;flex-wrap:wrap;
  box-shadow:0 1px 3px rgba(20,27,45,.06);
  transition:transform 150ms ease-out,box-shadow 150ms ease-out}
.scorefig{display:flex;align-items:center;gap:12px}
.scoren{font-size:50px;font-weight:700;line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.scoren small{font-size:17px;font-weight:600;color:var(--dim);letter-spacing:0}
.scoreg{font-size:21px;font-weight:700;min-width:40px;height:40px;padding:0 9px;border-radius:11px;
  display:grid;place-items:center;color:#fff;background:var(--card);
  transition:background-color 2s ease-in,color 2s ease-in}
/* Five steps through two existing hues. No new red: an F is the accent at full
   strength, which is already the loudest thing in this palette. */
.scoreg.gA{background:var(--green)}
.scoreg.gB{background:rgba(120,140,93,.62)}
.scoreg.gC{background:var(--blue)}
.scoreg.gD{background:rgba(240,126,38,.7)}
.scoreg.gF{background:var(--accent)}
.scoremeta{flex:1;min-width:230px}
.scorelabel{font-size:12.5px;font-weight:600;color:var(--ink);margin-bottom:7px}
.scorepct{font-size:13px;font-weight:600;color:var(--ink);line-height:1.45;margin:0 0 9px}
/* The citywide distribution, drawn from the same frozen 600 intersection sample
   the grade is computed against. Square root scaled on the vertical, because on
   a linear scale the tail is so heavy that only the last three bars are visible
   and the shape stops making its own argument. Pure SVG, no library. */
.distwrap{position:relative;margin:0}
.dist{display:block;width:100%;height:30px}
.dist rect{fill:#c7c3b3}
.dmark{position:absolute;top:-5px;bottom:-1px;width:2px;margin-left:-1px;background:var(--ink);border-radius:1px}
.dmark::after{content:"";position:absolute;top:-4px;left:50%;transform:translateX(-50%);
  width:8px;height:8px;border-radius:50%;background:inherit}
.dmark.gA{background:var(--green)}
.dmark.gB{background:rgba(120,140,93,.62)}
.dmark.gC{background:var(--blue)}
.dmark.gD{background:rgba(240,126,38,.7)}
.dmark.gF{background:var(--accent)}
/* Three spans in a space-between flex row with no gap and nothing stopping the
   endpoints shrinking. The middle label is long, so the moment the three items
   exceed the track there is no free space left to distribute: the spans butt
   against each other and the row reads "calmer8,254 SF intersections, the /
   whole cityworst". A grid gives each label its own column and a real gutter,
   and the endpoints are bound to the ends structurally rather than by whatever
   space happens to be left, so linearized and assistive reading keeps them
   separate and in order. */
.distax{display:grid;grid-template-columns:auto 1fr auto;align-items:baseline;
  gap:0 12px;font-size:10px;color:var(--dim);letter-spacing:.04em;margin:4px 0 6px}
.distax .dend{white-space:nowrap}
.distax .dend:first-child{justify-self:start}
.distax .dend:last-child{justify-self:end}
.distax .dmid{justify-self:center;text-align:center}
@media(max-width:600px){
  /* Too narrow for three across. The middle label takes its own line under the
     two endpoints rather than wrapping into them. */
  .distax{grid-template-columns:auto auto;justify-content:space-between;gap:2px 12px}
  .distax .dmid{grid-column:1 / -1;order:2;justify-self:center}
}
/* The two denominators reconciled where they first meet. The scale is the whole
   census; the masthead's count is the graded subset. Both are live constants
   and they used to appear on the same page contradicting each other. */
.distbridge{font-size:10.5px;color:var(--dim);line-height:1.6;margin:0 0 12px}
.sevbar{display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--card);margin-bottom:9px}
.sevbar i{display:block;height:100%}
.sevbar i.f{background:var(--ink)}
.sevbar i.s{background:var(--accent)}
.sevbar i.o{background:rgba(240,126,38,.55)}
.sevbar i.p{background:rgba(240,126,38,.25)}
.sevkey{display:flex;gap:13px;flex-wrap:wrap;font-size:11.5px;color:var(--dim);margin-bottom:7px}
.sevkey b{font-weight:600;color:var(--ink)}
.scorecav{font-size:11.5px;color:var(--dim);line-height:1.5}
.ghist{margin-top:8px}
.ghist summary{font-size:11.5px;font-weight:600;color:var(--dim);cursor:pointer;list-style:none;
  display:inline-block;border-bottom:1px dashed var(--line2)}
.ghist summary::-webkit-details-marker{display:none}
.ghist summary:hover{color:var(--ink)}
.ghist div{font-size:12px;color:var(--dim);line-height:1.7;margin-top:6px}
.ghist b{color:var(--ink);font-variant-numeric:tabular-nums}

/* Hazard tape.
   Caution stripes around the press card, because press coverage of a corner is
   the one lane that is somebody else already saying this place is dangerous.

   The motion rule is the whole point. Stripes are static. They slide exactly
   twice, 1.6s a loop, the first time the card is scrolled into view, and then
   they hold still forever. A border that never stops moving stops meaning
   anything and starts being wallpaper, so continuous motion is reserved for a
   run that is genuinely happening right now: the /status scan card, and only
   while a batch is actually reporting progress.

   The band period along the diagonal is 28px, so a 39.6px horizontal shift is
   exactly one repeat and the loop is seamless. */
.tape{padding:6px;border-radius:16px;margin-bottom:20px;
  background:repeating-linear-gradient(45deg,#EDA100 0 14px,#2C2C2A 14px 28px)}
.tape > *{margin-bottom:0 !important;border-radius:11px}
@keyframes tapeslide{from{background-position:0 0}to{background-position:39.6px 0}}
.tape.play{animation:tapeslide 1.6s linear 2}
.tape.live{animation:tapeslide 1.6s linear infinite}
@media(prefers-reduced-motion:reduce){
  .tape.play,.tape.live{animation:none}
}

.toggle{display:flex;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px;width:max-content;margin-bottom:16px}
.toggle button{font-family:inherit;font-size:14px;font-weight:600;color:var(--dim);background:none;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
.toggle button[disabled]{opacity:.42;cursor:default}
.toggle button[aria-pressed="true"]{background:var(--ink);color:#fff}
.toggle button:nth-child(2)[aria-pressed="true"]{background:var(--accent)}
.toggle button:nth-child(3)[aria-pressed="true"]{background:var(--green)}

/* The comparison slider. Two mounts, one component: the corner page fills it
   from the imagery lane after load, the homepage hero renders both frames
   straight out of KV. These rules are keyed on classes rather than on the
   corner page's element ids, which is what lets the second mount exist. */
.hero{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--card);aspect-ratio:640/400}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.hero img[hidden]{display:none}
.hero .sov{transition:opacity 200ms ease-out;clip-path:inset(0 0 0 50%)}
.hero.single .sov{display:none}
.hero.single .shdl{display:none}
.hero .shdl{position:absolute;top:0;bottom:0;left:50%;width:3px;background:#fff;box-shadow:0 0 0 1px rgba(20,27,45,.25);cursor:ew-resize;touch-action:none}
.hero .shdl::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:38px;height:38px;border-radius:50%;background:#fff;box-shadow:0 2px 10px rgba(20,27,45,.35)}
.hero .shdl::before{content:"‹ ›";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2;font-size:17px;font-weight:700;color:var(--ink);letter-spacing:2px}
.hero .shdl:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.cap{display:flex;gap:10px;align-items:baseline;margin:12px 0 14px;font-size:13.5px;color:var(--dim);line-height:1.55}
/* Corroboration chips. Green means the record backs the audit, outline means
   the audit saw something the record has not recorded, gray means the record
   raised something the photograph does not show. */
.hz{display:flex;flex-direction:column;gap:8px;margin:0 0 30px}
.hz .r{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:12.5px;color:var(--dim);line-height:1.45}
.hz .n{color:var(--ink);font-weight:500}
.hzc{font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  padding:2px 7px;border-radius:4px;white-space:nowrap}
.hzc.confirmed{background:rgba(120,140,93,.16);color:var(--green);border:1px solid rgba(120,140,93,.4)}
.hzc.candidate{background:transparent;color:var(--dim);border:1px dashed var(--line2)}
.hzc.reported{background:var(--card);color:var(--dim);border:1px solid var(--line2)}
.hzfoot{font-size:11.5px;color:var(--dim);line-height:1.5;margin:2px 0 0}
.cap b{color:var(--ink);font-weight:600;white-space:nowrap}

/* Three across when the column can hold them, two then one when it cannot.
   auto-fit rather than a fixed three, because these now live in a half width
   column and a fixed three at 430px is three unreadable tiles. */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:12px;margin-bottom:0}
.statgroup{margin:0 0 20px}
.statgroup .statcap{margin:10px 0 0}
/* Cred Check. Typographic, not a panel: four lanes either agree or they do not,
   and a lit chip should read as a fact rather than as a badge. */
.cred{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 30px}
.cred .c{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;
  padding:5px 11px;border-radius:999px;border:1px solid var(--line2);background:var(--panel);
  color:var(--dim);cursor:default;white-space:nowrap}
.cred .c::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--line2)}
.cred .c.on{color:var(--ink);border-color:var(--ink)}
.cred .c.on::before{background:var(--ink)}
/* Three states, not two. A lane nobody has checked is not a lane that failed,
   and drawing them the same way is how absence gets read as evidence. */
.cred .c.pending{border-style:dashed}
.cred .c.pending::before{background:none;box-shadow:inset 0 0 0 1.5px var(--line2)}
.vcred i.pending{background:none;box-shadow:inset 0 0 0 2px var(--line2)}
.cred .v{font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--dim);margin-left:3px}
.cred .v.strong{color:var(--ink)}
.stat{background:var(--panel);border:1.5px solid var(--line3);border-top:3px solid var(--ink);border-radius:12px;
  padding:20px 22px;min-width:0;box-shadow:0 1px 3px rgba(20,27,45,.06);
  transition:transform 150ms ease-out,box-shadow 150ms ease-out}
.stat .n{font-size:34px;font-weight:700;letter-spacing:-.02em;line-height:1.1;color:var(--accent)}
.stat .l{font-size:12.5px;color:var(--dim);margin-top:6px;line-height:1.45}
/* Provenance links. Same size, same color as the bare number, so trust is one
   hover away without turning the page into a link farm. */
a.src{color:inherit;text-decoration:none}
a.src:hover .n,a.src:focus-visible .n{text-decoration:underline;text-underline-offset:4px}
a.src:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:6px}
.srcq{color:var(--dim);text-decoration:none;border-bottom:1px dashed var(--line2)}
.srcq:hover{color:var(--ink)}
/* Footprint labels. The grade counts an 80m core and the tiles count 150m;
   both are deliberate and neither used to say so, which left the letter
   citing two different collision counts in one paragraph. */
.rad{font-style:normal;font-size:11px;color:var(--dim);display:inline-block;margin-top:3px}
/* The freshness line under the tiles. Swept figures are true as of a date, and
   the date is part of the number rather than a footnote about it. */
.statcap{margin:-4px 0 16px;font-size:11.5px;color:var(--dim);line-height:1.5}
/* Which tier this corner is in, said once, next to its name. */
/* inline-flex and no margin: the 10px gap belongs to the flex container, so
   the chip cannot drift out of alignment with whatever it sits beside. */
.tierchip{display:inline-flex;align-items:center;font-size:10px;font-weight:700;letter-spacing:.12em;
  padding:3px 8px;border-radius:999px;border:1px solid var(--line2);color:var(--dim);
  white-space:nowrap;flex:none}
.tierchip.t-audited{border-color:var(--ink);color:var(--ink)}
.tierchip.t-scored{border-style:dashed}
/* The one line every unchecked lane shows, so the page says the same thing in
   six places rather than six things. */
.lanenote{margin:10px 0 0;font-size:12px;color:var(--dim);line-height:1.55;
  padding-left:10px;border-left:2px solid var(--line3)}
.tlhead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 8px}
.tlttl{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
/* Only ever shown when both dates exist, so the chip is a comparison rather
   than a hunch. */
.tag.tlfirst{background:rgba(240,126,38,.10);color:#a04d0c;cursor:help}
/* What the press connects this corner to. Not a finding about the corner: a
   finding about the coverage, so it sits under the coverage. */
.pconn{margin:14px 0 0;padding:12px 14px;background:var(--card);border:1px solid var(--line);
  border-radius:10px;font-size:12.5px;line-height:1.55}
.pconn b{font-weight:600}
.pconn a{color:var(--accent);text-decoration:none;font-weight:600}
.pconn a:hover{text-decoration:underline}
.pconn .pcw{display:block;color:var(--dim);margin-top:4px}
.pcauto{margin:8px 0 0;font-size:11.5px;color:var(--dim);line-height:1.5}
.gated{margin:10px 0 0;font-size:12.5px;color:var(--dim);line-height:1.55}
.gated b{color:var(--ink);font-weight:600}
button.offer[disabled]{opacity:.55;cursor:not-allowed}
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
#mappanel .pbody{padding:16px 18px 14px}
.mapimg{display:block;width:100%;max-height:230px;object-fit:cover;object-position:center;border-radius:10px;border:1px solid var(--line)}
.mapfoot{font-size:11.5px;color:var(--dim);margin:9px 0 0}

.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
.panel{background:var(--panel);border:1.5px solid var(--line3);border-radius:12px;padding:0;margin-bottom:20px;
  box-shadow:0 1px 3px rgba(20,27,45,.06);
  transition:transform 150ms ease-out,box-shadow 150ms ease-out}
/* A 3px cap in the lane's own color, full width and part of the radius. Reads
   as the tab on a file folder, which is the right metaphor for a page that is
   arguing from a case file. */
.panel.lane-record{border-top:3px solid var(--ink)}
.panel.lane-press{border-top:3px solid var(--blue)}
.panel.lane-ask{border-top:3px solid var(--green)}
.panel.lane-voices{border-top:3px solid var(--dim)}
.panel.lane-imagery{border-top:3px solid var(--accent)}
.panel.lane-corner{border-top:3px solid var(--line3)}
.panel:hover,.stat:hover,.scorewrap:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(20,27,45,.10)}
/* The lid. A header strip in the card tint with a rule under it is what turns
   loose text inside a border into a card, and it is where the lane's title and
   its live/cache/sample tag belong: on the container they describe. */
/* Wraps rather than overflows. A panel heading and its tag together are wider
   than a 360px phone once the padding is counted, and with nowrap the tag ran
   off the right edge and gave the whole page a horizontal scrollbar. It only
   became visible when scored corners started showing the map panel without
   waiting for a thumbnail, which is what put a panel heading on screen at that
   width for the first time. */
.phs{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  background:var(--card);border-bottom:1px solid var(--line3);padding:11px 20px;
  border-radius:9px 9px 0 0}
.phs h2{font-size:13px;font-weight:600;margin:0;letter-spacing:.01em}
.phs .draft{margin:0}
.pbody{padding:20px}
/* One tag system. Every lane status chip is the same size and letterspacing;
   what varies is only the color, which is the lane's own, and the border,
   which goes dashed exactly when the content is degraded (sample, none found,
   audit pending). Live tags are solid, degraded tags are provisional at a
   glance, and no tag is ever the only thing carrying the information: the
   text inside it says the same thing the style does. */
/* Source badge. Same box as the imagery card's tag, with the provider's mark
   set into it: the imagery card names Street View and Gemini, so the press
   card should name what finds the press. Attribution, not a plug, so it is a
   badge and not a link. The mark is capped to the cap height of the label
   beside it so the two read as one object rather than a logo with text after
   it. */
.tag.src{display:inline-flex;align-items:center;gap:6px;
  background:rgba(106,155,204,.14);color:#3d6690}
.tag.src img{height:11px;width:auto;display:block;opacity:.85}

.tag{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;
  border-radius:5px;background:rgba(106,155,204,.14);color:#3d6690;border:1px solid transparent}
.tag.lane-voices{background:rgba(111,107,97,.12);color:var(--dim)}
.tag.lane-audit{background:rgba(240,126,38,.10);color:#a04d0c}
.tag.pending{background:rgba(111,107,97,.10);color:var(--dim);border:1px dashed var(--line2)}
/* Dashed, so a sample or empty state is legible as provisional at a glance and
   never gets mistaken for a live figure. */
.tag.sample{background:rgba(240,126,38,.10);color:#a04d0c;border:1px dashed rgba(240,126,38,.55)}

/* The year strip. One tick per year since 2014, height by how many results
   passed the same filter the panel below uses. A collision record says a corner
   is dangerous now; this says people have been writing about it for a decade,
   which is a different argument and a better one. Pure flexbox, no library. */
.tl{margin:0 0 16px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.tlbars{display:flex;align-items:flex-end;gap:3px;height:36px}
.tlb{flex:1;display:flex;align-items:flex-end;justify-content:stretch;height:100%;
  background:none;border:0;padding:0;cursor:pointer}
.tlb i{display:block;width:100%;background:var(--line2);border-radius:2px 2px 0 0;
  transition:background-color 120ms ease-out}
/* A year with nothing found still draws a floor, so the strip reads as a
   continuous timeline rather than as gaps where the chart broke. */
.tlb.none i{background:var(--line)}
.tlb:hover i,.tlb:focus-visible i,.tlb.on i{background:var(--blue)}
.tlb:focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:3px}
.tlax{display:flex;justify-content:space-between;font-size:10px;color:var(--dim);
  letter-spacing:.04em;margin-top:5px}
.tlnote{font-size:12.5px;color:var(--ink);font-weight:600;line-height:1.5;margin:9px 0 0}
/* Reserved height, so moving across the strip never reflows the panel. */
.tlpop{font-size:11.5px;color:var(--dim);line-height:1.5;margin:5px 0 0;min-height:2.9em}
.tlpop a{color:var(--dim);text-decoration:none;border-bottom:1px solid var(--line2)}
.tlpop a:hover{color:var(--accent);border-color:var(--accent)}
@media(prefers-reduced-motion:reduce){.tlb i{transition:none}}

.news a{display:block;text-decoration:none;color:inherit;padding:13px 0;border-top:1px solid var(--line)}
.news a:first-of-type{border-top:0;padding-top:0}
.news .t{font-size:14px;font-weight:500;line-height:1.45}
.osrc{display:inline-block;font-size:9.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
  color:var(--dim);border:1px dashed var(--line2);border-radius:4px;padding:1px 5px;vertical-align:2px;white-space:nowrap}
.news a:hover .t{color:var(--accent)}
.news .m{font-size:11.5px;color:var(--dim);margin-top:5px}

/* The scrape funnel. Three quotes look like a thin result until you know how
   many accounts were read to find them, and the volume is the part of this lane
   that is actually hard. Renders only from real counts, never estimated. */
.funnel{font-size:11.5px;color:var(--dim);line-height:1.55;margin:0 0 14px;
  padding-bottom:12px;border-bottom:1px solid var(--line)}
.funnel b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.voice{background:var(--card);border-radius:11px;padding:15px 17px;margin-bottom:11px}
.voice p{margin:0;font-family:Lora,Georgia,serif;font-style:italic;font-size:14.5px;line-height:1.6}
.voice .m{font-size:11.5px;color:var(--dim);margin-top:9px;text-transform:capitalize}
.casefile{margin:26px 0 8px}
.cfrows{list-style:none;margin:0;padding:0;border:1px solid var(--line2);border-radius:11px;background:var(--card);overflow:hidden}
.cfrows li{display:flex;align-items:baseline;gap:10px;padding:8px 14px;font-size:12px;border-top:1px solid var(--line)}
.cfrows li:first-child{border-top:none}
.cfrows a{color:var(--ink);text-decoration:none}
.cfrows a:hover{text-decoration:underline}
.cfchip{flex-shrink:0;min-width:86px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);font-weight:600}
.cfdate{margin-left:auto;font-size:11px;color:var(--dim);white-space:nowrap}
.cfpend{opacity:.62}
.cfpend .cfdate{font-style:italic}
.cfyou .cfchip,.cfyou a{color:var(--accent)}
/* The qualifier on a corridor quote. Deliberately not the accent colour and
   not a warning: this is a true label on real evidence, in the same register
   as the provenance chip beside it. */
.corrchip{display:inline-block;font-size:10.5px;color:var(--dim);background:var(--card);
  border:1px solid var(--line2);border-radius:999px;padding:2px 9px;margin-top:6px;text-transform:none}
.corrnote{display:inline-block;font-size:10.5px;color:var(--dim);margin-left:7px;text-transform:none}
.apichip{display:inline-block;font-size:10.5px;color:var(--dim);border:1px solid var(--line3);border-radius:999px;
  padding:2px 9px;margin-top:8px;text-decoration:none;text-transform:none}
.apichip:hover{color:var(--ink);border-color:var(--ink)}
.empty{margin:0;font-size:13.5px;color:var(--dim);line-height:1.55}

/* The ask's summary row.
   It was two columns with an auto sized second track holding a nowrap figure.
   That is fine for "$265,000 estimated" and wrong for "$250,000 to $350,000,
   order of magnitude": 409px of unbreakable text claimed the whole track, so
   the figure ran past the card's right edge and the label column collapsed to
   66px, breaking "Continental crosswalks, corner daylighting, and a leading
   pedestrian interval" one word to a line.
   Stacked is the default now, which is always correct, and the two column form
   is asked for against the CARD's width rather than the viewport's. This panel
   sits in a column whose width does not track the viewport, so a media query
   was answering a question about the wrong box. */
.lane-ask .pbody{container-type:inline-size}
.fixrow{display:grid;grid-template-columns:minmax(0,1fr);gap:8px 18px;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--line)}
@container (min-width:500px){
  /* Two columns only when the card can hold both honestly. The fix name is the
     longer text and gets the larger share; an auto track let the figure take
     279px of a 493px card and pinned the name to its floor, which is the same
     starvation as before with better manners. Below this the pairs stack and
     the name has the full width, which reads better than two cramped columns.
     Measured against the card, not the viewport: this panel sits in a column
     whose width does not track the window. */
  .fixrow{grid-template-columns:minmax(240px,1.6fr) minmax(0,1fr)}
  .fixrow .cost{text-align:right}
}
.fixrow .k{font-size:11.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.fixrow .v{font-size:14px;font-weight:500;line-height:1.45}
/* Wrapping is the default and there is no nowrap anywhere: an estimate that
   cannot break is an estimate that leaves the card. break-word is the last
   resort for a single token longer than its track, so nothing escapes at any
   width, including one narrower than the longest word in the figure. */
.fixrow .cost{font-size:19px;font-weight:700;color:var(--green);text-align:left;
  min-width:0;overflow-wrap:break-word;line-height:1.3}
@container (max-width:340px){
  .fixrow .cost{font-size:16px}
}
.letter{font-family:Lora,Georgia,serif;font-size:14.5px;line-height:1.72;white-space:pre-wrap}
.lfoot{display:flex;align-items:center;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line);flex-wrap:wrap}
/* Copy is the ask's primary action, so it wears the accent; download is its
   quieter sibling. Both are real buttons, no anchors pretending. */
.lfoot button{font-family:inherit;font-size:13px;font-weight:600;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px 20px;cursor:pointer}
.lfoot button.dl{background:none;color:var(--ink);border:1px solid var(--line2)}
.lfoot button.dl:hover{border-color:var(--ink)}
.lfoot span{font-size:11.5px;color:var(--dim)}
.draft{font-size:11.5px;color:#a04d0c;font-weight:600;margin-bottom:12px;letter-spacing:.03em}
/* The one status that belongs on the lid rather than in the body: a reader who
   only ever sees the header strip still learns this letter was never sent. */
.phs .draft{letter-spacing:.09em}
.phs-lg h2{font-size:15px}
.vnote{font-size:11px;color:var(--dim);margin:9px 0 0;line-height:1.5;max-width:520px}

.stack{display:grid;grid-template-columns:repeat(3,1fr);gap:18px 26px;margin-top:8px}
.stack div{font-size:12px;color:var(--dim);line-height:1.5}
/* Fixed 140x44 box on every row, whether it holds a mark or a name. The space
   is reserved before anything loads, so a blocked, slow, or failed logo shifts
   nothing: the strip is the same height with images off. */
.stack .lg{display:flex;align-items:center;gap:9px;width:140px;height:44px;margin-bottom:2px;overflow:hidden}
.stack .lg img{max-height:24px;width:auto;display:block}
.stack .lg b{font-size:14px;color:var(--ink);font-weight:600;white-space:nowrap;letter-spacing:-.01em}
@media(max-width:860px){.stack .lg{width:auto}}
.cname{display:block;font-size:15px;color:var(--ink);font-weight:600;margin:0;letter-spacing:inherit;line-height:1.3}
/* The corner's identity, now the imagery card's own header. The page used to
   open on a band carrying a name and a district and little else; the card that
   shows the corner is where its name belongs, and the top of the page is the
   grade. The name is the dominant element here, so it is larger than the h2 it
   replaced, and "The corner, three ways" survives above it as an eyebrow. */
.phs-id{align-items:flex-start}
.cardid{min-width:0;flex:1}
/* .corner was written for the page header, where it sat on the right and was
   right aligned and pushed by margin-left:auto. In a card header it is the
   left hand element, so both are undone here rather than removed there: the
   homepage and the watchlist still use the original behaviour. */
.phs-id .corner{margin-left:0;text-align:left;flex:none}
.cardeyebrow{display:block;font-size:10px;font-weight:700;letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim);margin-bottom:5px}
.phs-id .cname{font-size:22px;line-height:1.2;letter-spacing:-.01em}
/* justify-content:flex-end is the page header's, where the block hangs off the
   right edge. Here the name starts the row. */
.phs-id .ctitle{justify-content:flex-start}
.phs-id .cmeta{margin-top:4px;font-size:12.5px;color:var(--dim);line-height:1.45}
.phs-id .ctwin{margin-top:6px;font-size:12px;color:var(--dim);line-height:1.5;max-width:60ch}
.phs-id .auto{display:block;margin-top:6px;font-size:11px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;color:var(--dim)}
@media(max-width:600px){
  .phs-id .cname{font-size:19px}
}
/* The tagline closes the page instead of opening it: it is orientation for
   somebody who has read the evidence, not a preamble in front of it. */
.lede-close{margin:30px 0 0;padding-top:22px;border-top:1px solid var(--line)}
/* Projected outcome. Corroboration-chip scale, under the fix caption, shown
   only on the fix state. The not-a-promise label is the header, permanently. */
.impact{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.ihead{font-size:12px;font-weight:700;letter-spacing:.02em;margin-bottom:8px}
.inote{display:block;font-weight:400;font-size:11px;color:var(--dim);margin-top:2px;line-height:1.5}
.irow{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:12px;padding:5px 0;
  border-bottom:1px solid var(--line);line-height:1.5}
.irow .iname{font-weight:600;min-width:150px}
.irow .ibasis{color:var(--dim)}
.irow a{color:var(--dim);text-decoration:none;border-bottom:1px dashed var(--line2)}
.irow a:hover{color:var(--ink)}
.irow .irange{font-weight:600}
.irow.nofactor span{color:var(--dim)}
.icombined{font-size:11.5px;color:var(--dim);line-height:1.6;margin:9px 0 0}
.pfoot{font-size:11px;color:var(--dim);margin:10px 0 0}
.prow{padding:9px 0;border-bottom:1px solid var(--line);font-size:12.5px;line-height:1.55}
.prow b{display:block;font-size:13px}
.prow .pw{color:var(--dim);font-size:11.5px}
.prow .po{margin-top:3px}
.prow a{color:var(--dim);font-size:11px;text-decoration:none;border-bottom:1px dashed var(--line2)}
/* The split stage. Desktop only: at 1100px and up the imagery panel and the
   corner map share one band under the verdict, imagery 60, map 40, equal
   height. Below that everything stacks exactly as before; the band is created
   by script, so no JavaScript means no band and nothing is lost. The 520px
   imagery floor is structural: at the narrowest band viewport the left column
   is ~630px, and if a future layout change ever squeezed it the stack rule
   wins because the slider must never be starved. */
.band{display:grid;grid-template-columns:60fr 40fr;gap:18px;align-items:stretch;margin-bottom:20px}
.band > *{margin-bottom:0 !important;min-width:0}
.band #mappanel{display:flex;flex-direction:column;height:100%}
.band #mappanel .pbody{flex:1;display:flex;flex-direction:column}
.band #mappanel .pbody > div:first-of-type,
.band #mappanel .mapwrap{flex:1;min-height:420px}
.band .mapfoot{margin-top:10px}

/* The sticky letter bar. Appears on scroll, never taller than 48px, hides
   while the letter panel is on screen because an arrow pointing at something
   already visible is noise. Dismiss survives until the next page load. */
.sticky{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;align-items:center;gap:10px;
  height:48px;max-height:48px;padding:0 14px calc(env(safe-area-inset-bottom, 0px) / 2);
  background:var(--panel);border-top:1.5px solid var(--line3);box-shadow:0 -4px 14px rgba(20,27,45,.08)}
.sg{font-size:13px;font-weight:700;min-width:26px;height:26px;border-radius:7px;display:grid;
  place-items:center;color:#fff;background:var(--dimline)}
.sg.gA{background:var(--green)} .sg.gB{background:#a3b088} .sg.gC{background:var(--blue)}
.sg.gD{background:#e89a5f} .sg.gF{background:var(--accent)}
.sname{flex:1;min-width:0;display:flex;align-items:center;gap:10px}
.sn{min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sgo{font-size:12.5px;font-weight:600;color:#fff;background:var(--ink);border-radius:999px;
  padding:8px 16px;text-decoration:none;white-space:nowrap}
.sx{font-size:18px;line-height:1;background:none;border:0;color:var(--dim);cursor:pointer;padding:6px}

/* The verdict block. The page's conclusion, stated first: the grade, the
   percentile sentence that must never travel without it, one thesis sentence
   from the same payloads every panel below re-derives, and the door to the
   letter. Everything below it remains the receipt. */
.verdict{display:flex;align-items:center;gap:18px;background:var(--panel);
  border:1.5px solid var(--line3);border-top:3px solid var(--ink);border-radius:12px;
  padding:18px 22px;margin:0 0 20px;box-shadow:0 1px 3px rgba(20,27,45,.06);flex-wrap:wrap}
.vg{font-size:30px;font-weight:700;min-width:56px;height:56px;border-radius:14px;display:grid;
  place-items:center;color:#fff;background:var(--dimline);flex:0 0 auto}
.vg.gA{background:var(--green)} .vg.gB{background:#a3b088} .vg.gC{background:var(--blue)}
.vg.gD{background:#e89a5f} .vg.gF{background:var(--accent)}
.vmain{flex:1;min-width:240px}
.vline{font-size:15.5px;font-weight:600;margin:0;line-height:1.45}
.vthesis{font-size:13px;color:var(--dim);margin:4px 0 0;line-height:1.55}
.vcred{display:flex;align-items:center;gap:6px;margin:8px 0 0;font-size:11px;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.vcred i{width:9px;height:9px;border-radius:50%;background:var(--line2);display:inline-block}
.vcred i.on{background:var(--green)}
.vgo{font-size:13.5px;font-weight:600;color:#fff;background:var(--ink);border-radius:999px;
  padding:12px 22px;text-decoration:none;white-space:nowrap;flex:0 0 auto}
.vgo:hover{background:#000}
.vgo:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.panel.lit{box-shadow:0 0 0 3px rgba(240,126,38,.35), 0 6px 16px rgba(20,27,45,.10)}
@media (prefers-reduced-motion: reduce){.panel.lit{box-shadow:0 0 0 3px rgba(240,126,38,.35)}}
/* Preview badge. Only the preview environment renders the element at all, so
   production carries neither the node nor the style burden of hiding it. */
.pvw{position:fixed;right:14px;bottom:62px;z-index:80;font-size:10px;font-weight:700;
  letter-spacing:.12em;text-transform:uppercase;color:var(--dim);background:var(--panel);
  border:1px dashed var(--line2);border-radius:999px;padding:5px 12px;opacity:.85;pointer-events:none}
footer{margin-top:34px;padding-top:20px;border-top:1px solid var(--line);font-size:12.5px;color:var(--dim);line-height:1.6}
/* A lane's own count, in its header. Same numbers the lane body renders, so a
   reader can see the size of the evidence before reading it. */
/* The placeholder that replaces an image element with nothing in it. */
/* display:flex beats the [hidden] attribute's UA rule, so setting hidden on
   this box set an attribute and changed nothing: the placeholder stayed under
   the photograph it was standing in for, as a permanent empty panel. Same
   defect class as an img with display:block ignoring hidden. */
.imgph[hidden]{display:none}
.imgph{display:flex;flex-direction:column;justify-content:center;gap:8px;min-height:208px;
  padding:24px;background:var(--card);border:1px dashed var(--line2);border-radius:12px}
.imgphl{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
.ldrafting{margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.06em;
  text-transform:uppercase;color:var(--dim)}
.imgphn{margin:0;font-size:13.5px;color:var(--ink);line-height:1.55;max-width:52ch}

.lanenums{font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums;margin-left:auto;margin-right:8px}
.eyebrow .lanenums{margin-left:16px;margin-right:0}

/* The corner of the day, in the hero. Two columns on a wide screen with the
   search on the left, stacked on a narrow one with the search first, because a
   returning visitor comes to type. */
.herohead{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:32px;align-items:start;margin:0 0 32px}
@media(max-width:900px){.herohead{grid-template-columns:1fr;gap:24px}}
.herocorner{background:var(--panel);border:1.5px solid var(--line3);border-top:3px solid var(--accent);
  border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(20,27,45,.06)}
.hchead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hceyebrow{font-size:10px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#b0560e;width:100%}
.hcname{font-size:17px;font-weight:600;color:var(--ink);text-decoration:none}
.hcname:hover{text-decoration:underline}
.hcgrade{margin-left:auto;font-size:13px;font-weight:700;min-width:28px;height:28px;border-radius:8px;
  display:grid;place-items:center;color:#fff;background:var(--dim)}
.hcwhen{margin:4px 0 12px;font-size:11.5px;color:var(--dim);line-height:1.5}
/* The stage is the shared slider at embed size. It owns its height from the
   ratio, so nothing reflows when the bytes land, and both frames load eagerly
   because both panes have to be there before anyone drags anything. Only the
   corner radius is local: the handle keeps the corner page's dimensions, so
   the thing a visitor drags here is the thing they will drag there. */
.herocorner .hero{border-radius:9px}
.hctoggle{display:flex;gap:6px;margin:8px 0 0;flex-wrap:wrap}
.hctoggle button{font-family:inherit;font-size:11.5px;font-weight:600;color:var(--dim);background:var(--card);
  border:1px solid var(--line);border-radius:999px;padding:5px 12px;cursor:pointer}
.hctoggle button[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:#fff}
.hccap{margin:8px 0 0;font-size:11.5px;color:var(--dim);line-height:1.5}
.hccap b{color:var(--ink);font-weight:600}
.hcdisclaim{margin:10px 0 0;font-size:11.5px;color:var(--ink);line-height:1.5;
  padding-left:10px;border-left:2px solid var(--accent)}
.hcpending{margin:8px 0 0;font-size:11.5px;color:var(--dim);line-height:1.5}
.hcev{margin:12px 0 0;font-size:12.5px;color:var(--dim);line-height:1.55}

.hcact{display:flex;align-items:center;gap:16px;margin:16px 0 0;flex-wrap:wrap}
.hcgo{font-size:13px;font-weight:600;color:#fff;background:var(--ink);border-radius:999px;
  padding:9px 18px;text-decoration:none}
.hcletter{font-size:12.5px;font-weight:600;color:var(--dim);text-decoration:none}
.hcletter:hover{color:var(--ink);text-decoration:underline}
.hcnone{display:flex;flex-direction:column;justify-content:center;gap:8px;aspect-ratio:640/400;
  padding:24px;background:var(--card);border:1px dashed var(--line2);border-radius:9px}
.hcnonel{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
.hcnonen{margin:0;font-size:13.5px;color:var(--ink);line-height:1.55}

/* The stat band. Numbers as the design, each one a link to its own evidence. */
.statband{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:0 0 24px}
.sbcell{display:flex;flex-direction:column;gap:2px;padding:16px;text-decoration:none;color:inherit;
  background:var(--panel);border:1.5px solid var(--line3);border-radius:12px;
  transition:border-color 150ms ease-out}
.sbcell:hover{border-color:var(--ink)}
.sbnum{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.15;color:var(--ink)}
.sblabel{font-size:12.5px;font-weight:600;color:var(--ink)}
.sbnote{font-size:11.5px;color:var(--dim);line-height:1.45}
@media(max-width:820px){.statband{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:380px){.statband{grid-template-columns:1fr}}

/* Every number on the site lines up in a column. One rule, everywhere. */
.sbnum,.scoren,.ridx,.stat .n,.wlidx,.big,.mastcount,.n,.wlstat b{font-variant-numeric:tabular-nums}

.fcols{display:flex;gap:40px;flex-wrap:wrap;margin:0 0 24px}
.fcol{display:flex;flex-direction:column;gap:8px;min-width:152px}
.fh{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink);margin-bottom:2px}
.fcol a{font-size:12.5px;color:var(--dim);text-decoration:none}
.fcol a:hover{color:var(--ink);text-decoration:underline}
/* The honesty lines close the page. Never collapsed, never moved above the
   columns, never smaller than the links they follow. */
.fhonest{margin:0;font-size:12.5px;color:var(--dim);line-height:1.6}
.fhonest a{color:var(--dim)}
footer a{color:var(--dim);text-decoration:none;border-bottom:1px solid var(--line2)}
footer a:hover{color:var(--ink)}

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
  /* Everything added in the polish pass, and anything added after it. A
     blanket rule rather than a list, so a transition introduced later is
     covered without anybody remembering to come back here. */
  *,*::before,*::after{animation-duration:0.001ms;animation-iteration-count:1;
    transition-duration:0.001ms;scroll-behavior:auto}
}

/* One focus ring for the whole site, in the accent, on everything focusable.
   Keyboard users get the same affordance on a footer link as on the primary
   button, and no rule anywhere removes an outline without replacing it. */
a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible,
[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
.find input:focus-visible{outline-offset:1px}

@media(max-width:860px){
  .cols,.stack{grid-template-columns:1fr}
  /* Mobile reading order: verdict, imagery, letter, evidence, map, stack.
     The letter is why a person came; on a phone it must not sit under four
     panels of receipts. display:contents releases the two columns into main's
     flex flow so order can interleave them. */
  main{display:flex;flex-direction:column}
  main > *{order:20}
  .lede{order:0}
  #verdict{order:1}
  #replay{order:2}
  .panel.lane-imagery{order:3}
  .cols{display:contents}
  .cols > div:nth-child(2){order:4}
  .eyebrow{order:5}
  #scorewrap{order:6}
  /* The tiles travel with the column they now sit in, which puts them after
     the voices card. There is no #stats rule here any more because there is
     no longer a #stats child of main to order. */
  #cred{order:8}
  .cols > div:nth-child(1){order:9}
  #maplane{order:10}
}
@media(max-width:600px){
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  /* Panels now carry their own padding, so on a phone the body inset has to
     give some of it back or the widest fixed element in the page, the three
     button view toggle, pushes the whole document past the viewport and the
     header stops wrapping. */
  .wrap{padding:22px 14px 52px}
  .pbody{padding:16px}
  .phs{padding:10px 16px}
  .toggle{width:auto;flex-wrap:wrap;padding:5px}
  .toggle button{padding:9px 13px;font-size:13px}
}
@media(max-width:400px){.stats{grid-template-columns:1fr}}

/* Print. There was no print stylesheet on this site at all, which is how the
   operator's PDF came back carrying the hazard tape, the sticky bar and three
   stat tiles reading zero. A corner page is a document somebody may well print
   and take to a meeting, so it should print like one.

   Motion is the first thing to go: an animation mid-flight prints whatever
   frame it had reached, which for the eyebrow rules meant a half-drawn line and
   for the tiles meant a half-counted number. */
@media print{
  *{animation:none !important;transition:none !important}
  /* Skeletons are a loading state. On paper they are grey boxes with no
     explanation, so they take no ink. */
  .sk{animation:none !important;background:transparent !important}
  /* Fixed and sticky furniture either repeats on every sheet or covers the
     text under it. */
  .sticky,.pvw,#replay,.toggle,.share,.vgo,.offer{display:none !important}
  /* The eyebrow rule is drawn by a scaleX transition that has not run. */
  .eyebrow::after{transform:scaleX(1) !important}
  /* Three tiles across, since the paper is wider than the phone breakpoint
     that stacks them. */
  .stats{grid-template-columns:repeat(3,1fr) !important}
  /* A link that says "read the evaluation" is useless on paper without its
     destination. */
  .provenance a[href^="http"]::after,.src[href^="http"]::after{content:" (" attr(href) ")";font-size:9px;word-break:break-all}
  body{background:#fff}
  .panel{break-inside:avoid;box-shadow:none}
  .stat{break-inside:avoid}
}`;

export const PAGE = (c, og = {}) => {
  const idx = og.score?.index;
  const grade = og.score?.grade;
  const records = og.cred?.lanes?.find((l) => l.key === "records");
  // Title and description are built from this corner's own stored numbers, and
  // the tab title and the share title are now the same string rather than two
  // that drifted. Anything missing is left out rather than padded: a corner
  // with no grade yet says so by omission.
  const ogTitle = grade ? `${c.name} \u00b7 StreetCred grade ${grade}` : `${c.name} \u00b7 StreetCred`;
  const bits = [];
  if (Number.isFinite(idx)) bits.push(`Grade ${grade}, worse than ${idx}% of San Francisco intersections`);
  if (records?.detail) bits.push(records.detail);
  if (c.district) bits.push(`District ${c.district}`);
  // The one sentence of evidence the Worker can state without a network call,
  // built from the cred record it already read. Same numbers the stats lane
  // will render, because cred was computed from them.
  const serverThesis = [records?.detail, c.district ? `District ${c.district}` : null]
    .filter(Boolean)
    .join(". ")
    .replace(/\.\./g, ".");
  const ogDesc = bits.length
    ? `${c.name}, San Francisco. ${bits.join(". ")}.`.replace(/\.\./g, ".")
    : `${c.name}, San Francisco, graded on the city's own crash and 311 records.`;
  // Absolute, because crawlers do not resolve relative og:url or og:image.
  const base = og.origin || "";
  const url = `${base}/c/${c.slug}`;
  const img = `${base}/og.jpg?x=${c.slug}`;
  const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/logo.svg">
${META({ title: ogTitle, description: ogDesc, url, card: "summary_large_image" })}
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Share card for ${esc(c.name)}, showing its StreetCred grade">
<meta name="twitter:image" content="${img}">
${FONT_LINK}
<style>
${BASE_CSS}
</style>
</head>
<body>
<div class="wrap">
${MASTHEAD({ scored: og.scored || 0, active: "" })}
<header>
  <div class="hctl">
    <nav class="switcher" aria-label="Choose a corner">
      ${Object.values(CORNERS)
        .map(
          (k) =>
            `<a href="/c/${k.slug}"${k.slug === c.slug ? ' class="on" aria-current="page"' : ""}>${k.short}</a>`,
        )
        .join("")}
    </nav>
    <form class="find" id="find" role="search">
      <input id="q" type="search" placeholder="Try 24th and Valencia" autocomplete="off"
        aria-label="Check any San Francisco corner">
      <button type="submit" id="findgo">Check</button>
      <div class="findmsg" id="findmsg" role="status" hidden></div>
    </form>
    <button class="share ghost" id="watch" type="button">Watch the run</button>
    <button class="share" id="share" type="button">Share corner</button>
  </div>
</header>
<main>


<!-- Rendered by the Worker, not waited for. An evidence product that shows its
     evidence only to clients that run JavaScript is showing it to fewer readers
     than it thinks: link preview bots, reader modes and anyone fetching the URL
     see this. The numbers come from the same stored cred record the client lane
     renders, so nothing flips when the client arrives. -->
<section class="verdict" id="verdict"${og.score || og.cred ? "" : " hidden"} aria-label="The verdict for this corner">
  <span class="vg${grade ? ` g${grade}` : ""}" id="vg" aria-hidden="true">${grade || ""}</span>
  <div class="vmain">
    <p class="vline" id="vline">${
      grade && Number.isFinite(idx) ? `${grade} \u00b7 worse than ${idx}% of San Francisco intersections` : ""
    }</p>
    <p class="vthesis" id="vthesis">${esc(serverThesis)}</p>
    <p class="vcred" id="vcred">${
      og.cred?.lanes
        ? og.cred.lanes
            .map((l) => `<i class="${l.hit ? "on" : l.pending ? "pending" : ""}" title="${esc(l.label)}"></i>`)
            .join("") + `<span>${esc(og.cred.verdict || "")}</span>`
        : ""
    }</p>
  </div>
  <a class="vgo" id="vgo" href="#letterpanel">Get the letter</a>
</section>

<div class="sticky" id="sticky" hidden>
  <span class="sg" id="stickyg" aria-hidden="true"></span>
  <span class="sname"><span class="sn">${c.short || c.name}</span>${
    og.tier ? `<span class="tierchip t-${og.tier}" id="stickytier">${TIER_LABEL[og.tier]}</span>` : ""
  }</span>
  <a class="sgo" href="#letterpanel" id="stickygo">Get the letter</a>
  <button class="sx" id="stickyx" type="button" aria-label="Dismiss this bar">&times;</button>
</div>

<section class="replay" id="replay" hidden aria-label="Replay of this corner's pipeline run">
  <div class="rhead">
    <span class="rttl">Replay of the actual run from <b id="rdate">this corner</b></span>
    <span class="rtrig" id="rtrig"></span>
    <span class="rgrow"></span>
    <button class="rbtn" id="rskip" type="button">Skip</button>
    <button class="rbtn" id="rclose" type="button">Close</button>
  </div>
  <div class="rlog" id="rlog" role="log"></div>
  <p class="rfoot">Timings compressed for display. Nothing is re-run: this replays what was recorded.</p>
</section>

<div class="panel lane-imagery">
  <div class="phs phs-id">
    <div class="cardid">
      <span class="cardeyebrow">The corner, three ways</span>
      <div class="corner">
          <div class="ctitle">
            <h1 class="cname">${c.name}</h1>${
              og.tier ? `<span class="tierchip t-${og.tier}" id="tierchip" title="${esc(TIER_NOTE[og.tier] || "")}">${TIER_LABEL[og.tier]}</span>` : ""
            }
          </div>
          <div class="cmeta">${c.city}${
            c.district ? `, District ${c.district}` : ", district unresolved"
          }</div>${
            c.sweep?.twin
              ? `<div class="ctwin">${
                  c.sweep.alias
                    ? `Two crossings carry this name. This page is ${esc(c.sweep.aliasName || c.name)}.`
                    : "Another crossing carries this name."
                } The other is <a href="/c/${esc(c.sweep.twin.slug)}">${esc(c.sweep.twin.name)}</a>, ${
                  c.sweep.twin.apartM >= 1000
                    ? `${(c.sweep.twin.apartM / 1000).toFixed(1)}km`
                    : `${c.sweep.twin.apartM}m`
                } away.</div>`
              : ""
          }${c.cotd ? `<span class="auto">Audited autonomously by StreetCred on ${c.cotd}</span>` : ""}
        </div>
    </div>
    <span class="tag" id="imgtag">Street View plus Gemini</span>
  </div>
  <div class="pbody">
    <div class="toggle" role="group" aria-label="Corner view">
      <button data-state="today" aria-pressed="true">Today</button>
      <button data-state="hazards" aria-pressed="false"${c.generated ? " disabled" : ""}>Hazards</button>
      <button data-state="fix" aria-pressed="false"${c.generated ? " disabled" : ""}>Proposed fix</button>
    </div>

    ${SLIDER({
      root: "hero",
      base: "base",
      ov: "overlay",
      hdl: "handle",
      // A corner whose record already says ready ships its photograph in the
      // HTML. The server read that record to build this page; leaving the src
      // for the client to fill meant the raw HTML of a fully audited corner
      // said "loading" about bytes that were already in KV.
      single: !(og.frames && og.frames.fix),
      hidden: !og.frames,
      imgHidden: !og.frames,
      baseSrc: og.frames ? esc(og.frames.today) : "",
      baseAlt: `${esc(c.name)} today, photographed by Google Street View`,
      ovSrc: og.frames && og.frames.fix ? esc(og.frames.fix) : "",
      ovAlt: og.frames && og.frames.fix
        ? `AI visualization of a proposed fix at ${esc(c.name)}. Not a photograph.`
        : `Annotated comparison view of ${esc(c.name)}`,
    })}
    <!-- Stands in for the photograph until one is loaded, and stays if none
         arrives. A card that says what is missing and why beats an image
         element with nothing in it. Rendered only when the server does not
         already have the frames: a corner that ships its photograph in the HTML
         must not also ship a card saying the photograph is loading. -->
    ${og.frames ? "" : `<div class="imgph" id="imgph">
      <span class="imgphl">The corner, three ways</span>
      <p class="imgphn" id="imgphn">${esc(emptyImageryNote(og.imageryStatus))}</p>
    </div>`}
    <p class="cap" aria-live="polite"><b id="capk">Today</b><span id="capv">The corner as Street View last photographed it. Imagery: Google.</span></p>
    <div class="impact" id="impact" hidden>
      <div class="ihead">Projected outcome
        <span class="inote">Projections from published national research (FHWA CMF Clearinghouse). Not a promise about this corner.</span>
      </div>
      <div id="impactrows"></div>
      <p class="icombined" id="impactcombined"></p>
    </div>
    <div class="hz" id="hz" hidden></div>
  </div>
</div>

<div class="eyebrow"><span id="recordlabel">Official record</span><span class="lanenums" id="recnums"></span></div>
<div class="scorewrap" id="scorewrap" hidden>
  <div class="scorefig">
    <div class="scoren" id="scoren">0<small>/100</small></div>
    <div class="scoreg" id="scoreg"></div>
  </div>
  <div class="scoremeta">
    <div class="scorelabel">Danger Index, reported harm within 80 meters<br><i class="rad">grade computed over the 80m core, so it counts fewer collisions than the tiles above</i></div>
    <div class="scorepct" id="scorepct"></div>
    <div class="distwrap">
      ${DIST_SVG}
      <i class="dmark" id="dmark" hidden></i>
    </div>
    <div class="distax">
      <span class="dend">calmer</span>
      <span class="dmid">${DISTRIBUTION.length.toLocaleString("en-US")} SF intersections, the whole city</span>
      <span class="dend">worst</span>
    </div>
    ${
      og.scored
        ? `<p class="distbridge">${DISTRIBUTION.length.toLocaleString("en-US")} crossings in the census, ${og.scored.toLocaleString("en-US")} with reported harm, graded. The remainder recorded no harm at all, or are one crossing counted twice where the city splits it into quadrants and the sweep keeps the worst.</p>`
        : ""
    }
    <div class="sevbar" id="sevbar"></div>
    <div class="sevkey" id="sevkey"></div>
    <div class="scorecav" id="scorecav"></div>
    <details class="ghist" id="ghist" hidden>
      <summary>Grade history</summary>
      <div id="ghistbody"></div>
    </details>
  </div>
</div>
<div class="cred" id="cred" hidden></div>

<section class="lane" id="maplane" hidden>
  <div class="panel lane-corner" id="mappanel">
    <div class="phs"><h2>Location</h2><span class="tag" id="maptag">Google Maps</span></div>
    <div class="pbody">
      <img id="mapimg" class="mapimg" alt="Roadmap showing the location of ${c.name}, ${c.city}">
      <p class="mapfoot">${c.name}${c.district ? `, District ${c.district}` : ""}. <span id="mapprov">Map data: Google.</span></p>
    </div>
  </div>
</section>

<section class="casefile" id="casefile" aria-label="Case file: what has happened at this corner, dated from stored records">
  <div class="eyebrow"><span>Case file</span><span class="lanenums">every date read from a stored record, none invented</span></div>
  <ol class="cfrows">
    <li id="cf-scored" class="cfdone"><span class="cfchip">DataSF</span><a href="#scorewrap">Scored from the city's own records</a><span class="cfdate">${
      c.sweep?.sweepDate ? esc(c.sweep.sweepDate) : "date not recorded"
    }</span></li>
    <li id="cf-photo" class="cfpend"><span class="cfchip">Google Maps</span><a href="#hero">Photographed</a><span class="cfdate">checking the stored frame</span></li>
    <li id="cf-press" class="cfpend"><span class="cfchip">Exa</span><a href="#presstape">Press read</a><span class="cfdate">checking stored coverage</span></li>
    <li id="cf-voices" class="cfpend"><span class="cfchip">Apify</span><a href="#voices">Residents heard</a><span class="cfdate">checking stored scrapes</span></li>
    <li id="cf-audited" class="${c.cotd ? "cfdone" : "cfpend"}"><span class="cfchip">Gemini</span><a href="#hz">Visual audit</a><span class="cfdate">${
      c.cotd ? esc(c.cotd) : "checking the stored audit"
    }</span></li>
    <li id="cf-fix" class="cfpend"><span class="cfchip">Gemini</span><a href="#hero">Fix drawn</a><span class="cfdate">checking the stored render</span></li>
    <li id="cf-letter" class="cfpend"><span class="cfchip">The gate</span><a href="#letterpanel">Letter verified</a><span class="cfdate">checking the stored letter</span></li>
    <li id="cf-sent" class="cfyou"><span class="cfchip">You</span><a href="#letterpanel">Sent: that part is yours</a><span class="cfdate">the letter is drafted, never sent by us</span></li>
  </ol>
</section>

<div class="cols">
  <div>
    <div class="tape" id="presstape">
    <div class="panel lane-press">
      <div class="phs"><h2 id="newshead">Press coverage</h2><span class="lanenums" id="newsnums"></span><span class="tag" id="newstag">found live, cited</span>
      <span class="tag src"><img src="/logos/exa.svg" alt="" width="35" height="11" loading="lazy">Press via Exa</span></div>
      <div class="pbody">
        <div class="tl" id="tl" hidden>
          <div class="tlhead"><span class="tlttl">Coverage by year</span><span class="tag tlfirst" id="tlfirst" hidden></span></div>
          <div class="tlbars" id="tlbars" role="group" aria-label="Coverage found by year"></div>
          <div class="tlax"><span id="tlfrom"></span><span id="tlto"></span></div>
          <p class="tlnote" id="tlnote"></p>
          <p class="tlpop" id="tlpop"></p>
        </div>
        <div class="news" id="news"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
        <div class="pconn" id="pconn" hidden></div>
      </div>
    </div>
    </div>
    <div class="panel lane-voices">
      <div class="phs"><h2>Resident voices</h2><span class="lanenums" id="voicenums"></span><span class="tag" id="voicestag">scraped</span></div>
      <p class="funnel" id="voicesfilter" hidden></p>
      <div class="pbody">
        <p class="funnel" id="voicefunnel" hidden></p>
        <div id="voices"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
      </div>
    </div>
    <!-- The record's three counts, moved here for the column rather than for
         the lane. A voices card is short whenever a corner has no scraped
         accounts, which is most of them, and it left a tall press card facing
         a column of nothing. The tiles belong to the Official record lane and
         still say so: the group is labelled by that heading, which is what a
         screen reader announces on entering it, so moving the box did not move
         what it is part of. -->
    <section class="statgroup" role="group" aria-labelledby="recordlabel">
<div class="stats" id="stats">${
  og.stats
    ? [
        [og.stats.crashes, "Injury collisions, last 5 years", `within ${og.stats.radiusM || 80}m`],
        [
          og.stats.reports311,
          `Street-condition 311 reports, ${og.stats.reports311Window || "3 years"}`,
          `within ${og.stats.radiusM || 80}m`,
        ],
        [og.stats.district, "Supervisor district", ""],
      ]
        .map(
          ([v, label, rad]) =>
            `\n  <div class="stat"><div class="n" data-to="${v ?? ""}">${
              v === null || v === undefined ? "n/a" : Number(v).toLocaleString("en-US")
            }</div><div class="l">${label}${rad ? `<br><i class="rad">${rad}</i>` : ""}</div></div>`,
        )
        .join("")
    : `
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Injury collisions, last 5 years<br><i class="rad">within 150m</i></div></div>
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Street-condition 311 reports, 3 years<br><i class="rad">within 150m</i></div></div>
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Supervisor district</div></div>`
}
</div>
<p class="statcap" id="statcap" hidden></p>
    </section>
  </div>
  <div>
    <div class="panel lane-ask" id="letterpanel">
      <div class="phs phs-lg"><h2>The ask</h2><span class="draft">DRAFT ONLY</span></div>
      <div class="pbody">
        <div class="fixrow">
          <div><div class="k">Proposed fix</div><div class="v" id="fixname">${c.fix.name}</div></div>
          <div class="cost" id="fixcost">${c.fix.cost}</div>
          <div><div class="k">Funding route</div><div class="v" id="fixgrant">${c.fix.grant}</div></div>
        </div>
        <div class="draft">NOT SENT TO ANY OFFICIAL</div>
        <div class="letter" id="letter">${
          og.letter?.text
            ? esc(og.letter.text)
            : '<p class="ldrafting">Drafting from the four sources</p><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div>'
        }</div>
        <div class="lfoot"><button id="copy">Copy letter</button><button id="download" class="dl" type="button">Download as text</button><span class="tag" id="lettertag">drafted</span><span>by Gemini</span></div>
        <p class="vnote">Every figure in this letter is checked against the source records before it is shown. A draft that states something the records do not support is rejected and rewritten.</p>
      </div>
    </div>
    <div class="panel" id="precedents" hidden>
      <div class="phs"><h2>This works in San Francisco</h2><span class="tag">official source</span></div>
      <div class="pbody">
        <div id="precrows"></div>
        <p class="pfoot">Outcomes as reported by SFMTA's own evaluations.</p>
      </div>
    </div>
  </div>
</div>

<div class="panel">
  <div class="phs"><h2>Powered by</h2></div>
  <div class="pbody">
  <div class="stack">
    <div><span class="lg"><img src="/logos/gemini.svg" alt="Google Gemini" width="24" height="24" loading="lazy"><b>Gemini</b></span>Audits the real Street View frame for hazards, renders the fix, writes the letter</div>
    <div><span class="lg"><img src="/logos/exa.svg" alt="Exa" width="77" height="24" loading="lazy"><b>Exa</b></span>Finds current press coverage of this intersection, cited</div>
    <div><span class="lg"><img src="/logos/apify.svg" alt="Apify" width="87" height="24" loading="lazy"><b>Apify</b></span>Scrapes what residents say on Reddit and Google Maps</div>
    <div><span class="lg"><img src="/logos/googlemaps.svg" alt="Google Maps" width="24" height="24" loading="lazy"><b>Google Maps</b></span>Street View frames, the corner thumbnail, and the city map</div>
    <div><span class="lg"><img src="/logos/cloudflare.svg" alt="Cloudflare" width="52" height="24" loading="lazy"><b>Cloudflare</b></span>Workers serve the page, KV holds corners, imagery and grades</div>
    <div><span class="lg"><img src="/logos/datasf.svg" alt="DataSF" width="34" height="24" loading="lazy"><b>DataSF</b></span>Collisions and 311, queried by radius around the corner</div>
  </div>
  </div>
</div>

</main>
</main>
<p class="lede lede-close">Every claim about a dangerous corner, graded and traced to its source, ending in ${
  og.showsFix ? "a picture of the fix and a letter to the Supervisor" : "a letter to the Supervisor"
}. <button class="nudge" id="nudge" type="button">Check your own corner</button></p>
${og.preview ? '<div class="pvw">Preview</div>' : ''}
${FOOTER()}
</div>

<script>
${PACIFIC_DAY_JS}

// The case file. Rows are server-rendered; each lane payload settles its row
// as it arrives. cfSet writes a row only from a value the payload actually
// carried, and cfDate refuses any date beyond today in America/Los_Angeles:
// a stored date is displayed, a missing one is said to be missing, a future
// one is treated as missing, and nothing is ever invented here.
function cfDate(ts){
  var d = ptDay(ts);
  if(!d) return "";
  return d <= ptDay(Date.now()) ? d : "";
}
function cfSet(row, dated, note){
  var li = el("cf-" + row);
  if(!li) return;
  li.classList.remove("cfpend","cfdone");
  li.classList.add(dated ? "cfdone" : "cfpend");
  li.querySelector(".cfdate").textContent = note;
}
function cfLane(row, ts, fallbackDone, pendingNote){
  var d = cfDate(ts);
  if(d) cfSet(row, true, d);
  else if(fallbackDone) cfSet(row, true, "stored, date not recorded");
  else cfSet(row, false, pendingNote);
}
// Kept byte-identical to PROMOTED_NOTE in src/imagery.js. tools/provenance.test.mjs
// asserts the two match, because a caption that drifts from the server's own
// definition of the claim is a caption nobody is checking.
const PROMOTED_NOTE = "This render was promoted from the enriched pool. This corner has not had a full visual audit and is not counted in the audited coverage layer.";
const CAPS = {
  today:["Today","The corner as Street View last photographed it. Imagery: Google."],
  hazards:["Hazards","Gemini read the real photograph and marked the zones it flags as high risk: faded crosswalk markings in red, vehicle conflict zones in amber. Drag to compare."],
  fix:["Proposed fix","An AI visualization of continental crosswalks, a protected bike lane, and a corner curb extension. Not a photograph of anything that exists. Drag to compare."]
};
// Mutable on purpose: the split stage swaps corners in place via pushState,
// and every lane below reads these at fetch time rather than baking the slug
// into a closure. A full page load still initializes them from the server.
let X = "?x=${c.slug}";
let CORNER_SLUG = "${c.slug}";
// Which tier the server resolved this corner into. Read by the map (a scored
// corner skips the billed static thumbnail) and by the swap path, which has to
// re-read it when the corner changes underneath the page.
let TIER = "${og.tier || ""}";
let CORNER_GEO = {lat: ${c.lat}, lon: ${c.lon}, name: ${JSON.stringify(c.short || c.name)}};
let IMG = null, state = "today";

const el = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const mark = (id, src, asOf) => {
  const t = el(id);
  if(!t) return;
  if(src === "live" || src === "cache") return;
  // A swept figure is the real record as of a stated date. Tagging it "sample"
  // would say the opposite of what it is, so the tag carries the date instead.
  if(src === "sweep"){ t.textContent = asOf ? "as of " + asOf : "from the sweep"; t.classList.add("pending"); return; }
  t.textContent = "sample"; t.classList.add("sample");
};

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
  const ph = el("imgph");
  // A corner with no Street View coverage is still a corner with collisions.
  // The stage becomes a card that says so, and every records lane below it is
  // untouched. What never happens is an image element with no source in it.
  if(!IMG.today){
    hero.hidden = true;
    if(ph){
      ph.hidden = false;
      // Only a stored probe that came back empty is a claim about Google. Any
      // other absent frame is our gap and says so. Mirrors emptyImageryNote on
      // the server; tools/emptystate.test.mjs pins the two together.
      el("imgphn").textContent = IMG.note || (IMG.status === "nocoverage"
        ? "Street View has no photograph of this corner."
        : "No photograph stored for this corner yet.");
    }
    document.querySelector(".toggle").hidden = true;
    el("capk").textContent = "No photograph";
    el("capv").textContent = IMG.note || (IMG.status === "nocoverage"
      ? "Street View has no imagery for this corner."
      : "No photograph stored for this corner yet.");
    return;
  }
  if(ph) ph.hidden = true;
  hero.hidden = false;
  // The server may already have set these. Assigning the same src is a no-op in
  // every browser, but the guard keeps the network panel honest on a reload.
  el("base").hidden = false;
  el("base").src = IMG.today;
  // Alt text from data, not boilerplate: the audit names what it marked.
  el("base").alt = "Street View of " + CORNER_GEO.name + " today";
  const ovImg = el("overlay");
  if(state === "hazards"){
    const marked = (window.HZLABELS && window.HZLABELS.length)
      ? "marking " + window.HZLABELS.join(" and ").toLowerCase()
      : "with hazard zones marked";
    ovImg.alt = "Automated hazard audit of " + CORNER_GEO.name + " " + marked;
  } else if(state === "fix"){
    ovImg.alt = "AI visualization of the proposed fix at " + CORNER_GEO.name + ". Not a photograph.";
  } else { ovImg.alt = "Annotated comparison view of " + CORNER_GEO.name; }
  if(state === "today" || !IMG[state]){ hero.classList.add("single"); el("overlay").hidden = true; }
  else {
    hero.classList.remove("single");
    // Crossfade rather than a hard swap, so switching states reads as the same
    // photograph being re-examined rather than as a different picture.
    const ov = el("overlay");
    ov.hidden = false;
    if(ov.getAttribute("src") !== IMG[state]){
      if(!REDUCED) ov.style.opacity = "0";
      ov.onload = () => { ov.style.opacity = "1"; };
      ov.src = IMG[state];
    }
    setSplit(split);
  }
  el("capk").textContent = CAPS[state][0];
  // The promoted note rides the fix caption and nowhere else. It is a statement
  // about where THIS render came from, so it belongs beside the render and not
  // on the photograph or the hazard overlay, which are not promoted anything.
  const prov = state === "fix" && IMG.provenance === "promoted-from-enriched" ? " " + PROMOTED_NOTE : "";
  el("capv").textContent = CAPS[state][1] + prov + (state === "today" && IMG.note ? " " + IMG.note : "");
  // The projected outcome belongs to the fix state alone: it describes the
  // proposal, not the photograph.
  const ib = el("impact");
  if(ib) ib.hidden = !(state === "fix" && window.__impactReady);
}
${SLIDER_JS}
// The same slider the homepage hero mounts, wired to this page's elements.
// The split percentage stays a local here so render() can hand the current
// position back after a state change without reaching into the component.
let split = 50;
const SLIDER_API = mountSlider(el("hero"), el("overlay"), el("handle"), (p) => { split = p; });
function setSplit(pct){ if(SLIDER_API) SLIDER_API.set(pct); }
// Sticky bar lifecycle.
(function(){
  const bar = el("sticky");
  if(!bar || !("IntersectionObserver" in window)) return;
  let dismissed = false, letterVisible = false, pastVerdict = false;
  const sync = () => { bar.hidden = dismissed || letterVisible || !pastVerdict; };
  el("stickyx").addEventListener("click", () => { dismissed = true; sync(); });
  el("stickygo").addEventListener("click", (e) => {
    const t = el("letterpanel");
    if(!t) return;
    e.preventDefault();
    t.scrollIntoView({behavior: REDUCED ? "auto" : "smooth", block: "start"});
  });
  const vio = new IntersectionObserver((en) => {
    pastVerdict = !en[0].isIntersecting && en[0].boundingClientRect.top < 0;
    sync();
  });
  const vEl = el("verdict"); if(vEl) vio.observe(vEl);
  const lio = new IntersectionObserver((en) => { letterVisible = en[0].isIntersecting; sync(); });
  const lEl = el("letterpanel"); if(lEl) lio.observe(lEl);
  // Fill the chip once the score lands.
  const fill = setInterval(() => {
    if(V.score){
      const g = el("stickyg");
      g.textContent = V.score.grade;
      g.className = "sg g" + V.score.grade;
      // The percentile sentence travels with the grade wherever it appears,
      // here as the chip's popover.
      g.title = "Worse than " + V.score.index + "% of San Francisco intersections";
      g.removeAttribute("aria-hidden");
      g.setAttribute("role", "img");
      g.setAttribute("aria-label", "Grade " + V.score.grade + ", worse than " + V.score.index + "% of San Francisco intersections");
      clearInterval(fill);
    }
  }, 400);
})();

el("vgo") && el("vgo").addEventListener("click", (e) => {
  const t = el("letterpanel");
  if(!t) return;
  e.preventDefault();
  t.scrollIntoView({behavior: REDUCED ? "auto" : "smooth", block: "start"});
  t.classList.add("lit");
  setTimeout(() => t.classList.remove("lit"), 1600);
  history.replaceState(null, "", "#letterpanel");
});

document.querySelectorAll(".toggle button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".toggle button").forEach(o => o.setAttribute("aria-pressed", String(o === b)));
  state = b.dataset.state; split = 50; render();
}));
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
    // Not a failure and not a wait. Say what it is, so a calm corner does not
    // read as a broken one.
    else if(d.status === "recordsonly"){ b.disabled = true; b.textContent = LABELS[s] + ", not generated"; }
    else if(d.status === "scoredonly"){ b.disabled = true; b.textContent = LABELS[s] + ", audit pending";
      const t = el("imgtag"); t.textContent = "scored, not audited"; t.classList.add("pending"); }
    else if(d.status && d.status !== "ready"){ b.disabled = true; b.textContent = LABELS[s] + ", unavailable"; }
  }
  render();
  paintTier();
}

function loadImagery(){
  fetch("/api/imagery" + X).then(r => r.json()).then(d => {
    // Case file rows this payload settles.
    cfLane("photo", d && d.today ? d.at : null, Boolean(d && d.today), "no photograph stored yet");
    var fx = d && d.render && d.render.fix;
    if(fx && (cfDate(fx.at) || fx.model)){
      cfSet("fix", true, (cfDate(fx.at) || "date not recorded") + (fx.model ? ", " + fx.model : ""));
    } else cfLane("fix", d && d.fix ? d.at : null, Boolean(d && d.fix), "no fix render yet");
    // A dated audit block always settles the row. The negative belongs to
    // the hazards lane, which is the record of whether an audit ran at all:
    // writing "has not run" from here mislabelled the flagship, whose audit
    // predates both the cotd stamp and the stored audit block.
    var au = d && d.audit;
    if(au && cfDate(au.at)) cfSet("audited", true, cfDate(au.at) + (au.model ? ", " + au.model : ""));
    applyImagery(d);
    const settled = !d.status || d.status !== "pending";
    if(settled) return;
    if(polls++ < POLL_MAX) setTimeout(loadImagery, POLL_MS);
    // Timed out rather than failed, but the honest label is the same either way.
    else applyImagery(Object.assign({}, d, { status: "failed" }));
  }).catch(() => {});
}
loadImagery();

// Share. Copies the canonical /c/{slug} URL. No tracking parameters are added,
// so a shared link is the same link for everyone who receives it.
(function(){
  const btn = el("share");
  if(!btn) return;
  btn.addEventListener("click", () => {
    const link = location.origin + "/c/" + CORNER_SLUG;
    const done = (label) => {
      btn.textContent = label;
      setTimeout(() => btn.textContent = "Share corner", 2200);
    };
    // Never prompt(). A modal blocks the whole page, and a share button is not
    // worth freezing a page over. The fallback selects the link instead.
    const fallback = () => {
      const t = document.createElement("input");
      t.value = link;
      t.setAttribute("readonly", "");
      t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      document.body.removeChild(t);
      done(ok ? "Link copied" : link);
    };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(link).then(() => done("Link copied")).catch(fallback);
    } else {
      fallback();
    }
  });
})();

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
      if(d.ok){ location.href = "/c/" + encodeURIComponent(d.slug); return; }
      reset();
      say(d.message || "That corner could not be found.");
    }).catch(() => { reset(); say("Lookup failed. Try again in a moment."); });
  });
  input.addEventListener("input", () => say(""));
  const nudge = el("nudge");
  if(nudge) nudge.addEventListener("click", () => { input.focus(); input.select(); });
})();

// The map panel stays out of the document until the thumbnail actually decodes.
// A failed Static Maps request removes it rather than leaving a broken image.
(function(){
  const img = el("mapimg");
  // The thumbnail is one billed Static Maps request per corner. The audited
  // fleet is small and already paid for; the scored city is 7,353 corners a
  // crawler can walk in an afternoon, and the interactive map that replaces
  // the thumbnail a moment later draws on free tiles anyway. So a scored
  // corner skips straight to it and spends nothing.
  if(TIER === "scored"){
    img.remove();
    el("maplane").hidden = false;
    upgradeMap();
    return;
  }
  img.addEventListener("load", () => { el("maplane").hidden = false; upgradeMap(); });
  img.addEventListener("error", () => el("maplane").remove());
  img.src = "/map.jpg" + X;
})();

// Interactive map over the static thumbnail, progressive enhancement: the
// thumbnail stays until Leaflet's tiles are actually on screen, and any
// failure leaves it standing. Zoom 16: this map is about one corner, with its
// audited neighbors, the scored tier, and the census dots for context.
function upgradeMap(){
  if(!window.fetch) return;
  const img = el("mapimg");
  const wrap = document.createElement("div");
  wrap.className = "mapwrap";
  wrap.style.position = "relative";
  if(img){
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
  } else {
    // No thumbnail to build on: a scored corner goes straight to tiles.
    const body = document.querySelector("#mappanel .pbody");
    if(!body) return;
    body.insertBefore(wrap, body.firstChild);
  }
  // Inside the band the wrap flexes to fill the column; standalone it keeps
  // the thumbnail's height as before.
  if(!document.querySelector(".band")) wrap.style.height = (img && img.clientHeight ? img.clientHeight : 300) + "px";
  if(img){
    img.style.position = "absolute"; img.style.inset = "0";
    img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "cover";
  }
  const s = document.createElement("script");
  s.src = "/leafmap.js"; s.defer = true;
  s.onload = () => {
    StreetMap.whenNear(wrap, () => {
      Promise.all([
        fetch("/data/scoretier.json").then(r => r.ok ? r.json() : {corners:[]}).catch(() => ({corners:[]})),
        fetch("/api/board").then(r => r.ok ? r.json() : {corners:[]}).catch(() => ({corners:[]})),
      ]).then(([tier, board]) => {
        const audited = (board.corners||[]).filter(c => c.slug !== CORNER_SLUG);
        const auditedSlugs = new Set(audited.map(c => c.slug));
        const scored = (tier.corners||[]).filter(c => !auditedSlugs.has(c.slug) && c.slug !== CORNER_SLUG);
        StreetMap.upgrade(wrap, {
          center: [CORNER_GEO.lat, CORNER_GEO.lon], zoom: 16,
          audited, scored, heatUrl: "/data/city/dots.json",
          tapAnywhere: true,
          focus: CORNER_GEO,
          onReady: () => {
            const t = el("maptag"); if(t) t.textContent = "OpenStreetMap";
            const p = el("mapprov");
            if(p) p.textContent = "Map data (c) OpenStreetMap contributors (c) CARTO.";
          }
        }).then(map => { if(map) CORNER_MAP = map; });
      });
    });
  };
  document.head.appendChild(s);
}

// The lane registry. Each loader is a function of the CURRENT corner (it
// reads X when called), so calling them again after a swap repaints every
// panel in place through the exact same code a full load runs.
const LANE_LOADERS = {};

// The press card is written by two lanes that never spoke to each other. The
// year strip counts what a dated search can find across a decade; the press
// list is what passed the relevance filter now. Rendered independently they
// could contradict each other inside one card, and on burn-checked corners
// they routinely did: "First coverage we can find dates to 2018. 2 headlines
// since." sitting directly above "Searched and nothing found."
//
// Both statements were true of their own lane and the pair was nonsense. So
// one composer owns the sentence, and it waits for both lanes, because a claim
// about what was not found is only safe to make once you know what was.
let PRESS_LANES = { news: undefined, timeline: undefined };
function pressLane(name, value){ PRESS_LANES[name] = value; composePress(); }

function composePress(){
  if(PRESS_LANES.news === undefined || PRESS_LANES.timeline === undefined) return;
  const n = PRESS_LANES.news || {}, t = PRESS_LANES.timeline || {};
  // Cited results are their own answer. Nothing to reconcile and nothing to
  // soften: the card lists what it found.
  if((n.items || []).length) return;
  const box = el("news");
  if(!box) return;
  const hist = t.totalHeadlines || 0;
  const year = t.firstReportedYear;
  const read = n.found || 0;
  const searches = (n.cost && n.cost.searches) || 0;
  if(hist && year){
    box.innerHTML = '<p class="empty">' + hist +
      (hist === 1 ? " historical headline" : " historical headlines") +
      " found (earliest " + year + "); no current safety coverage passed the relevance filter (0 of " +
      read + " read).</p>";
    // The strip's own note said the same thing in a way that reads as a
    // finding rather than as the other half of this sentence. The bars still
    // carry the history; the words are said once, here.
    if(el("tlnote")) el("tlnote").textContent = "";
  } else if(n.lane === "press-checked"){
    box.innerHTML = '<p class="empty">Searched and nothing found. ' + read +
      (read === 1 ? " article was" : " articles were") + " read across " + searches +
      " searches and none was about safety at this crossing.</p>";
  } else {
    box.innerHTML = '<div class="m">No coverage found.</div>';
  }
  if(n.lane === "press-checked"){
    const pn = document.createElement("p");
    pn.className = "lanenote";
    pn.textContent = "Press checked in a batch run against the city's coverage. This corner keeps its tier: "
      + "the visual audit has not run here, and being press checked does not make a corner audited.";
    box.appendChild(pn);
  }
}

LANE_LOADERS.stats = () => fetch("/api/stats" + X).then(r => r.json()).then(d => {
  V.stats = d; paintVerdict();
  // The district line under the name comes from the same payload as the tile
  // that states it. Server side it is only known for corners carrying one on
  // their stored record, so a shard-composed corner rendered "district
  // unresolved" beside a tile that resolved it two panels below. It also went
  // stale on a corner swap, which changes the name and not the line under it.
  const meta = document.querySelector(".cmeta");
  if(meta){
    const city = (CORNER_GEO && CORNER_GEO.city) || "San Francisco";
    meta.textContent = city + (d.district ? ", District " + d.district : ", district unresolved");
  }
  // A null district means no clear majority, which prints as "n/a" rather than
  // as the 0 that Number(null) would quietly produce.
  const vals = [d.crashes, d.reports311, d.district];
  // The window and the footprint come from the payload, never from the page.
  // Live tiles count 150m over three years; a swept corner's tiles are the 80m
  // core over twelve months, and a label baked in here would describe one of
  // them while the other number sat underneath it.
  const win = d.reports311Window || "3 years";
  const rad = d.radiusM ? "within " + d.radiusM + "m" : "";
  const sub = [rad, rad, ""];
  const l = ["Injury collisions, last 5 years" + (d.fatal ? ", including " + d.fatal + " fatal" : ""),
             "Street-condition 311 reports, " + win,"Supervisor district"];
  // Each figure is a quiet link to the exact Socrata query it came from, same
  // size and color as the plain number, underline on hover only. The reader who
  // clicks re-runs the count on data.sfgov.org; everyone else sees a number.
  const urls = [d.urls && d.urls.crashes, d.urls && d.urls.reports311, d.urls && d.urls.district];
  el("stats").innerHTML = vals.map((v,i) => {
    // Seeded with the real figure, not with "0". Writing a zero and leaving the
    // truth in data-to made the count-up the only thing that could produce the
    // number, and the count-up is gated on the tiles scrolling into view. The
    // tiles sit below the press and voices cards, so anything that never
    // scrolls (print, a full-page screenshot, a headless capture, reader mode)
    // showed three zeros under an F verdict. The animation is decoration now,
    // replaying 0 to n over a number that was already correct.
    const num = '<div class="n" data-to="' + (v === null || v === undefined ? "" : v) + '">' +
      (v === null || v === undefined ? "n/a" : Number(v).toLocaleString()) + '</div>';
    const linked = urls[i] && v !== null && v !== undefined
      ? '<a class="src" href="' + urls[i] + '" target="_blank" rel="noopener" ' +
        'aria-label="' + l[i].replace(/"/g, "") + ': opens source query on data.sfgov.org">' + num + '</a>'
      : num;
    return '<div class="stat">' + linked + '<div class="l">' + l[i] +
      (sub[i] ? '<br><i class="rad">' + sub[i] + '</i>' : '') +
      (d.source === "sample" && i === 0 ? ' <span class="tag sample">sample</span>' : '') + '</div></div>';
  }).join("");
  // Swept numbers are true as of the sweep, and the provenance links below them
  // re-run live. Both facts are stated, because the reader who clicks through
  // and gets a slightly different count deserves to know why in advance.
  const cap = el("statcap");
  if(cap){
    if(d.asOf){
      cap.textContent = "Counted in the citywide sweep of " + d.asOf +
        ", within " + (d.radiusM || 80) + " meters. Each number links to the same query, which re-runs live.";
      cap.hidden = false;
    } else {
      cap.hidden = true; cap.textContent = "";
    }
  }
  // The same numbers the tiles below show, said once in the section header.
  var rn = el("recnums");
  if(rn){
    var parts = [];
    if(typeof d.crashes === "number") parts.push(d.crashes + (d.crashes === 1 ? " collision" : " collisions"));
    if(d.fatal) parts.push(d.fatal + " fatal");
    if(typeof d.reports311 === "number") parts.push(d.reports311 + (d.reports311 === 1 ? " street report" : " street reports"));
    rn.textContent = parts.join(", ");
  }
  onFirstView(el("stats"), () => {
    el("stats").querySelectorAll(".n").forEach(node => {
      const to = node.getAttribute("data-to");
      if(to !== "") countUp(node, to);
    });
  });
  flushStats();
});

// data-to is the source of truth; this puts it on screen with no animation and
// no waiting for anything to be scrolled into view. Called when the lane lands,
// and again before printing, because a print does not scroll and a half-played
// count-up prints whatever number it had reached.
function flushStats(){
  const wrap = el("stats");
  if(!wrap) return;
  wrap.querySelectorAll(".n").forEach(node => {
    const to = node.getAttribute("data-to");
    if(to === null || to === "") return;
    const n = Number(to);
    node.textContent = Number.isFinite(n) ? n.toLocaleString() : to;
  });
}
window.addEventListener("beforeprint", flushStats);
// Safari and the headless capture paths do not always fire beforeprint.
if(window.matchMedia){
  const pq = window.matchMedia("print");
  pq.addEventListener && pq.addEventListener("change", e => { if(e.matches) flushStats(); });
}

// Cred Check. Four lanes, lit when they agree, with the verdict beside them.
// Detail sits in the title attribute, which is hover on a pointer and long
// press on touch, and keeps the strip to one line.
LANE_LOADERS.cred = () => fetch("/api/cred" + X).then(r => r.json()).then(d => {
  V.cred = d; paintVerdict();
  if(!d || !d.lanes) return;
  el("cred").hidden = false;
  el("cred").innerHTML = d.lanes.map(l =>
    '<span class="c' + (l.hit ? ' on' : (l.pending ? ' pending' : '')) + '" title="' + esc(l.detail) + '">' + esc(l.label) + '</span>'
  ).join("") +
    '<span class="v' + (d.score >= 3 ? ' strong' : '') + '" title="' + esc(d.score) +
    (d.pending ? ' of ' + (4 - d.pending) + ' lanes checked so far agree' : ' of 4 lanes agree') +
    '">' + esc(d.verdict) + '</span>';
});

// Corroboration. Which audit findings the public record backs, which it does
// not, and which the record raised on its own. Deterministic server side, so
// this is display only.
LANE_LOADERS.hazards = () => fetch("/api/hazards" + X).then(r => r.json()).then(d => {
  (function(){
    var li = el("cf-audited");
    if(li && !li.classList.contains("cfdone")){
      if(d && d.audited) cfSet("audited", true, cfDate(d.at) || "stored, date not recorded");
      else cfSet("audited", false, "the visual audit has not run here yet");
    }
  })();
  const items = d.items || [];
  // Feed the hero's alt text: the audit image's description names what the
  // audit actually flagged at this corner, not a generic phrase.
  window.HZLABELS = items.filter(h => h.verdict !== "REPORTED").map(h => h.label);
  if(IMG && state === "hazards") render();
  if(!items.length) return;
  el("hz").hidden = false;
  el("hz").innerHTML = items.map(h =>
    '<div class="r"><span class="hzc ' + esc(h.verdict.toLowerCase()) + '">' + esc(h.verdict) +
    '</span><span class="n">' + esc(h.label) + '</span><span>' + esc(h.detail) + '</span></div>'
  ).join("") +
    '<p class="hzfoot">Confirmed means the city record backs what the audit saw. ' +
    'Candidate means the audit saw it and the record is silent. ' +
    'Reported means the record raised it and the photograph does not show it.</p>';
});

// The Danger Index. Every number here came out of DataSF arithmetic, so the
// caveat travels with it on the page rather than being buried in the README.
// The verdict block assembles from the same three payloads the panels below
// render, so it can never disagree with its own receipts. Each fetch feeds it
// as it lands; the block shows once the grade is in.
const V = { score: null, stats: null, cred: null };
function paintVerdict(){
  if(!V.score) return;
  const v = el("verdict");
  const g = el("vg");
  g.textContent = V.score.grade;
  g.className = "vg g" + V.score.grade;
  el("vline").textContent = V.score.grade + " \u00b7 worse than " + V.score.index + "% of San Francisco intersections";
  if(V.stats){
    const f = V.stats.fatal ? ", " + V.stats.fatal + " fatal" : "";
    // The corroboration clause only when the Cred Check actually corroborates:
    // a score-tier corner with no audit yet gets the numbers and no chorus.
    const agree = V.cred && V.cred.score >= 3 ? ", and the evidence agrees" : "";
    // A swept count says which footprint it counted and when, in the same
    // sentence as the number, because this line is the one people quote.
    const when = V.stats.asOf
      ? " within " + (V.stats.radiusM || 80) + "m, as of " + V.stats.asOf
      : "";
    el("vthesis").textContent = V.stats.crashes + " injury collisions in 5 years" + f + when + agree + ".";
  }
  if(V.cred && V.cred.lanes){
    el("vcred").innerHTML = V.cred.lanes.map(l =>
      '<i class="' + (l.hit ? "on" : (l.pending ? "pending" : "")) + '" title="' + esc(l.label) +
      (l.pending ? ", not yet checked" : "") + '"></i>').join("") +
      '<span>' + esc(V.cred.verdict) + '</span>';
  }
  v.hidden = false;
  paintTier();
}

// The chip beside the corner name. The server renders it for the corner the
// page loaded with; a swapped-in corner can be in a different tier, and this
// derives it from the lanes that already landed rather than asking again.
function paintTier(){
  const chips = [el("tierchip"), el("stickytier")].filter(Boolean);
  if(!chips.length) return;
  let t = TIER;
  if(V.score && V.score.source === "sweep") t = "scored";
  // A promoted corner has a proposed-fix render and no audit. Reading the chip
  // off imagery status alone made "ready" mean AUDITED, which would have
  // relabelled every promoted corner the moment its render published.
  else if(IMG && IMG.provenance === "promoted-from-enriched") t = "enriched";
  else if(IMG && IMG.status === "ready") t = "audited";
  else if(IMG && IMG.status) t = "enriched";
  chips.forEach(function(chip){
    if(!t){ chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = t.toUpperCase();
    chip.className = "tierchip t-" + t;
  });
  if(t) TIER = t;
}

LANE_LOADERS.score = () => fetch("/api/score" + X).then(r => r.json()).then(d => {
  if(!d || typeof d.index !== "number") return;
  V.score = d; paintVerdict();
  // Remember this visit on this device and nowhere else: slug, name, the grade
  // seen, when. The homepage strip renders it and a later grade change earns a
  // dot. Capped, deduped, most recent first.
  try {
    const visits = JSON.parse(localStorage.getItem("sc:visits") || "[]")
      .filter(v => v && v.slug !== CORNER_SLUG);
    visits.unshift({ slug: CORNER_SLUG, name: CORNER_GEO.name, gradeSeen: d.grade, at: Date.now() });
    localStorage.setItem("sc:visits", JSON.stringify(visits.slice(0, 12)));
  } catch(e) {}
  el("scorewrap").hidden = false;
  el("scoren").innerHTML = d.index + '<small>/100</small>';
  const g = el("scoreg");
  g.textContent = d.grade;
  g.className = "scoreg g" + d.grade;
  // The index is a percentile, so say so in words next to the number. "99 out
  // of 100" invites a reader to imagine a scale that stops somewhere.
  el("scorepct").textContent =
    "More reported harm than " + d.index + "% of San Francisco intersections." +
    (d.asOf ? " Measured in the citywide sweep of " + d.asOf + "." : "");
  const m = el("dmark");
  m.style.left = d.index + "%";
  m.className = "dmark g" + d.grade;
  m.hidden = false;
  const c = d.counts || {};
  const parts = [["f","Fatal",c.fatal],["s","Severe",c.severe],
                 ["o","Other visible",c.otherVisible],["p","Complaint of pain",c.pain]];
  const total = parts.reduce((n,[,,v]) => n + (v||0), 0);
  el("sevbar").innerHTML = total
    ? parts.filter(([,,v]) => v).map(([k,,v]) =>
        '<i class="' + k + '" style="width:' + (100*v/total) + '%"></i>').join("")
    : '';
  const sevKeyHtml = parts.filter(([,,v]) => v)
    .map(([,label,v]) => '<span><b>' + v + '</b> ' + label + '</span>').join("")
    || '<span>No injury collisions recorded in 5 years</span>';
  // The severity mix is one grouped query; link the whole key to it rather
  // than pretending each slice came from somewhere different.
  el("sevkey").innerHTML = d.urls && d.urls.severity
    ? '<a class="src" href="' + d.urls.severity + '" target="_blank" rel="noopener" aria-label="Severity mix: opens source query on data.sfgov.org">' + sevKeyHtml + '</a>'
    : sevKeyHtml;
  const cav = el("scorecav");
  cav.innerHTML = esc(d.caveat || "") +
    ' <a class="srcq" href="/methodology" aria-label="How the index and its frozen census distribution are computed">How this is computed</a>';
});

// Grade history: this corner's rows from the public changelog. Hidden when
// there are none, because "no changes" is the normal state and an empty
// expando reads as something broken.
fetch("/api/changes").then(r => r.json()).then(d => {
  const mine = (d.changes || []).filter(c => c.slug === CORNER_SLUG);
  if (!mine.length) return;
  el("ghistbody").innerHTML = mine.map(c =>
    '<div>' + esc(ptDay(c.date)) + ': <b>' + esc(c.old?.grade ?? "?") + " " + (c.old?.index ?? "?") +
    '</b> to <b>' + esc(c.new?.grade ?? "?") + " " + (c.new?.index ?? "?") + '</b>, ' + esc(c.reason || "") +
    ' <span style="text-transform:uppercase;font-size:9.5px;letter-spacing:.07em">' + esc(c.source || "") + '</span></div>').join("");
  el("ghist").hidden = false;
}).catch(() => {});

LANE_LOADERS.news = () => fetch("/api/news" + X).then(r => r.json()).then(d => {
  // A lane that has not run is not a lane that found nothing. "No coverage
  // found" would be a claim about this corner that nobody has checked.
  if(d.note && !(d.items || []).length){
    const t = el("newstag"); t.textContent = "not yet checked"; t.classList.add("pending");
    el("news").innerHTML = '<p class="empty">Press coverage has not been searched at this corner yet.</p>' +
      '<p class="lanenote">' + esc(d.note) + '</p>';
    return;
  }
  mark("newstag", d.source);
  // A batch press check is not an audit and never borrows the word. The tag
  // says what it was, the note below says what it was not.
  var checked = d.lane === "press-checked";
  if(checked){
    var pt = el("newstag");
    pt.textContent = "press coverage, found and cited";
    pt.classList.remove("pending");
  }
  // Do not claim corner-level precision the result set does not support.
  if (d.heading) el("newshead").textContent = d.heading;
  // Retrieval date on hover: when this page actually fetched the citation,
  // distinct from when the outlet published it. d.fetchedAt is stamped by the
  // Worker at fetch time; a cached payload keeps the stamp of the fetch that
  // produced it, which is the honest reading of "retrieved".
  const got = ptDay(d.fetchedAt) || null;
  var nn = el("newsnums");
  if(nn){
    var kept = (d.items||[]).length;
    nn.textContent = typeof d.found === "number"
      ? kept + " cited from " + d.found + " found"
      : kept + (kept === 1 ? " citation" : " citations");
  }
  el("news").innerHTML = (d.items||[]).map(x =>
    '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"' +
    (got ? ' title="Retrieved by StreetCred on ' + got + '"' : '') + '><div class="t">' + esc(x.title) +
    // An agency page is the record, not reporting on the record. Tagged so it
    // reads as a primary source rather than as press coverage.
    (x.official ? ' <span class="osrc">official source</span>' : '') +
    '</div><div class="m">' + esc(x.domain) + (x.date ? " &middot; " + esc(x.date) : "") + '</div></a>').join("");
  // The empty state is not written here. It is a claim about what was not
  // found, and this lane does not know what the year strip found, so it hands
  // over and lets the composer say it once.
  pressLane("news", d);
}).catch(() => pressLane("news", null));

// Hazard tape, once. Threshold 0.4 so it fires when the card is properly on
// screen rather than when one pixel of it is, unobserved immediately after so
// it can never play twice, and not armed at all under reduced motion: the
// class that animates is simply never added.
(function(){
  const tape = el("presstape");
  if(!tape || !("IntersectionObserver" in window)) return;
  if(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const io = new IntersectionObserver((entries) => {
    for(const e of entries){
      if(!e.isIntersecting) continue;
      e.target.classList.add("play");
      io.unobserve(e.target);
    }
  }, { threshold: 0.4 });
  io.observe(tape);
})();

// The replay. Every line is rendered from the stored run manifest, so the log
// cannot say anything the pipeline did not actually record. A stage that did
// not run prints why, dimmed, rather than being quietly dropped: a log that
// shows only successes is an advertisement.
(function(){
  const btn = el("watch"), panel = el("replay"), log = el("rlog");
  if(!btn || !panel) return;
  let manifest = null, timers = [], playing = false;

  const n = v => (typeof v === "number" ? v.toLocaleString() : v);
  const plural = (v, one, many) => n(v) + " " + (v === 1 ? one : (many || one + "s"));

  function lines(m){
    const s = m.stages || {}, out = [];
    const push = (lane, text, off) => out.push({ lane, text, off: !!off });

    const st = s.stats;
    push("record", st && st.ran
      ? "Official records: " + plural(st.collisions5y, "collision") + " in 5 years, " +
        st.fatal + " fatal, " + plural(st.reports311Filtered, "street-condition 311 report") +
        (st.reports311Raw ? " kept from " + n(st.reports311Raw) + " raw" : "") +
        ". District " + (st.district == null ? "unresolved" : st.district) + "."
      : "Official records: " + ((st && st.reason) || "did not run") + ".", !(st && st.ran));

    const ex = s.exa;
    push("press", ex && ex.ran
      ? "Exa: " + (ex.found == null ? "search ran" : n(ex.found) + " results found") +
        (ex.afterFilters == null ? "" : ", " + n(ex.afterFilters) + " pass filters") +
        ", " + n(ex.kept) + " cited" + (ex.officialSources ? ", " + ex.officialSources + " tagged official source" : "") + "."
      : "Exa: " + ((ex && ex.reason) || "did not run") + ".", !(ex && ex.ran));

    const tl = s.timeline;
    if(tl && tl.ran) push("press", "Exa time machine: " + tl.searches + " year searches, " +
      (tl.firstFoundYear ? "earliest coverage found " + tl.firstFoundYear + ", " : "") +
      plural(tl.totalHeadlines, "headline") + " since.");
    else if(tl) push("press", "Exa time machine: " + tl.reason + ".", true);

    const ap = s.apify;
    if(ap && ap.ran && ap.countsUnavailable) push("voices", "Apify: counts unavailable for this run.", true);
    else if(ap && ap.ran) push("voices", "Apify: " + plural(ap.itemsRead, "account") + " read, " +
      n(ap.aboutCorner) + " about this corner, " + n(ap.streetRelevant) + " describe the street, " +
      n(ap.kept) + " kept.");
    else push("voices", "Apify: " + ((ap && ap.reason) || "did not run") + ".", true);

    const vi = s.vision;
    push("vision", vi && vi.ran
      ? "Gemini vision: " + plural(vi.zonesFlagged, "hazard zone") + " flagged" +
        (vi.labels && vi.labels.length ? ": " + vi.labels.join(", ") : "") + "."
      : "Gemini vision: " + ((vi && vi.reason) || "did not run") + ".", !(vi && vi.ran));

    if(vi && vi.ran) push("vision", "Corroboration: " + vi.confirmed + " CONFIRMED against city records, " +
      vi.candidate + " candidate, " + vi.reported + " from records only.");

    const ix = s.index;
    push("index", ix && ix.ran
      ? "Danger Index: " + ix.points + " points, worse than " + ix.percentile +
        " percent of " + n(ix.sampleSize) + " sampled SF intersections: grade " + ix.grade + "."
      : "Danger Index: " + ((ix && ix.reason) || "did not run") + ".", !(ix && ix.ran));

    const lt = s.letter;
    push("ask", lt && lt.ran
      ? "Letter: assembled from " + plural((lt.inputs || []).length, "evidence lane") +
        " (" + (lt.inputs || []).join(", ") + "), addressed to " + lt.supervisor + "."
      : "Letter: " + ((lt && lt.reason) || "did not run") + ".", !(lt && lt.ran));

    push("ask", '<a href="#scorewrap" id="rjump">See the evidence below.</a>');
    return out;
  }

  function clear(){ timers.forEach(clearTimeout); timers = []; }

  function render(m, instant){
    const rows = lines(m);
    log.innerHTML = rows.map(r =>
      '<div class="rline ' + r.lane + (r.off ? ' off' : '') + (instant ? ' in' : '') + '">' +
      '<b></b><span>' + r.text + '</span></div>').join("");
    el("rdate").textContent = ptDay(m.ranAt) || "an earlier run";
    el("rtrig").textContent = m.trigger === "cron" ? "autonomous run"
      : m.trigger === "precompute" ? "precomputed run" : "run on a visit";
    if(instant) return;
    playing = true;
    // Under 12 seconds in total: nine lines at 340ms apart lands near three.
    [].forEach.call(log.children, (node, i) => {
      timers.push(setTimeout(() => {
        node.classList.add("in");
        if(i === rows.length - 1) playing = false;
      }, 60 + i * 340));
    });
  }

  function open(){
    panel.hidden = false;
    if(manifest){ render(manifest, REDUCED); return; }
    log.innerHTML = '<div class="rline in off"><b></b><span>Reading the run manifest...</span></div>';
    LANE_LOADERS.run = () => fetch("/api/run" + X).then(r => r.json()).then(m => {
      // No pipeline has run at this corner, so there is no run to replay. The
      // stage-by-stage log would otherwise print nine "did not run" lines and
      // read as a broken pipeline rather than an unstarted one.
      if(m && m.source === "empty"){
        log.innerHTML = '<div class="rline in off"><b></b><span>No pipeline run is recorded at this corner yet.</span></div>' +
          '<div class="rline in off"><b></b><span>' + esc(m.note || "") + '</span></div>';
        return;
      }
      manifest = m;
      render(m, REDUCED);
    }).catch(() => {
      log.innerHTML = '<div class="rline in off"><b></b><span>No run manifest is stored for this corner yet.</span></div>';
    });
  }

  btn.addEventListener("click", () => { panel.hidden ? open() : (clear(), panel.hidden = true); });
  // Linkable, so "watch how this was built" is one URL rather than an
  // instruction. The panel starts hidden, so the browser's own fragment scroll
  // lands on a zero height element and misses: scroll it in once it is real.
  if(location.hash === "#replay"){
    open();
    setTimeout(() => panel.scrollIntoView({ behavior: "auto", block: "start" }), 0);
  }
  el("rskip").addEventListener("click", () => {
    clear();
    [].forEach.call(log.children, node => node.classList.add("in"));
    playing = false;
  });
  el("rclose").addEventListener("click", () => { clear(); panel.hidden = true; });
  log.addEventListener("click", (e) => {
    if(e.target.id !== "rjump") return;
    e.preventDefault();
    const t = el("scorewrap");
    if(t) t.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "center" });
  });
})();

// The press year strip. Phrased as coverage-we-can-find everywhere, never as
// first report: Exa recall is not ground truth, and an empty year means this
// search found nothing that year, not that nothing happened.
LANE_LOADERS.timeline = () => fetch("/api/timeline" + X).then(r => r.json()).then(t => {
  (function(){
    var yrs = (t && t.years || []).filter(function(y){ return y && y.count > 0; });
    if(yrs.length){
      var first = yrs[0].year, last = yrs[yrs.length - 1].year;
      cfSet("press", true, "first " + first + ", latest " + last + (cfDate(t.builtAt) ? ", read " + cfDate(t.builtAt) : ""));
    } else if(cfDate(t && t.builtAt)) cfSet("press", true, "read " + cfDate(t.builtAt) + ", nothing found");
    else cfSet("press", false, "press history not read here yet");
  })();
  const years = t && t.years;
  // "The strip has nothing" is an answer the composer is waiting on just as
  // much as a full decade is, so it is reported on this path too.
  if(!years || !years.length){ pressLane("timeline", t); return; }
  const counts = years.map(y => y.count || 0);
  const max = Math.max.apply(null, counts) || 1;
  const bars = el("tlbars");
  bars.innerHTML = years.map(y => {
    const n = y.count || 0;
    // Floor of 3px so a quiet year is a tick rather than a hole.
    const h = n ? Math.round(3 + (n / max) * 33) : 3;
    const label = y.year + ": " + (y.failed ? "search failed" : n + (n === 1 ? " result" : " results"));
    return '<button type="button" class="tlb' + (n ? '' : ' none') + '" data-y="' + y.year +
      '" style="height:100%" aria-label="' + esc(label) + '">' +
      '<i style="height:' + h + 'px"></i></button>';
  }).join("");
  el("tlfrom").textContent = t.from;
  el("tlto").textContent = t.to;

  const note = [];
  if(t.firstReportedYear) note.push("First coverage we can find dates to " + t.firstReportedYear + ".");
  if(t.totalHeadlines) note.push(t.totalHeadlines + (t.totalHeadlines === 1 ? " headline" : " headlines") + " since.");
  el("tlnote").textContent = note.join(" ");

  // The one comparison this lane exists to make: the earliest coverage anyone
  // can find against the earliest collision the city has on record here. The
  // wording is deliberately narrow. Exa recall is not ground truth, so the
  // claim is about what can be found, never about what happened first.
  const chip = el("tlfirst");
  if(chip){
    if(t.sawItFirst){
      chip.textContent = "Press got there first";
      chip.title = "The earliest coverage this search can find (" + t.firstReportedYear +
        ") predates the earliest collision in the city's record at this corner (" + t.firstCrashYear + ").";
      chip.hidden = false;
    } else if(typeof t.firstCrashYear === "number" && t.firstReportedYear){
      chip.textContent = "Records first, " + t.firstCrashYear;
      chip.title = "The city recorded a collision here in " + t.firstCrashYear +
        ", before the earliest coverage this search can find (" + t.firstReportedYear + ").";
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  }

  const pop = el("tlpop");
  const show = (y) => {
    [].forEach.call(bars.children, (b, i) => b.classList.toggle("on", i === years.indexOf(y)));
    if(y.failed){ pop.textContent = y.year + ": that year's search failed, so it is not counted."; return; }
    if(!y.count){ pop.textContent = y.year + ": no coverage found by this search."; return; }
    const b = y.best;
    pop.innerHTML = '<b>' + y.year + '</b> &middot; ' + y.count +
      (y.count === 1 ? " result" : " results") + (b ? '. <a href="' + esc(b.url) +
      '" target="_blank" rel="noopener">' + esc(b.title) + '</a> (' + esc(b.domain) +
      (b.official ? ", official source" : "") + ')' : ".");
  };
  years.forEach((y, i) => {
    const b = bars.children[i];
    b.addEventListener("mouseenter", () => show(y));
    b.addEventListener("focus", () => show(y));
    b.addEventListener("click", () => show(y));
  });
  // Opens on the most recent year that has anything, so the strip says
  // something before it is touched.
  const latest = [].concat(years).reverse().find(y => y.count);
  if(latest) show(latest);
  el("tl").hidden = false;
  // Last, deliberately. The composer may blank this lane's note when the two
  // lanes would otherwise contradict, and reporting earlier let the rest of
  // this function write the contradiction straight back.
  pressLane("timeline", t);
}).catch(() => pressLane("timeline", null));

// The scrape funnel, drawn from the run manifest. It renders only when real
// counts exist for this corner: a corner with no backfilled scrape shows no
// line at all rather than a row of zeroes that reads like a result.
fetch("/api/run" + X).then(r => r.json()).then(m => {
  const a = m && m.stages && m.stages.apify;
  if(!a || !a.ran) return;
  const n = el("voicefunnel");
  if(a.countsUnavailable){
    n.textContent = "Scrape counts are no longer retrievable from Apify for this corner.";
    n.hidden = false;
    return;
  }
  if(!a.itemsRead) return;
  const num = v => '<b>' + v + '</b>';
  n.innerHTML = num(a.itemsRead) + ' accounts read, ' + num(a.aboutCorner) +
    ' about this corner, ' + num(a.streetRelevant) + ' describe the street itself. Showing ' +
    num(a.kept) + '.';
  n.hidden = false;
}).catch(() => {});

// What the press connects this corner to. One KV read behind the endpoint, so
// it costs a scored corner nothing, and it renders on both ends of a
// connection: the corner that ran the search and the corner it found.
LANE_LOADERS.connections = () => fetch("/api/connections" + X).then(r => r.json()).then(d => {
  const box = el("pconn");
  if(!box) return;
  const links = (d && d.links) || [];
  if(!links.length){ box.hidden = true; box.innerHTML = ""; return; }
  box.innerHTML = links.map(function(l){
    return '<div><b>The press links this corner to <a href="/c/' + esc(l.slug) + '">' + esc(l.name) + '</a></b>' +
      (l.grade ? ' <span class="tag">' + esc(l.grade) + (typeof l.index === "number" ? " \u00b7 " + l.index : "") + '</span>' : '') +
      '<span class="pcw">' + esc(l.article.title) + '<br>' +
      '<a href="' + esc(l.article.url) + '" target="_blank" rel="noopener">' + esc(l.article.domain) + '</a>' +
      (l.article.date ? " \u00b7 " + esc(l.article.date) : "") + '</span></div>';
  }).join("") +
    '<p class="pcauto">Found by asking Exa what else is written in the same breath as this corner\u2019s own coverage, then checking every crossing named in the result against the city index. Nothing fuzzy is shown.</p>';
  box.hidden = false;
}).catch(() => {});

LANE_LOADERS.voices = () => fetch("/api/voices" + X).then(r => r.json()).then(d => {
  // "1 accounts" was on every single-candidate corner, which is all four that
  // carry a quote. One helper, used by every sentence in this lane.
  var acct = function(nn){ return nn + (Number(nn) === 1 ? " account" : " accounts"); };
  // The filter, stated in numbers from this corner's own stored funnel. It
  // renders wherever a scrape was commissioned, zero-kept corners included:
  // "0 of 41 cleared" is the finding, not a gap, and the NONE FOUND state
  // below stays exactly as it was.
  (function(){
    var f = el("voicesfilter");
    if(!f || !d || !d.commissioned || typeof d.candidates !== "number") return;
    var kept = (d.items || []).length;
    f.innerHTML = 'Apify scraped public reviews and forums for this corner. Only accounts specifically ' +
      'about this intersection and street safety were kept: <b>' + kept + '</b> of <b>' + d.candidates +
      '</b> cleared the filter.' +
      // Withheld here rather than at the scrape: the account cleared the
      // ingest filter and then named a different crossing, which the page
      // checks against the city's own street index before showing anything.
      (d.suppressed
        ? ' ' + esc(acct(d.suppressed)) + ' withheld for naming a different crossing.'
        : '');
    f.hidden = false;
  })();
  (function(){
    var comm = cfDate(d && d.commissionedAt), ing = cfDate(d && d.collected);
    if(comm || ing){
      cfSet("voices", true, (comm ? "commissioned " + comm : "") + (comm && ing ? ", " : "") + (ing ? "ingested " + ing : ""));
    } else cfSet("voices", false, "no scrape commissioned here yet");
  })();
  const items = d.items || [];
  const tag = el("voicestag");
  if (d.commissioned && !items.length) {
    tag.textContent = d.suppressed ? "none on this corner" : "none on topic";
    tag.classList.add("pending");
    el("voices").innerHTML =
      (d.suppressed
        ? '<p class="empty">The scrapers ran here and every surviving account turned out to describe a different crossing, so none is shown as evidence for this one.</p>'
        : '<p class="empty">The scrapers ran here and found no account that describes the street itself.</p>') +
      '<p class="pcauto">Commissioned autonomously on ' + esc(ptDay(d.commissionedAt)) +
      ', ' + esc(acct(d.candidates || 0)) + ' read. An empty lane that actually ran is worth more than a full one that guessed.</p>';
    return;
  }
  if (d.note && !items.length) {
    tag.textContent = "not yet checked"; tag.classList.add("pending");
    el("voices").innerHTML = '<p class="empty">Resident accounts have not been scraped at this corner yet.</p>' +
      '<p class="lanenote">' + esc(d.note) + '</p>';
    return;
  }
  if (!items.length) {
    // Say so plainly. An empty scrape is a real result, not a hole to fill.
    tag.textContent = "none found";
    tag.classList.add("sample");
    el("voices").innerHTML =
      '<p class="empty">No on-topic resident accounts found for this corner.</p>';
    return;
  }
  // Display rule, same token lists the Cred Check uses server side: a strong
  // street word stands alone, a weak one only counts beside a strong one. If
  // no rendered quote is about the street itself, the honest empty state wins
  // over quotes about a neighborhood, a station, or a movie.
  //
  // The harm words are here as well as the conditions ones. Without them a
  // quote reading "another cyclist struck on Valencia" was hidden as "none
  // about the street", which is the opposite of true.
  const STRONG = ["crossing","cross","crosswalk","driver","drivers","traffic","cars","speeding","signal","curb","sidewalk","intersection","pedestrian","struck","killed","collision","crash","cyclist"];
  const isStreet = t => { const low = String(t||"").toLowerCase(); return STRONG.some(w => low.includes(w)); };
  // A commissioned payload was already filtered server side by a stricter rule
  // than this one. Re-deciding it here with a different word list can only
  // produce a contradiction: a quote the pipeline kept, hidden under a line
  // saying nothing was found.
  if (!d.commissioned && !items.some(v => isStreet(v.text))) {
    tag.textContent = "none about the street";
    tag.classList.add("pending");
    el("voices").innerHTML =
      '<p class="empty">Accounts were scraped here, but none of the rendered quotes describe the street itself, so none are shown as evidence.</p>';
    return;
  }
  var vn = el("voicenums");
  if(vn && typeof d.candidates === "number") vn.textContent = items.length + " kept from " + d.candidates + " read";
  // The tag is this lane's verdict, and by the time this line runs the lane
  // has a surviving account: every zero-kept path above has already returned
  // with its own honest tag. It used to call mark(), which returns early for
  // a live or cached source and left the server-rendered default in place, so
  // a corner with a quote that cleared the filter published the verdict
  // "scraped", which describes the run rather than the result.
  tag.textContent = "kept";
  tag.classList.remove("pending", "sample");
  // Which Apify actor produced a quote's source, the same ids the
  // commissioning path starts. The chip renders only when the stored record
  // carries the metadata: an item source these ids do not name, or a record
  // with no collected date, gets no chip rather than an invented one.
  var APIFY_ACTORS = {google_maps: "compass/crawler-google-places", reddit: "trudax/reddit-scraper-lite"};
  el("voices").innerHTML = items.map(v => {
    var actor = APIFY_ACTORS[v.source];
    var chip = actor && d.collected
      ? '<br><a class="apichip" href="https://apify.com/' + actor + '" target="_blank" rel="noopener">via Apify, ' +
        actor + ', scraped ' + esc(d.collected) + '</a>'
      : '';
    // What this account is evidence ABOUT. A quote naming one of the two
    // streets is real and relevant and is not testimony about this crossing,
    // and the page has to say which it is holding rather than let the reader
    // assume the stronger one.
    var corridor = v.match === "corridor"
      ? '<br><span class="corrchip" title="This account names one of the two streets at this corner and not the crossing itself.">corridor evidence</span>' +
        '<span class="corrnote">about this street, not this exact crossing</span>'
      : '';
    return '<div class="voice"><p>&ldquo;' + esc(v.text) + '&rdquo;</p><div class="m">' +
    esc(String(v.source).replace("_"," ")) + (v.stars ? " &middot; " + v.stars + "&#9733;" : "") +
    (v.when ? " &middot; " + esc(v.when) : "") + chip + corridor + '</div></div>';
  }).join("") +
    // Said out loud, because it is the unusual part: nobody asked for this
    // scrape and nobody was present when it ran.
    (d.commissioned
      ? '<p class="pcauto">Commissioned autonomously: the morning run started both scrapers for this corner on ' +
        esc(ptDay(d.commissionedAt)) + ' and the next run ingested ' +
        esc(acct(d.candidates || 0)) + ', of which ' + esc(items.length) +
        ' survived the relevance filter.</p>'
      : '');
});

LANE_LOADERS.impact = () => fetch("/api/impact" + X).then(r => r.json()).then(d => {
  const box = el("impact");
  if(!d || d.source === "empty" || !d.rows){ window.__impactReady = false; return; }
  el("impactrows").innerHTML = d.rows.map(r => {
    if(!r.hasFactor){
      return '<div class="irow nofactor"><span class="iname">' + esc(r.intervention) + '</span>' +
        '<span>no high-quality published factor</span>' +
        ' <a href="' + esc(r.cmfUrl) + '" target="_blank" rel="noopener">clearinghouse</a></div>';
    }
    return '<div class="irow"><span class="iname">' + esc(r.intervention) + '</span>' +
      '<span class="ibasis">' + esc(r.basis) + '</span>' +
      '<a href="' + esc(r.cmfUrl) + '" target="_blank" rel="noopener">' + esc(r.factorText) + '</a>' +
      '<span class="irange">' + esc(r.projectedRange) + '</span></div>';
  }).join("");
  el("impactcombined").textContent = d.combined ? d.combined.sentence : "";
  window.__impactReady = true;
  if(state === "fix") box.hidden = false;
}).catch(() => {});

LANE_LOADERS.precedents = () => fetch("/data/precedents.json").then(r => r.json()).then(d => {
  const rows = (d.projects || []);
  if(!rows.length) return;
  el("precrows").innerHTML = rows.slice(0, 3).map(p =>
    '<div class="prow"><b>' + esc(p.name) + '</b>' +
    '<span class="pw">' + esc(p.what) + ' &middot; ' + esc(p.completed) + '</span>' +
    '<div class="po">' + esc(p.outcome) + '</div>' +
    '<a href="' + esc(p.sourceUrl) + '" target="_blank" rel="noopener">read the evaluation</a></div>'
  ).join("");
  el("precedents").hidden = false;
}).catch(() => {});

LANE_LOADERS.letter = () => fetch("/api/letter" + X).then(r => r.json()).then(d => {
  (function(){
    var ok = d && d.verified && (d.source === "verified-cache" || d.source === "live");
    var chk = cfDate(d && (d.checkedAt || d.generatedAt));
    if(ok && chk) cfSet("letter", true, "verified " + chk + (d.verifyVersion ? ", gate " + d.verifyVersion : ""));
    else if(ok) cfSet("letter", true, "verified, date not recorded");
    else cfSet("letter", false, "no verified letter serves here yet");
  })();
  const copyBtn = el("copy"), dlBtn = el("download");
  // Not drafted, and not pretending otherwise. A sample letter is the one
  // artifact on this site somebody might actually send, so a corner without a
  // real draft shows the offer and the reason it cannot run right now.
  // Two ways to have no letter, and they are different facts about the corner.
  // "ondemand" means nobody has asked for one yet. "pending-verification"
  // means one was written and the check refused it, which is a stronger
  // statement and the reader is entitled to the reason.
  if(d.source === "ondemand" || d.source === "pending-verification"){
    const t = el("lettertag");
    t.textContent = d.source === "ondemand" ? "not drafted" : "not verified";
    t.classList.add("pending");
    el("letter").innerHTML = '<p class="empty">' + esc(d.note || "") + '</p>' +
      '<p class="gated"><button class="offer" type="button" disabled>Draft the letter for this corner</button><br>' +
      '<b>Drafting is paused.</b> ' + esc(d.gatedReason || "") + '</p>';
    if(copyBtn) copyBtn.disabled = true;
    if(dlBtn) dlBtn.disabled = true;
    return;
  }
  if(copyBtn) copyBtn.disabled = false;
  if(dlBtn) dlBtn.disabled = false;
  mark("lettertag", d.source);
  el("letter").textContent = d.text || "";

// Download as text: a client-side blob of exactly what is on screen, named
// for the corner. Nothing fetched, nothing regenerated.
el("download") && (el("download").onclick = () => {
  const text = el("letter") ? el("letter").textContent : "";
  if(!text.trim()) return;
  const blob = new Blob([text], {type: "text/plain;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "streetcred-letter-" + CORNER_SLUG + ".txt";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
});
  // onclick, not addEventListener: this handler rebinds on every letter load,
  // and after an in-place corner swap a second listener would copy the letter
  // twice. Assignment replaces; listeners accumulate.
  el("copy").onclick = () => {
    navigator.clipboard.writeText(d.text || "");
    el("copy").textContent = "Copied";
    setTimeout(() => el("copy").textContent = "Copy letter", 1400);
  };
});

// ---------------- in-place corner swap (split stage) ----------------
// pushState navigation between corners without a reload: identity flips,
// transient DOM resets to skeletons, and the exact same lane loaders repaint
// every panel. Deep links and the back button stay truthful because every
// swap is a history entry and popstate swaps back through the same path.
let CORNER_MAP = null; // the Leaflet map instance, once the band upgrade runs

function runLanes(){ Object.values(LANE_LOADERS).forEach(fn => { try { fn(); } catch(e) {} }); }

function resetTransient(){
  // The corner swapped underneath the page, so neither lane has answered for
  // the new one yet. Left populated, the composer would reconcile this
  // corner's press against the last corner's history.
  PRESS_LANES = { news: undefined, timeline: undefined };
  V.score = null; V.stats = null; V.cred = null;
  IMG = null; state = "today"; polls = 0;
  window.HZLABELS = [];
  el("verdict").hidden = true;
  el("scorewrap").hidden = true;
  el("cred").hidden = true;
  if(el("ghist")) el("ghist").hidden = true;
  if(el("tl")) el("tl").hidden = true;
  if(el("hz")){ el("hz").hidden = true; el("hz").innerHTML = ""; }
  if(el("replay")) el("replay").hidden = true;
  const sk = '<div class="sk"></div><div class="sk"></div><div class="sk"></div>';
  el("letter").innerHTML = sk + sk;
  el("news").innerHTML = sk;
  if(el("voices")) el("voices").innerHTML = sk;
  el("stats").innerHTML = '<div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Injury collisions, last 5 years</div></div>' +
    '<div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Street-condition 311 reports, 3 years</div></div>' +
    '<div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Supervisor district</div></div>';
  document.querySelectorAll(".toggle button").forEach((b,i) => {
    b.setAttribute("aria-pressed", String(i === 0));
    if(b.dataset.state !== "today"){ b.disabled = true; b.textContent = b.dataset.state === "hazards" ? "Hazards" : "Proposed fix"; }
  });
  // Lane tags accumulate state as their payloads land. A swap that did not
  // reset them would show the previous corner's verdict on the new corner's
  // lanes, which is the one thing a tag exists to prevent.
  [["newstag","found live, cited"],["voicestag","scraped"],["lettertag","drafted"],
   ["imgtag","Street View plus Gemini"]].forEach(pair => {
    const t = el(pair[0]);
    if(!t) return;
    t.textContent = pair[1];
    t.classList.remove("sample","pending");
  });
  const cap = el("statcap");
  if(cap){ cap.hidden = true; cap.textContent = ""; }
  if(el("copy")) el("copy").disabled = false;
  if(el("download")) el("download").disabled = false;
}

function swapCorner(info, push){
  CORNER_SLUG = info.slug;
  CORNER_GEO = { lat: Number(info.lat), lon: Number(info.lon), name: info.name };
  X = "?x=" + info.slug;
  if(push !== false) history.pushState({ corner: info }, "", "/c/" + info.slug);
  document.title = info.name + ", graded - StreetCred";
  const h = el("cname") || document.querySelector(".cname"); if(h) h.textContent = info.name;
  const sn = document.querySelector(".sn"); if(sn) sn.textContent = info.name;
  resetTransient();
  runLanes();
  loadImagery();
  if(CORNER_MAP && window.L){
    // Recenter, never flyTo under reduced motion; the map itself stays live
    // while the left column shows skeletons.
    if(REDUCED) CORNER_MAP.setView([CORNER_GEO.lat, CORNER_GEO.lon], 16);
    else CORNER_MAP.flyTo([CORNER_GEO.lat, CORNER_GEO.lon], 16, { duration: 0.8 });
    CORNER_MAP.closePopup();
  }
}

window.addEventListener("popstate", (e) => {
  const m = location.pathname.match(/^[/]c[/]([A-Za-z0-9-]+)/);
  if(!m) return;
  if(e.state && e.state.corner){ swapCorner(e.state.corner, false); return; }
  // A history entry from before the first swap: reload is the honest fallback,
  // because we no longer know that corner's geometry without asking.
  location.reload();
});

// Intercept popup navigation inside the band only. Everywhere else the link
// behaves as a link.
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest(".lpop-view");
  if(!a || !document.querySelector(".band")) return;
  e.preventDefault();
  swapCorner({ slug: a.dataset.slug, name: a.dataset.name, lat: a.dataset.lat, lon: a.dataset.lon });
});

// ---------------- band assembly, desktop only ----------------
(function(){
  if(!matchMedia("(min-width: 1100px)").matches) return;
  if(document.querySelector(".band")) return;
  const imagery = document.querySelector(".panel.lane-imagery");
  const maplane = el("maplane");
  if(!imagery || !maplane) return;
  const band = document.createElement("div");
  band.className = "band";
  imagery.parentNode.insertBefore(band, imagery);
  band.appendChild(imagery);
  band.appendChild(maplane);
  maplane.hidden = false;
})();

// First load: every lane once. Swaps call runLanes() again.
runLanes();
</script>
<script src="/typeahead.js" defer></script>
</body>
</html>`;
};
