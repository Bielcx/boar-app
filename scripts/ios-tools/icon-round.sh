#!/usr/bin/env bash
# Icon-alignment round on the iPhone SE (3rd gen, 375 pt) simulator.
#   icon-round.sh <BOAR.app> <out-dir> <size-tag:content-size>...
#   e.g. icon-round.sh app out default:large axxl:accessibility-extra-large axxxl:accessibility-extra-extra-large
# Per size: fresh install with bge + 1.5B -> chat answer with sources (4), drawer (2),
# Settings top + Appearance (1), Models + available (3), Knowledge (5); then a fresh
# install without models -> setup 1 (Get started) and setup 2 (OptionCard).
# Navigation finds text with Vision OCR (findtext) and falls back to fixed points.
set -u
APP="$1"; OUT="$2"; shift 2
SE="${SE_UDID:-0305BDAA-FD18-4C14-B6F0-6FBA745ACD98}"
M=/Users/r4to/Script/boar/shared-models
FT="${FINDTEXT:-/Users/r4to/Script/boar/builds/ios/tools/findtext}"  # build: swiftc -O scripts/ios-tools/findtext.swift -o <path>
T=$(mktemp -d); mkdir -p "$OUT"
P="Harbor SE $(date +%H%M%S)"
xcrun simctl boot "$SE" 2>/dev/null; xcrun simctl bootstatus "$SE" -b >/dev/null
xcrun simctl ui "$SE" appearance dark
xcrun simctl status_bar "$SE" override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularMode notSupported
maestri portal create --simulator "$SE" "$P" >/dev/null 2>&1
shot() { xcrun simctl io "$SE" screenshot "$OUT/$1.png" >/dev/null 2>&1; echo "  $1"; }
cur() { xcrun simctl io "$SE" screenshot "$T/c.png" >/dev/null 2>&1; }
tap() { maestri portal click "$P" "$1" >/dev/null; sleep "${2:-1.8}"; }
find_text() { cur; "$FT" "$T/c.png" "$1" 2>/dev/null; }
tap_text() { local xy; xy=$(find_text "$1") && { tap "$xy" "${3:-1.8}"; return 0; }; [[ -n "${2:-}" ]] && { tap "$2" "${3:-1.8}"; return 0; }; echo "  ! '$1' not found"; return 1; }
scroll() { maestri portal scroll "$P" "$1" "${2:-300}" >/dev/null; sleep 1; }
scroll_to() { for _ in $(seq 1 12); do xy=$(find_text "$1") && { y=${xy#*,}; (( y > 90 && y < 560 )) && return 0; }; scroll "${2:-down}" 250; done; return 1; }
install() {
  xcrun simctl terminate "$SE" team.sopa.aoair 2>/dev/null; xcrun simctl uninstall "$SE" team.sopa.aoair 2>/dev/null
  xcrun simctl install "$SE" "$APP"
  if [[ "$1" == models ]]; then
    local d; d="$(xcrun simctl get_app_container "$SE" team.sopa.aoair data)/Documents/models"; mkdir -p "$d"
    cp -c "$M/bge-small-en-v1.5-q8_0.gguf" "$d/embedding.gguf"; cp -c "$M/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" "$d/qwen2.5-1.5b-instruct-q4km.gguf"
  fi
  maestri portal launch "$P" team.sopa.aoair >/dev/null 2>&1
}
for spec in "$@"; do
  tag=${spec%%:*}; size=${spec#*:}; echo "== $tag ($size)"
  xcrun simctl ui "$SE" content_size "$size"
  install models
  for _ in $(seq 1 60); do s=$(maestri portal snapshot "$P" 2>/dev/null); grep -q "Ask: " <<<"$s" && ! grep -qE "Indexing|Loading|Preparing" <<<"$s" && break; sleep 3; done
  # Ask by typing (a suggestion card can be below the fold at large text sizes).
  cur; sxy=$(python3 - "$T/c.png" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); s = im.width / 375
pts = [(x, y) for y in range(int(560 * s), im.height, 3) for x in range(int(290 * s), im.width, 3) if (lambda r, g, b: r > 200 and 80 < g < 170 and b < 120)(*im.getpixel((x, y)))]
xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
print(f"{round((min(xs) + max(xs)) / 2 / s)},{round((min(ys) + max(ys)) / 2 / s)}" if pts else "333,633")
EOF
)
  tap "140,${sxy#*,}" 0.6; maestri portal type "$P" "What causes the greenhouse effect?" >/dev/null; sleep 0.4; tap "$sxy" 2
  for _ in $(seq 1 60); do maestri portal snapshot "$P" 2>/dev/null | grep -q "Copy answer" && break; sleep 2; done
  xy=$(find_text "SOURCES ON") && { x=${xy%,*}; y=${xy#*,}; tap "187,$((y + 34))" 1.5; }
  scroll down 150; shot "4-chat-sources-$tag-en"
  tap 37,44 1.5; shot "2-drawer-$tag-en"
  drawer_to() { for _ in 1 2 3 4; do xy=$(find_text "$1") && { tap "$xy"; return 0; }; scroll down 250; done; echo "  ! drawer '$1' not found"; return 1; }
  drawer_to "Settings"; shot "1-settings-top-$tag-en"
  scroll_to "APPEARANCE" down && shot "1-settings-appearance-$tag-en"
  scroll up 3000
  if scroll_to "Models" down; then xy=$(find_text "Models"); tap "$xy"
  else scroll up 3000; scroll_to "LIBRARY" down && { xy=$(find_text "LIBRARY"); tap "187,$(( ${xy#*,} + 45 ))"; } || echo "  ! Models not found"; fi
  shot "3-models-$tag-en"; scroll down 700; shot "3-models-available-$tag-en"
  tap 37,42 1.5; tap 37,42 1.5; tap 37,44 1.5
  drawer_to "Knowledge"; shot "5-knowledge-$tag-en"
  install none
  for _ in $(seq 1 30); do maestri portal snapshot "$P" 2>/dev/null | grep -q "Get started" && break; sleep 1; done; sleep 1
  shot "0-setup1-$tag-en"
  tap_text "Get started" "187,630" 2; shot "0-setup2-optioncard-$tag-en"
done
xcrun simctl ui "$SE" content_size large
rm -rf "$T"
