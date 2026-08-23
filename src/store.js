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
import { pacificDay, pacificToday } from "./data.js";

export const DAILY_GENERATION_CAP = 25;

// Street View frames fetched per day for corners that are only scored.
//
// Publishing the whole city means 7,353 pages a crawler can walk in an
// afternoon, and each one wants the free-to-look-at-but-billed-to-fetch Street
// View frame. The audited fleet is ~130 corners and pays for itself; the other
// 7,200 must not be able to turn one crawl into a Maps invoice. Same discipline
// as the image and timeline budgets: reject before spending, from a global KV
// counter rather than the per-colo edge cache. A frame already stored is free
// and is never counted, so this ceiling only ever meets a corner nobody has
// opened before.
export const DAILY_PHOTO_CAP = 300;

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

// The stored record regardless of version. The changelog needs the outgoing
// grade at the moment a recompute replaces it, and the versioned reader above
// hides exactly that record.
export async function getScoreRaw(env, slug) {
  const raw = await rawGet(env, `score:${slug}`);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- changelog

// Every stored grade or index change, append only, newest first. A grade that
// can move with no public record of having moved is a grade nobody can cite:
// the screenshot from last week and the page today would simply disagree, and
// the reader has no way to learn which one to trust.
export async function appendChange(env, entry) {
  const raw = await rawGet(env, "changes:log");
  let log = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    log = Array.isArray(parsed) ? parsed : [];
  } catch {
    log = [];
  }
  log.unshift(entry);
  await rawPut(env, "changes:log", JSON.stringify(log.slice(0, 500)));
}

export async function getChanges(env) {
  const raw = await rawGet(env, "changes:log");
  try {
    const l = raw ? JSON.parse(raw) : [];
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
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
  // No stored audit date may exceed today in America/Los_Angeles. The stamp
  // is pacificToday() at the writer today, so this cannot fire; it exists so
  // a future change to UTC stamping, or a caller passing its own date, cannot
  // put tomorrow on the streak. Clamped rather than refused, because losing
  // the record of a run that happened is worse than correcting its label,
  // and the original value is kept beside the correction.
  const cap = pacificToday();
  const stamped = entry?.date && String(entry.date) > cap
    ? { ...entry, date: cap, dateWas: entry.date }
    : entry;
  log.push(stamped);
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

// Which corners have a stored Street View frame, as one key.
//
// The alternative was an imgstatus record per corner, which is a second write
// for every frame published: 7,309 frames would have cost 14,618 writes to say
// something a single list already says. It is read once per isolate and answers
// for the whole city, so a scored corner's page can serve its stored photograph
// without a KV read per request and without re-reserving a Maps fetch for bytes
// that are already in hand.
//
// It is an index, not the truth. The bytes under img:{slug}:today are the
// truth; this only says where to look, and a slug listed here whose bytes are
// missing degrades to the ordinary not-stored-yet state rather than to a broken
// image, because /gen answers 404 and the page has an honest empty state.
export async function getFrameIndex(env) {
  const raw = await rawGet(env, "img:index");
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    return { ...r, slugs: new Set(r.slugs || []) };
  } catch {
    return null;
  }
}

export async function putFrameIndex(env, slugs, opts = {}) {
  const list = [...new Set(slugs)].sort();
  await rawPut(env, "img:index", JSON.stringify({
    updated: new Date().toISOString(),
    count: list.length,
    // What produced this listing, so a reader can tell a bulk fetch from the
    // daily cron's own accumulation.
    source: opts.source || "bulk fetch",
    slugs: list,
  }));
  return list.length;
}

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

// ---------------------------------------------------------------- letter backoff

// A daily model quota is not a transient error, and treating it as one is
// expensive in the one currency a page load actually has: time. The letter
// lane retries five times with exponential backoff, which is right for a
// model that returns UNAVAILABLE under load and wrong for a key that has no
// requests left today. It costs 15.5 seconds of sleeping per request, on every
// uncached request, and the synthetic monitor measured 17.2s.
//
// So the first request to hit a quota refusal writes this flag, and every
// request for the next hour skips the model entirely and serves the corner's
// last verified letter. Nothing about the verifier changes; this only shortens
// a path that was already failing.
export async function getLetterBackoff(env) {
  const raw = await rawGet(env, "letter:backoff");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setLetterBackoff(env, reason, ttlSec = 3600) {
  const rec = {
    at: new Date().toISOString(),
    until: new Date(Date.now() + ttlSec * 1000).toISOString(),
    reason: String(reason || "").slice(0, 160),
  };
  await rawPut(env, "letter:backoff", JSON.stringify(rec), ttlSec);
  return rec;
}

// ---------------------------------------------------------------- exa budget

// Total Exa searches the batch lanes may ever spend, against the event
// credits. The per-page press lane is bounded by traffic and the edge cache and
// is deliberately NOT metered here: it costs one search per corner per ten
// minutes and it is the lane a visitor is waiting on. What is metered is the
// two lanes that fan out on their own, the citywide watchlist and the press
// connections pass, because those are the ones that can spend a thousand
// searches without anybody asking them to.
//
// Cumulative, not daily, and it counts from the moment this counter was
// introduced rather than pretending to know what earlier runs spent.
// The meter is denominated in cents, because the thing that runs out is a
// balance and not a call count. A search and a page of contents cost different
// amounts, so counting calls priced them the same and was wrong in both
// directions at once.
//
// Two figures are kept and both are needed. Reserved cents are the estimate,
// added before a call, because a fan-out that checks its budget one call at a
// time has already overspent by the time it notices. Spent cents are the
// measurement, added after, from the costDollars every Exa response carries.
// The cap is checked against the greater of the two, so an estimate running
// ahead of the measurement can only make the meter more cautious.
//
// Per call estimates: a search is 0.7 cents and a page of contents is 0.1
// cents. The search figure is not a guess. tools/exa_probe.mjs measured this
// account at exactly $0.007 a search.
export const EXA_CAP_CENTS = 6500;
export const EXA_PERIOD = "2026-08";
export const EXA_SEARCH_CENTS = 0.7;
export const EXA_CONTENTS_CENTS = 0.1;

// What this account had already spent when the meter was retuned, from the old
// call counter. Not erased and not folded into the pass counter: the
// dashboard's remaining balance is the prior spend plus this counter, and
// saying so is the only way the two figures can ever be reconciled.
export const EXA_PRIOR_SPEND_USD = 1.269;
export const EXA_PRIOR_CALLS = 783;

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

const exaZero = () => ({
  period: EXA_PERIOD,
  // Nobody has watched a dashboard move, so nothing here names an account.
  // These three fields move together and only verifyExaAccount moves them.
  account: null,
  accountVerified: false,
  verifiedAt: null,
  observedBalanceUsd: null,
  capCents: EXA_CAP_CENTS,
  spentCents: 0,
  reservedCents: 0,
  searches: 0,
  contentPages: 0,
  deferrals: 0,
  priorSpendUsd: EXA_PRIOR_SPEND_USD,
  priorCalls: EXA_PRIOR_CALLS,
  updated: null,
});

async function readExaMeter(env) {
  const raw = await rawGet(env, "budget:exa");
  if (!raw) return exaZero();
  try {
    const m = { ...exaZero(), ...JSON.parse(raw) };
    // A new period starts a new counter rather than inheriting the last one,
    // and a stored cap never outranks the deployed one.
    if (m.period !== EXA_PERIOD) return exaZero();
    m.capCents = EXA_CAP_CENTS;
    return m;
  } catch {
    return exaZero();
  }
}

async function writeExaMeter(env, m) {
  m.updated = new Date().toISOString();
  await rawPut(env, "budget:exa", JSON.stringify(m));
  return m;
}

// A human watched a specific workspace's dashboard move after a known call.
// That is the only thing that identifies the account, so it is the only thing
// that sets it. The observed balance is recorded beside it so the next
// reconciliation has a fixed point to measure from.
export async function verifyExaAccount(env, { workspace, observedBalanceUsd = null, attributedFromCents = null } = {}) {
  if (!workspace) throw new Error("a workspace name is required to verify the account");
  const m = await readExaMeter(env);
  m.account = String(workspace);
  m.accountVerified = true;
  m.verifiedAt = new Date().toISOString();
  // Number(null) is 0 and 0 is finite, so a missing balance recorded itself as
  // an observed balance of zero dollars. An unknown reading must stay unknown.
  m.observedBalanceUsd =
    observedBalanceUsd === null || observedBalanceUsd === undefined || observedBalanceUsd === ""
      ? null
      : Number.isFinite(Number(observedBalanceUsd))
        ? Number(observedBalanceUsd)
        : null;
  // Spend before the confirmed key was installed was billed somewhere else.
  // Keeping it in the total is right, because it happened; counting it against
  // this workspace's balance is not. The boundary is recorded so both readings
  // are available and neither has to be inferred later.
  m.attributedFromCents =
    attributedFromCents === null || attributedFromCents === undefined || attributedFromCents === ""
      ? m.spentCents
      : Number.isFinite(Number(attributedFromCents))
        ? Number(attributedFromCents)
        : m.spentCents;
  return writeExaMeter(env, m);
}

export async function exaBudget(env) {
  const m = await readExaMeter(env);
  const usedCents = round2(Math.max(m.spentCents, m.reservedCents));
  return {
    ...m,
    spentCents: round2(m.spentCents),
    reservedCents: round2(m.reservedCents),
    usedCents,
    remainingCents: round2(Math.max(0, m.capCents - usedCents)),
    spentUsd: round4(m.spentCents / 100),
    capUsd: m.capCents / 100,
    exhausted: usedCents >= m.capCents,
    // What some workspace's dashboard should be showing against its balance.
    // Which workspace is a separate question, and until accountVerified is
    // true this figure is a total with no address on it. It is also not the
    // same as a balance drop: free monthly credits are consumed first on some
    // plans, so a real spend can appear as usage while the balance does not
    // move at all.
    allTimeUsd: round4(m.priorSpendUsd + m.spentCents / 100),
    // What this confirmed workspace has been billed, as opposed to what the
    // counter has measured in total across whatever keys were installed.
    attributedUsd: m.accountVerified
      ? round4(Math.max(0, m.spentCents - (m.attributedFromCents ?? m.spentCents)) / 100)
      : null,
    unattributedUsd: m.accountVerified
      ? round4((m.attributedFromCents ?? m.spentCents) / 100 + m.priorSpendUsd)
      : null,
    reconciliation: m.accountVerified
      ? `observed on ${m.account}${m.verifiedAt ? ` at ${pacificDay(m.verifiedAt)}` : ""}`
      : "unverified: no dashboard observation has attributed this spend to a workspace",
  };
}

// One metering session per invocation, flushed once.
//
// The meter was three KV writes per Exa call: reserveExa wrote it, and
// recordExaSpend wrote exa:spend and then wrote it again. At 683 searches a day
// that is 2,049 writes on a 1,000 a day allowance, which is why the press tick
// was consuming the whole day's writes before any publish could run. The counts
// were never the problem; the write amplification was.
//
// A session decides from a snapshot plus what it has accumulated, so the cap is
// still enforced call by call, and touches KV twice at the end instead of three
// times per call. Deltas are applied to a FRESH read at flush, not to the
// snapshot, so a concurrent invocation's writes are not clobbered: exactly the
// guarantee the per-call version had, over a longer window.
//
// The checkpoint bounds what a dead isolate can lose. Without one, an
// invocation killed near the end of a long batch would lose every measured
// dollar it had accumulated, and this ledger's whole claim is that it measures.
export function openExaMeter(env, { checkpointEvery = 25 } = {}) {
  const zero = () => ({ reservedCents: 0, searches: 0, contentPages: 0, spentCents: 0, spendUsd: 0, deferrals: 0 });
  let pending = zero();
  let snapshot = null;
  let sinceFlush = 0;
  let flushes = 0;

  const load = async () => {
    if (!snapshot) snapshot = await readExaMeter(env);
    return snapshot;
  };

  const session = {
    async reserve(searches, contentPages = 0) {
      const n = Math.max(0, Number(searches) || 0);
      const pages = Math.max(0, Number(contentPages) || 0);
      const cost = n * EXA_SEARCH_CENTS + pages * EXA_CONTENTS_CENTS;
      const m = await load();
      // The snapshot plus everything this session has already committed to.
      const used = Math.max(m.spentCents + pending.spentCents, m.reservedCents + pending.reservedCents);
      if (used + cost > m.capCents) {
        pending.deferrals += 1;
        return false;
      }
      pending.reservedCents = round2(pending.reservedCents + cost);
      pending.searches += n;
      pending.contentPages += pages;
      sinceFlush += 1;
      if (sinceFlush >= checkpointEvery) await session.flush();
      return true;
    },

    async record(usd) {
      const n = Number(usd);
      if (!Number.isFinite(n) || n <= 0) return;
      pending.spentCents = round2(pending.spentCents + n * 100);
      pending.spendUsd = Math.round((pending.spendUsd + n) * 1e6) / 1e6;
      sinceFlush += 1;
      if (sinceFlush >= checkpointEvery) await session.flush();
    },

    async flush() {
      const p = pending;
      const dirty =
        p.reservedCents || p.searches || p.contentPages || p.spentCents || p.spendUsd || p.deferrals;
      if (!dirty) return { writes: 0 };
      pending = zero();
      sinceFlush = 0;
      let writes = 0;
      if (p.spendUsd > 0) {
        const cur = parseFloat((await rawGet(env, "exa:spend")) || "0") || 0;
        await rawPut(env, "exa:spend", String(Math.round((cur + p.spendUsd) * 1e6) / 1e6));
        writes += 1;
      }
      const m = await readExaMeter(env);
      m.reservedCents = round2(m.reservedCents + p.reservedCents);
      m.searches += p.searches;
      m.contentPages += p.contentPages;
      m.spentCents = round2(m.spentCents + p.spentCents);
      m.deferrals += p.deferrals;
      await writeExaMeter(env, m);
      writes += 1;
      flushes += 1;
      // The next reserve decides against what is actually stored now.
      snapshot = m;
      return { writes };
    },

    stats: () => ({ pending: { ...pending }, flushes }),
  };
  return session;
}

// Reserved before the batch runs. Returns false at the cap and records the
// refusal, so a deferred batch is visible as a deferral rather than as
// silence.
export async function reserveExa(env, searches, contentPages = 0) {
  const n = Math.max(0, Number(searches) || 0);
  const pages = Math.max(0, Number(contentPages) || 0);
  const cost = n * EXA_SEARCH_CENTS + pages * EXA_CONTENTS_CENTS;
  const m = await readExaMeter(env);
  const used = Math.max(m.spentCents, m.reservedCents);
  if (used + cost > m.capCents) {
    m.deferrals += 1;
    await writeExaMeter(env, m);
    return false;
  }
  m.reservedCents = round2(m.reservedCents + cost);
  m.searches += n;
  m.contentPages += pages;
  await writeExaMeter(env, m);
  return true;
}

// Exa returns costDollars on every response, so the spend on this feature is a
// measured number rather than an estimate. Recorded in two places on purpose:
// the all-time figure, which is what the provider's balance is drawn against,
// and this period's counter, which is what the cap is enforced on.
export async function recordExaSpend(env, usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return;
  const spend = parseFloat((await rawGet(env, "exa:spend")) || "0") || 0;
  await rawPut(env, "exa:spend", String(Math.round((spend + n) * 1e6) / 1e6));
  const m = await readExaMeter(env);
  m.spentCents = round2(m.spentCents + n * 100);
  await writeExaMeter(env, m);
}

// What plan the deployed Exa key is on, which is NOT the same as what account
// it belongs to.
//
// This distinction was got wrong once and it cost a batch run. The price of a
// contents-free search identifies a plan tier, because the tiers are priced
// differently. It cannot identify a workspace: any number of workspaces can
// sit on the same tier and bill identically. Reading "$0.007 a search" as
// "therefore the $70 workspace" is an inference the data does not support, and
// the way it failed was silent, with a workspace Usage page showing no
// activity at all while the counter here climbed.
//
// Only a human observing movement on a specific workspace's dashboard
// identifies the account. That observation is recorded by verifyExaAccount and
// nothing else sets it.
//
// Prices are per search, from the plan pages.
export const EXA_PLAN_PRICES = { "15-per-1k": 0.015, "7-per-1k": 0.007 };

export function exaPlanFor(unitUsd) {
  if (!Number.isFinite(unitUsd) || unitUsd <= 0) return null;
  let best = null;
  for (const [name, unit] of Object.entries(EXA_PLAN_PRICES)) {
    const err = Math.abs(unitUsd - unit) / unit;
    // A 20 percent band. The tiers differ by more than a factor of two, so
    // nothing lands in both bands, and a price in neither is reported as
    // unknown rather than rounded into the nearest story.
    if (err <= 0.2 && (!best || err < best.err)) best = { name, err };
  }
  return best ? best.name : null;
}

export async function recordExaProbe(env, cost) {
  const unitUsd = Number(cost?.total);
  if (!Number.isFinite(unitUsd) || unitUsd <= 0) return null;
  const rec = {
    unitUsd,
    plan: exaPlanFor(unitUsd),
    breakdown: cost || null,
    at: new Date().toISOString(),
  };
  await rawPut(env, "exa:probe", JSON.stringify(rec));
  return rec;
}

export async function getExaProbe(env) {
  const raw = await rawGet(env, "exa:probe");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------- press enrichment

// One entry per street, shared by every corner on it. A seven day life is
// long enough that a nightly batch pays for a street once a week and short
// enough that a corridor in the news does not stay stale for a month.
export async function getPressSegment(env, street) {
  const raw = await rawGet(env, `press:segment:${street}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function putPressSegment(env, street, rec, ttlSec = 7 * 24 * 3600) {
  await rawPut(env, `press:segment:${street}`, JSON.stringify(rec), ttlSec);
}

// The stored press record for one corner. No TTL: a stored result is the
// evidence the corner was checked, and it expires by being replaced.
export async function getPress(env, slug, version) {
  const raw = await rawGet(env, `press:corner:${slug}`);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    return !version || rec.version === version ? rec : null;
  } catch {
    return null;
  }
}

export async function putPress(env, slug, rec) {
  await rawPut(env, `press:corner:${slug}`, JSON.stringify(rec));
}

// The roll-up the watchlist page reads. Counted as corners are written rather
// than by listing thousands of keys at read time.
export async function bumpPressRollup(env, rec) {
  const key = "press:rollup";
  const raw = await rawGet(env, key);
  let r;
  try { r = raw ? JSON.parse(raw) : null; } catch { r = null; }
  const period = (rec.fetchedAt || "").slice(0, 7);
  if (!r || r.period !== period) r = { period, checked: 0, withCoverage: 0, empty: 0, deferred: 0, paused: 0, costUsd: 0, citations: 0 };
  if (typeof r.citations !== "number") r.citations = 0;
  if (typeof r.paused !== "number") r.paused = 0;
  // Our cap reached, versus the provider refusing the key on balance. Counted
  // apart because they need different repairs.
  if (rec.source === "budget-paused") r.paused += 1;
  else if (rec.source === "budget-deferred") r.deferred += 1;
  else {
    r.checked += 1;
    if (rec.source === "live") r.withCoverage += 1;
    else r.empty += 1;
    r.citations += (rec.items || []).length;
  }
  r.costUsd = Math.round((r.costUsd + (rec.cost?.usd || 0)) * 1e6) / 1e6;
  r.updated = new Date().toISOString();
  await rawPut(env, key, JSON.stringify(r));
  return r;
}

// The burn checkpoint. The stored press record already makes a run resumable
// corner by corner; this is what stops a resumed run re-scanning the rank from
// page one to find where it got to.
export async function getBurnCheckpoint(env) {
  const raw = await rawGet(env, "press:burn");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function putBurnCheckpoint(env, rec) {
  await rawPut(env, "press:burn", JSON.stringify({ ...rec, updatedAt: new Date().toISOString() }));
}

// Rolled up once a chunk rather than once a corner. Same arithmetic, an order
// of magnitude fewer round trips.
export async function bumpPressRollupBulk(env, recs) {
  const key = "press:rollup";
  const raw = await rawGet(env, key);
  let r;
  try { r = raw ? JSON.parse(raw) : null; } catch { r = null; }
  const period = (recs.find((x) => x?.fetchedAt)?.fetchedAt || new Date().toISOString()).slice(0, 7);
  if (!r || r.period !== period) r = { period, checked: 0, withCoverage: 0, empty: 0, deferred: 0, paused: 0, costUsd: 0, citations: 0 };
  if (typeof r.citations !== "number") r.citations = 0;
  if (typeof r.paused !== "number") r.paused = 0;
  for (const rec of recs) {
    if (!rec) continue;
    if (rec.source === "budget-paused") r.paused += 1;
    else if (rec.source === "budget-deferred") r.deferred += 1;
    else {
      r.checked += 1;
      if (rec.source === "live") r.withCoverage += 1;
      else r.empty += 1;
      r.citations += (rec.items || []).length;
    }
    r.costUsd = Math.round((r.costUsd + (rec.cost?.usd || 0)) * 1e6) / 1e6;
  }
  r.updated = new Date().toISOString();
  await rawPut(env, key, JSON.stringify(r));
  return r;
}

export async function getPressRollup(env) {
  const raw = await rawGet(env, "press:rollup");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// The true count of published citations, from the stored records themselves.
//
// A running counter was added to the roll-up, which is right going forward and
// worthless for anything already written: the burn had stored 246 corners
// before the counter existed, so it read zero while the homepage tile showed a
// snapshot from a tool run at 02:53. A stale number with a fresh timestamp is
// worse than a stale number, because it looks current.
//
// So this counts what is actually there. It runs inside the Worker where KV is
// a binding rather than a REST call, it is bounded, and its result is cached
// so a page load reads one key.
export const CITATION_CACHE_S = 6 * 3600;
const CITATION_SCAN_CAP = 2000;

export async function recountPressCitations(env) {
  if (!env?.STORE?.list) return null;
  try {
    return await scanPressCitations(env);
  } catch (e) {
    // A scan that fails silently leaves the tile showing a stale number with a
    // fresh timestamp, which is the exact failure this function exists to fix.
    // The error is stored where the reader of the count will find it.
    await rawPut(env, "press:citations", JSON.stringify({
      error: String((e && e.message) || e).slice(0, 240),
      at: new Date().toISOString(),
    }));
    return null;
  }
}

async function scanPressCitations(env) {
  let cursor, scanned = 0, citations = 0, corners = 0, withCoverage = 0;
  for (;;) {
    const page = await env.STORE.list({ prefix: "press:corner:", cursor, limit: 1000 });
    for (const k of page.keys || []) {
      if (scanned >= CITATION_SCAN_CAP) break;
      scanned += 1;
      const rec = await env.STORE.get(k.name, "json").catch(() => null);
      if (!rec) continue;
      corners += 1;
      const n = (rec.items || []).length;
      citations += n;
      if (n) withCoverage += 1;
    }
    if (page.list_complete || !page.cursor || scanned >= CITATION_SCAN_CAP) break;
    cursor = page.cursor;
  }
  const rec = {
    citations, corners, withCoverage, scanned,
    truncated: scanned >= CITATION_SCAN_CAP,
    at: new Date().toISOString(),
  };
  await rawPut(env, "press:citations", JSON.stringify(rec));
  return rec;
}

export async function getPressCitations(env) {
  const raw = await rawGet(env, "press:citations");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Audited, and audited with imagery: one source of truth.
//
// "23 fully audited" was one number doing two jobs. A corner whose records,
// press, voices and hazard lanes all ran but whose two generated frames never
// landed is audited in every sense the page means except the one the imagery
// panel shows, and calling it the same thing as a complete corner makes the
// homepage claim something the corner page then contradicts.
//
// Counted from the imagery records rather than a roster somebody maintains, so
// when the imagery lane backfills a corner it promotes itself and the copy
// goes back to the simpler sentence without anybody editing it.
export const AUDIT_TIER_CACHE_S = 6 * 3600;

export async function recountAuditTiers(env, roster) {
  const slugs = Array.isArray(roster) ? roster : [];
  let fullyAudited = 0;
  const pending = [];
  for (const slug of slugs) {
    const img = await getImageryStatus(env, slug).catch(() => null);
    const states = img?.states || [];
    if (states.includes("hazards") && states.includes("fix")) fullyAudited += 1;
    else pending.push(slug);
  }
  const rec = {
    fullyAudited,
    textAudited: pending.length,
    total: slugs.length,
    pending: pending.slice(0, 40),
    at: new Date().toISOString(),
  };
  await rawPut(env, "audit:tiers", JSON.stringify(rec));
  return rec;
}

export async function getAuditTiers(env) {
  const raw = await rawGet(env, "audit:tiers");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------- radar

// The radar's own budget, deliberately separate from the burn counter. They
// spend the same balance but they answer different questions: the burn is a
// project with an end, the radar is a standing cost, and a standing cost that
// shares a project's ceiling is a standing cost nobody notices.
export const RADAR_DAY_CENTS = 40;
export const RADAR_MONTH_CENTS = 900;

const radarZero = (day, month) => ({
  day, month, dayCents: 0, monthCents: 0, detections: 0, calls: 0, updated: null,
});

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const utcMonth = (d = new Date()) => d.toISOString().slice(0, 7);

async function readRadar(env) {
  const day = utcDay(), month = utcMonth();
  const raw = await rawGet(env, "budget:radar");
  let r;
  try { r = raw ? JSON.parse(raw) : null; } catch { r = null; }
  if (!r) return radarZero(day, month);
  // The day counter resets at 00:00 UTC and the month counter does not go with
  // it. Rolling both together was how a daily cap quietly became a monthly one.
  if (r.day !== day) { r.day = day; r.dayCents = 0; }
  if (r.month !== month) { r.month = month; r.monthCents = 0; }
  return { ...radarZero(day, month), ...r };
}

export async function radarBudget(env) {
  const r = await readRadar(env);
  const dayLeft = Math.max(0, RADAR_DAY_CENTS - r.dayCents);
  const monthLeft = Math.max(0, RADAR_MONTH_CENTS - r.monthCents);
  return {
    ...r,
    dayCapCents: RADAR_DAY_CENTS,
    monthCapCents: RADAR_MONTH_CENTS,
    dayRemainingCents: Math.round(dayLeft * 100) / 100,
    monthRemainingCents: Math.round(monthLeft * 100) / 100,
    paused: dayLeft <= 0 || monthLeft <= 0,
    pausedBy: dayLeft <= 0 ? "day" : monthLeft <= 0 ? "month" : null,
  };
}

// Charged before the work, like every other counter here. Returns false at the
// cap, and the caller renders the paused state rather than going quietly stale.
export async function reserveRadar(env, cents) {
  const c = Math.max(0, Number(cents) || 0);
  const r = await readRadar(env);
  if (r.dayCents + c > RADAR_DAY_CENTS || r.monthCents + c > RADAR_MONTH_CENTS) return false;
  r.dayCents = Math.round((r.dayCents + c) * 100) / 100;
  r.monthCents = Math.round((r.monthCents + c) * 100) / 100;
  r.calls += 1;
  r.updated = new Date().toISOString();
  await rawPut(env, "budget:radar", JSON.stringify(r));
  return true;
}

export async function countRadarDetection(env, n = 1) {
  const r = await readRadar(env);
  r.detections += n;
  r.updated = new Date().toISOString();
  await rawPut(env, "budget:radar", JSON.stringify(r));
}

// The monitors this Worker created. A webhook naming a monitor id that is not
// in here is not from a monitor this site owns, and is refused.
export async function getMonitors(env) {
  const raw = await rawGet(env, "radar:monitors");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function putMonitors(env, rec) {
  await rawPut(env, "radar:monitors", JSON.stringify(rec));
}

// The feed, newest first, capped. The cap is the point: this is a live surface
// and an unbounded log in KV is a value that eventually fails to write.
export const RADAR_FEED_CAP = 120;

export async function getRadarFeed(env) {
  const raw = await rawGet(env, "radar:feed");
  if (!raw) return [];
  try { const f = JSON.parse(raw); return Array.isArray(f) ? f : []; } catch { return []; }
}

export async function pushRadarFeed(env, hits) {
  const feed = await getRadarFeed(env);
  const seen = new Set(feed.map((h) => h.url));
  const fresh = (hits || []).filter((h) => h.url && !seen.has(h.url));
  if (!fresh.length) return { added: 0, feed };
  const next = [...fresh, ...feed].slice(0, RADAR_FEED_CAP);
  await rawPut(env, "radar:feed", JSON.stringify(next));
  return { added: fresh.length, feed: next };
}

// A payload the reader did not recognise. Kept so an unknown shape is a thing
// to look at rather than a detection silently dropped on the floor.
export async function putRadarUnknown(env, payload) {
  await rawPut(env, "radar:unknown", JSON.stringify({ at: new Date().toISOString(), payload }), 7 * 24 * 3600);
}

// ---------------------------------------------------------------- press watchlist

export async function getWatchlist(env, version) {
  const raw = await rawGet(env, "press:watchlist");
  if (!raw) return null;
  try {
    const w = JSON.parse(raw);
    return !version || w.version === version ? w : null;
  } catch {
    return null;
  }
}

// The last watchlist run, as a record of the run rather than of its output.
//
// The watchlist blob says what the pass found. This says what the pass did:
// when it fired, how many searches it attempted, how many completed, and why
// any of them did not. Kept separate because the two answer different
// questions, and because a run that failed before writing a blob still has to
// leave a trace. One key, last run only; the page needs "did the last one
// finish", not a history.
export async function getWatchlistRun(env) {
  const raw = await rawGet(env, "press:watchlistrun");
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function putWatchlistRun(env, record) {
  await rawPut(env, "press:watchlistrun", JSON.stringify(record));
}

export async function putWatchlist(env, w) {
  await rawPut(env, "press:watchlist", JSON.stringify(w));
}

// One record per corner that the press connects to another corner. Written for
// BOTH ends of every connection, so the claim reads the same from either page.
export async function getConnections(env, slug) {
  const raw = await rawGet(env, `press:conn:${slug}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putConnections(env, slug, rec) {
  await rawPut(env, `press:conn:${slug}`, JSON.stringify(rec));
}

// ---------------------------------------------------------------- apify runs

// Actor runs the site may commission in a calendar month. Two per corner and
// one corner a morning is 62 in a long month; the ceiling sits just above that
// so a bug that commissions in a loop stops at a knowable number instead of at
// the credit balance.
export const MONTHLY_ACTOR_RUN_CAP = 70;

const monthKey = () => new Date().toISOString().slice(0, 7);

export async function actorRunBudget(env) {
  const used = parseInt((await rawGet(env, `apifyruns:${monthKey()}`)) || "0", 10) || 0;
  return { used, cap: MONTHLY_ACTOR_RUN_CAP, remaining: Math.max(0, MONTHLY_ACTOR_RUN_CAP - used), month: monthKey() };
}

export async function reserveActorRun(env) {
  const key = `apifyruns:${monthKey()}`;
  const used = parseInt((await rawGet(env, key)) || "0", 10) || 0;
  if (used >= MONTHLY_ACTOR_RUN_CAP) return false;
  // Two months, so a counter written on the last day cannot linger a year.
  await rawPut(env, key, String(used + 1), 62 * 24 * 3600);
  return true;
}

// What the site commissioned for a corner, and where the results will land.
// Written the moment the runs start, read by the NEXT cron cycle, because an
// actor takes minutes and a cron handler must not sit waiting on one.
export async function getVoiceRun(env, slug) {
  const raw = await rawGet(env, `voicerun:${slug}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putVoiceRun(env, slug, rec) {
  await rawPut(env, `voicerun:${slug}`, JSON.stringify(rec));
}

// The queue of corners whose runs have not been ingested yet. A list rather
// than a scan, because listing KV by prefix from inside a Worker is not a
// thing and a cron must not guess which corners are outstanding.
export async function getVoicePending(env) {
  const raw = await rawGet(env, "voicerun:pending");
  try {
    const l = raw ? JSON.parse(raw) : [];
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

export async function putVoicePending(env, list) {
  await rawPut(env, "voicerun:pending", JSON.stringify(list.slice(0, 40)));
}

// Scraped resident voices for a corner, ingested from a commissioned run.
// Distinct from the baked assets, which were collected by hand before the
// demo: this key is only ever written by the autonomous path.
export async function getVoicesStored(env, slug) {
  const raw = await rawGet(env, `voices:${slug}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putVoicesStored(env, slug, rec) {
  await rawPut(env, `voices:${slug}`, JSON.stringify(rec));
}

// Every commissioned run and what it actually cost, newest first. The credit
// is real money and an autonomous system spending it without a ledger is the
// thing nobody should ship.
export async function appendActorCost(env, entry) {
  const raw = await rawGet(env, "apify:costs");
  let log = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    log = Array.isArray(parsed) ? parsed : [];
  } catch {
    log = [];
  }
  log.unshift(entry);
  const trimmed = log.slice(0, 300);
  await rawPut(env, "apify:costs", JSON.stringify(trimmed));
  return trimmed;
}

export async function getActorCosts(env) {
  const raw = await rawGet(env, "apify:costs");
  try {
    const l = raw ? JSON.parse(raw) : [];
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

// A running count of what the autonomous voices lane has actually produced,
// so the homepage can state it without reading a hundred keys. Written by
// whatever ingests, which is the only code that knows the answer changed.
export async function getVoicesSummary(env) {
  const raw = await rawGet(env, "voices:summary");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function putVoicesSummary(env, summary) {
  await rawPut(env, "voices:summary", JSON.stringify(summary));
}

// ---------------------------------------------------------------- photo budget

export async function photoBudget(env) {
  const used = parseInt((await rawGet(env, `photo:${today()}`)) || "0", 10) || 0;
  return { used, cap: DAILY_PHOTO_CAP, remaining: Math.max(0, DAILY_PHOTO_CAP - used) };
}

export async function reservePhoto(env) {
  const key = `photo:${today()}`;
  const used = parseInt((await rawGet(env, key)) || "0", 10) || 0;
  if (used >= DAILY_PHOTO_CAP) return false;
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
