import { CORNERS } from "./data.js";
import { DISTRIBUTION } from "./score.js";
import { TIER_LABEL, TIER_NOTE, TIERS } from "./city.js";

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
.corner{margin-left:auto;text-align:right;font-size:13px;color:var(--dim);line-height:1.5}
.corner b{display:block;font-size:15px;color:var(--ink);font-weight:600}
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
.distax{display:flex;justify-content:space-between;font-size:10px;color:var(--dim);
  letter-spacing:.04em;margin:4px 0 12px}
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

.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}
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
.tierchip{display:inline-block;margin-left:8px;font-size:10px;font-weight:700;letter-spacing:.12em;
  padding:3px 8px;border-radius:999px;border:1px solid var(--line2);color:var(--dim);vertical-align:2px}
.tierchip.t-audited{border-color:var(--ink);color:var(--ink)}
.tierchip.t-scored{border-style:dashed}
/* The one line every unchecked lane shows, so the page says the same thing in
   six places rather than six things. */
.lanenote{margin:10px 0 0;font-size:12px;color:var(--dim);line-height:1.55;
  padding-left:10px;border-left:2px solid var(--line3)}
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
.phs{display:flex;align-items:center;justify-content:space-between;gap:10px;
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
.empty{margin:0;font-size:13.5px;color:var(--dim);line-height:1.55}

.fixrow{display:grid;grid-template-columns:1fr auto;gap:8px 18px;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--line)}
.fixrow .k{font-size:11.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.fixrow .v{font-size:14px;font-weight:500;line-height:1.45}
.fixrow .cost{font-size:19px;font-weight:700;color:var(--green);white-space:nowrap;text-align:right}
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
.cname{display:inline;font-size:inherit;font-weight:inherit;margin:0;letter-spacing:inherit}
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
.sn{flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
}

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
  #stats{order:7}
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
@media(max-width:400px){.stats{grid-template-columns:1fr}}`;

export const PAGE = (c, og = {}) => {
  const idx = og.score?.index;
  const grade = og.score?.grade;
  const verdict = og.cred?.verdict;
  const records = og.cred?.lanes?.find((l) => l.key === "records");
  // Falls back to the plain product line when a corner has not been scored yet,
  // rather than shipping a title with a hole in it.
  const ogTitle = Number.isFinite(idx)
    ? `${c.name} scores ${idx}/100 on StreetCred`
    : `${c.name} on StreetCred`;
  const ogDesc = [
    records?.detail,
    verdict,
    "Evidence graded and traced, letter drafted.",
  ]
    .filter(Boolean)
    .join(". ")
    .replace(/\.\./g, ".");
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
<title>StreetCred, ${c.short}</title>
<link rel="icon" href="/logo.svg">
<link rel="canonical" href="${url}">
<meta name="description" content="${esc(ogDesc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="StreetCred">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Street View photograph of ${esc(c.name)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
<meta name="twitter:image" content="${img}">
${FONT_LINK}
<style>
${BASE_CSS}
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
  <div class="corner"><h1 class="cname"><b>${c.name}</b>${
    og.tier ? `<span class="tierchip t-${og.tier}" title="${esc(TIER_NOTE[og.tier] || "")}">${TIER_LABEL[og.tier]}</span>` : ""
  }</h1>${c.city}${
    c.district ? `, District ${c.district}` : ", district unresolved"
  }${c.cotd ? `<span class="auto">Audited autonomously by StreetCred on ${c.cotd}</span>` : ""}</div>
</header>
<main>

<p class="lede">Every claim about a dangerous corner, graded and traced to its source, ending in a picture of the fix and a letter to the Supervisor. <button class="nudge" id="nudge" type="button">Check your own corner</button></p>

<section class="verdict" id="verdict" hidden aria-label="The verdict for this corner">
  <span class="vg" id="vg" aria-hidden="true"></span>
  <div class="vmain">
    <p class="vline" id="vline"></p>
    <p class="vthesis" id="vthesis"></p>
    <p class="vcred" id="vcred"></p>
  </div>
  <a class="vgo" id="vgo" href="#letterpanel">Get the letter</a>
</section>

<div class="sticky" id="sticky" hidden>
  <span class="sg" id="stickyg" aria-hidden="true"></span>
  <span class="sn">${c.short || c.name}</span>
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
  <div class="phs"><h2>The corner, three ways</h2><span class="tag" id="imgtag">Street View plus Gemini</span></div>
  <div class="pbody">
    <div class="toggle" role="group" aria-label="Corner view">
      <button data-state="today" aria-pressed="true">Today</button>
      <button data-state="hazards" aria-pressed="false"${c.generated ? " disabled" : ""}>Hazards</button>
      <button data-state="fix" aria-pressed="false"${c.generated ? " disabled" : ""}>Proposed fix</button>
    </div>

    <div class="hero single" id="hero">
      <img id="base" alt="${c.name} today, from Street View">
      <img id="overlay" alt="">
      <div id="handle" role="separator" tabindex="0" aria-label="Comparison slider, arrow keys move it" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>
    </div>
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

<div class="eyebrow"><span>Official record</span></div>
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
    <div class="distax"><span>calmer</span><span>${DISTRIBUTION.length.toLocaleString("en-US")} SF intersections, the whole city</span><span>worst</span></div>
    <div class="sevbar" id="sevbar"></div>
    <div class="sevkey" id="sevkey"></div>
    <div class="scorecav" id="scorecav"></div>
    <details class="ghist" id="ghist" hidden>
      <summary>Grade history</summary>
      <div id="ghistbody"></div>
    </details>
  </div>
</div>
<div class="stats" id="stats">
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Injury collisions, last 5 years<br><i class="rad">within 150m</i></div></div>
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Street-condition 311 reports, 3 years<br><i class="rad">within 150m</i></div></div>
  <div class="stat"><div class="n sk" style="width:70px;height:34px"></div><div class="l">Supervisor district</div></div>
</div>
<p class="statcap" id="statcap" hidden></p>
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

<div class="cols">
  <div>
    <div class="panel lane-press">
      <div class="phs"><h2 id="newshead">Press coverage</h2><span class="tag" id="newstag">found live, cited</span></div>
      <div class="pbody">
        <div class="tl" id="tl" hidden>
          <div class="tlbars" id="tlbars" role="group" aria-label="Coverage found by year"></div>
          <div class="tlax"><span id="tlfrom"></span><span id="tlto"></span></div>
          <p class="tlnote" id="tlnote"></p>
          <p class="tlpop" id="tlpop"></p>
        </div>
        <div class="news" id="news"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
        <div class="pconn" id="pconn" hidden></div>
      </div>
    </div>
    <div class="panel lane-voices">
      <div class="phs"><h2>Resident voices</h2><span class="tag" id="voicestag">scraped</span></div>
      <div class="pbody">
        <p class="funnel" id="voicefunnel" hidden></p>
        <div id="voices"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
      </div>
    </div>
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
        <div class="letter" id="letter"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
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
    <div><span class="lg"><img src="/logos/exa.svg" alt="Exa" width="77" height="24" loading="lazy"></span>Finds current press coverage of this intersection, cited</div>
    <div><span class="lg"><img src="/logos/apify.svg" alt="Apify" width="87" height="24" loading="lazy"></span>Scrapes what residents say on Reddit and Google Maps</div>
    <div><span class="lg"><img src="/logos/googlemaps.svg" alt="Google Maps" width="24" height="24" loading="lazy"><b>Google Maps</b></span>Street View frames, the corner thumbnail, and the city map</div>
    <div><span class="lg"><img src="/logos/cloudflare.svg" alt="Cloudflare" width="52" height="24" loading="lazy"><b>Cloudflare</b></span>Workers serve the page, KV holds corners, imagery and grades</div>
    <div><span class="lg"><b>DataSF</b></span>Collisions and 311, queried by radius around the corner</div>
  </div>
  </div>
</div>

</main>
</main>
${og.preview ? '<div class="pvw">Preview</div>' : ''}
<footer>Exa finds it, Apify hears it, Gemini shows it and writes it. Built at Build Club, August 17 2026.<br>
Hazard and proposed-fix images are AI generated from the Street View photograph. The proposed fix is a visualization, not a photograph of anything that exists. Nothing here is sent to any official.<br><a href="/methodology">Methodology</a> &middot; <a href="/watchlist">Press watchlist</a> &middot; <a href="/changes">Grade changes</a> &middot; <a href="/status">Status</a> &middot; <a href="/watchdog">The watchdog</a></footer>
</div>

<script>
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
  } else { ovImg.alt = ""; }
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
  // The projected outcome belongs to the fix state alone: it describes the
  // proposal, not the photograph.
  const ib = el("impact");
  if(ib) ib.hidden = !(state === "fix" && window.__impactReady);
}
let split = 50;
function setSplit(pct){
  split = Math.max(0, Math.min(100, pct));
  el("overlay").style.clipPath = "inset(0 0 0 " + split + "%)";
  const h = el("handle");
  h.style.left = split + "%";
  h.setAttribute("aria-valuenow", String(Math.round(split)));
}
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
(function(){
  const hero = el("hero"); let drag = false;
  const move = e => { if(!drag) return; const r = hero.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    setSplit(x / r.width * 100); };
  el("handle").addEventListener("pointerdown", e => { drag = true; e.preventDefault(); });
  // Keyboard control: 5 percent per press, Home and End jump. The slider was
  // the one piece of the page a keyboard user literally could not operate.
  el("handle").addEventListener("keydown", e => {
    if(e.key === "ArrowLeft" || e.key === "ArrowDown"){ e.preventDefault(); setSplit(split - 5); }
    else if(e.key === "ArrowRight" || e.key === "ArrowUp"){ e.preventDefault(); setSplit(split + 5); }
    else if(e.key === "Home"){ e.preventDefault(); setSplit(0); }
    else if(e.key === "End"){ e.preventDefault(); setSplit(100); }
  });
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

LANE_LOADERS.stats = () => fetch("/api/stats" + X).then(r => r.json()).then(d => {
  V.stats = d; paintVerdict();
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
    const num = '<div class="n" data-to="' + (v === null || v === undefined ? "" : v) + '">' +
      (v === null || v === undefined ? "n/a" : "0") + '</div>';
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
  onFirstView(el("stats"), () => {
    el("stats").querySelectorAll(".n").forEach(node => {
      const to = node.getAttribute("data-to");
      if(to !== "") countUp(node, to);
    });
  });
});

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
  const chip = document.querySelector(".tierchip");
  if(!chip) return;
  let t = TIER;
  if(V.score && V.score.source === "sweep") t = "scored";
  else if(IMG && IMG.status === "ready") t = "audited";
  else if(IMG && IMG.status) t = "enriched";
  if(!t){ chip.hidden = true; return; }
  TIER = t;
  chip.hidden = false;
  chip.textContent = t.toUpperCase();
  chip.className = "tierchip t-" + t;
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
    '<div>' + esc(String(c.date||"").slice(0,10)) + ': <b>' + esc(c.old?.grade ?? "?") + " " + (c.old?.index ?? "?") +
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
  // Do not claim corner-level precision the result set does not support.
  if (d.heading) el("newshead").textContent = d.heading;
  // Retrieval date on hover: when this page actually fetched the citation,
  // distinct from when the outlet published it. d.fetchedAt is stamped by the
  // Worker at fetch time; a cached payload keeps the stamp of the fetch that
  // produced it, which is the honest reading of "retrieved".
  const got = d.fetchedAt ? new Date(d.fetchedAt).toISOString().slice(0,10) : null;
  el("news").innerHTML = (d.items||[]).map(x =>
    '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"' +
    (got ? ' title="Retrieved by StreetCred on ' + got + '"' : '') + '><div class="t">' + esc(x.title) +
    // An agency page is the record, not reporting on the record. Tagged so it
    // reads as a primary source rather than as press coverage.
    (x.official ? ' <span class="osrc">official source</span>' : '') +
    '</div><div class="m">' + esc(x.domain) + (x.date ? " &middot; " + esc(x.date) : "") + '</div></a>').join("")
    || '<div class="m">No coverage found.</div>';
});

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
    el("rdate").textContent = (m.ranAt || "").slice(0, 10) || "an earlier run";
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
  const years = t && t.years;
  if(!years || !years.length) return;
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
}).catch(() => {});

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
  const items = d.items || [];
  const tag = el("voicestag");
  if (d.commissioned && !items.length) {
    tag.textContent = "none on topic"; tag.classList.add("pending");
    el("voices").innerHTML =
      '<p class="empty">The scrapers ran here and found no account that describes the street itself.</p>' +
      '<p class="pcauto">Commissioned autonomously on ' + esc(String(d.commissionedAt || "").slice(0,10)) +
      ', ' + esc(d.candidates || 0) + ' accounts read. An empty lane that actually ran is worth more than a full one that guessed.</p>';
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
  const STRONG = ["crossing","cross","crosswalk","driver","drivers","traffic","cars","speeding","signal","curb","sidewalk","intersection","pedestrian"];
  const isStreet = t => { const low = String(t||"").toLowerCase(); return STRONG.some(w => low.includes(w)); };
  if (!items.some(v => isStreet(v.text))) {
    tag.textContent = "none about the street";
    tag.classList.add("pending");
    el("voices").innerHTML =
      '<p class="empty">Accounts were scraped here, but none of the rendered quotes describe the street itself, so none are shown as evidence.</p>';
    return;
  }
  mark("voicestag", d.source);
  el("voices").innerHTML = items.map(v =>
    '<div class="voice"><p>&ldquo;' + esc(v.text) + '&rdquo;</p><div class="m">' +
    esc(String(v.source).replace("_"," ")) + (v.stars ? " &middot; " + v.stars + "&#9733;" : "") +
    (v.when ? " &middot; " + esc(v.when) : "") + '</div></div>').join("") +
    // Said out loud, because it is the unusual part: nobody asked for this
    // scrape and nobody was present when it ran.
    (d.commissioned
      ? '<p class="pcauto">Resident voices commissioned autonomously: the morning run started both scrapers for this corner on ' +
        esc(String(d.commissionedAt || "").slice(0,10)) + ' and the next run ingested ' +
        esc(d.candidates || 0) + ' accounts, of which these survived the relevance filter.</p>'
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
  const copyBtn = el("copy"), dlBtn = el("download");
  // Not drafted, and not pretending otherwise. A sample letter is the one
  // artifact on this site somebody might actually send, so a corner without a
  // real draft shows the offer and the reason it cannot run right now.
  if(d.source === "ondemand"){
    const t = el("lettertag"); t.textContent = "not drafted"; t.classList.add("pending");
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
  const h = document.querySelector(".cname b"); if(h) h.textContent = info.name;
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
