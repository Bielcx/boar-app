#!/usr/bin/env bash
# Copies GGUF models into the BOAR app's container on a real iPhone over the
# USB/network device link (devicectl), so the phone needs no network. The app
# must be installed with a development-signed build (devicectl can only write
# into containers of apps it can debug).
#
#   IOS_DEVICE=<devicectl id> scripts/ios-device-seed-models.sh [models_dir] [set]
#     set = compact (default: bge + Qwen2.5-1.5B) | 4b (bge + Qwen3-4B) | all
#
# Files land in Documents/models/<catalog filename> (src/models/manifest.ts).
set -euo pipefail

: "${IOS_DEVICE:?set IOS_DEVICE (xcrun devicectl list devices)}"
SRC="${1:-/Users/r4to/Script/boar/shared-models}"
SET="${2:-compact}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="$(node -p "require('$ROOT/app.json').expo.ios.bundleIdentifier")"

# source file in $SRC -> catalog filename
EMBED="bge-small-en-v1.5-q8_0.gguf:embedding.gguf"
COMPACT="Qwen2.5-1.5B-Instruct-Q4_K_M.gguf:qwen2.5-1.5b-instruct-q4km.gguf"
FOUR_B="Qwen3-4B-Instruct-2507-Q4_K_M.gguf:qwen3-4b-instruct-2507-q4km.gguf"
case "$SET" in
  compact) PAIRS=("$EMBED" "$COMPACT") ;;
  4b) PAIRS=("$EMBED" "$FOUR_B") ;;
  all) PAIRS=("$EMBED" "$COMPACT" "$FOUR_B") ;;
  *) echo "unknown set $SET" >&2; exit 2 ;;
esac

for pair in "${PAIRS[@]}"; do
  from="$SRC/${pair%%:*}" to="Documents/models/${pair##*:}"
  [[ -f "$from" ]] || { echo "missing $from" >&2; exit 1; }
  echo "$(stat -f %z "$from") bytes  $from -> $to"
  xcrun devicectl device copy to --device "$IOS_DEVICE" \
    --domain-type appDataContainer --domain-identifier "$BUNDLE_ID" \
    --source "$from" --destination "$to"
done
