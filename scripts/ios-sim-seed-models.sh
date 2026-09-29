#!/usr/bin/env bash
# Puts the two required models (embedding + default LLM) into the booted iOS
# Simulator's app container, where ModelManager looks for them
# (Documents/models/<catalog filename>). Uses APFS clones (cp -c), so it costs
# no extra disk when the source is on the same volume. The app must have been
# installed (and launched once) first.
#
#   scripts/ios-sim-seed-models.sh [models_dir]   # default /Users/r4to/Script/boar/shared-models
#   IOS_SIM_UDID=<udid> ...                        # a specific simulator instead of "booted"
set -euo pipefail

SRC="${1:-/Users/r4to/Script/boar/shared-models}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="$(node -p "require('$ROOT/app.json').expo.ios.bundleIdentifier")"
DATA="$(xcrun simctl get_app_container "${IOS_SIM_UDID:-booted}" "$BUNDLE_ID" data)"
DEST="$DATA/Documents/models"
mkdir -p "$DEST"

# source file in $SRC -> catalog filename (src/models/manifest.ts)
seed() {
  local from="$SRC/$1" to="$DEST/$2"
  [[ -f "$from" ]] || { echo "missing $from" >&2; exit 1; }
  rm -f "$to"
  cp -c "$from" "$to" 2>/dev/null || cp "$from" "$to"
  echo "$(stat -f %z "$to") bytes  $to"
}
seed bge-small-en-v1.5-q8_0.gguf embedding.gguf
seed Qwen2.5-1.5B-Instruct-Q4_K_M.gguf qwen2.5-1.5b-instruct-q4km.gguf
