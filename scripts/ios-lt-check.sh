#!/usr/bin/env bash
# Large-title check (LT-1) on the simulator: builds a ref, opens Settings,
# Models and Knowledge at the top and scrolled, and says whether text is drawn
# in the large-title band (y 105-175 pt) of each top screen.
#
#   scripts/ios-lt-check.sh <git-ref>
#
# A new maestri portal is created each run: a portal loses its input when the
# simulator it watches reboots.
set -euo pipefail
REF="${1:?git ref}"
B=/Users/r4to/Script/boar
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV="${IOS_FIDELITY_DEVICE:-$(xcrun simctl list devices | grep 'BOAR Fidelity iPhone 16' | grep -oE '[0-9A-F-]{36}' | head -1)}"
MODELS="${IOS_MODELS_DIR:-$B/shared-models}"
BUNDLE=team.sopa.aoair
HASH=$(git -C "$REPO" rev-parse --short "$REF")
PORTAL="Harbor LT $(date +%H%M%S)"

IOS_FIDELITY_ONLY=splash IOS_FIDELITY_LOCAL=1 IOS_FIDELITY_PORTAL="$PORTAL" \
  bash "$REPO/scripts/ios-shots-fidelity.sh" "$REF" >/dev/null 2>&1 || true
APP="$B/builds/ios/fidelity/$HASH/iphonesimulator/BOAR.app"
[[ -d "$APP" ]] || { echo "no app for $HASH"; exit 1; }
R="$B/shots/fidelity/$HASH/raw"; mkdir -p "$R"

xcrun simctl boot "$DEV" 2>/dev/null || true; xcrun simctl bootstatus "$DEV" -b >/dev/null
maestri portal create --simulator "$DEV" "$PORTAL" >/dev/null 2>&1 || true
xcrun simctl terminate "$DEV" "$BUNDLE" 2>/dev/null || true
xcrun simctl uninstall "$DEV" "$BUNDLE" 2>/dev/null || true
xcrun simctl install "$DEV" "$APP"
d="$(xcrun simctl get_app_container "$DEV" "$BUNDLE" data)/Documents/models"; mkdir -p "$d"
cp -c "$MODELS/bge-small-en-v1.5-q8_0.gguf" "$d/embedding.gguf"
cp -c "$MODELS/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" "$d/qwen2.5-1.5b-instruct-q4km.gguf"
maestri portal launch "$PORTAL" "$BUNDLE" >/dev/null 2>&1
for _ in $(seq 1 60); do
  s=$(maestri portal snapshot "$PORTAL" 2>/dev/null || true)
  grep -q "Ask: " <<<"$s" && ! grep -qE "Indexing|Loading|Preparing" <<<"$s" && break; sleep 3
done
tap() { maestri portal click "$PORTAL" "$1" >/dev/null; sleep "${2:-2}"; }
shot() { xcrun simctl io "$DEV" screenshot "$R/$1.png" >/dev/null 2>&1; }
tap 37,84 1.5; tap 78,746; shot settings-top
maestri portal scroll "$PORTAL" down 350 >/dev/null; sleep 1.2; shot settings-scrolled
maestri portal scroll "$PORTAL" up 800 >/dev/null; sleep 1.2
tap 200,615; shot models-top
tap 37,80 1.5; tap 200,663; shot knowledge-top
maestri portal scroll "$PORTAL" down 400 >/dev/null; sleep 1.2; shot knowledge-scrolled

for f in settings-top models-top knowledge-top; do
  python3 - "$R/$f.png" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); s = im.width / 393
# light text pixels (title colour) in the large-title band, left half (where a large title sits)
n = sum(1 for y in range(int(105 * s), int(175 * s), 2) for x in range(int(16 * s), int(250 * s), 2)
        if min(im.getpixel((x, y))) > 180)
name = sys.argv[1].split("/")[-1]
print(f"{name}: large title {'DRAWN' if n > 40 else 'EMPTY'} ({n} light px in the band)")
EOF
done | tee "$R/lt-check.txt"
echo "shots: $R"
