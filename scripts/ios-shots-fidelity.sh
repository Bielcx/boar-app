#!/usr/bin/env bash
# Fidelity shots (review/ui-qa/FIDELITY.md): builds the app for a git ref,
# captures the 8 mockup screens on an iPhone 16 simulator (393x852 pt, the
# mockup's frame) in dark Fogueira, EN, text size 1.0, and writes
# mockup | app | 50% overlay into shots/fidelity/<hash>/.
#
#   scripts/ios-shots-fidelity.sh [git-ref] [variant]   # default origin/integration offline
#   make shots-fidelity [REF=<git-ref>] [VARIANT=offline|downloader]
#
# The variant is EXPO_PUBLIC_BOAR_VARIANT; "offline" is the submission build
# and the one the mockup shows (OFFLINE badge, models imported by file).
#
# Needs: Xcode 27 on the build host (the mini, via scripts/ios-remote-build.sh),
# the iOS 26.1 simulator runtime here, the maestri portal CLI (taps), the
# shared models (bge + Qwen2.5-1.5B), Python with Pillow, ffmpeg.
# Env: IOS_FIDELITY_SRC (detached worktree used to build, default
# /Users/r4to/Script/boar/builds/ios/src), IOS_FIDELITY_REBUILD=1 (ignore the
# cached .app), IOS_FIDELITY_SKIP_DEPS=0/1 (force or skip the prebuild on the
# build host; default: skip when nothing native changed since its last prebuild),
# IOS_FIDELITY_ONLY=splash (splash frames + setup only), IOS_FIDELITY_SKIP_ERROR=1,
# IOS_FIDELITY_PORTAL (portal name, default "Harbor Fidelity"), IOS_FIDELITY_LOCAL=1
# (build on this Mac instead of the mini; IOS_XCODEBUILD_JOBS, default 4, under nice).
set -euo pipefail

REF="${1:-origin/integration}"
VARIANT="${2:-offline}"
B=/Users/r4to/Script/boar
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${IOS_FIDELITY_SRC:-$B/builds/ios/src}"
MODELS="${IOS_MODELS_DIR:-$B/shared-models}"
PORTAL="${IOS_FIDELITY_PORTAL:-Harbor Fidelity}"
SCREENS="$B/review/ui-ref/screens"
BUNDLE=team.sopa.aoair
QUESTION="What causes the monsoon?"
# The mockup's generating-screen question (review/ui-ref/template.html).
GEN_QUESTION="I'm trekking in a high-altitude arid environment. Synthesize methods for off-grid water purification, compare chemical treatment vs. microfiltration, and outline altitude sickness management protocols."
T0=$(date +%s)
log() { printf '[shots-fidelity %s +%ss] %s\n' "$(date +%H:%M:%S)" "$(( $(date +%s) - T0 ))" "$*"; }

git -C "$REPO" fetch -q origin
HASH=$(git -C "$REPO" rev-parse --short "$REF")
TAG=$HASH; [[ "$VARIANT" == offline ]] || TAG="$HASH-$VARIANT"
OUT="$B/shots/fidelity/$TAG"; RAW="$OUT/raw"
APPDIR="$B/builds/ios/fidelity/$TAG"; APP="$APPDIR/iphonesimulator/BOAR.app"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$RAW"
log "ref $REF = $HASH, variant $VARIANT -> $OUT"

# ---------- 1. build (cached per hash) ----------
NATIVE=(app.json app.config.js package.json package-lock.json modules assets/icon.png assets/icon-ios.png assets/splash-icon.png)
# plugins/ counts only when the change touches iOS mods (most of them are Android-only).
ios_plugin_change() { git -C "$SRC" diff "$1" "$HASH" -- plugins | grep -qE '^[+-].*(withIos|withInfoPlist|withEntitlements|withXcode|withPodfile|withAppDelegate|"ios")'; }
if [[ ! -d "$APP" || "${IOS_FIDELITY_REBUILD:-0}" == "1" ]]; then
  [[ -d "$SRC" ]] || git -C "$REPO" worktree add --detach -q "$SRC" "$HASH"
  git -C "$SRC" fetch -q origin
  # $SRC is a build-only worktree: drop the build scripts copied into it last
  # time (tracked or not) before switching refs, then copy the newest ones again.
  git -C "$SRC" clean -q -f -- scripts
  git -C "$SRC" checkout -q -f --detach "$HASH"
  cp "$REPO"/scripts/ios-*.sh "$SRC/scripts/"   # the newest build scripts, whatever the ref
  # Marker of the last full prebuild ("<hash> <variant>"; the variant renames the
  # Xcode project, so a switch needs a prebuild). Local builds keep it next to
  # the builds; remote ones outside the synced folder (rsync --delete).
  if [[ "${IOS_FIDELITY_LOCAL:-0}" == "1" ]]; then
    MARK="$B/builds/ios/ios-prebuilt-local"; PREBUILT=$(cat "$MARK" 2>/dev/null || true)
  else
    PREBUILT=$(ssh "${IOS_BUILD_HOST:-r4toMacMini}" "cat boar/ios-prebuilt 2>/dev/null" || true)
  fi
  PREBUILT_VARIANT=${PREBUILT#* }; PREBUILT=${PREBUILT%% *}
  [[ "$PREBUILT_VARIANT" == "$VARIANT" ]] || PREBUILT=""
  SKIP=0
  if [[ -n "$PREBUILT" ]] && git -C "$SRC" cat-file -e "$PREBUILT" 2>/dev/null \
     && git -C "$SRC" diff --quiet "$PREBUILT" "$HASH" -- "${NATIVE[@]}" && ! ios_plugin_change "$PREBUILT"; then SKIP=1; fi
  SKIP="${IOS_FIDELITY_SKIP_DEPS:-$SKIP}"
  if [[ "${IOS_FIDELITY_LOCAL:-0}" == "1" ]]; then
    log "build on this Mac (reuse prebuild of ${PREBUILT:-none}: $SKIP)"
    DEV_FOR_BUILD="${IOS_FIDELITY_DEVICE:-$(xcrun simctl list devices | grep 'BOAR Fidelity iPhone 16' | grep -oE '[0-9A-F-]{36}' | head -1)}"
    (cd "$SRC" && EXPO_PUBLIC_BOAR_VARIANT="$VARIANT" IOS_SKIP_DEPS=$SKIP IOS_NO_QUEUE=1 IOS_XCODEBUILD_JOBS="${IOS_XCODEBUILD_JOBS:-4}" \
      IOS_SIM_DEVICE="$DEV_FOR_BUILD" IOS_XCODE_APP="${IOS_XCODE_APP:-/Applications/Xcode-27.0.0.app}" \
      IOS_OUT_DIR="$APPDIR" bash scripts/ios-build-on-host.sh sim) > "$APPDIR.build.log" 2>&1 \
      || { tail -20 "$APPDIR.build.log"; exit 65; }
    BUILT=$(ls -d "$APPDIR"/iphonesimulator/*.app | head -1)
    [[ "$BUILT" == "$APP" ]] || { rm -rf "$APP"; mv "$BUILT" "$APP"; }
    [[ "$SKIP" == 1 ]] || echo "$HASH $VARIANT" > "$MARK"
  else
    log "build on the mini (reuse prebuild of ${PREBUILT:-none}: $SKIP)"
    (cd "$SRC" && EXPO_PUBLIC_BOAR_VARIANT="$VARIANT" IOS_SKIP_DEPS=$SKIP IOS_XCODE_APP="${IOS_XCODE_APP:-/Applications/Xcode-27.0.0.app}" \
      IOS_OUT_DIR="$APPDIR" bash scripts/ios-remote-build.sh sim) > "$APPDIR.build.log" 2>&1 \
      || { tail -20 "$APPDIR.build.log"; exit 65; }
    [[ "$SKIP" == 1 ]] || ssh "${IOS_BUILD_HOST:-r4toMacMini}" "echo $HASH $VARIANT > boar/ios-prebuilt"
  fi
fi
log "app ready: $APP"

# ---------- 2. simulator: iPhone 16, dark, 1.0, 9:41 ----------
DEV="${IOS_FIDELITY_DEVICE:-$(xcrun simctl list devices | grep 'BOAR Fidelity iPhone 16' | grep -oE '[0-9A-F-]{36}' | head -1)}"
if [[ -z "$DEV" ]]; then
  RT=$(xcrun simctl list runtimes | grep -E 'iOS 26\.1' | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+' | head -1)
  DEV=$(xcrun simctl create "BOAR Fidelity iPhone 16" com.apple.CoreSimulator.SimDeviceType.iPhone-16 "$RT")
fi
xcrun simctl boot "$DEV" 2>/dev/null || true
xcrun simctl bootstatus "$DEV" -b >/dev/null
xcrun simctl ui "$DEV" appearance dark
xcrun simctl ui "$DEV" content_size large
xcrun simctl status_bar "$DEV" override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularMode notSupported
maestri portal info "$PORTAL" >/dev/null 2>&1 || maestri portal create --simulator "$DEV" "$PORTAL" >/dev/null

shot() { xcrun simctl io "$DEV" screenshot "$RAW/$1.png" >/dev/null 2>&1; log "shot $1"; }
snap() { maestri portal snapshot "$PORTAL" 2>/dev/null || true; }
# wait_for <regex> [timeout s] [absent-regex]: until the accessibility tree matches.
wait_for() {
  local re=$1 t=${2:-60} not=${3:-} end=$(( $(date +%s) + ${2:-60} )) s
  while (( $(date +%s) < end )); do
    s=$(snap)
    if grep -qE "$re" <<<"$s" && { [[ -z "$not" ]] || ! grep -qE "$not" <<<"$s"; }; then return 0; fi
    sleep 1
  done
  log "timeout ($t s) waiting for /$re/"; return 1
}
# tap_orange <y0> <y1> [x0 x1]: tap the centre of the accent-coloured (#FF7A3D)
# area inside that box (pt). Give the x range when another accent element shares
# the rows (the focused composer's border next to the send button).
tap_orange() {
  xcrun simctl io "$DEV" screenshot "$TMP/t.png" >/dev/null 2>&1
  local xy; xy=$(python3 - "$TMP/t.png" "$1" "$2" "${3:-0}" "${4:-393}" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); s = im.width / 393
y0, y1 = int(float(sys.argv[2]) * s), int(float(sys.argv[3]) * s)
x0, x1 = int(float(sys.argv[4]) * s), min(int(float(sys.argv[5]) * s), im.width)
pts = [(x, y) for y in range(y0, min(y1, im.height), 3) for x in range(x0, x1, 3)
       if (lambda r, g, b: r > 220 and 90 < g < 160 and b < 110)(*im.getpixel((x, y)))]
if not pts: sys.exit(1)
xs, ys = [p[0] for p in pts], [p[1] for p in pts]
print(f"{round((min(xs) + max(xs)) / 2 / s)},{round((min(ys) + max(ys)) / 2 / s)}")
EOF
) || { log "no accent button between $1..$2 pt"; return 1; }
  maestri portal click "$PORTAL" "$xy" >/dev/null
}
# tap_card <n>: tap the n-th suggestion card (1-based), found as the n-th run of
# card-surface rows (s1) along x=22 pt (inside the card, left of its text) between the "TRY ASKING" label and the composer.
tap_card() {
  xcrun simctl io "$DEV" screenshot "$TMP/t.png" >/dev/null 2>&1
  local xy; xy=$(python3 - "$TMP/t.png" "${1:-1}" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); s = im.width / 393; n = int(sys.argv[2] or 1)
card = lambda c: 28 <= c[0] <= 48 and 20 <= c[1] <= 36 and 14 <= c[2] <= 30   # s1 #221913 +- glow
runs, start = [], None
for y in range(int(300 * s), int(740 * s)):
    on = card(im.getpixel((int(22 * s), y)))  # card padding, left of the text
    if on and start is None: start = y
    if not on and start is not None:
        if y - start > 30 * s: runs.append((start, y))
        start = None
if len(runs) < n: sys.exit(1)
a, b = runs[n - 1]
print(f"196,{round((a + b) / 2 / s)}")
EOF
) || { log "suggestion card $1 not found"; return 1; }
  maestri portal click "$PORTAL" "$xy" >/dev/null
}
# tap_first_source: the sources header has a book icon in accent-2 (#FFC15E) at
# x~43 pt; the first source row sits ~36 pt below it.
tap_first_source() {
  xcrun simctl io "$DEV" screenshot "$TMP/t.png" >/dev/null 2>&1
  local xy; xy=$(python3 - "$TMP/t.png" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); s = im.width / 393
ys = [y for y in range(int(150 * s), int(780 * s), 2) for x in range(int(36 * s), int(50 * s), 2)
      if (lambda r, g, b: r > 220 and 160 < g < 215 and b < 130)(*im.getpixel((x, y)))]
if not ys: sys.exit(1)
print(f"196,{round(max(ys) / s + 36)}")
EOF
) || { log "sources header not found"; return 1; }
  maestri portal click "$PORTAL" "$xy" >/dev/null
}
container() { xcrun simctl get_app_container "$DEV" "$BUNDLE" data; }
fresh_install() {
  xcrun simctl terminate "$DEV" "$BUNDLE" 2>/dev/null || true
  xcrun simctl uninstall "$DEV" "$BUNDLE" 2>/dev/null || true
  xcrun simctl install "$DEV" "$APP"
}
seed() {  # APFS clones: no extra disk
  local d; d="$(container)/Documents/models"; mkdir -p "$d"
  cp -c "$MODELS/bge-small-en-v1.5-q8_0.gguf" "$d/embedding.gguf"
  cp -c "$MODELS/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" "$d/qwen2.5-1.5b-instruct-q4km.gguf"
}

if [[ "${IOS_FIDELITY_ONLY:-}" != "splash" ]]; then
# ---------- 3. chat: error, empty, generating, answer ----------
# ask <question>: type into the composer (tap on its centre line, the send
# button's height; the simulator's hardware keyboard keeps the soft keyboard
# off screen, as in the mockup) and send.
ask() {
  xcrun simctl io "$DEV" screenshot "$TMP/t.png" >/dev/null 2>&1
  local y; y=$(python3 - "$TMP/t.png" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); s = im.width / 393
ys = [y for y in range(int(740 * s), im.height, 3) for x in range(int(320 * s), im.width, 3)
      if (lambda r, g, b: r > 220 and 90 < g < 160 and b < 110)(*im.getpixel((x, y)))]
print(round((min(ys) + max(ys)) / 2 / s) if ys else 797)
EOF
)
  maestri portal click "$PORTAL" "150,$y" >/dev/null; sleep 0.8
  maestri portal type "$PORTAL" "$1" >/dev/null; sleep 0.5
  tap_orange 740 852 330 393   # the 52 pt send button only
}
fresh_chat() {  # installed with both models seeded (APFS clones)
  fresh_install
  xcrun simctl launch "$DEV" "$BUNDLE" >/dev/null; sleep 2; xcrun simctl terminate "$DEV" "$BUNDLE"
  seed
}
fresh_chat
LLM="$(container)/Documents/models/qwen2.5-1.5b-instruct-q4km.gguf"
if [[ "${IOS_FIDELITY_SKIP_ERROR:-0}" != "1" ]]; then
  printf 'XXXX' | dd of="$LLM" bs=1 seek=0 count=4 conv=notrunc 2>/dev/null   # same size, bad magic: engine error
  maestri portal launch "$PORTAL" "$BUNDLE" >/dev/null
  wait_for "Try again|didn.t load" 90 && shot chat-model-error
  xcrun simctl terminate "$DEV" "$BUNDLE"
  rm -f "$LLM"; cp -c "$MODELS/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" "$LLM"
fi
maestri portal launch "$PORTAL" "$BUNDLE" >/dev/null
wait_for "Send" 120 "Indexing|Loading|Try again" && shot chat-empty
# Generating: the mockup's question, then a burst of screenshots (~4/s for up
# to 40 s, stopping 3 s after generation ends) and the LAST frame that still
# shows the stop button (the send button's circle is dark inside with an
# accent ring/square while generating, a solid accent disc when idle): the
# answer text is streaming and fills the most screen.
ask "$GEN_QUESTION"
mkdir -p "$TMP/burst"
is_generating() {  # is_generating <png>: exit 0 while the stop button shows
  python3 - "$1" <<'EOF'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); s = im.width / 393
acc = lambda c: c[0] > 220 and 90 < c[1] < 160 and c[2] < 110
pts = [(x, y) for y in range(int(740 * s), im.height, 3) for x in range(int(325 * s), im.width, 3) if acc(im.getpixel((x, y)))]
if not pts: sys.exit(1)
cx = (min(p[0] for p in pts) + max(p[0] for p in pts)) // 2; cy = (min(p[1] for p in pts) + max(p[1] for p in pts)) // 2
sys.exit(0 if not acc(im.getpixel((cx - int(15 * s), cy))) else 1)
EOF
}
i=0; idle_since=0; end=$(( $(date +%s) + 40 ))
while (( $(date +%s) < end )); do
  f="$TMP/burst/$(printf %04d $i).png"
  xcrun simctl io "$DEV" screenshot "$f" >/dev/null 2>&1
  if is_generating "$f"; then idle_since=0; last="$f"
  else (( idle_since == 0 )) && idle_since=$(date +%s); [[ -n "${last:-}" ]] && (( $(date +%s) - idle_since >= 3 )) && break; fi
  i=$((i + 1)); sleep 0.1
done
if [[ -n "${last:-}" ]]; then cp "$last" "$RAW/chat-generating.png"; log "shot chat-generating (burst frame $(basename "$last") of $i)"
else log "no generating frame in the burst ($i frames)"; fi
rm -rf "$TMP/burst"
wait_for "Copy answer" 180 || true
# Answer: a fresh conversation, so the screen holds one exchange like the mockup.
xcrun simctl terminate "$DEV" "$BUNDLE"
fresh_chat
maestri portal launch "$PORTAL" "$BUNDLE" >/dev/null
wait_for "Send" 120 "Indexing|Loading|Try again"
ask "$QUESTION"
wait_for "Copy answer" 120 || true
tap_first_source && sleep 1
shot chat-answer

fi  # IOS_FIDELITY_ONLY=splash skips the chat

# ---------- 4. setup: splash, 1, 2, 3 ----------
fresh_install
# Only the search model on disk: setup still opens (no answer model) and the
# offline import step shows one file already in place.
xcrun simctl launch "$DEV" "$BUNDLE" >/dev/null; sleep 2; xcrun simctl terminate "$DEV" "$BUNDLE"
mkdir -p "$(container)/Documents/models"
cp -c "$MODELS/bge-small-en-v1.5-q8_0.gguf" "$(container)/Documents/models/embedding.gguf"
xcrun simctl io "$DEV" recordVideo --codec h264 --force "$TMP/launch.mp4" >/dev/null 2>&1 & REC=$!
sleep 1.5; xcrun simctl launch "$DEV" "$BUNDLE" >/dev/null; sleep 6
kill -INT "$REC"; wait "$REC" 2>/dev/null || true
ffmpeg -loglevel error -i "$TMP/launch.mp4" -vf fps=10 "$TMP/f%03d.png"
python3 - "$TMP" "$SCREENS/splash.png" "$RAW/splash.png" <<'EOF'
# Splash frames from the launch video. The splash is the run of full-screen dark
# frames (no wallpaper at the edges) before the setup stepper (accent at the
# top) appears. native = a few frames into that run; bootsplash = the last
# frames before the stepper (the JS BootSplash, when wired). All frames of the
# run are kept in splash-seq/ to check for a jump or seam at the handover.
import sys, glob, os, shutil
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + "/f*.png"))
out = os.path.dirname(sys.argv[3])
acc = lambda c: c[0] > 220 and 90 < c[1] < 160 and c[2] < 110
def stepper(im):
    w, h = im.size
    return any(acc(im.getpixel((x, y))) for y in range(int(h * .04), int(h * .08), 2) for x in range(0, w, 4))
def dark_edges(im):
    w, h = im.size
    return all(max(im.getpixel(p)) < 60 for p in [(2, h // 3), (w - 3, h // 3), (2, h * 2 // 3), (w - 3, h * 2 // 3)])
ims = [Image.open(p).convert("RGB") for p in files]
first_content = next((i for i, im in enumerate(ims) if dark_edges(im) and stepper(im)), len(ims))
run = [i for i in range(first_content) if dark_edges(ims[i])]
if not run:
    ims[len(ims) // 2].save(sys.argv[3]); sys.exit()
seq = os.path.join(out, "splash-seq"); shutil.rmtree(seq, ignore_errors=True); os.makedirs(seq)
for i in run: ims[i].save(os.path.join(seq, f"{i:03d}.png"))
# The handover native -> JS BootSplash is the biggest frame-to-frame change
# inside the run: native = the frame before it, bootsplash = the one after.
from PIL import ImageChops, ImageStat
def delta(a, b):
    return sum(ImageStat.Stat(ImageChops.difference(a.resize((131, 284)), b.resize((131, 284)))).sum)
jumps = [(delta(ims[run[k - 1]], ims[run[k]]), k) for k in range(1, len(run))]
k = max(jumps)[1] if jumps else len(run) - 1
ims[run[max(0, k - 1)]].save(os.path.join(out, "splash-native.png"))
ims[run[k]].save(os.path.join(out, "splash-bootsplash.png"))
ims[run[k]].save(sys.argv[3])
print(f"splash handover at frame {run[k]} (native {run[max(0, k - 1)]})", file=sys.stderr)
EOF
log "shot splash (from launch video)"
maestri portal launch "$PORTAL" "$BUNDLE" >/dev/null
wait_for "Get started" 60 && shot setup1-language
tap_orange 700 852
wait_for "Choose what to install" 30 && sleep 0.5 && shot setup2-model
tap_orange 700 852
sleep 2; shot setup3-download
xcrun simctl terminate "$DEV" "$BUNDLE"
xcrun simctl uninstall "$DEV" "$BUNDLE"   # drop the partial download

# ---------- 5. compose ----------
python3 "$REPO/scripts/ios-fidelity-compose.py" "$SCREENS" "$RAW" "$OUT" "$HASH"
{
  echo "commit $HASH ($REF) · variant $VARIANT · iPhone 16 simulator iOS 26.1, 393x852 pt · dark Fogueira · EN · text 1.0 · $(date '+%Y-%m-%d %H:%M')"
  echo "raw shots: raw/<screen>.png (1179x2556) · side by side: <screen>_side.png (mockup | app | overlay 50% + 10 pt grid)"
  echo "question for the chat states: \"$QUESTION\" · model Qwen2.5-1.5B Q4_K_M · error state = same-size GGUF with a bad magic"
  echo "run time: $(( $(date +%s) - T0 )) s"
} > "$OUT/README.txt"
log "done: $OUT ($(ls "$OUT"/*_side.png 2>/dev/null | wc -l | tr -d ' ') side-by-sides)"
