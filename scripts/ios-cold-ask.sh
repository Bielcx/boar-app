#!/usr/bin/env bash
# Cold boot with a question asked while the models load (simulator).
# Fresh install, bge + Qwen2.5-1.5B seeded (APFS clones), screen recording and
# the app's [boot]/[answer] console lines (build with IOS_RN_LOG_INFO=1), the
# question typed and sent ASK_AT seconds after the launch, then a contact sheet
# every 3 s and the answer's performance receipt, if one arrived.
#
#   scripts/ios-cold-ask.sh <udid> <BOAR.app> <out-dir> ["question"]
#
# Env: ASK_AT (s, default 2), RECORD_S (default 75), IOS_FIDELITY_PORTAL
# (maestri portal on that simulator, default "Harbor Fidelity 2"),
# IOS_MODELS_DIR (default /Users/r4to/Script/boar/shared-models).
set -euo pipefail
DEV="${1:?udid}"; APP="${2:?app}"; OUT="${3:?out dir}"; Q="${4:-What causes the monsoon?}"
PORTAL="${IOS_FIDELITY_PORTAL:-Harbor Fidelity 2}"
MODELS="${IOS_MODELS_DIR:-/Users/r4to/Script/boar/shared-models}"
BUNDLE=team.sopa.aoair
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
now() { python3 -c 'import time; print(time.time())'; }
send_xy() {  # centre of the accent send button (bottom right)
  xcrun simctl io "$DEV" screenshot "$TMP/t.png" >/dev/null 2>&1
  python3 - "$TMP/t.png" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); s = im.width / 393
acc = lambda c: c[0] > 220 and 90 < c[1] < 160 and c[2] < 110
pts = [(x, y) for y in range(int(740 * s), im.height, 3) for x in range(int(330 * s), im.width, 3) if acc(im.getpixel((x, y)))]
xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
print(f"{round((min(xs) + max(xs)) / 2 / s)},{round((min(ys) + max(ys)) / 2 / s)}" if pts else "351,797")
EOF
}

xcrun simctl terminate "$DEV" "$BUNDLE" 2>/dev/null || true
xcrun simctl uninstall "$DEV" "$BUNDLE" 2>/dev/null || true
xcrun simctl install "$DEV" "$APP"
d="$(xcrun simctl get_app_container "$DEV" "$BUNDLE" data)/Documents/models"; mkdir -p "$d"
cp -c "$MODELS/bge-small-en-v1.5-q8_0.gguf" "$d/embedding.gguf"
cp -c "$MODELS/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" "$d/qwen2.5-1.5b-instruct-q4km.gguf"

xcrun simctl spawn "$DEV" log stream --style compact --level info --predicate 'eventMessage CONTAINS "[boot]"' > "$OUT/cold-ask-boot.log" 2>/dev/null & L1=$!
xcrun simctl spawn "$DEV" log stream --style compact --level info --predicate 'eventMessage CONTAINS "[answer]"' > "$OUT/cold-ask-answer.log" 2>/dev/null & L2=$!
xcrun simctl io "$DEV" recordVideo --codec h264 --force "$OUT/cold-ask.mp4" >/dev/null 2>&1 & REC=$!
sleep 1.5
T0=$(now)
maestri portal launch "$PORTAL" "$BUNDLE" >/dev/null 2>&1 || true
sleep "${ASK_AT:-2}"
XY=$(send_xy); Y=${XY#*,}
maestri portal click "$PORTAL" "150,$Y" >/dev/null; sleep 0.4
maestri portal type "$PORTAL" "$Q" >/dev/null; sleep 0.3
maestri portal click "$PORTAL" "$XY" >/dev/null
T1=$(now)
echo "question sent at $(python3 -c "print(round($T1 - $T0, 1))") s after the launch command (tap $XY)" | tee "$OUT/cold-ask.txt"
sleep "${RECORD_S:-75}"
kill -INT "$REC"; wait "$REC" 2>/dev/null || true
kill "$L1" "$L2" 2>/dev/null || true
maestri portal snapshot "$PORTAL" 2>/dev/null | grep -o 'Performance details[^"]*' | tee -a "$OUT/cold-ask.txt" || echo "no answer receipt on screen" | tee -a "$OUT/cold-ask.txt"
grep -o '\[answer\].*' "$OUT/cold-ask-answer.log" | tee -a "$OUT/cold-ask.txt" || true
mkdir -p "$TMP/f"; ffmpeg -loglevel error -i "$OUT/cold-ask.mp4" -vf "fps=1/3,scale=196:-1" "$TMP/f/%03d.png"
python3 - "$TMP/f" "$OUT/cold-ask-sheet.png" <<'EOF'
import sys, glob
from PIL import Image, ImageDraw
fs = sorted(glob.glob(sys.argv[1] + "/*.png")); ims = [Image.open(f).convert("RGB") for f in fs]
w, h = ims[0].size; cols = 9
s = Image.new("RGB", ((w + 8) * cols, (h + 22) * ((len(ims) + cols - 1) // cols)), "white"); d = ImageDraw.Draw(s)
for i, im in enumerate(ims):
    x = (i % cols) * (w + 8); y = (i // cols) * (h + 22); s.paste(im, (x, y + 20)); d.text((x + 4, y + 4), f"t={i * 3}s", fill="black")
s.save(sys.argv[2])
EOF
echo "sheet: $OUT/cold-ask-sheet.png"
