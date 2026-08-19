// Record a human dashboard observation against the Exa meter.
//
// This is the only thing in the codebase that may name the workspace being
// billed. Everything else can measure a price, and a price identifies a plan
// tier, never an account: workspaces on the same tier bill identically. The
// gate that was supposed to catch that was written as a price comparison and
// passed while a workspace's own Usage page showed no activity at all.
//
// Run it only after watching a specific workspace's dashboard move following a
// known call. The balance is optional and worth recording when it is visible,
// with one caveat: where a plan grants free monthly credits those are consumed
// first, so usage can appear while the balance stays put. Usage moving is the
// observation that counts.
//
//   node tools/exa_verify.mjs --workspace "Alex Schroeder" --balance 69.93
//   node tools/exa_verify.mjs --show
import { kvEnv } from "./lib/kvenv.mjs";
import { exaBudget, verifyExaAccount } from "../src/store.js";

const ROOT = new URL("..", import.meta.url).pathname;
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
};

const env = kvEnv(ROOT);

if (process.argv.includes("--show") || !arg("workspace")) {
  const b = await exaBudget(env);
  console.log(`period          ${b.period}`);
  console.log(`spent           $${b.spentUsd.toFixed(4)} of $${b.capUsd.toFixed(2)}`);
  console.log(`searches        ${b.searches}, ${b.contentPages} pages of contents`);
  console.log(`all time        $${b.allTimeUsd.toFixed(4)} (includes $${b.priorSpendUsd} from before this counter)`);
  console.log(`workspace       ${b.accountVerified ? b.account : "NOT CONFIRMED"}`);
  console.log(`reconciliation  ${b.reconciliation}`);
  if (!arg("workspace")) {
    console.log("");
    console.log('to confirm: node tools/exa_verify.mjs --workspace "<name>" --balance <usd>');
  }
  process.exit(0);
}

const m = await verifyExaAccount(env, { workspace: arg("workspace"), observedBalanceUsd: arg("balance") });
console.log(`confirmed: ${m.account}, observed ${m.verifiedAt}`);
if (m.observedBalanceUsd !== null) console.log(`balance at observation: $${m.observedBalanceUsd}`);
console.log("the nightly batch and tools/press_batch.mjs will spend against this workspace now");
