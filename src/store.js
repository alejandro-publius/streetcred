// Durable store for everything arbitrary-corner support needs to remember:
// resolved corners, generated imagery, the daily generation budget, and resolve
// rate limiting.
//
// KV rather than the edge cache, because two of these protect money. The edge
// cache is per-colo and evictable, so a "global" daily cap enforced there would
// really be one cap per data center, quietly multiplying spend by the number of
// colos serving traffic. KV is eventually consistent, so the cap is approximate
// at the margin under a burst, but it is genuinely global and it survives
// isolate recycling.

// Ceiling on newly generated corners per day. Each corner costs two Gemini image
// calls, so 25 corners is 50 billed generations. Picked to keep a bad day cheap
// while leaving room for real traffic; raise it once there is a billing alert
// worth trusting.
export const DAILY_GENERATION_CAP = 25;

// Resolve attempts allowed per IP per window. Generous for a person exploring
// corners, useless for a crawler trying to burn the image budget.
const RATE_LIMIT = 20;
const RATE_WINDOW_SEC = 600;

// Fallback when no KV binding exists, so local dev and a misconfigured deploy
// degrade instead of erroring. Per-isolate and therefore not a real store: the
// caller is told so via `durable`.
const memory = new Map();

const hasKV = (env) => Boolean(env && env.STORE);

async function rawGet(env, key, type = "text") {
  if (hasKV(env)) return env.STORE.get(key, type);
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expires && Date.now() > hit.expires) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

async function rawPut(env, key, value, ttlSec) {
  if (hasKV(env)) {
    const opts = ttlSec ? { expirationTtl: Math.max(60, ttlSec) } : {};
    return env.STORE.put(key, value, opts);
  }
  memory.set(key, { value, expires: ttlSec ? Date.now() + ttlSec * 1000 : null });
}

export const isDurable = (env) => hasKV(env);

// ---------------------------------------------------------------- corners

// No TTL. A corner's geometry does not change, and re-geocoding is the step that
// leads to re-generating imagery, which is the step that costs money.
export async function getCorner(env, slug) {
  const raw = await rawGet(env, `corner:${slug}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putCorner(env, corner) {
  await rawPut(env, `corner:${corner.slug}`, JSON.stringify(corner));
}

// ---------------------------------------------------------------- score

// No TTL. A Danger Index is computed once per corner and then holds still,
// because a grade that drifts between page loads is a grade nobody can cite.
// The stored record carries the version it was computed under, so a change to
// the weights or the frozen distribution invalidates it rather than serving a
// stale grade.
export async function getScore(env, slug, version) {
  const raw = await rawGet(env, `score:${slug}`);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s.version === version ? s : null;
  } catch {
    return null;
  }
}

export async function putScore(env, slug, score) {
  await rawPut(env, `score:${slug}`, JSON.stringify(score));
}

// ---------------------------------------------------------------- hazards

// Corroboration is expensive once (one model call plus five DataSF queries) and
// free forever after, so it is stored like the score is.
export async function getHazards(env, slug, version) {
  const raw = await rawGet(env, `hazards:${slug}`);
  if (!raw) return null;
  try {
    const h = JSON.parse(raw);
    return h.version === version ? h : null;
  } catch {
    return null;
  }
}

export async function putHazards(env, slug, hazards) {
  await rawPut(env, `hazards:${slug}`, JSON.stringify(hazards));
}

// ---------------------------------------------------------------- cred

export async function getCredCached(env, slug, version) {
  const raw = await rawGet(env, `cred:${slug}`);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    return c.version === version ? c : null;
  } catch {
    return null;
  }
}

export async function putCredCached(env, slug, cred) {
  await rawPut(env, `cred:${slug}`, JSON.stringify(cred));
}

// ---------------------------------------------------------------- leaderboard

// The ranked corner list the city view reads. Written by
// tools/precompute_hin.js, so the homepage costs one KV read rather than
// twenty score lookups.
export async function getHinList(env) {
  const raw = await rawGet(env, "hin:list");
  if (!raw) return [];
  try {
    const d = JSON.parse(raw);
    return Array.isArray(d) ? d : d.corners || [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- corner of the day

// The queue the scheduled handler eats from, and the log of what it has done.
// Both are plain KV lists rather than anything cleverer, because the whole
// feature is one corner a day and the interesting property is that it keeps
// happening without anyone present.
export async function getQueue(env) {
  const raw = await rawGet(env, "cotd:queue");
  if (!raw) return null;
  try {
    const q = JSON.parse(raw);
    return Array.isArray(q) ? q : null;
  } catch {
    return null;
  }
}

export async function putQueue(env, queue) {
  await rawPut(env, "cotd:queue", JSON.stringify(queue));
}

export async function getCotdLog(env) {
  const raw = await rawGet(env, "cotd:log");
  if (!raw) return [];
  try {
    const l = JSON.parse(raw);
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

export async function appendCotdLog(env, entry) {
  const log = await getCotdLog(env);
  log.push(entry);
  // Newest last, trimmed to a season. A streak nobody can see is not a streak,
  // but neither is one that needs a scrollbar.
  await rawPut(env, "cotd:log", JSON.stringify(log.slice(-120)));
  return log;
}

// ---------------------------------------------------------------- timeline

// Ceiling on newly built press timelines per day. Each one costs about a dozen
// Exa searches, so this lane can burn credits far faster than the single search
// the panel makes. Same discipline as the image budget: reject before spending,
// globally, in KV rather than the per-colo edge cache.
export const DAILY_TIMELINE_CAP = 40;

const dayKey = () => new Date().toISOString().slice(0, 10);

export async function getTimeline(env, slug, version) {
  const raw = await rawGet(env, `timeline:${slug}`);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw);
    return t.version === version ? t : null;
  } catch {
    return null;
  }
}

// No TTL. A year that had coverage will always have had coverage, so this is a
// record rather than a cache, and rebuilding it would spend a dozen searches to
// re-learn history that did not change.
export async function putTimeline(env, slug, timeline) {
  await rawPut(env, `timeline:${slug}`, JSON.stringify(timeline));
}

export async function timelineBudget(env) {
  const key = `timelines:${dayKey()}`;
  const used = parseInt((await rawGet(env, key)) || "0", 10) || 0;
  return { used, cap: DAILY_TIMELINE_CAP, remaining: Math.max(0, DAILY_TIMELINE_CAP - used) };
}

export async function reserveTimeline(env) {
  const key = `timelines:${dayKey()}`;
  const used = parseInt((await rawGet(env, key)) || "0", 10) || 0;
  if (used >= DAILY_TIMELINE_CAP) return false;
  await rawPut(env, key, String(used + 1), 3 * 24 * 3600);
  return true;
}

// One findSimilar lead for the whole board, not one per corner. It is a
// suggestion about the city, it costs an Exa call plus a few DataSF lookups to
// build, and it changes only when the top corner's coverage changes.
export async function getSuggestion(env, version) {
  const raw = await rawGet(env, "suggest:board");
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s.version === version ? s : null;
  } catch {
    return null;
  }
}

export async function putSuggestion(env, suggestion) {
  // A day. Long enough that it is not rebuilt on every homepage load, short
  // enough that it follows the news rather than freezing on one week's story.
  await rawPut(env, "suggest:board", JSON.stringify(suggestion), 24 * 3600);
}

// ---------------------------------------------------------------- run manifest

// What each tool actually did on this corner's last run. No TTL: it is a record
// of an event that happened, not a cache of something recomputable, and it is
// what the replay animates. Overwritten only by a later real run.
export async function getRun(env, slug) {
  const raw = await rawGet(env, `run:${slug}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putRun(env, slug, manifest) {
  await rawPut(env, `run:${slug}`, JSON.stringify(manifest));
}

// Written at the moment a letter is actually drafted, which is the only moment
// anything truthful can be said about it. The Worker cannot fetch its own
// endpoints, and regenerating a letter to find out when it was generated would
// cost a billed model call to answer a question about the past.
export async function getLetterRun(env, slug) {
  const raw = await rawGet(env, `letterrun:${slug}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putLetterRun(env, slug, record) {
  await rawPut(env, `letterrun:${slug}`, JSON.stringify(record));
}

// Apify counts are backfilled offline by tools/backfill_apify.js reading the
// stored datasets, never by the Worker at request time. A scrape takes minutes
// and a page load cannot wait on one, and re-scraping to count what was already
// scraped would be spending money to learn something already on disk.
export async function getApifyCounts(env, slug) {
  const raw = await rawGet(env, `apify:${slug}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Written by the cron when it audits a corner overnight, so the board is
// current by morning without a human running the precompute tool.
export async function putHinList(env, corners) {
  await rawPut(env, "hin:list", JSON.stringify({ built: new Date().toISOString(), corners }));
}

// ---------------------------------------------------------------- share card

// The 1200x630 preview, composited offline and uploaded, because a Worker has
// no image library and the alternative would be shipping a WASM codec to draw
// two lines of text. Absent for a corner nobody has warmed, which is why the
// route falls back to the plain Street View frame.
export async function getShareCard(env, slug) {
  return rawGet(env, `og:${slug}`, "arrayBuffer");
}

// The write half, which did not exist. og:{slug} was only ever written by
// tools/make_og.py through the wrangler CLI, so a corner resolved at runtime
// could never receive a composited card: the Worker had a reader for a key
// nothing inside the Worker could produce. Cards for new corners can now be
// written by whatever composites them next; until one lands, shareCard() keeps
// falling back to the plain Street View frame, which is a worse card but an
// honest one.
export async function putShareCard(env, slug, bytes) {
  await rawPut(env, `og:${slug}`, bytes);
}

// ---------------------------------------------------------------- imagery

const imgKey = (slug, state) => `img:${slug}:${state}`;

export async function getImage(env, slug, state) {
  return rawGet(env, imgKey(slug, state), "arrayBuffer");
}

export async function putImage(env, slug, state, bytes) {
  await rawPut(env, imgKey(slug, state), bytes);
}

// Records which states exist for a corner and whether generation finished,
// failed, or is still running, so a poll can answer without touching the blobs.
export async function getImageryStatus(env, slug) {
  const raw = await rawGet(env, `imgstatus:${slug}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putImageryStatus(env, slug, status) {
  // A short TTL on "pending" only, so a generation killed mid-flight by an
  // isolate eviction cannot pin a corner as pending forever.
  const ttl = status.status === "pending" ? 300 : 0;
  await rawPut(env, `imgstatus:${slug}`, JSON.stringify(status), ttl);
}

// ---------------------------------------------------------------- budget

const today = () => new Date().toISOString().slice(0, 10);

export async function generationBudget(env) {
  const used = parseInt((await rawGet(env, `gen:${today()}`)) || "0", 10) || 0;
  return { used, cap: DAILY_GENERATION_CAP, remaining: Math.max(0, DAILY_GENERATION_CAP - used) };
}

// Reserve before generating, not after. Read-modify-write on an eventually
// consistent store can undercount a simultaneous burst; that is acceptable for a
// spend ceiling and is why the cap sits well below the pain threshold.
export async function reserveGeneration(env) {
  const key = `gen:${today()}`;
  const used = parseInt((await rawGet(env, key)) || "0", 10) || 0;
  if (used >= DAILY_GENERATION_CAP) return false;
  // Two days, so a counter written just before midnight cannot linger a week.
  await rawPut(env, key, String(used + 1), 48 * 3600);
  return true;
}

// ---------------------------------------------------------------- trust

// The last letter that passed verification at this corner, kept so a corner
// whose regeneration keeps failing can still serve something true. Stale and
// verified beats fresh and unsourced: a reader forwarding a letter to their
// Supervisor is better served by last week's accurate figures than by this
// morning's invented ones.
export async function getVerifiedLetter(env, slug) {
  const raw = await rawGet(env, `letter:verified:${slug}`);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function putVerifiedLetter(env, slug, rec) {
  await rawPut(env, `letter:verified:${slug}`, JSON.stringify(rec));
}

// Every time a draft failed verification twice. This is the number that tells
// you whether the model is drifting, and it is kept whether or not anyone is
// looking, because a rail with no telemetry is a rail nobody can audit.
export async function appendTrustIncident(env, incident) {
  const raw = await rawGet(env, "trust:incidents");
  let log = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    log = Array.isArray(parsed) ? parsed : [];
  } catch {
    log = [];
  }
  log.unshift(incident);
  await rawPut(env, "trust:incidents", JSON.stringify(log.slice(0, 200)));
  return log.length;
}

export async function getTrustIncidents(env) {
  const raw = await rawGet(env, "trust:incidents");
  try {
    const l = raw ? JSON.parse(raw) : [];
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- watchdog

// Everything the Corner Watchdog writes lives under agent:, so the whole
// surface an outside system can touch is one prefix and can be listed, audited
// or dropped in one operation. Nothing here shares a key with a lane the site
// computes for itself: an agent must never be able to overwrite StreetCred's
// own score, letter or imagery, only to publish its parallel claim beside them.

export async function getJournal(env) {
  const raw = await rawGet(env, "agent:journal");
  if (!raw) return [];
  try {
    const l = JSON.parse(raw);
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

export async function appendJournal(env, entry, cap = 300) {
  const log = await getJournal(env);
  // Newest first, because the diary is read from the top and the interesting
  // entry is always this morning's.
  log.unshift(entry);
  const trimmed = log.slice(0, cap);
  await rawPut(env, "agent:journal", JSON.stringify(trimmed));
  return { count: trimmed.length };
}

export async function putAgentRescore(env, rec) {
  await rawPut(env, `agent:rescore:${rec.slug}`, JSON.stringify(rec));
}

export async function getAgentRescore(env, slug) {
  const raw = await rawGet(env, `agent:rescore:${slug}`);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function putAgentLetter(env, rec) {
  await rawPut(env, `agent:letter:${rec.slug}`, JSON.stringify(rec));
}

export async function getAgentLetter(env, slug) {
  const raw = await rawGet(env, `agent:letter:${slug}`);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function putAgentFlag(env, rec) {
  await rawPut(env, `agent:flag:${rec.slug}`, JSON.stringify(rec));
}

export async function getAgentFlag(env, slug) {
  const raw = await rawGet(env, `agent:flag:${slug}`);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The only thing a failed authentication is allowed to leave behind. Counted so
// the page can say "N rejected" without recording who, when or with what.
export async function countAgentReject(env) {
  const used = parseInt((await rawGet(env, "agent:rejects")) || "0", 10) || 0;
  await rawPut(env, "agent:rejects", String(used + 1));
}

export async function getAgentRejects(env) {
  return parseInt((await rawGet(env, "agent:rejects")) || "0", 10) || 0;
}

// ---------------------------------------------------------------- rate limit

export async function rateLimit(env, ip) {
  if (!ip) return { allowed: true, remaining: RATE_LIMIT };
  const window = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC);
  const key = `rl:${ip}:${window}`;
  const used = parseInt((await rawGet(env, key)) || "0", 10) || 0;
  if (used >= RATE_LIMIT) return { allowed: false, remaining: 0 };
  await rawPut(env, key, String(used + 1), RATE_WINDOW_SEC);
  return { allowed: true, remaining: RATE_LIMIT - used - 1 };
}
