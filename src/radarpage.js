// The press radar, public.
//
// The instrument is the argument. This page does not describe a capability, it
// shows the queries standing open, what they caught, what the filter threw
// away and why, how long each story took to reach us, and what it cost. The
// filtered half is on the page for the same reason the watchlist publishes its
// rejects: a detector that shows only its hits is indistinguishable from a
// search box that got lucky.
import { FONT_LINK, BASE_CSS, META, MASTHEAD, FOOTER } from "./page.js";
import { medianLag } from "./radar.js";

const esc = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

const when = (ts) => {
  const d = new Date(ts);
  if (isNaN(d)) return "";
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
};

const n = (v) => Number(v || 0).toLocaleString("en-US");

export const RADAR_PAGE = (radar = {}, origin = "", preview = false, scored = 0) => {
  const feed = radar.feed || [];
  const monitors = radar.monitors || null;
  const budget = radar.budget || null;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const week = feed.filter((h) => Date.parse(h.detectedAt || 0) >= weekAgo);
  const weekPassed = week.filter((h) => h.passed).length;
  const last10 = feed.slice(0, 10);
  const median = medianLag(last10);
  const undated = last10.filter((h) => typeof h.lagHours !== "number").length;
  const running = monitors?.list?.length || 0;
  const live = running > 0 && !budget?.paused;

  return `<!doctype html>
<html lang="en">
<head>
${META({
  title: "The press radar",
  description:
    "Exa watches San Francisco's press coverage continuously. New reporting about a watched corridor lands here within hours of publication, with every detection logged, filtered in public, and costed.",
  url: `${origin}/radar`,
})}
${FONT_LINK}
<style>
${BASE_CSS}
.rfeed{display:flex;flex-direction:column}
.rhit{display:grid;grid-template-columns:130px minmax(0,1fr) auto;gap:14px;align-items:baseline;
  padding:12px 0;border-bottom:1px solid var(--line);font-size:13px}
.rhit:last-child{border-bottom:0}
.rwhen{font-size:11.5px;color:var(--dim);font-variant-numeric:tabular-nums}
.rtitle{color:var(--ink);line-height:1.45;text-decoration:none}
a.rtitle:hover{text-decoration:underline}
.rmeta{display:block;font-size:11.5px;color:var(--dim);margin-top:3px}
.rfilt .rtitle{color:var(--dim)}
.rlag{font-size:11.5px;color:var(--dim);white-space:nowrap;font-variant-numeric:tabular-nums}
.rchip{font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 7px;
  border-radius:4px;white-space:nowrap}
.rchip.pass{background:rgba(120,140,93,.16);color:var(--green);border:1px solid rgba(120,140,93,.4)}
.rchip.filt{background:transparent;color:var(--dim);border:1px dashed var(--line2)}
.rinst{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:0 0 20px}
.ricell{background:var(--panel);border:1.5px solid var(--line3);border-radius:12px;padding:14px}
.ricell b{display:block;font-size:24px;font-weight:700;line-height:1.1}
.ricell span{display:block;font-size:11.5px;color:var(--dim);margin-top:4px;line-height:1.45}
.rq{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.rq code{font-size:11px;background:var(--card);border:1px solid var(--line);border-radius:5px;padding:3px 8px;color:var(--dim)}
.rpaused{background:rgba(240,126,38,.10);border:1px solid rgba(240,126,38,.35);border-radius:9px;
  padding:12px 14px;font-size:13px;color:#a04d0c;margin:0 0 16px;line-height:1.5}
</style>
</head>
<body>
<div class="wrap">
${MASTHEAD({ scored, active: "radar" })}
<header>
  <div class="hctl"></div>
  <div class="corner"><b>The press radar</b><span class="csub">Exa watches San Francisco's coverage continuously</span></div>
</header>

<p class="lede">New reporting about a watched corridor lands here within hours of publication. Delivery is
push: Exa holds the queries open and sends a detection as coverage appears, so nothing here is on a
schedule this page could promise. What it can show is the lag it actually measured.</p>

${
  budget?.paused
    ? `<p class="rpaused"><b>Paused at ${budget.pausedBy === "day" ? "the daily" : "the monthly"} budget.</b>
Detections resume at 00:00 UTC. The radar is not stale by accident: it stopped on purpose and said so.</p>`
    : ""
}

<div class="rinst">
  <div class="ricell"><b>${n(running)}</b><span>monitors running${running ? "" : ", none created yet"}</span></div>
  <div class="ricell"><b>${n(week.length)}</b><span>detections this week</span></div>
  <div class="ricell"><b>${n(weekPassed)}</b><span>cleared the relevance filter${
    week.length ? `, ${Math.round((weekPassed / week.length) * 100)}%` : ""
  }</span></div>
  <div class="ricell"><b>${median === null ? "n/a" : `${median}h`}</b><span>median publication to detection, last ${
    last10.length
  } hit${last10.length === 1 ? "" : "s"}${undated ? `, ${undated} carried no publication date and are excluded` : ""}</span></div>
  <div class="ricell"><b>${budget ? (budget.dayCents || 0).toFixed(1) : "0.0"}c</b><span>spent today of a ${
    budget?.dayCapCents ?? 40
  }c daily cap</span></div>
</div>

${
  radar.burnHitRate !== null && radar.burnHitRate !== undefined
    ? `<p class="note">For comparison, and measured separately: the batch press lane found coverage at
${radar.burnHitRate}% of the ${n(radar.burnChecked)} corners it has checked. That is a different question
asked of a different population, the worst corners in the city rather than this week's news, and the two
rates should not be read as one number.</p>`
    : ""
}

<div class="eyebrow"><span>Detections</span><span class="tag src"><img src="/logos/exa.svg" alt="" width="35" height="11" loading="lazy">Press via Exa</span></div>
<div class="tape${live ? " live" : ""}">
<div class="panel">
  <div class="pbody">
    ${
      feed.length
        ? `<div class="rfeed">${feed
            .map(
              (h) => `<div class="rhit${h.passed ? "" : " rfilt"}">
      <span class="rwhen">${esc(when(h.detectedAt))}</span>
      <span>${
        h.passed
          ? `<a class="rtitle" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>`
          : `<span class="rtitle">${esc(h.title)}</span>`
      }
        <span class="rmeta">${esc(h.domain)}${h.date ? ` &middot; published ${esc(h.date)}` : ", no publication date"} &middot; matched ${esc(
                h.corridor,
              )}${
                h.passed && h.corners?.length
                  ? ` &middot; ${h.corners.map((s) => `<a href="/c/${esc(s)}">${esc(s.replace(/-/g, " "))}</a>`).join(", ")}`
                  : ""
              }</span>
        ${
          h.passed
            ? `<span class="rchip pass">cleared the filter</span>`
            : `<span class="rchip filt">detected, filtered as not safety relevant</span><span class="rmeta">${esc(
                h.reason || "",
              )}</span>`
        }
      </span>
      <span class="rlag">${typeof h.lagHours === "number" ? `${h.lagHours}h` : "lag unknown"}</span>
    </div>`,
            )
            .join("\n")}</div>`
        : `<p class="empty">No detections yet. The monitors are ${
            running ? "running and nothing has been published about a watched corridor since they started" : "not created yet"
          }.</p>`
    }
  </div>
</div>
</div>

${
  monitors?.list?.length
    ? `<div class="eyebrow"><span>The standing queries</span><span class="lanenums">${n(
        monitors.list.length,
      )} monitors</span></div>
<p class="note">Corridors, not corners. A street-level query is the efficient unit: every corner on
Mission shares Mission's coverage, so one standing query serves all of them. Which corners a story
attaches to is decided afterwards, by whether the article names both streets of a crossing.</p>
<div class="rq">${monitors.list.map((m) => `<code>${esc(m.query)}</code>`).join("")}</div>`
    : ""
}

<p class="note" style="margin-top:22px">Radar queries cost ${
    budget ? (budget.dayCents || 0).toFixed(1) : "0.0"
  } cents today against a ${budget?.dayCapCents ?? 40} cent daily cap and ${
    budget ? (budget.monthCents || 0).toFixed(1) : "0.0"
  } cents this month against ${budget?.monthCapCents ?? 900}. The full ledger is on <a href="/status">/status</a>.</p>

${preview ? '<div class="pvw">Preview</div>' : ""}
${FOOTER()}
</div>
</body>
</html>`;
};
