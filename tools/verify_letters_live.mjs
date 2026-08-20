// Five random corners, checked against the live site.
//
// The question is narrow and it is not "did the tool run". It is whether a
// visitor loading a corner page gets that corner's stored letter, addressed to
// that corner's actual representative, from the server rather than from a model
// call made while they wait.
//
//   node tools/verify_letters_live.mjs
//   node tools/verify_letters_live.mjs --n=5 --seed=7
//
// Read only. Every request is a GET against the free Worker and none of them
// can cause a draft: the letter lane serves stored records or the pending state.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPERVISORS, FALLBACK_OFFICIAL } from "../src/data.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(ROOT, "scratch", "letters");
const ORIGIN = (process.env.STREETCRED_ORIGIN || "https://streetcred.thealexschroeder.workers.dev").replace(/\/$/, "");

const arg = (n, d) => {
  const h = process.argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const N = Number(arg("n", 5));
const SEED = Number(arg("seed", Date.now() % 100000));

// Deterministic shuffle, so a run that finds a problem can be repeated exactly.
function pick(list, n, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const staged = readdirSync(STAGE)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_") && !f.startsWith(".") && !f.includes(".pending."))
  .map((f) => f.replace(/\.json$/, ""));

if (!staged.length) {
  console.log("no staged letters to verify");
  process.exit(0);
}

const chosen = pick(staged, Math.min(N, staged.length), SEED);
console.log(`origin: ${ORIGIN}`);
console.log(`seed:   ${SEED}\n`);

const known = new Set(Object.values(SUPERVISORS));
let bad = 0;

for (const slug of chosen) {
  const local = JSON.parse(readFileSync(join(STAGE, `${slug}.json`), "utf8"));
  const row = { slug, expected: local.supervisor };

  // 1. The API the page's letter lane reads.
  const api = await fetch(`${ORIGIN}/api/letter?x=${slug}`).then((r) => r.json()).catch(() => null);
  row.source = api?.source ?? "unreachable";
  row.served = Boolean(api?.text);
  row.matchesStored = api?.text?.trim() === local.text.trim();

  // 2. The salutation actually on the served letter. "Dear" is optional: a
  // letter may open "Supervisor Dorsey," and four of the first 116 did. Reading
  // only the Dear form reported those as having no addressee and failed them
  // for a letter that named the right person.
  const m =
    (api?.text || "").match(/^\s*Dear\s+([^,\n]+?)\s*[,:]/m) ||
    (api?.text || "").match(/^[ \t]*((?:Supervisor|Mayor)\s+[^,\n]+?)\s*[,:][ \t]*$/m);
  row.salutation = m ? m[1] : null;
  row.namedIsReal = m
    ? /^Supervisor\s/.test(m[1])
      ? [...known].some((n) => n.split(" ").slice(-1)[0] === m[1].split(" ").slice(-1)[0])
      : m[1] === FALLBACK_OFFICIAL
    : false;
  row.supervisorMatches = api?.supervisor === local.supervisor;

  // 3. The corner page itself: is the letter in the server HTML, or does the
  // page still have to go and fetch it?
  const html = await fetch(`${ORIGIN}/c/${slug}`).then((r) => r.text()).catch(() => "");
  const panel = html.slice(html.indexOf('class="letter" id="letter"'), html.indexOf('class="lfoot"'));
  row.inServerHtml = panel.includes(local.text.split("\n")[0].slice(0, 40));

  const ok = row.served && row.matchesStored && row.namedIsReal && row.supervisorMatches && row.inServerHtml;
  if (!ok) bad += 1;

  console.log(`${ok ? "PASS" : "FAIL"}  ${slug}`);
  console.log(`      source in api      : ${row.source}`);
  console.log(`      salutation         : ${row.salutation}`);
  console.log(`      expected supervisor: ${row.expected}`);
  console.log(`      names a real rep   : ${row.namedIsReal}`);
  console.log(`      text matches stored: ${row.matchesStored}`);
  console.log(`      in server HTML     : ${row.inServerHtml}`);
  console.log();
}

console.log(`${chosen.length - bad} of ${chosen.length} corners verified live`);
process.exit(bad ? 1 : 0);
