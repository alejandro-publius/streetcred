// The normalizer behind the visual-regression-lite harness.
//
// A byte diff of a live page is useless here. The press burn moves spend and
// corner counts every few minutes, the synthetic monitor adds a bar every hour,
// the corner of the day rotates every morning, and the audited roster grows.
// A harness that shouts every run is a harness nobody reads by Wednesday, which
// is worse than no harness at all.
//
// So every volatile value is replaced by a token that keeps its SHAPE and drops
// its VALUE. A four-digit count stays a four-digit count. That makes a number
// changing invisible and a number appearing, disappearing or changing magnitude
// loud, which is the split we actually want: data drifts, markup should not.
//
// Two rules keep it honest.
//
// 1. Whatever is not recognised as volatile is left literal. An unrecognised
//    moving part therefore fails LOUD, as a diff a human has to read, not
//    silently. Wrong in the safe direction.
// 2. <style>, <pre> and <code> are never touched. Those are the densest
//    constant surfaces on this site: the generated CSS in src/page.js, and the
//    quoted formula and 311 allow list on /methodology. A code block here is
//    quoted source, and quoted source that drifts is exactly the change this
//    harness exists to catch.
//
// Both tools import this file, so the snapshotter and the differ cannot
// disagree about what a snapshot is.

export const ORIGIN = "https://streetcred.thealexschroeder.workers.dev";

// The five pages. Between them they cover every rendering path that carries a
// number: the hero and the map and the board, a full corner page, the two
// operations pages, and the one page that is nearly all prose.
export const PAGES = [
  { file: "home.txt", path: "/", label: "homepage" },
  { file: "corner-16th-mission.txt", path: "/c/16th-mission", label: "corner page" },
  { file: "status.txt", path: "/status", label: "status" },
  { file: "radar.txt", path: "/radar", label: "radar" },
  { file: "methodology.txt", path: "/methodology", label: "methodology" },
];

// ---------------------------------------------------------------------------
// Parking
//
// Rules run in sequence over one string, so a token an early rule emits is in
// the way of every later rule. Emitted tokens are parked behind a letters-only
// placeholder and restored at the end. Letters only, because a placeholder
// carrying a digit would be eaten by the integer rule.
// ---------------------------------------------------------------------------

const MARK = "\u0001";
const letters = (n) => {
  let s = "";
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  } while (n > 0);
  return s;
};
const makeLot = () => {
  const held = [];
  return {
    park: (v) => `${MARK}${letters(held.push(v) - 1)}${MARK}`,
    restore: (s) => s.replace(new RegExp(`${MARK}([a-z]+)${MARK}`, "g"), (m, k) => held[decode(k)]),
  };
};
const decode = (k) => k.split("").reduce((a, c) => a * 26 + (c.charCodeAt(0) - 97), 0);

// ---------------------------------------------------------------------------
// Skeletons
//
// A skeleton is markup with its identity removed: tag names and class values
// survive, every other attribute value and every run of text does not. It is
// what a collapsed region is replaced by, so that a template edit inside a
// growing list is still visible while the list growing is not.
// ---------------------------------------------------------------------------

export function skeleton(fragment) {
  return String(fragment)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/([a-zA-Z][\w:-]*)\s*>/g, (m, tag) => `[/${tag.toLowerCase()}]`)
    .replace(/<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g, (m, tag, attrs, slash) => {
      const parts = [];
      const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
      let a;
      while ((a = re.exec(attrs))) {
        const name = a[1].toLowerCase();
        const value = a[2] ?? a[3] ?? a[4];
        if (value === undefined) parts.push(name);
        // The grade letter is identity, not structure: the corner of the day is
        // a D today and an F tomorrow with nothing in the repo changed.
        else if (name === "class") parts.push(`class="${value.replace(/\bg([ABCDF])\b/g, "g*")}"`);
        else parts.push(`${name}=*`);
      }
      return `[${tag.toLowerCase()}${parts.length ? " " + parts.join(" ") : ""}${slash ? " /" : ""}]`;
    })
    .replace(/\]([^[\]]*[^\s[\]])\s*(?=\[)/g, "]{t}")
    .replace(/\]([^[\]]*[^\s[\]])\s*$/, "]{t}")
    .replace(/\s+/g, " ")
    .trim();
}

// A digit count, not a digit. 24 audited corners and 25 audited corners are the
// same token; 24 and 4 are not, because losing twenty corners is a real event.
const shapeInt = (digits) => `{N${String(digits).replace(/[^0-9]/g, "").length}}`;

function runToken(selector, run, itemRe) {
  const items = run.match(itemRe) || [];
  // Sorted, so that a failing bar moving from the middle of the strip to the
  // front is not reported as a change. Which shapes are present is the signal.
  const shapes = [...new Set(items.map(skeleton))].sort();
  const body = shapes.length === 1 ? shapes[0] : shapes.map((s, i) => `#${i + 1} ${s}`).join(" | ");
  return `{RUN ${selector} n=${shapeInt(items.length)} ${body}}`;
}

// ---------------------------------------------------------------------------
// Region rules
//
// Each one collapses a list that grows on its own schedule. They are matched by
// class, because class is the only stable handle the rendered page offers. A
// region that stops matching is not silently dropped: it simply stops being
// collapsed, and the next diff asks about it.
// ---------------------------------------------------------------------------

export const REGION_RULES = [
  {
    name: "corner-of-the-day",
    why: "the hero card rotates every morning: name, slug, grade, image srcs, alt text and audit date all move at once",
    re: /<section class="herocorner"[^>]*>[\s\S]*?<\/section>/g,
    render: (m) => `{COTD ${skeleton(m)}}`,
  },
  {
    name: "audited-roster-js",
    why: "var AUDITED on the homepage is the JSON roster behind the map, and the morning run appends to it",
    re: /var AUDITED = \[[\s\S]*?\];/g,
    render: (m) => `var AUDITED = {JSON-ARRAY items=${shapeInt((m.match(/"slug":/g) || []).length)}};`,
  },
  {
    name: "map-pins",
    why: "one anchor per audited corner, so the run lengthens every morning; the left/top percentages are layout, not measurement",
    re: /(?:<a class="pin"[^>]*>[^<]*<\/a>\s*){2,}/g,
    render: (m) => runToken("a.pin", m, /<a class="pin"[^>]*>[^<]*<\/a>/g),
  },
  {
    name: "audit-log-chips",
    why: "the a.cotdi chips under the ops band are one per unattended audit and grow with the roster",
    re: /(?:<a class="cotdi"[^>]*>[\s\S]*?<\/a>\s*){2,}/g,
    render: (m) => runToken("a.cotdi", m, /<a class="cotdi"[^>]*>[\s\S]*?<\/a>/g),
  },
  {
    name: "uptime-bars",
    why: "one i per synthetic run, appended hourly, each carrying its own run time in a title",
    re: /(?:<i class="(?:ok|bad|warn|fail|down)"[^>]*><\/i>\s*){2,}/g,
    render: (m) => runToken("i.bar", m, /<i class="[^"]*"[^>]*><\/i>/g),
  },
  {
    name: "per-corner-srows",
    why: "the Apify ledger and the recent-grade-changes list on /status are both div.srow rows carrying a /c/ link, and both grow whenever the morning run does anything",
    re: /(?:<div class="srow"><span class="ep"><a href="\/c\/[\s\S]*?<\/div>\s*)+/g,
    render: (m) => runToken("div.srow[corner]", m, /<div class="srow">[\s\S]*?<\/div>/g),
  },
];

// ---------------------------------------------------------------------------
// Value rules
//
// Applied only to text nodes and to the four attributes that carry prose:
// title, alt, content, aria-label. Never to class, id, href, src, style, or to
// SVG coordinates, because those are structure and a change in them is the
// thing being looked for.
//
// Order matters. The longest and most specific pattern has to win before a
// shorter one eats half of it.
// ---------------------------------------------------------------------------

const MON = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

export const VALUE_RULES = [
  {
    name: "iso-timestamp",
    why: "full ISO instants move on every write",
    re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?/g,
    to: () => "{TS}",
  },
  {
    name: "iso-date",
    why: "audit dates, ledger dates and grade-change dates roll over daily",
    re: /\b\d{4}-\d{2}-\d{2}\b/g,
    to: () => "{DATE}",
  },
  {
    name: "iso-month",
    why: "the Exa and Apify budget lines are labelled by billing month",
    re: /\b\d{4}-\d{2}\b/g,
    to: () => "{MONTH}",
  },
  {
    name: "short-date",
    why: "the audit-log chips print MM-DD",
    re: /\b\d{2}-\d{2}\b/g,
    to: () => "{MMDD}",
  },
  {
    name: "human-datetime",
    why: '"Last reported Aug 19, 10:46 PM" moves while the press burn runs',
    re: new RegExp(`\\b(?:${MON})[a-z]* \\d{1,2}, \\d{1,2}:\\d{2}\\s?(?:AM|PM)\\b`, "g"),
    to: () => "{WHEN}",
  },
  {
    name: "human-date",
    why: "run headings and the footer build line print a written date",
    re: new RegExp(`\\b(?:${MON})[a-z]* \\d{1,2}(?:,? \\d{4})?\\b`, "g"),
    to: () => "{DAY}",
  },
  {
    name: "money",
    why: "every ledger figure on /status moves while a run is in flight",
    re: /\$\d[\d,]*(?:\.\d+)?/g,
    to: (m) => {
      const [int, dec = ""] = m.slice(1).split(".");
      return `{$${int.replace(/,/g, "").length}.${dec.length}}`;
    },
  },
  {
    name: "milliseconds",
    why: "the synthetic monitor prints a fresh latency per endpoint every hour",
    re: /\b\d+(?:\.\d+)?\s?ms\b/g,
    to: () => "{MS}",
  },
  {
    name: "seconds",
    why: "the letter-timeout incident note quotes a measured duration",
    re: /\b\d+(?:\.\d+)?\s?seconds?\b/g,
    to: () => "{SECS}",
  },
  {
    name: "cents",
    why: "the radar prints today's spend and its cap in cents",
    re: /\b\d+(?:\.\d+)?\s?(?:c\b|cents?\b)/g,
    to: () => "{CENTS}",
  },
  {
    name: "percent",
    why: "uptime and press coverage are both live rates",
    re: /\b\d+(?:\.\d+)?%/g,
    to: (m) => {
      const [int, dec = ""] = m.slice(0, -1).split(".");
      return `{%${int.length}.${dec.length}}`;
    },
  },
  {
    name: "percent-word",
    why: 'the grade sentence says "worse than 93 percent"',
    re: /\b\d+ percent\b/g,
    to: () => "{PCTW}",
  },
  {
    name: "grouped-count",
    why: "the masthead and census counters are the ones that grow: 7,355 scored, 8,254 crossings",
    re: /\b\d{1,3}(?:,\d{3})+\b/g,
    to: (m) => shapeInt(m),
  },
  {
    name: "decimal",
    why: "medians, points and index values are decimals recomputed from live data",
    re: /\b\d+\.\d+\b/g,
    to: (m) => {
      const [int, dec] = m.split(".");
      return `{N${int.length}.${dec.length}}`;
    },
  },
  {
    name: "integer",
    why: "the catch-all for counters: corners checked, chunks, runs, monitors, collisions, 311 reports",
    re: /\b\d+\b/g,
    to: (m) => shapeInt(m),
  },
];

const PROSE_ATTRS = new Set(["title", "alt", "content", "aria-label"]);

function applyValueRules(text, lot) {
  // HTML numeric entities are markup, not measurement. Park them first.
  let s = text.replace(/&#\d+;/g, (m) => lot.park(m));
  for (const rule of VALUE_RULES) s = s.replace(rule.re, (m) => lot.park(rule.to(m)));
  return s;
}

function normalizeTag(tag, lot) {
  return tag.replace(/([^\s=<>/]+)\s*=\s*"([^"]*)"/g, (m, name, value) =>
    PROSE_ATTRS.has(name.toLowerCase()) ? `${name}="${applyValueRules(value, lot)}"` : m
  );
}

// ---------------------------------------------------------------------------

const RAW_BLOCK = /<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;

export function normalize(html) {
  const lot = makeLot();
  let doc = String(html).replace(/\r\n/g, "\n");

  // Regions first: they read real markup, and their output is parked whole so
  // no value rule can chew on a skeleton.
  for (const rule of REGION_RULES) doc = doc.replace(rule.re, (m) => lot.park(rule.render(m)));

  // Split into raw blocks, left alone entirely, and everything else.
  const out = [];
  let last = 0;
  RAW_BLOCK.lastIndex = 0;
  let m;
  while ((m = RAW_BLOCK.exec(doc))) {
    out.push(markup(doc.slice(last, m.index), lot));
    out.push(m[0]);
    last = m.index + m[0].length;
  }
  out.push(markup(doc.slice(last), lot));

  // One tag or one run of text per line. The diff reads far better for it, and
  // section attribution needs headings on lines of their own.
  return lot
    .restore(out.join(""))
    .replace(/</g, "\n<")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length)
    .join("\n");
}

function markup(chunk, lot) {
  return chunk
    .replace(COMMENT, "")
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith("<") && part.endsWith(">") ? normalizeTag(part, lot) : applyValueRules(part, lot)))
    .join("");
}

// The section a changed line belongs to, for the diff report. Headings survive
// normalization as ordinary text, so the last one seen is the right answer.
export function sectionsFor(lines) {
  const sections = new Array(lines.length);
  let current = "(top of page)";
  for (let i = 0; i < lines.length; i++) {
    // A heading line is "<h2 ...>Some words", because normalize only breaks
    // the line before a tag. Longer headings spill onto the lines after it.
    const h = /^<h([1-6])\b[^>]*>(.*)$/.exec(lines[i]);
    if (h) {
      const text = [h[2]];
      for (let j = i + 1; j < lines.length && j < i + 8; j++) {
        if (lines[j].startsWith("<")) break;
        text.push(lines[j]);
      }
      const title = text.join(" ").replace(/\s+/g, " ").trim();
      if (title) current = title.slice(0, 60);
    } else if (lines[i].startsWith("<section")) {
      const label = /\baria-label="([^"]{2,60})"/.exec(lines[i]);
      if (label) current = label[1];
    }
    sections[i] = current;
  }
  return sections;
}

export async function fetchPage(origin, path) {
  const res = await fetch(origin + path, {
    headers: { "user-agent": "streetcred-rendered-harness/1 (+tools/snap_rendered.mjs)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return await res.text();
}
