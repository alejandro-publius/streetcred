// The day's findings, under the masthead.
//
// What the pipeline actually found today, Pacific, from stored records only.
// Never a summary, never a backfill, never a number without the thing it
// counts. Every item links somewhere a reader can check it and carries a chip
// naming which provider produced it, because an item with no provenance on a
// page whose whole argument is provenance is worse than no item.
//
// **The empty state is the feature.** A lane that found nothing today says so
// in plain words, and a lane that is paused says which ceiling paused it and
// what the numbers are. That is the difference between "we looked and there was
// nothing" and "we did not look", and those are the two states a reader most
// needs to tell apart. Backfilling yesterday's press to keep the row busy would
// destroy exactly that distinction, so no item older than today can render and
// a test holds it.
//
// **A day with nothing in it does not animate.** A scrolling row with one line
// in it reads as motion for its own sake. One honest line, static, naming what
// ran and what it found.

import { pacificDay, pacificToday } from "./data.js";

export const TICKER_CAP = 20;

const esc = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

const trim = (t, n) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

// Lane order is reading order and also tab order. Findings first, then what the
// agent decided, then what was audited, because that is the order of the day.
export const LANE_ORDER = ["press", "voices", "watchlist", "watchdog", "audits"];

const LABEL = {
  press: "Press",
  voices: "Resident accounts",
  watchlist: "Watchlist",
  watchdog: "Agent decisions",
  audits: "Corners audited",
};

const SEE_ALL = {
  press: { href: "/watchlist", label: "all press" },
  voices: { href: "/status", label: "all runs" },
  watchlist: { href: "/watchlist", label: "the watchlist" },
  watchdog: { href: "/watchdog", label: "the diary" },
  audits: { href: "/changes", label: "every change" },
};

// ------------------------------------------------------------------- the lanes

function pressLane(recent, exa, today) {
  const items = [];
  for (const rec of recent || []) {
    if (pacificDay(rec.at) !== today) continue;
    for (const a of rec.items || []) {
      items.push({
        lane: "press",
        chip: "PRESS VIA EXA",
        href: a.url || `/${rec.slug}`,
        external: Boolean(a.url),
        text: trim(a.title, 88),
        meta: [a.publisher, rec.name].filter(Boolean).join(" · "),
        at: rec.at,
      });
    }
  }
  if (items.length) return { items, empty: "" };

  // The paused state is a different claim from the empty one and the numbers
  // are what make it checkable. Read from the real budget rather than inferred
  // from the absence of items, because absence has two causes.
  if (exa?.paused || exa?.reached) {
    const spent = typeof exa.spentUsd === "number" ? `$${exa.spentUsd.toFixed(2)}` : "the cap";
    const cap = typeof exa.capUsd === "number" ? ` of $${exa.capUsd.toFixed(2)}` : "";
    return { items, empty: `press paused: Exa budget reached, ${spent}${cap} spent this period` };
  }
  return { items, empty: "no press found today" };
}

function voicesLane(costs, apify, today) {
  const items = [];
  for (const run of costs || []) {
    if (pacificDay(run.at) !== today) continue;
    if (run.event !== "commissioned" && run.event !== "rescored") continue;
    const actor = (run.runs || []).map((r) => r.actor).filter(Boolean)[0];
    items.push({
      lane: "voices",
      chip: `VOICES VIA APIFY${actor ? ` · ${trim(actor, 28)}` : ""}`,
      href: `/${run.slug}`,
      text: trim(run.quote || run.name || run.slug, 88),
      meta: run.name || run.slug,
      at: run.at,
    });
  }
  if (items.length) return { items, empty: "" };
  if (apify?.paused) {
    return {
      items,
      empty:
        `commissioning paused to protect the monthly ceiling, ` +
        `${apify.used} of ${apify.cap} runs used and ${apify.reserved} reserved for the daily cron`,
    };
  }
  return { items, empty: "no resident accounts commissioned today" };
}

function watchlistLane(watchlist, today) {
  const built = pacificDay(watchlist?.builtAt);
  if (!watchlist || built !== today) {
    return {
      items: [],
      empty: built
        ? `no watchlist run today, the last one was ${built}`
        : "no watchlist run recorded",
    };
  }
  const items = [];
  for (const e of watchlist.entries || []) {
    items.push({
      lane: "watchlist",
      chip: "WATCHLIST VIA EXA",
      href: `/${e.slug}`,
      text: trim(e.article?.title || e.name || e.slug, 88),
      meta: [e.name, e.grade ? `grade ${e.grade}` : ""].filter(Boolean).join(" · "),
      at: watchlist.builtAt,
    });
  }
  // Published, not counted. A nomination this site threw away is a claim it
  // declined to make, and the reason is the interesting half.
  for (const r of watchlist.rejected || []) {
    items.push({
      lane: "watchlist",
      chip: "WATCHLIST REJECTED",
      rejected: true,
      href: "/watchlist",
      text: trim(r.title || r.query || r.name || "a nomination", 72),
      meta: `rejected: ${trim(r.reason || r.why || "no reason recorded", 60)}`,
      at: watchlist.builtAt,
    });
  }
  return { items, empty: items.length ? "" : "watchlist ran today and nominated nothing" };
}

function watchdogLane(journal, today) {
  const items = [];
  for (const e of journal || []) {
    if (pacificDay(e.ts) !== today) continue;
    const declined = !(e.actions || []).length;
    items.push({
      lane: "watchdog",
      chip: "WATCHDOG",
      href: "/watchdog",
      text: trim(e.tier2?.reasoning || e.tier1?.reason || e.delta || "a decision", 88),
      meta: [e.name || e.slug, declined ? "declined" : (e.actions || []).join(", ")]
        .filter(Boolean)
        .join(" · "),
      at: e.ts,
    });
  }
  return { items, empty: items.length ? "" : "the agent published no decisions today" };
}

function auditsLane(cotd, today) {
  const items = (cotd || [])
    .filter((e) => String(e?.date || "") === today)
    .map((e) => ({
      lane: "audits",
      chip: "AUDITED",
      href: `/${e.slug}`,
      text: trim(e.name || e.slug, 88),
      meta: e.grade ? `grade ${e.grade}` : "every lane checked",
      at: e.at || e.date,
    }));
  return { items, empty: items.length ? "" : "no corner audited today" };
}

// ------------------------------------------------------------------ the model

export function buildTicker(sources = {}, today = pacificToday()) {
  const lanes = {
    press: pressLane(sources.pressRecent, sources.exa, today),
    voices: voicesLane(sources.actorCosts, sources.apify, today),
    watchlist: watchlistLane(sources.watchlist, today),
    watchdog: watchdogLane(sources.journal, today),
    audits: auditsLane(sources.cotd, today),
  };

  const built = LANE_ORDER.map((key) => {
    const lane = lanes[key];
    const all = lane.items.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return {
      key,
      label: LABEL[key],
      items: all.slice(0, TICKER_CAP),
      hidden: Math.max(0, all.length - TICKER_CAP),
      empty: lane.empty,
      seeAll: SEE_ALL[key],
    };
  });

  const items = built.flatMap((l) => l.items).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const ran = built.filter((l) => !l.empty).map((l) => l.label.toLowerCase());
  const total = items.length;

  return {
    today,
    lanes: built,
    items: items.slice(0, TICKER_CAP),
    total,
    // A day with nothing in it is a sentence, not a carousel.
    animate: total > 1,
    summary: total
      ? `${total} finding${total === 1 ? "" : "s"} today across ${ran.length} lane${ran.length === 1 ? "" : "s"}`
      : `Nothing found today. ${built.map((l) => l.empty).filter(Boolean).join(". ")}.`,
  };
}

// -------------------------------------------------------------------- the row

// Speed is expressed as duration for a fixed distance rather than as a rate,
// because CSS has no rate. The distance is the track width, which the script
// measures, so the duration is set from it and the rate stays a rate: 40px a
// second is the ceiling and this sits under it.
export const TICKER_PX_PER_SECOND = 34;

export const TICKER_CSS = `
/* The findings row. Sits between the masthead and the hero, and its height is
   fixed in CSS rather than left to its content, because content that arrives
   after first paint moving the fold is the one thing a ticker must not do. */
.tick{border-bottom:1px solid var(--line2);background:var(--panel2,var(--panel));
  overflow:hidden;position:relative}
.tick-in{max-width:1180px;margin:0 auto;padding:0 20px;display:flex;align-items:center;
  gap:14px;height:52px;box-sizing:border-box}
.tick-lab{flex:0 0 auto;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--dim);font-weight:700;white-space:nowrap}
.tick-vp{flex:1 1 auto;overflow-x:auto;overflow-y:hidden;position:relative;
  scrollbar-width:none;-webkit-overflow-scrolling:touch}
.tick-vp::-webkit-scrollbar{display:none}
.tick-tr{display:flex;align-items:center;gap:10px;width:max-content;will-change:transform}
.tick.run .tick-tr{animation:tickscroll var(--tickdur,60s) linear infinite}
.tick.run:hover .tick-tr,.tick.run:focus-within .tick-tr,.tick.paused .tick-tr{animation-play-state:paused}
@keyframes tickscroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}

.tick-it{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;
  text-decoration:none;color:var(--ink);font-size:13px;line-height:1;
  border:1px solid var(--line2);border-radius:999px;padding:7px 13px;background:var(--bg)}
.tick-it:hover{border-color:var(--line3)}
.tick-it:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.tick-it .c{font-size:9.5px;letter-spacing:.07em;font-weight:800;text-transform:uppercase;
  color:var(--dim);border:1px solid var(--line2);border-radius:4px;padding:2px 5px;flex:0 0 auto}
.tick-it.rej .c{color:#8c2f2f;border-color:#e2c4c4}
.tick-it .m{color:var(--dim);font-size:11.5px}
.tick-more{font-size:11.5px;color:var(--dim);text-decoration:none;border-bottom:1px solid var(--line2);
  white-space:nowrap;padding:2px 0}
.tick-more:focus-visible{outline:2px solid var(--ink);outline-offset:2px}

/* Empty lanes are items too, and they are the point of the row on a quiet day. */
.tick-mt{display:inline-flex;align-items:center;white-space:nowrap;color:var(--dim);
  font-size:12.5px;border:1px dashed var(--line2);border-radius:999px;padding:7px 13px}

.tick-pz{flex:0 0 auto;font:inherit;font-size:11px;letter-spacing:.05em;text-transform:uppercase;
  font-weight:700;color:var(--dim);background:var(--bg);border:1px solid var(--line2);
  border-radius:6px;padding:5px 9px;cursor:pointer;line-height:1}
.tick-pz:hover{color:var(--ink);border-color:var(--line3)}
.tick-pz:focus-visible{outline:2px solid var(--ink);outline-offset:2px}

/* One line, static, on a day that found nothing.
   The height stays exactly the height of a busy day. An earlier draft let this
   row grow with its text, which meant a quiet morning pushed the hero down by
   however many lines the honest sentence happened to need. The sentence is not
   shortened to fit: the row is a ticker, so it scrolls sideways like one, and
   the fold does not move. */
.tick.quiet .tick-in{height:52px}
.tick.quiet .tick-vp{overflow-x:auto}
.tick-quiet{font-size:13px;color:var(--dim);line-height:1.4;margin:0;white-space:nowrap}

@media (max-width:900px){
  .tick-in{gap:10px;padding:0 14px}
  .tick-lab{display:none}
}
@media (max-width:430px){
  .tick-in{height:50px}
  .tick-it{font-size:12.5px;padding:6px 11px}
  .tick-it .m{display:none}
}

/* Hard requirement, not a nicety. No auto-scroll, no duplicate track, and the
   row is an ordinary scrollable strip the reader drives. */
@media (prefers-reduced-motion:reduce){
  .tick.run .tick-tr{animation:none}
  .tick-vp{overflow-x:auto}
  .tick-pz{display:none}
}
`;

const chip = (it) => `<span class="c">${esc(it.chip)}</span>`;

const itemHtml = (it) =>
  `<a class="tick-it${it.rejected ? " rej" : ""}" href="${esc(it.href)}"` +
  `${it.external ? ' rel="noopener noreferrer" target="_blank"' : ""}>` +
  `${chip(it)}<span class="t">${esc(it.text)}</span>` +
  `${it.meta ? `<span class="m">${esc(it.meta)}</span>` : ""}</a>`;

const emptyHtml = (lane) => `<span class="tick-mt">${esc(lane.empty)}</span>`;

const moreHtml = (lane) =>
  lane.hidden
    ? `<a class="tick-more" href="${esc(lane.seeAll.href)}">${lane.hidden} more, see ${esc(lane.seeAll.label)}</a>`
    : `<a class="tick-more" href="${esc(lane.seeAll.href)}">see ${esc(lane.seeAll.label)}</a>`;

// Human date, from the Pacific day the model already computed. Never from a
// second clock read: the label and the filter have to agree or the row is
// claiming a day it did not filter on.
export function tickerDateLabel(today) {
  const [y, m, d] = String(today).split("-").map(Number);
  if (!y || !m || !d) return "";
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export const TICKER = (model) => {
  if (!model) return "";
  const label = `Today, ${tickerDateLabel(model.today)} Pacific`;

  if (!model.total) {
    return `<div class="tick quiet"><div class="tick-in">
<span class="tick-lab">${esc(label)}</span>
<div class="tick-vp"><p class="tick-quiet">${esc(model.summary)}</p></div>
</div></div>`;
  }

  // Every lane contributes: its items, its empty line if it has one, and its
  // see-all. A lane that found nothing is still represented, which is what
  // makes the row a report rather than a highlight reel.
  const cells = model.lanes
    .flatMap((lane) => [
      ...(lane.items.length ? lane.items.map(itemHtml) : [emptyHtml(lane)]),
      moreHtml(lane),
    ])
    .join("");

  // Duplicated once for a seamless loop. aria-hidden on the copy so a screen
  // reader and the tab order meet each item exactly once.
  const track = `<div class="tick-tr" id="ticktrack">${cells}</div>`;
  const copy = `<div class="tick-tr" aria-hidden="true" tabindex="-1" data-copy="1">${cells}</div>`;

  return `<div class="tick run" id="tick" data-count="${model.total}">
<div class="tick-in">
<span class="tick-lab">${esc(label)}</span>
<button class="tick-pz" id="tickpz" type="button" aria-pressed="false"
  aria-controls="ticktrack" aria-label="Pause the findings ticker">Pause</button>
<div class="tick-vp" id="tickvp" role="region" aria-label="${esc(label)}, ${esc(model.summary)}">
${track}${copy}
</div>
</div></div>`;
};

// Sets the duration from the measured track width so the rate is a rate, wires
// the pause control, and respects a reduced-motion preference that changes
// after load. Inlined by the page; it holds no state the server needs.
export const TICKER_JS = `
(function(){
  var t=document.getElementById('tick'); if(!t) return;
  var vp=document.getElementById('tickvp'), tr=document.getElementById('ticktrack');
  var pz=document.getElementById('tickpz');
  var mq=window.matchMedia('(prefers-reduced-motion: reduce)');
  function measure(){
    if(!tr) return;
    var w=tr.scrollWidth||0;
    if(w) t.style.setProperty('--tickdur',Math.max(20,Math.round(w/${TICKER_PX_PER_SECOND}))+'s');
  }
  function apply(){
    if(mq.matches){ t.classList.remove('run'); t.classList.remove('paused'); }
    else { t.classList.add('run'); }
  }
  if(pz){
    pz.addEventListener('click',function(){
      var paused=t.classList.toggle('paused');
      pz.setAttribute('aria-pressed',String(paused));
      pz.textContent=paused?'Play':'Pause';
    });
  }
  measure(); apply();
  if(mq.addEventListener) mq.addEventListener('change',apply);
  window.addEventListener('resize',measure);
})();
`;

// ---------------------------------------------------------------- the reading

// Every source is a single KV read of a capped list. No fan-out, no scan, no
// per-corner lookup: the homepage is the most-loaded page on the site and a row
// under the masthead must not cost more than the hero beneath it.
export async function collectTicker(env, deps) {
  const {
    getPressRecent, getActorCosts, getWatchlist, getJournal, getCotdLog,
    exaBudget, actorRunBudget, watchlistVersion,
  } = deps;

  const [pressRecent, actorCosts, watchlist, journal, cotd, exa, apify] = await Promise.all([
    getPressRecent(env).catch(() => []),
    getActorCosts(env).catch(() => []),
    getWatchlist(env, watchlistVersion).catch(() => null),
    getJournal(env).catch(() => []),
    getCotdLog(env).catch(() => []),
    exaBudget(env).catch(() => null),
    actorRunBudget(env).catch(() => null),
  ]);

  return buildTicker({
    pressRecent,
    actorCosts,
    watchlist,
    journal,
    cotd,
    exa: exa ? { ...exa, reached: exa.exhausted, paused: exa.exhausted } : null,
    apify,
  });
}
