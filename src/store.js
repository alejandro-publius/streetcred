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
// the weights or REFERENCE_MAX invalidates it rather than serving a stale grade.
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

// ---------------------------------------------------------------- share card

// The 1200x630 preview, composited offline and uploaded, because a Worker has
// no image library and the alternative would be shipping a WASM codec to draw
// two lines of text. Absent for a corner nobody has warmed, which is why the
// route falls back to the plain Street View frame.
export async function getShareCard(env, slug) {
  return rawGet(env, `og:${slug}`, "arrayBuffer");
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
