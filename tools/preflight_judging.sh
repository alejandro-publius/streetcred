#!/bin/sh
# The judge-morning preflight. Run this before anybody opens the site on a
# judging day, from a machine that is not the one that deployed it.
#
#   sh tools/preflight_judging.sh
#   sh tools/preflight_judging.sh https://some-preview.workers.dev
#   sh tools/preflight_judging.sh --quiet
#
# It curls the live Worker and asserts two things per check: HTTP 200, and a
# string from the middle of the body that only appears if the page actually
# assembled. Asserting the title would prove almost nothing. The failure mode
# that matters here is a Worker that lost KV or a data lane and still answers
# 200 with a masthead and a hole where the content goes, so every check names a
# marker that a shell cannot produce.
#
# Ordered the way a judge reads: homepage, one corner of each tier, the
# explainer pages, then the JSON a curious judge poked at.
#
# Two things to know before you run it.
#
# One: /api/health is not free. It pings every provider, and the Exa ping is a
# billed search, roughly $0.007 at the unit price that endpoint reports. That
# is the price of learning a lane is down before a stranger does, and it is one
# search rather than a batch. Do not put this script in a loop.
#
# Two: it needs curl and nothing else. No jq, no timeout. `timeout` is not on
# macOS, so every request carries curl's own --max-time instead of being
# wrapped in anything.
#
# Exits non-zero if anything failed, and names what. A preflight that exits 0
# while the site is broken is worse than no preflight: it turns a problem you
# had time to fix into a surprise in front of an audience.

DEFAULT_ORIGIN="https://streetcred.thealexschroeder.workers.dev"
MAXTIME=45
QUIET=0
ORIGIN=""

for arg in "$@"; do
  case "$arg" in
    --quiet|-q) QUIET=1 ;;
    -h|--help)
      echo "usage: sh tools/preflight_judging.sh [origin] [--quiet]"
      echo "  origin defaults to \$STREETCRED_ORIGIN, then $DEFAULT_ORIGIN"
      exit 0
      ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) ORIGIN="$arg" ;;
  esac
done

[ -n "$ORIGIN" ] || ORIGIN="${STREETCRED_ORIGIN:-$DEFAULT_ORIGIN}"
# A trailing slash would build //status, which is a different route.
ORIGIN="${ORIGIN%/}"

# Colour only for a human. Piped into a file or a CI log it stays plain, so the
# summary line is greppable.
if [ -t 1 ]; then
  C_PASS=$(printf '\033[32m'); C_FAIL=$(printf '\033[31m')
  C_DIM=$(printf '\033[2m');   C_OFF=$(printf '\033[0m')
else
  C_PASS=""; C_FAIL=""; C_DIM=""; C_OFF=""
fi

TMP="${TMPDIR:-/tmp}/streetcred-preflight.$$"
mkdir -p "$TMP" || exit 2
trap 'rm -rf "$TMP"' EXIT INT TERM
: > "$TMP/tally"
: > "$TMP/failures"
: > "$TMP/notes"

say() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }

# One real slug per tier, picked because each is stable and each proves a
# different lane. 16th and Mission is the flagship full audit. 1st and Bush
# came back partial, so it sits at ENRICHED and is the only corner that catches
# a regression collapsing the middle tier. 18th and Valencia has never been
# audited and must stay SCORED: if it ever renders AUDITED, the tier is being
# read from the wrong place.
CORNER_AUDITED="16th-mission"
CORNER_ENRICHED="1st-and-bush"
CORNER_SCORED="18th-and-valencia"
API_CORNER="16th-mission"

# name | path | marker that proves the body really rendered
CHECKS=$(cat <<SPEC
homepage|/|intersections graded citywide
corner AUDITED|/c/$CORNER_AUDITED|tierchip t-audited
corner ENRICHED|/c/$CORNER_ENRICHED|tierchip t-enriched
corner SCORED|/c/$CORNER_SCORED|tierchip t-scored
/status|/status|runs in the last 7 days
/radar|/radar|cleared the relevance filter
/methodology|/methodology|Danger Index
/changes|/changes|Grade changes
/watchlist|/watchlist|found by:
/watchdog|/watchdog|The Corner Watchdog
/api/health|/api/health|"ok":true
/api/board|/api/board|"corners":[
/api/stats|/api/stats?x=$API_CORNER|"crashes":
/api/score|/api/score?x=$API_CORNER|"grade":
/api/news|/api/news?x=$API_CORNER|"items":
/api/letter|/api/letter?x=$API_CORNER|"text":
SPEC
)

# Every lane /api/health pings. A lane is healthy when its value is exactly
# "ok"; anything else is the provider's own error text, truncated by the
# Worker, and is a failure. A lane the Worker deliberately skipped is named
# rather than counted either way: it is not passing and it is not broken.
HEALTH_LANES="datasf exa apify gemini maps imagery staticmap kv voices"

row() {
  # name, code, ms, PASS/FAIL, detail
  [ "$QUIET" -eq 1 ] && return 0
  if [ "$4" = "PASS" ]; then col="$C_PASS"; else col="$C_FAIL"; fi
  printf '%-16s %-6s %6s  %s%-4s%s %s%s%s\n' \
    "$1" "$2" "$3" "$col" "$4" "$C_OFF" "$C_DIM" "$5" "$C_OFF"
}

say ""
say "StreetCred judging preflight"
say "origin: $ORIGIN"
say "run at: $(date '+%Y-%m-%d %H:%M:%S %Z')"
say ""
[ "$QUIET" -eq 1 ] || printf '%-16s %-6s %6s  %s\n' "check" "status" "ms" "result"
[ "$QUIET" -eq 1 ] || printf '%-16s %-6s %6s  %s\n' \
  "----------------" "------" "------" "------"

while IFS='|' read -r name path marker; do
  [ -n "$name" ] || continue
  body="$TMP/body"
  meta=$(curl -sS --max-time "$MAXTIME" -o "$body" \
    -w '%{http_code} %{time_total}' "$ORIGIN$path" 2>/dev/null)
  rc=$?
  code=$(printf '%s' "$meta" | cut -d' ' -f1)
  secs=$(printf '%s' "$meta" | cut -d' ' -f2)
  [ -n "$code" ] || code="---"
  if [ -n "$secs" ]; then
    ms=$(awk -v t="$secs" 'BEGIN { printf "%d", t * 1000 }')
  else
    ms="-"
  fi

  detail=""
  ok=1
  if [ "$rc" -ne 0 ]; then
    ok=0
    if [ "$rc" -eq 28 ]; then
      detail="no answer within ${MAXTIME}s"
    else
      detail="curl exit $rc"
    fi
  elif [ "$code" != "200" ]; then
    ok=0
    detail="expected 200"
  elif ! grep -qF -- "$marker" "$body"; then
    ok=0
    detail="200 but body is missing: $marker"
  fi

  # /api/health publishes its own verdict, so read it rather than trusting 200.
  if [ "$ok" -eq 1 ] && [ "$path" = "/api/health" ]; then
    skiplist=$(sed -n 's/.*"skipped":\[\([^]]*\)\].*/\1/p' "$body")
    bad=""
    skipped=""
    for lane in $HEALTH_LANES; do
      if grep -qF -- "\"$lane\":\"ok\"" "$body"; then
        continue
      elif printf '%s' "$skiplist" | grep -qF -- "\"$lane\""; then
        skipped="$skipped $lane"
      else
        bad="$bad $lane"
      fi
    done
    if [ -n "$bad" ]; then
      ok=0
      detail="lane not ok:$bad"
    elif [ -n "$skipped" ]; then
      detail="skipped:$skipped"
      printf 'note: /api/health deliberately skipped these lanes:%s\n' \
        "$skipped" >> "$TMP/notes"
    fi
  fi

  if [ "$ok" -eq 1 ]; then
    row "$name" "$code" "$ms" "PASS" "$detail"
    echo pass >> "$TMP/tally"
  else
    row "$name" "$code" "$ms" "FAIL" "$detail"
    echo fail >> "$TMP/tally"
    printf '%s: %s\n' "$name" "$detail" >> "$TMP/failures"
  fi
done <<SPECEOF
$CHECKS
SPECEOF

PASSCOUNT=$(grep -c '^pass$' "$TMP/tally" 2>/dev/null)
FAILCOUNT=$(grep -c '^fail$' "$TMP/tally" 2>/dev/null)
[ -n "$PASSCOUNT" ] || PASSCOUNT=0
[ -n "$FAILCOUNT" ] || FAILCOUNT=0
TOTAL=$((PASSCOUNT + FAILCOUNT))

say ""
if [ -s "$TMP/notes" ] && [ "$QUIET" -eq 0 ]; then
  sort -u "$TMP/notes"
  say ""
fi

if [ "$FAILCOUNT" -eq 0 ]; then
  printf '%sPREFLIGHT PASS%s  %d of %d checks green against %s\n' \
    "$C_PASS" "$C_OFF" "$PASSCOUNT" "$TOTAL" "$ORIGIN"
  exit 0
fi

names=$(cut -d: -f1 < "$TMP/failures" \
  | awk 'NR > 1 { printf ", " } { printf "%s", $0 } END { print "" }')
printf '%sPREFLIGHT FAIL%s  %d of %d checks failed against %s: %s\n' \
  "$C_FAIL" "$C_OFF" "$FAILCOUNT" "$TOTAL" "$ORIGIN" "$names"
if [ "$QUIET" -eq 0 ]; then
  while IFS= read -r f; do printf '  %s\n' "$f"; done < "$TMP/failures"
fi
exit 1
