#!/bin/bash
# Install an Exa key and run the honest gate, without the key passing through
# anything but this shell.
#
#   bash tools/exa_install.sh
#
# It prompts twice for the same key: once for the Worker secret, once for
# .dev.vars. Neither prompt echoes and neither value is written to a log, a
# shell history entry, or an argv. Then it fires exactly one deliberate search
# for you to watch your workspace's Usage page for.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/3  Worker secret =="
echo "Paste the key at the wrangler prompt."
npx wrangler secret put EXA_API_KEY

echo
echo "== 2/3  .dev.vars =="
printf 'Paste the same key (hidden): '
read -rs KEY
echo
if [ -z "$KEY" ]; then echo "empty, nothing written to .dev.vars"; exit 1; fi
cp .dev.vars .dev.vars.bak
# Rewritten via a temp file so a failure halfway leaves the original intact.
if grep -q '^EXA_API_KEY=' .dev.vars; then
  grep -v '^EXA_API_KEY=' .dev.vars > .dev.vars.tmp
else
  cp .dev.vars .dev.vars.tmp
fi
printf 'EXA_API_KEY=%s\n' "$KEY" >> .dev.vars.tmp
mv .dev.vars.tmp .dev.vars
unset KEY
echo "written, previous file kept at .dev.vars.bak"

echo
echo "== 3/3  one deliberate search =="
echo "Waiting 15s for the secret to propagate."
sleep 15
curl -s "https://streetcred.thealexschroeder.workers.dev/api/health?probe=exa" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  exa:", d["exa"]);print("  unit price: $%s" % d.get("exaUnitUsd"));print("  plan tier:", d.get("exaPlan"))'

echo
echo "Now open the workspace Usage page and refresh it."
echo "One search should appear. If Usage moves and the balance does not, that still passes:"
echo "free monthly credits are consumed before a balance moves."
echo
echo "Then tell Claude the workspace name, or run it yourself:"
echo '  node tools/exa_verify.mjs --workspace "<name>" --balance <usd>'
echo '  node tools/press_batch.mjs --limit 10'
