// Which Exa account a key belongs to, without ever showing the key.
//
// The API does not report the account. The two accounts funding this project
// are on different plans, so one contents-free search costs a different amount
// on each, and that price is the fingerprint. This prints the price and the
// account and nothing else: the key is read from .dev.vars, used once, and
// never echoed.
//
//   node tools/exa_probe.mjs
import { readFileSync } from "node:fs";
import { EXA_UNIT_PRICES, exaAccountFor } from "../src/store.js";

const ROOT = new URL("..", import.meta.url).pathname;
const varsFor = (name) => {
  let text = "";
  try { text = readFileSync(ROOT + ".dev.vars", "utf8"); } catch { return null; }
  const line = text.split("\n").find((l) => l.trim().startsWith(name + "="));
  if (!line) return null;
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
};

const key = varsFor("EXA_API_KEY");
if (!key) {
  console.log("no EXA_API_KEY in .dev.vars");
  process.exit(1);
}

const r = await fetch("https://api.exa.ai/search", {
  method: "POST",
  headers: { "x-api-key": key, "content-type": "application/json" },
  body: JSON.stringify({ query: "san francisco pedestrian safety", numResults: 1 }),
});
if (!r.ok) {
  console.log(`.dev.vars key: http ${r.status}${r.status === 401 ? " (invalid or revoked)" : ""}`);
  process.exit(1);
}
const d = await r.json();
const unit = Number(d?.costDollars?.total);
// No fingerprint, no prefix, no length. The account is the answer; the key
// stays out of every transcript this ever runs in.
console.log(".dev.vars key");
console.log("  unit price   $" + unit);
console.log("  account      " + (exaAccountFor(unit) || "unknown, matches no known plan"));
console.log("  plans        " + Object.entries(EXA_UNIT_PRICES).map(([n, u]) => `${n} $${u}`).join(", "));
