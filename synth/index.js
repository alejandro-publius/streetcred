// The synthetic monitor. A second, tiny Worker whose only job is to be a
// stranger: once an hour it loads the same URLs a visitor would, records what
// happened, and writes the result where /status can read it.
//
// A separate Worker rather than a cron on the main one, because a Worker
// cannot fetch its own endpoints (self-subrequests die with error 1042), and
// because a monitor that shares a blast radius with the thing it monitors
// reports "all good" precisely when both are down.

const ORIGIN = "https://streetcred.thealexschroeder.workers.dev";

// The paths a real visit exercises: the homepage, one flagship page, and the
// lanes that page fetches. Kept short; this runs 24 times a day forever.
const CHECKS = [
  "/",
  "/c/16th-mission",
  "/api/stats?x=16th-mission",
  "/api/score?x=16th-mission",
  "/api/letter?x=16th-mission",
  "/api/health",
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },

  // Manual trigger for verification, GET only, no auth: it reveals nothing a
  // visitor could not learn by loading the pages themselves.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      const entry = await run(env);
      return new Response(JSON.stringify(entry), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("streetcred-synth. GET /run to trigger one cycle.", { status: 200 });
  },
};

async function run(env) {
  const results = [];
  for (const path of CHECKS) {
    const t0 = Date.now();
    let ok = false, status = 0;
    try {
      const r = await env.SITE.fetch(ORIGIN + path, { headers: { "user-agent": "streetcred-synth" } });
      status = r.status;
      // /api/health is the one body worth reading: it reports ok:false while
      // still returning 200, and a monitor that only reads status codes would
      // call that healthy.
      if (path === "/api/health") {
        const d = await r.json().catch(() => null);
        ok = Boolean(d && d.ok);
      } else {
        ok = r.ok;
      }
    } catch {
      ok = false;
    }
    results.push({ endpoint: path, ok, status, ms: Date.now() - t0 });
  }

  const entry = { ts: new Date().toISOString(), ok: results.every((r) => r.ok), results };

  // Bounded to 7 days of hourly runs plus slack. Same KV the site uses, under
  // its own prefix.
  try {
    const raw = await env.STORE.get("synth:log");
    let log = [];
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      log = Array.isArray(parsed) ? parsed : [];
    } catch {
      log = [];
    }
    log.unshift(entry);
    await env.STORE.put("synth:log", JSON.stringify(log.slice(0, 200)));
  } catch {
    // A monitor that cannot write its log still ran its checks; the trigger
    // response carries the result either way.
  }
  return entry;
}
