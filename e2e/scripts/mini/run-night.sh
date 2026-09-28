#!/bin/bash
# Heavy job (inside the lock), night 28/09: Boar #3 (Android prints: 07 PT + 12, then 02/03/07/11/12 at font 1.3 and 2.0)
# and #7 (dumpsys gfxinfo: streaming, sources list, Models, Knowledge, places + "Show N more", cold start; 3 reps each).
# One headless AVD boot for both. usage: [PHASES="prints perf"] [FLOOR_GB=12] [REPS=3] run-night.sh <apk> <sha>
# Flows in ~/boar/android/e2e/flows-piston/{prints,perf}. Output: ~/boar/android/e2e-out/night-<sha>-<ts>/
set -uo pipefail
APK=${1:?apk}; SHA=${2:?sha}; SDK=$HOME/Library/Android/sdk; A=$SDK/platform-tools/adb; P=team.sopa.aoair.offline
M=$HOME/boar/shared-models; D=$HOME/boar/android/e2e-data; PL=$HOME/boar/shared-data/packs/pinned
F=$HOME/boar/android/e2e/flows-piston; OUT=$HOME/boar/android/e2e-out/night-$SHA-$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
PHASES=${PHASES:-"prints perf"}; FLOOR=${FLOOR_GB:-12}; REPS=${REPS:-3}
export JAVA_HOME=$(/usr/libexec/java_home -v 17) ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK
free() { df -g / | tail -1 | awk '{print $4}'; }
log() { echo "[night] $(date +%T) $*" | tee -a "$OUT/night.log"; }
stop_emu() { $A emu kill >/dev/null 2>&1; sleep 5; pkill -x qemu-system-aarch64 2>/dev/null; sleep 2; pkill -9 -x qemu-system-aarch64 2>/dev/null; rm -f $HOME/.android/avd/boar_api35.avd/userdata-qemu.img* $HOME/.android/avd/boar_api35.avd/cache.img*; echo "[night] $(date +%T) emulator off, AVD data removed"; }
trap stop_emu EXIT
t0=$(date +%s); log "start $SHA phases='$PHASES' floor $FLOOR GB free $(free) GB"
nohup $SDK/emulator/emulator -avd boar_api35 -no-window -no-audio -no-boot-anim -no-snapshot -wipe-data -gpu swiftshader_indirect > "$OUT/emulator.log" 2>&1 &
( while sleep 10; do f=$(free); [ "$f" -lt "$FLOOR" ] && { echo "[night] ABORT: free $f GB < $FLOOR"; stop_emu; kill $$; break; }; done ) & WD=$!
$A wait-for-device; t=0; until [ "$($A shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || [ $t -gt 400 ]; do sleep 5; t=$((t+5)); done
log "booted in $(( $(date +%s)-t0 ))s"; sleep 30
$A shell settings put system font_scale 1.0; $A shell cmd uimode night yes >/dev/null
for ime in $($A shell pm list packages | tr -d '\r' | sed -n 's/^package://p' | grep -i -E 'inputmethod|latin'); do $A shell pm grant "$ime" android.permission.READ_CONTACTS 2>/dev/null; done
$A install "$APK" | tail -1; $A shell cmd connectivity airplane-mode enable
{ echo "apk $(basename "$APK") $(shasum -a 256 "$APK" | cut -c1-64)"; echo "avd boar_api35 $($A shell getprop ro.build.version.release) API $($A shell getprop ro.build.version.sdk) $($A shell getprop ro.product.cpu.abi) gpu swiftshader_indirect"; $A shell wm size; $A shell wm density; grep -E '^hw.ramSize|^hw.cpu.ncore' $HOME/.android/avd/boar_api35.avd/config.ini; echo "host $(sysctl -n machdep.cpu.brand_string) $(sysctl -n hw.ncpu) cpu"; } | tr -d '\r' | tee "$OUT/device.txt"
$A push "$M/bge-small-en-v1.5-q8_0.gguf" "$M/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" "$D/corpus-standard.json" "$D/corpus-full.json" /sdcard/Download/ | tail -1
$A shell mkdir -p /sdcard/Download/places
PF=${PLACES_FILES:?PLACES_FILES}
$A push $PF /sdcard/Download/places/ | tail -1
for f in bge-small-en-v1.5-q8_0.gguf Qwen2.5-1.5B-Instruct-Q4_K_M.gguf corpus-standard.json corpus-full.json $(for f in $PF; do echo places/$(basename $f); done); do $A shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$f" >/dev/null; done

EN=(T_START="Get started" T_ESSENTIAL="Essential" T_CONTINUE="Continue" T_PICK="Choose files" T_DONE="Everything runs offline from now on." T_OPEN="Open BOAR"
  T_ASK="Ask something" T_MENU="Open menu" T_NEWCHAT="New chat" T_SEND="Send" T_STOP="Stop answer" T_SETTINGS="Settings" T_KNOWLEDGE="Knowledge"
  T_ASSISTANT="Assistant" T_MODELS="Models" T_VERIFIED="Verified:" T_IMPORT_PLACES="Import places" T_ASK_MODEL="Answer with AI" T_ANYWAY="Answer anyway"
  T_SOURCES="Sources? \\(?[0-9]" T_SHOW_MORE="Show [0-9]+ more"
  Q_MONSOON="What causes the monsoon?" Q_DECLINE="What happened today in history?" Q_PLACES="best vegan restaurants in Rome")
PT=(T_START="Começar" T_ESSENTIAL="Essencial" T_CONTINUE="Continuar" T_PICK="Escolher arquivos" T_DONE="Tudo roda offline a partir de agora." T_OPEN="Abrir o BOAR"
  T_ASK="Pergunte algo" T_MENU="Abrir menu" T_NEWCHAT="Nova conversa" T_SEND="Enviar" T_STOP="Parar resposta" T_SETTINGS="Ajustes" T_KNOWLEDGE="Conhecimento"
  T_ASSISTANT="Assistente" T_MODELS="Modelos" T_VERIFIED="Verificado:" T_IMPORT_PLACES="Importar lugares" T_ASK_MODEL="Responder com IA" T_ANYWAY="Arriscar resposta"
  T_SOURCES="Fontes? \\(?[0-9]" T_SHOW_MORE="Mostrar mais [0-9]+"
  Q_MONSOON="O que causa a monção?" Q_DECLINE="O que aconteceu hoje na história?" Q_PLACES="melhores restaurantes veganos em Roma")
# mf <label> <flow> <en|pt> [KEY=VALUE...]: one Maestro run, screenshots land in $OUT/<label>/
mf() {
  local label=$1 flow=$2 L=$3; shift 3; local -a S; [ "$L" = pt ] && S=("${PT[@]}") || S=("${EN[@]}")
  local args=(-e APP_ID=$P -e L=$L); for kv in "${S[@]}" "$@"; do args+=(-e "$kv"); done
  local ts=$(date +%s); mkdir -p "$OUT/$label"
  (cd "$OUT/$label" && $HOME/.maestro/bin/maestro test "$F/$flow" "${args[@]}" --test-output-dir "$OUT/$label/maestro" > "$OUT/$label/maestro.out" 2>&1); local rc=$?
  log "$label ($flow $L $*) rc=$rc $(( $(date +%s)-ts ))s"; [ $rc -ne 0 ] && { grep -E "FAILED|not found|Assertion" "$OUT/$label/maestro.out" | tail -3 | tee -a "$OUT/night.log"; $A exec-out screencap -p > "$OUT/$label/fail.png"; }
  return $rc
}
fontscale() { $A shell settings put system font_scale "$1"; log "font_scale $($A shell settings get system font_scale | tr -d '\r')"; }
fresh() { $A shell am force-stop $P; $A shell pm clear $P >/dev/null; }

if [[ " $PHASES " == *" prints "* ]]; then
  # 02/03 at 1.3 and 2.0 (PT); fresh app each time, no import
  for fs in 1.3 2.0; do suf=_font$(echo $fs | tr -d .)0; fontscale $fs; fresh; mf ax-setup$suf prints/ax-setup.yaml pt SUF=$suf; done
  # one PT import at 1.0, then 07/12/11 at 1.0, 1.3 and 2.0 on the same data
  fontscale 1.0; fresh; mf setup-pt prints/setup-to-chat.yaml pt
  for fs in 1.0 1.3 2.0; do
    suf=_font$(echo $fs | tr -d .)0
    fontscale $fs; $A shell am force-stop $P; mf ax-chat-pt$suf prints/ax-chat.yaml pt SUF=$suf
  done
  fontscale 1.0
fi

if [[ " $PHASES " == *" perf "* ]] || [[ " $PHASES " == *" prints "* ]]; then
  # EN install for 12 EN and for the measurements (EN streams the model answer directly)
  fresh; mf setup-en prints/setup-to-chat.yaml en
  [[ " $PHASES " == *" prints "* ]] && mf ax-chat-en prints/ax-chat.yaml en SUF=_font100 ONLY_12=1
fi

if [[ " $PHASES " == *" perf "* ]]; then
  PD=$OUT/perf; mkdir -p "$PD"; R=$PD/results.tsv; echo -e "scenario\trep\tframes\tjanky\tjanky_pct\tlegacy_janky_pct\tp50\tp90\tp95\tp99\tseconds\tnote" > $R
  gfx_reset() { $A shell dumpsys gfxinfo $P reset >/dev/null; }
  # gfx_dump <scenario> <rep> <seconds> [note]: raw dump + one TSV row
  gfx_dump() {
    local f=$PD/$1-$2.gfxinfo.txt; $A shell dumpsys gfxinfo $P | tr -d '\r' > $f
    # first block = app process stats (the per-window "Profile data" blocks follow)
    local fr=$(grep -m1 'Total frames rendered' $f | awk -F': ' '{print $2}')
    local jk=$(grep -m1 '^Janky frames:' $f | sed -E 's/^Janky frames: ([0-9]+) \(([0-9.]+)%\).*/\1\t\2/')
    local lg=$(grep -m1 '^Janky frames (legacy):' $f | sed -E 's/.*\(([0-9.]+)%\).*/\1/')
    pc() { grep -m1 "^$1th percentile" $f | sed -E 's/.*: ([0-9]+)ms/\1/'; }
    echo -e "$1\t$2\t$fr\t$jk\t$lg\t$(pc 50)\t$(pc 90)\t$(pc 95)\t$(pc 99)\t$3\t${4:-}" | tee -a $R
  }
  swipes() { # $1 = count per direction
    for i in $(seq 1 $1); do $A shell input swipe 540 1800 540 700 250; sleep 0.8; done
    for i in $(seq 1 $1); do $A shell input swipe 540 700 540 1800 250; sleep 0.8; done
  }
  # long answer (Quill: >= 400 tokens, with a list and [n]); tokens are estimated afterwards from the UI tree dump
  QLONG=${QLONG:-"List the main causes of the monsoon in at least eight numbered points, explain each point in detail and cite your sources."}
  # (e) cold start to usable chat: am start -W (first frame) + polling the UI tree for the composer (~1 s resolution)
  ACT=$($A shell cmd package resolve-activity --brief $P | tail -1 | tr -d '\r')
  for r in $(seq 1 $REPS); do
    $A shell am force-stop $P; sleep 3; ts=$(python3 -c 'import time;print(time.time())')
    $A shell am start -W -n "$ACT" | tr -d '\r' > $PD/coldstart-$r.amstart.txt
    until $A shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && $A shell cat /sdcard/ui.xml | grep -q 'Ask something'; do
      [ $(python3 -c "import time;print(int(time.time()-$ts))") -gt 90 ] && break; done
    usable=$(python3 -c "import time;print(round(time.time()-$ts,1))"); sleep 2
    gfx_dump coldstart $r $usable "am start TotalTime $(grep TotalTime $PD/coldstart-$r.amstart.txt | awk '{print $2}') ms; seconds = until 'Ask something' in the UI tree"
  done
  # (a) streaming a long answer, then (b) its open source list
  for r in $(seq 1 $REPS); do
    mf perf-prep-$r perf/prep-ask.yaml en QUESTION="$QLONG"
    gfx_reset; ts=$(date +%s); mf perf-stream-$r perf/send.yaml en; gfx_dump streaming $r $(( $(date +%s)-ts )) "includes Maestro polling"
    $A exec-out screencap -p > $PD/streaming-$r-end.png; $A shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; $A exec-out cat /sdcard/ui.xml > $PD/streaming-$r-end.xml
    mf perf-src-$r perf/open-sources.yaml en; gfx_reset; ts=$(date +%s); swipes 3; gfx_dump sources-scroll $r $(( $(date +%s)-ts ))
    $A exec-out screencap -p > $PD/sources-$r-end.png
  done
  # Perfetto: one extra streaming run (not in the table), 5 s trace starting 15 s after Send (JS thread vs UI thread)
  mf perf-prep-trace perf/prep-ask.yaml en QUESTION="$QLONG"
  ( sleep ${TRACE_DELAY:-15}; $A shell perfetto -o /data/misc/perfetto-traces/stream.pftrace -t 5s -b 64mb sched freq idle am wm gfx view input dalvik hal binder_driver > $PD/perfetto.out 2>&1 ) & TP=$!
  mf perf-stream-trace perf/send.yaml en; wait $TP; $A pull /data/misc/perfetto-traces/stream.pftrace $PD/streaming-trace.pftrace >/dev/null 2>&1; ls -la $PD/streaming-trace.pftrace 2>&1 | tee -a "$OUT/night.log"
  # (c) Models and Knowledge scroll
  for r in $(seq 1 $REPS); do
    mf perf-models-$r perf/open-models.yaml en; gfx_reset; ts=$(date +%s); swipes 3; gfx_dump models-scroll $r $(( $(date +%s)-ts ))
    mf perf-know-$r perf/open-knowledge.yaml en; gfx_reset; ts=$(date +%s); swipes 3; gfx_dump knowledge-scroll $r $(( $(date +%s)-ts ))
  done
  $A exec-out screencap -p > $PD/knowledge-end.png
  # (d) places: 10 rows + "Show N more" (tap + scroll inside the window)
  mf perf-places-import perf/import-places.yaml en
  for r in $(seq 1 $REPS); do
    mf perf-places-ask-$r perf/ask-wait.yaml en QUESTION="best vegan restaurants in Rome"
    gfx_reset; ts=$(date +%s); mf perf-places-more-$r perf/show-more.yaml en; swipes 3; gfx_dump places-more $r $(( $(date +%s)-ts )) "tap Show more + 3 swipes each way"
    $A exec-out screencap -p > $PD/places-$r-end.png
  done
  log "perf done"; column -t -s $'\t' $R | tee -a "$OUT/night.log"
fi
kill $WD 2>/dev/null; log "total $(( $(date +%s)-t0 ))s; free $(free) GB; out $OUT"; find "$OUT" -name "*.png" | wc -l
