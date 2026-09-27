#!/usr/bin/env bash
# Tap the first element whose label contains <text> on the Maestri portal (default "Pixel").
# Scrolls down up to 4 times looking for it. Usage: e2e/scripts/tap.sh "<text>" [portal]
set -uo pipefail
text="$1"; portal="${2:-Pixel}"
for i in 0 1 2 3 4; do
  ref=$(maestri portal snapshot "$portal" | grep -F -- "$text" | head -1 | grep -oE '^@e[0-9]+')
  if [ -n "$ref" ]; then maestri portal click "$portal" "$ref" >/dev/null; exit 0; fi
  maestri portal scroll "$portal" down 800 >/dev/null
done
echo "tap.sh: '$text' not found" >&2; exit 1
