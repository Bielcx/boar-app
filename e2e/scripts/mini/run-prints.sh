#!/bin/bash
# Heavy job (inside the lock): UI approval prints (PRINTS-v11) on the headless AVD, EN then PT.
# usage: [PRINTS_FLOW=prints-0709.yaml] [SKIP_SPLASH=1] run-prints.sh <apk> <sha>   (flows in ~/boar/android/e2e/flows-piston/prints)
# 01 splash = adb screencap burst on a cold start; 02-12 = Maestro takeScreenshot (lossless PNG).
set -uo pipefail
APK=${1:?apk}; SHA=${2:?sha}; SDK=$HOME/Library/Android/sdk; A=$SDK/platform-tools/adb; P=team.sopa.aoair.offline
M=$HOME/boar/shared-models; D=$HOME/boar/android/e2e-data; PL=$HOME/boar/shared-data/packs/pinned
F=$HOME/boar/android/e2e/flows-piston/prints; OUT=$HOME/boar/android/e2e-out/prints-$SHA-$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT/splash"
export JAVA_HOME=$(/usr/libexec/java_home -v 17) ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK
free() { df -g / | tail -1 | awk '{print $4}'; }
stop_emu() { $A emu kill >/dev/null 2>&1; sleep 5; pkill -x qemu-system-aarch64 2>/dev/null; sleep 2; pkill -9 -x qemu-system-aarch64 2>/dev/null; rm -f $HOME/.android/avd/boar_api35.avd/userdata-qemu.img* $HOME/.android/avd/boar_api35.avd/cache.img*; echo "[prints] $(date +%T) emulator off, AVD data removed"; }
trap stop_emu EXIT
t0=$(date +%s); echo "[prints] $(date +%T) start free $(free) GB"
nohup $SDK/emulator/emulator -avd boar_api35 -no-window -no-audio -no-boot-anim -no-snapshot -wipe-data -gpu swiftshader_indirect > "$OUT/emulator.log" 2>&1 &
( while sleep 10; do f=$(free); [ "$f" -lt 12 ] && { echo "[prints] ABORT: free $f GB < 12"; stop_emu; kill $$; break; }; done ) & WD=$!
$A wait-for-device; t=0; until [ "$($A shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || [ $t -gt 400 ]; do sleep 5; t=$((t+5)); done
echo "[prints] $(date +%T) booted in $(( $(date +%s)-t0 ))s"; sleep 30
$A shell settings put system font_scale 1.0; $A shell cmd uimode night yes >/dev/null
{ echo "apk $(basename "$APK") $(shasum -a 256 "$APK" | cut -c1-64)"; $A shell wm size; $A shell wm density; echo "font_scale $($A shell settings get system font_scale)"; } | tr -d '\r' | tee "$OUT/device.txt"
# The AOSP keyboard asks for contacts on first use and the dialog eats the flow's taps: grant it up front (harness only, the app is untouched).
for ime in $($A shell pm list packages | tr -d '\r' | sed -n 's/^package://p' | grep -i -E 'inputmethod|latin'); do $A shell pm grant "$ime" android.permission.READ_CONTACTS 2>/dev/null; done
$A install "$APK" | tail -1; $A shell cmd connectivity airplane-mode enable
$A push "$M/bge-small-en-v1.5-q8_0.gguf" "$M/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" "$D/corpus-standard.json" "$D/corpus-full.json" /sdcard/Download/ | tail -1
$A shell mkdir -p /sdcard/Download/places
PF=${PLACES_FILES:-"$PL/6a30ffe9c81a1c92ab399dac4e90578a24f4eb72d3db0c133cb375ee673e947f/t-N41E012.sqlite $PL/b6771c536efe9b61bff283d4ceadca89c0c4c76e0ec9412f9a0cc981c48b0d15/world-places.sqlite"}
$A push $PF /sdcard/Download/places/ | tail -1
for f in bge-small-en-v1.5-q8_0.gguf Qwen2.5-1.5B-Instruct-Q4_K_M.gguf corpus-standard.json corpus-full.json $(for f in $PF; do echo places/$(basename $f); done); do $A shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$f" >/dev/null; done
# 01 splash: cold start, lossless screencap burst (the frames are picked by eye afterwards)
if [ -z "${SKIP_SPLASH:-}" ]; then
ACT=$($A shell cmd package resolve-activity --brief $P | tail -1 | tr -d '\r'); $A shell am start -n "$ACT" >/dev/null
for i in $(seq -w 1 15); do $A exec-out screencap -p > "$OUT/splash/$i.png"; done
$A shell am force-stop $P; $A shell pm clear $P >/dev/null
fi
run() { # $1 = en|pt, then KEY=VALUE pairs
  local L=$1; shift; local args=(-e APP_ID=$P -e L=$L); for kv in "$@"; do args+=(-e "$kv"); done
  local ts=$(date +%s); mkdir -p "$OUT/$L"; (cd "$OUT/$L" && $HOME/.maestro/bin/maestro test "$F/${PRINTS_FLOW:-prints-v11.yaml}" "${args[@]}" --test-output-dir "$OUT/$L/maestro" > "$OUT/$L/maestro.out" 2>&1); local rc=$?
  $A exec-out screencap -p > "$OUT/$L/final.png"; echo "[prints] $L rc=$rc $(( $(date +%s)-ts ))s"; grep -E "FAILED|not found|Assertion" "$OUT/$L/maestro.out" | tail -5
  $A shell am force-stop $P; $A shell pm clear $P >/dev/null
}
run en T_START="Get started" T_ESSENTIAL="Essential" T_CONTINUE="Continue" T_IMPORT_TITLE="Import the files" T_PICK="Choose files" \
  T_DONE="Everything runs offline from now on." T_OPEN="Open BOAR" T_ASK="Ask something" T_MENU="Open menu" T_NEWCHAT="New chat" \
  T_SEND="Send" T_STOP="Stop answer" T_SETTINGS="Settings" T_KNOWLEDGE="Knowledge" T_ASSISTANT="Assistant" T_SOURCE1="Sources? 1:" \
  T_VERIFIED="Verified:" T_IMPORT_PLACES="Import places" T_ASK_MODEL="Answer with AI" T_CHIP_MONSOON="Ask: What is a monsoon\\?" Q_MONSOON="What causes the monsoon?" Q_DECLINE="What happened today in history?" Q_PLACES="best vegan restaurants in Rome"
run pt T_START="Começar" T_ESSENTIAL="Essencial" T_CONTINUE="Continuar" T_IMPORT_TITLE="Importe os arquivos" T_PICK="Escolher arquivos" \
  T_DONE="Tudo roda offline a partir de agora." T_OPEN="Abrir o BOAR" T_ASK="Pergunte algo" T_MENU="Abrir menu" T_NEWCHAT="Nova conversa" \
  T_SEND="Enviar" T_STOP="Parar resposta" T_SETTINGS="Ajustes" T_KNOWLEDGE="Conhecimento" T_ASSISTANT="Assistente" T_SOURCE1="Fontes? 1:" \
  T_VERIFIED="Verificado:" T_IMPORT_PLACES="Importar lugares" T_ASK_MODEL="Responder com IA" T_CHIP_MONSOON="Perguntar: O que é uma monção\\?" Q_MONSOON="O que causa a monção?" Q_DECLINE="O que aconteceu hoje na história?" Q_PLACES="melhores restaurantes veganos em Roma"
kill $WD 2>/dev/null; echo "[prints] total $(( $(date +%s)-t0 ))s; free $(free) GB; out $OUT"; find "$OUT" -name "*.png" | wc -l
