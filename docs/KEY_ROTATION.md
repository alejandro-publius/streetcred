# Key rotation

A read-only hygiene sweep, and the checklist for the rotation itself.

**Nothing was rotated to produce this file.** No secret was written, no
provider key was minted or revoked, no deploy happened. Every command below is
a read: `wrangler secret list` returns names and types and never values, the
greps report line numbers, and the live endpoints queried are the free public
ones on this Worker. An assistant does not install a credential, so every
procedure in the table ends at a command a human types.

**No key value appears in this file.** That claim is checked at the bottom by a
grep run against this file itself.

Measurements are timestamped because some of them move. The press burn was
still advancing while this was written, so any number tied to it is a reading,
not a total.

Sweep run 2026-08-20T05:49Z to 05:52Z (2026-08-19, about 22:50 Pacific).

---

## 1. Secrets the deployed Worker holds

`npx wrangler secret list`, read 2026-08-20T05:47Z. Six secrets, all
`secret_text`, on the production Worker `streetcred`:

    APIFY_TOKEN
    EXA_API_KEY
    GEMINI_API_KEY
    GOOGLE_MAPS_API_KEY
    WATCHDOG_INGEST_TOKEN
    WEBHOOK_SECRET

`npx wrangler secret list --env preview` returns `[]`. Secrets do not inherit
across environments, which `wrangler.jsonc` already says in a comment and which
`specs/HANDOFF.md` records as deliberate: the preview Worker degrades to sample
states rather than putting a spendable surface on a second public URL.

Every one of the six has a reader in `src/`. There is no dead weight in this
population. The read sites, from `grep -rn "env\.NAME" src/`:

| Secret | Read at |
| --- | --- |
| `APIFY_TOKEN` | `src/voices.js:244`, `:255`, `:262`; `src/index.js:1215` |
| `EXA_API_KEY` | `src/press.js:249`, `:262`; `src/pressenrich.js:83`; `src/suggest.js:31`; `src/timeline.js:49`; `src/index.js:472`, `:906`, `:947`, `:1202` |
| `GEMINI_API_KEY` | `src/hazards.js:99`; `src/imagery.js:85`; `src/index.js:738`, `:1221` |
| `GOOGLE_MAPS_API_KEY` | `src/imagery.js:60`, `:73`; `src/index.js:620`, `:1227`, `:1388` |
| `WATCHDOG_INGEST_TOKEN` | `src/agent.js:140`, compared against the bearer token parsed at `src/agent.js:150` |
| `WEBHOOK_SECRET` | `src/index.js:905`, `:935`, `:996`, `:2000`, `:2009`, `:2023`, `:2481` |

`src/index.js:2014` lists all six by name in the `/api/radar` diagnostics. That
is a name list, not a read, so it is not counted as a reader above.

### What the live Worker says about them

`curl /api/radar`, read 2026-08-20T05:49:16Z:

- `secretsVisible` is `true` for all six. The runtime can see every one.
- `envKeyCount` is 8, which is the six secrets plus the two bindings declared
  in `wrangler.jsonc`, `ASSETS` and `STORE`. Nothing unaccounted for.
- `hasWebhookSecret` is `true` and `webhookSecretLength` is 64.
- `monitors` holds 29 entries, and `radar:setup` records them created at
  `2026-08-20T02:08:17.204Z`.

Two hygiene notes on `WEBHOOK_SECRET`, both about design decisions that are
already documented in the code and are worth restating here because they change
the rotation procedure:

1. The secret travels in a URL path, not a header. `src/index.js:935` builds
   `/api/radar/hook/{secret}` and hands that URL to Exa, and `src/index.js:996`
   checks the last path segment against `env.WEBHOOK_SECRET`. A path segment is
   the part of a URL most likely to end up in somebody else's request log. This
   is the correct shape for a provider that only offers a webhook URL, but it
   means the secret is held by Exa, in 29 places, and rotating it is not just a
   `secret put`.
2. `/api/radar` publishes `webhookSecretLength` to anyone. The comment at
   `src/index.js:2023` explains why, and the reason is good: a bound but empty
   secret is indistinguishable from a missing one from every other angle, and
   guessing between those cost six deploys. The cost is that the length is
   public. At 64 characters that is not a meaningful narrowing, so this is
   recorded and not flagged. Keep any replacement at least as long.

## 2. Keys referenced by the local env files

Names only, from `cut -d= -f1`. `.dev.vars` is untracked and is line 1 of
`.gitignore`; `git ls-files --error-unmatch .dev.vars` fails, and the file has
never existed in any of the 132 commits on `main`.

| Name | in `.dev.vars` | in `.dev.vars.example` | read by `src/` | read by `tools/` |
| --- | --- | --- | --- | --- |
| `EXA_API_KEY` | line 1 | yes | yes | yes |
| `APIFY_TOKEN` | line 2 | yes | yes | yes |
| `GEMINI_API_KEY` | line 3 | yes | yes | `tools/gemini_preflight.mjs:28`, `tools/generate_imagery.py:129` |
| `GOOGLE_MAPS_API_KEY` | line 4 | yes | yes | `tools/generate_imagery.py:128`, `tools/make_og.py:78` |
| `UPSTASH_REDIS_REST_URL` | line 5 | yes | **no** | **no** |
| `UPSTASH_REDIS_REST_TOKEN` | line 6 | yes | **no** | **no** |
| `WATCHDOG_INGEST_TOKEN` | line 7 | **no** | yes | **no** |
| `WEBHOOK_SECRET` | **no** | **no** | yes | `tools/create_monitors.mjs:32` reads it from the process env |

Three mismatches, in both directions:

- **`WATCHDOG_INGEST_TOKEN` is in `.dev.vars` and not in `.dev.vars.example`.**
  Undocumented. Somebody setting up from the example gets a local env that
  cannot exercise the ingest path, and nothing tells them why.
- **`WEBHOOK_SECRET` is in neither local file.** It exists only as a deployed
  Worker secret and as a process env var that `tools/create_monitors.mjs`
  expects the operator to export by hand. That is a defensible choice given
  point 1 above, but it is undocumented in the same way, and the example file
  is where it would be documented.
- **The `UPSTASH_REDIS_REST_*` pair has no reader anywhere.** `git grep
  UPSTASH` hits `.dev.vars.example:5` and `:6` and nothing else in the tree.
  Both names sit in `.dev.vars` too. This is the setup trap in its worst form:
  the example asks a newcomer to go get an Upstash credential that no line of
  this repo will ever read.

## 3. Key strings exposed in conversation transcripts

The transcripts themselves are not readable from here and were not opened. What
follows is the recorded state, from `specs/HANDOFF.md`, `specs/BILLING_QUEUE.md`
and the session record handed to this sweep.

- **Multiple Exa API keys were pasted into a chat session on 2026-08-19.**
  Every key pasted in that session is burned and must be treated as public.
  Rotation required. No value is reproduced here, and none was read.
- **A radar webhook shared secret was exposed in the same session, and was
  replaced afterwards.** The replacement is asserted by the session record and
  cannot be confirmed from the tree, because nothing outside the Worker can see
  the current value. What the tree does show is that all 29 Exa monitors were
  created at `2026-08-20T02:08:17.204Z`, which is after the exposure, and they
  carry whatever secret the Worker held at that moment. Item 2 of tomorrow's
  checklist is a human confirming that the deployed value is the replacement
  and not the exposed one.

Neither spec file names these keys more precisely than that.
`specs/BILLING_QUEUE.md` closes with the standing rule they were written under:
"No key material in the tree, transcript, or responses." The tree half of that
rule holds, per section 4. The transcript half did not.

Two adjacent facts from `specs/HANDOFF.md` that belong in this population
because they describe key state, not key values:

- The **deployed** `GEMINI_API_KEY` answers `429 You exceeded your current
  quota` for text generation. It is live and rate-limited, not revoked.
- The `GEMINI_API_KEY` in `.dev.vars` is a **different value** and answers
  `400 API key not valid`. It is dead. Any local tool reading line 3 of
  `.dev.vars` is testing a key the site does not use, which
  `tools/gemini_preflight.mjs` now detects.

## 4. The pattern sweep

### The repo's own grep, as CI runs it

From `.github/workflows/ci.yml`, the `key pattern grep` step:

    ! grep -rInE "AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_-]{30,}|apify_api_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}" \
      --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.github .

**Over tracked files: clean.** Zero matches. The step passes.

**Over the whole working tree, including gitignored files: three matches, all
in `.dev.vars`, at lines 2, 3 and 4.** By the mapping in section 2 those are
`APIFY_TOKEN`, `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY`. This is expected and
is not a leak: the file is untracked, gitignored, and has never been committed.
It is recorded because it is the exact thing the pattern is for, and because it
means the local file holds three provider-shaped credentials one `git add -f`
away from the history.

One caveat that matters more than the result. On the machine this sweep ran on,
`grep` resolves to a wrapper around `ugrep` with `--ignore-files`, which honors
`.gitignore`. Run through that wrapper the CI grep reports zero matches over the
whole tree, because it silently never opens `.dev.vars` at all. The three
matches above only appear under `command grep`. CI is unaffected, since the
GitHub runner uses GNU grep and gitignored files are never checked out there,
but anyone reproducing this sweep locally should use `command grep` or they will
get a false clean over every ignored path.

### Extension: the Exa key shape

Exa keys are UUIDs, so the CI pattern cannot see one. Scanning for a UUID in an
Exa context, and then for bare UUIDs anywhere, with `command grep`:

- UUID assigned to an `EXA`-prefixed name: **zero matches** in the working tree
  and zero across all 132 commits.
- Bare UUID shape, whole tree, gitignored files included: **6 matches in 2
  files.** `.dev.vars:1`, which is `EXA_API_KEY` and is therefore a live Exa key
  sitting in a gitignored local file. And `specs/HANDOFF.md` lines 392, 395,
  402, 480 and 481, which are Cloudflare Worker deployment version ids quoted in
  the rollback instructions. Those five are public identifiers, not credentials,
  and are correct to keep.

### Extension: bearer tokens

Scanning for a literal after `Bearer`, and for a quoted literal assigned to an
`Authorization` header:

- **Zero matches** in tracked files, zero in the whole working tree including
  gitignored files, and zero across all 132 commits.

The only `Bearer` in `src/` is `src/agent.js:150`, which parses an incoming
header. It contains no literal.

### History

`git log --all -G` over the four CI patterns, the Exa-context UUID pattern, the
bearer pattern and a quoted `x-api-key` literal: **zero commits matched** across
all 132 commits. No file named `.dev.vars`, `.env`, or anything matching
`secret` or `credential` has ever been added to this repository. The only such
file in history is `.dev.vars.example`, which holds names.

**Verdict: the tracked tree and its entire history are clean.** The exposure in
population 3 happened in a chat session, not in git, which is exactly why the
CI grep did not and could not catch it.

---

## 5. The table

Status vocabulary: LIVE means installed and working. RETIRED means known dead or
superseded. ROTATION REQUIRED means the value must be assumed public. UNKNOWN
means this sweep could not establish it.

Every `wrangler secret put` below is **run by the human**. An assistant does not
install a credential, and nothing in this repo should ever be given one to hold.

| Key name | Provider | Status | Read from in `src/` | Rotation, one line |
| --- | --- | --- | --- | --- |
| `EXA_API_KEY` (deployed) | Exa | **ROTATION REQUIRED** (exposed in session, 2026-08-19) | `press.js:249,262`, `pressenrich.js:83`, `suggest.js:31`, `timeline.js:49`, `index.js:472,906,947,1202` | Human mints a new key in the Exa dashboard, runs `npx wrangler secret put EXA_API_KEY`, then deletes every older key on that workspace. |
| `EXA_API_KEY` (`.dev.vars:1`) | Exa | **ROTATION REQUIRED** (same session) | not read by `src/`; read by seven `tools/` scripts | Human pastes the same freshly minted key over line 1 of `.dev.vars`. No deploy, no commit, the file is gitignored. |
| `WEBHOOK_SECRET` (deployed) | self-issued, held by Exa in 29 monitor webhook URLs | **LIVE**, believed replaced after the 2026-08-19 exposure, not independently verifiable | `index.js:905,935,996,2000,2009,2023,2481` | Human generates at least 64 random characters, runs `npx wrangler secret put WEBHOOK_SECRET`, then deletes all 29 Exa monitors and the `radar:monitors` KV record so `ensureMonitors` rebuilds them against the new URL. |
| `WEBHOOK_SECRET` (value in use before 2026-08-19) | self-issued | **RETIRED**, exposed in session | nothing reads it | No provider revoke exists. Confirm no Exa monitor still carries it in its webhook URL, then it is inert. |
| `APIFY_TOKEN` | Apify | **LIVE** | `voices.js:244,255,262`, `index.js:1215` | Human mints a new token in the Apify console, runs `npx wrangler secret put APIFY_TOKEN`, then revokes the old token in the same console. |
| `GEMINI_API_KEY` (deployed) | Google AI Studio | **LIVE**, quota exhausted (`429`, per `specs/HANDOFF.md`) | `hazards.js:99`, `imagery.js:85`, `index.js:738,1221` | Human creates a key on a billed project, runs `npx wrangler secret put GEMINI_API_KEY`, then deletes the old key in AI Studio. This is also item 0 of `specs/BILLING_QUEUE.md`. |
| `GEMINI_API_KEY` (`.dev.vars:3`) | Google AI Studio | **RETIRED**, provider answers `400 API key not valid` | not read by `src/`; `tools/gemini_preflight.mjs:28`, `tools/generate_imagery.py:129` | Human overwrites line 3 with the new billed key or deletes the line, and deletes the dead key in AI Studio if it still exists there. |
| `GOOGLE_MAPS_API_KEY` | Google Cloud | **LIVE** | `imagery.js:60,73`, `index.js:620,1227,1388` | Human creates a replacement credential in the Google Cloud console, runs `npx wrangler secret put GOOGLE_MAPS_API_KEY`, then deletes the old credential. |
| `WATCHDOG_INGEST_TOKEN` | self-issued | **LIVE** | `agent.js:140` | Human generates a new random token, runs `npx wrangler secret put WATCHDOG_INGEST_TOKEN`, then updates every agent that posts a bearer token to the ingest endpoint. |
| `UPSTASH_REDIS_REST_URL` | Upstash | **UNKNOWN**, no reader anywhere in the repo | none | Nothing to rotate. Delete the line from `.dev.vars` and `.dev.vars.example`, or name the code that needs it. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash | **UNKNOWN**, no reader anywhere in the repo | none | Human revokes it at Upstash if a real token was ever issued, then deletes the line from both files. |

---

## 6. Tomorrow's checklist

Ordered most urgent first. Tick each.

- [ ] **1. Rotate `EXA_API_KEY`, both copies.** Mint one new key, `npx wrangler
      secret put EXA_API_KEY`, and paste the same key over line 1 of
      `.dev.vars`. Do the deployed copy first: the quarter-hourly cron reads it.
- [ ] **2. Delete every other key on the Exa workspace.** Rotation is not
      finished until the pasted ones cannot be used. The session pasted more
      than one, so delete everything that is not today's mint.
- [ ] **3. Time it around the press burn.** The `*/15` cron runs `pressBatch`
      on `EXA_API_KEY`, and it was still advancing at 2026-08-20T05:51:20Z
      (`burnChecked` 318, hit rate 95.6%, both readings not totals). Rotate just
      after a tick, and expect the in-flight batch to fail if you catch one.
      The budget counter is unaffected by a rotation.
- [ ] **4. Confirm the deployed `WEBHOOK_SECRET` is the replacement, not the
      exposed value.** Only the human can answer this. If there is any doubt,
      rotate it, then delete all 29 Exa monitors and the `radar:monitors` KV
      record before re-running setup, because `ensureMonitors` returns "already
      created" and will leave every stale webhook URL in place otherwise.
- [ ] **5. Re-verify from outside.** `curl /api/radar` and check
      `secretsVisible` is `true` for all six and `webhookSecretLength` is
      non-zero. A secret can be uploaded, listed by wrangler, and still be
      empty; that distinction cost six deploys once already.
- [ ] **6. Replace or delete the dead local `GEMINI_API_KEY`** on `.dev.vars`
      line 3. It is rejected by the provider and every local tool that reads it
      is testing something the site does not use.
- [ ] **7. Resolve the `UPSTASH_REDIS_REST_*` pair.** Either name the code that
      needs it or delete both lines from `.dev.vars` and `.dev.vars.example`.
      Today it is a setup trap that sends a newcomer to a provider for nothing.
- [ ] **8. Document `WATCHDOG_INGEST_TOKEN` and `WEBHOOK_SECRET` in
      `.dev.vars.example`**, as empty placeholders with a comment, or write down
      why they are deliberately absent.
- [ ] **9. After the freeze lifts on 2026-08-25, extend the CI grep.** The
      current pattern cannot see a UUID, which is the shape of the key that was
      actually burned. Add a UUID-in-`EXA`-context clause and a bearer-literal
      clause, both of which returned zero here and would therefore go in green.
      `.github/` is frozen until then, so this is not a tonight job.
- [ ] **10. Re-run this sweep** with `command grep`, not the wrapper, and
      confirm the tracked tree is still clean.

---

## 7. Self-check

No key value appears anywhere in this file: every credential is referred to by
name, by file and line number, or by description, and nothing was copied out of
`.dev.vars`, out of `wrangler secret list`, or off any provider.

That sentence was verified, not just asserted. This file was grepped with
`command grep` for the four CI provider patterns, for the UUID shape, for any
run of 32 hex characters, for a bearer literal, and for a quoted `x-api-key`
literal. All six searches returned zero. The longest unbroken alphanumeric run
in the file is the string `UPSTASH_REDIS_REST_TOKEN`, which is a variable name.
The one number here that could be mistaken for a secret, 64, is a length that
`/api/radar` already publishes to the public internet.

There are also no em dashes, per house style, checked the same way.
