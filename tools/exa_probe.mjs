// What plan an Exa key is on, without ever showing the key.
//
// It cannot tell you the account. The API does not report one, and the price
// of a contents-free search identifies a plan tier only: any number of
// workspaces can sit on the same tier and bill identically. Reading this
// output as an account identification is exactly the mistake that ran a batch
// against a workspace nobody had confirmed. Only a human watching a specific
// dashboard move after a known call identifies the account.
//
//   node tools/exa_probe.mjs
import { readFileSync } from "node:fs";
import { EXA_PLAN_PRICES, exaPlanFor } from "../src/store.js";

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
console.log("  plan tier    " + (exaPlanFor(unit) || "unknown, matches no known tier"));
console.log("  known tiers  " + Object.entries(EXA_PLAN_PRICES).map(([n, u]) => `${n} $${u}`).join(", "));
console.log("  account      not determined by price. Price identifies a tier, never a workspace.");

// The Websets endpoint is Pro only, and its refusal names the team it refused.
// That is the one place Exa's API states the account, found only because this
// pass went looking for Monitors. It corroborates a dashboard observation; it
// does not replace one, because it names the team a key belongs to and not
// what any particular call was billed against.
const w = await fetch("https://api.exa.ai/websets/v0/websets", { headers: { "x-api-key": key } });
const body = await w.json().catch(() => null);
const team = /your team \(([^)]+)\)/i.exec(String(body?.message || ""));
console.log("  team         " + (team ? team[1] : "not stated by the API"));
