#!/usr/bin/env bash
# Capture a PNG from the connected Android device/emulator.
# Usage: e2e/scripts/shot.sh <out-dir> <name>   → <out-dir>/<name>.png
set -euo pipefail
ADB="${ADB:-${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb}"
out="$1"; name="$2"
mkdir -p "$out"
"$ADB" exec-out screencap -p > "$out/$name.png"
echo "$out/$name.png"
