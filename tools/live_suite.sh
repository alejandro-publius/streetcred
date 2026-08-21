#!/usr/bin/env bash
# The permanent live cells, as one command a deploy can gate on.
#
#   tools/live_suite.sh
#   STREETCRED_ORIGIN=https://streetcred-preview.thealexschroeder.workers.dev tools/live_suite.sh
#
# Exits 0 only if every cell passes, so it can sit in front of a promotion to
# production without anything else having to interpret its output.
#
# --test-force-exit is not optional and not a style preference. Without it the
# runner prints every result and then does not exit: undici's connection pool
# holds the process open after the last assertion, and these suites open dozens
# of sockets. A gate that passes and then hangs is worse than no gate, because
# it blocks the deploy it was meant to protect and looks like a failure while
# doing it. The flag preserves exit codes: 0 on pass, 1 on any failure, both
# verified.
set -uo pipefail

ORIGIN="${STREETCRED_ORIGIN:-https://streetcred.thealexschroeder.workers.dev}"
cd "$(dirname "$0")/.."

SUITES=(tools/audited_live.mjs tools/audited_page_live.mjs)
rc=0
for s in "${SUITES[@]}"; do
  echo "=== ${s#tools/} against ${ORIGIN} ==="
  if STREETCRED_ORIGIN="$ORIGIN" node --test --test-force-exit "$s"; then
    :
  else
    rc=1
  fi
done

if [ "$rc" -eq 0 ]; then
  echo "LIVE SUITE GREEN against ${ORIGIN}"
else
  echo "LIVE SUITE FAILED against ${ORIGIN}"
fi
exit "$rc"
