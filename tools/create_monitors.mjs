// Create the standing Exa Monitors that feed the radar.
//
//   node tools/create_monitors.mjs --dry
//   node tools/create_monitors.mjs --secret-from-env
//
// The webhook secret is never passed on the command line and never read from
// a file this tool prints. It comes from the environment:
//
//   read -rs WEBHOOK_SECRET && export WEBHOOK_SECRET && node tools/create_monitors.mjs
//
// Monitors are created once and their ids stored in KV. The webhook refuses
// any payload naming a monitor id it did not create, so this list is the
// second half of the authentication.
import { kvEnv, devVar } from "./lib/kvenv.mjs";
import { getRankPage } from "../src/city.js";
import { worstCorridors, corridorQuery, META_QUERIES, CORRIDOR_LIMIT } from "../src/radar.js";
import { getMonitors, putMonitors } from "../src/store.js";

const ROOT = new URL("..", import.meta.url).pathname;
const HOST = "https://streetcred.thealexschroeder.workers.dev";
const DRY = process.argv.includes("--dry");
const log = (s) => console.log(s);

const env = kvEnv(ROOT, { EXA_API_KEY: devVar(ROOT, "EXA_API_KEY") });

const secret = process.env.WEBHOOK_SECRET;
if (!secret && !DRY) {
  console.log("WEBHOOK_SECRET is not in the environment.");
  console.log("run:  read -rs WEBHOOK_SECRET && export WEBHOOK_SECRET && node tools/create_monitors.mjs");
  process.exit(1);
}

// Corridors are derived from the rank, not asserted. A street's weight is the
// sum of its corners' points, so a long arterial with many bad crossings
// outranks one notorious intersection, which is the right unit for a query
// about a street.
const rows = [];
for (let page = 1; page <= 12; page += 1) {
  const p = await getRankPage(env, page);
  if (!p?.rows?.length) break;
  rows.push(...p.rows);
}
const corridors = worstCorridors(rows, CORRIDOR_LIMIT);
log(`${rows.length} ranked corners read, ${corridors.length} corridors selected`);

const plan = [
  ...corridors.map((c) => ({ kind: "corridor", corridor: c.street, query: corridorQuery(c.street), corners: c.corners })),
  ...META_QUERIES.map((q) => ({ kind: "meta", corridor: "citywide", query: q })),
];

for (const m of plan) log(`  ${m.kind.padEnd(9)} ${m.query}${m.corners ? `  (${m.corners} corners)` : ""}`);
if (DRY) { log(`\n${plan.length} monitors would be created. Nothing was.`); process.exit(0); }

const existing = await getMonitors(env);
if (existing?.list?.length) {
  log(`\n${existing.list.length} monitors already exist. Delete them first if you mean to replace them.`);
  process.exit(0);
}

const url = `${HOST}/api/radar/hook/${secret}`;
const list = [];
for (const m of plan) {
  const r = await fetch("https://api.exa.ai/monitors", {
    method: "POST",
    headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      name: `streetcred ${m.kind} ${m.corridor}`.slice(0, 60),
      search: { query: m.query, numResults: 5 },
      webhook: { url },
      metadata: { corridor: m.corridor, kind: m.kind },
    }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    log(`  FAILED ${m.query}: ${r.status} ${JSON.stringify(d).slice(0, 160)}`);
    continue;
  }
  const id = d?.id || d?.monitorId || d?.data?.id;
  if (!id) { log(`  no id returned for ${m.query}: ${JSON.stringify(d).slice(0, 160)}`); continue; }
  list.push({ id, query: m.query, corridor: m.corridor, kind: m.kind, createdAt: new Date().toISOString() });
  log(`  created ${id}  ${m.query}`);
}

await putMonitors(env, { version: "v1", createdAt: new Date().toISOString(), list });
log(`\n${list.length} monitors stored. The webhook accepts these ids and no others.`);
