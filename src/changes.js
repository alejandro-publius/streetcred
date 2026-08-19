// /changes. The public record of every stored grade or index movement.
//
// Fifty most recent, each with who moved it and why. This page exists so a
// reader holding last week's screenshot can find out what happened between
// then and now, instead of having to choose which of two numbers to distrust.

import { FONT_LINK, BASE_CSS, META, MASTHEAD, FOOTER } from "./page.js";

const esc = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

const day = (ts) => String(ts || "").slice(0, 10);

export const CHANGES = (changes = [], origin = "", preview = false, scored = 0) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/logo.svg">
${META({
  title: "Grade changes \u00b7 StreetCred",
  description: "Every stored grade or index change on StreetCred, newest first, with the reason and the source, so a grade cannot move without a public record of it moving. Radar entries appear here too, marked as no grade change, because press attention decides what gets looked at next and never what a corner scores.",
  url: `${origin}/changes`,
})}
${FONT_LINK}
<style>
${BASE_CSS}
.doc{max-width:720px}
.doc h1{font-size:26px;letter-spacing:-.02em;margin:0 0 8px}
.doc .sub{font-size:13.5px;color:var(--dim);margin:0 0 26px;line-height:1.6}
.chg{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;background:var(--panel);
  border:1.5px solid var(--line3);border-radius:12px;padding:13px 16px;margin:0 0 10px;
  box-shadow:0 1px 3px rgba(20,27,45,.06);font-size:13.5px}
.chg .d{color:var(--dim);font-variant-numeric:tabular-nums;font-size:12px}
.chg a{color:var(--ink);font-weight:600;text-decoration:none;border-bottom:1px solid var(--line2)}
.chg .mv{font-weight:700;font-variant-numeric:tabular-nums}
.chg .why{flex-basis:100%;color:var(--dim);font-size:12.5px;line-height:1.5}
.chg .src{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);
  border:1px solid var(--line2);border-radius:4px;padding:2px 7px;margin-left:auto}
.empty{font-size:14px;color:var(--dim);line-height:1.7}
</style>
</head>
<body>
<div class="wrap">
${MASTHEAD({ scored, active: "changes" })}
<header>
  <div class="switcher">
    <a href="/">The city</a>
    <a href="/methodology">Methodology</a>
  </div>
</header>
<main>
<div class="doc">
<h1>Grade changes</h1>
<p class="sub">Every stored grade or index movement, newest first, with who moved it and why.
A grade that can change with no public record of having changed is a grade nobody can cite.
Raw feed at <a href="/api/changes" style="color:inherit">/api/changes</a>.</p>
${
  changes.length
    ? changes
        .map(
          (c) => `<div class="chg">
  <span class="d">${esc(day(c.date))}</span>
  <a href="/c/${esc(c.slug)}">${esc(c.name || c.slug)}</a>
  <span class="mv">${
    c.old || c.new
      ? `${esc(c.old?.grade ?? "?")} ${c.old?.index ?? "?"} &rarr; ${esc(c.new?.grade ?? "?")} ${c.new?.index ?? "?"}`
      : "no grade change"
  }</span>
  <span class="src">${esc(c.source || "pipeline")}</span>
  <span class="why">${esc(c.reason || "")}</span>
</div>`,
        )
        .join("\n")
    : `<p class="empty">No grade has changed since the changelog began. When one does, the movement,
the reason and the source will be recorded here whether or not anyone is watching.</p>`
}
</div>
</main>
${FOOTER()}
${preview ? '<div class="pvw">Preview</div>' : ''}
</div>
</body>
</html>`;
