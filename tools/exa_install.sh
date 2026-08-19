#!/bin/bash
# Install an Exa key in both places and run the honest gate, from one paste.
#
#   bash tools/exa_install.sh
#
# One hidden prompt. The value is written to .dev.vars quoted, to match the
# other vars in that file, and piped to the Worker secret unquoted, because
# quotes in a secret are sent verbatim and Exa answers 401 to a key wrapped in
# them. That exact mistake cost a debugging round: same symptom as a bad key,
# entirely different cause.
#
# The key never reaches an argv, a log, or a shell history entry.
set -euo pipefail
cd "$(dirname "$0")/.."

printf 'Paste the Exa key (hidden): '
read -rs KEY
echo
KEY="${KEY//[$'\r\n\"']/}"
if [ -z "$KEY" ]; then echo "empty, nothing changed"; exit 1; fi

echo "== 1/3  .dev.vars =="
cp .dev.vars .dev.vars.bak
grep -v '^EXA_API_KEY=' .dev.vars > .dev.vars.tmp || true
printf 'EXA_API_KEY="%s"\n' "$KEY" >> .dev.vars.tmp
mv .dev.vars.tmp .dev.vars
echo "written, previous file kept at .dev.vars.bak"

echo
echo "== 2/3  Worker secret =="
printf %s "$KEY" | npx wrangler secret put EXA_API_KEY --env=""
unset KEY

echo
echo "== 3/3  one deliberate search =="
echo "Waiting 15s for the secret to propagate."
sleep 15
curl -s "https://streetcred.thealexschroeder.workers.dev/api/health?probe=exa" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  exa:       ",d["exa"]);print("  unit price: $%s"%d.get("exaUnitUsd"));print("  plan tier: ",d.get("exaPlan"))'

echo
echo "If that says ok, refresh the workspace Usage page: one search should appear."
echo "Usage moving with the balance frozen still passes, free credits go first."
echo "Then tell Claude the workspace name."
