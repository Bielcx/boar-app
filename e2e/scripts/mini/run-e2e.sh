#!/bin/bash
# Heavy job (inside the lock): headless emulator -> fresh install -> push files -> Maestro flow -> emulator off.
# usage: run-e2e.sh <apk> <flow.yaml>
set -uo pipefail
APK=${1:?apk}; FLOW=${2:?flow}; SDK=$HOME/Library/Android/sdk; A=$SDK/platform-tools/adb; P=team.sopa.aoair.offline
M=$HOME/boar/shared-models; D=$HOME/boar/android/e2e-data; OUT=$HOME/boar/android/e2e-out/$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
export JAVA_HOME=$(/usr/libexec/java_home -v 17) ANDROID_HOME=$SDK ANDROID_SDK_ROOT=$SDK
free() { df -g / | tail -1 | awk '{print $4}'; }
stop_emu() { $A emu kill >/dev/null 2>&1; sleep 5; pkill -x qemu-system-aarch64 2>/dev/null; sleep 2; pkill -9 -x qemu-system-aarch64 2>/dev/null; rm -f $HOME/.android/avd/boar_api35.avd/userdata-qemu.img* $HOME/.android/avd/boar_api35.avd/cache.img*; echo "[e2e] $(date +%T) emulator off, AVD data removed"; }
trap stop_emu EXIT
t0=$(date +%s); echo "[e2e] $(date +%T) start free $(free) GB"
nohup $SDK/emulator/emulator -avd boar_api35 -no-window -no-audio -no-boot-anim -no-snapshot -wipe-data -gpu swiftshader_indirect > "$OUT/emulator.log" 2>&1 &
( while sleep 10; do f=$(free); [ "$f" -lt 12 ] && { echo "[e2e] ABORT: free $f GB < 12"; stop_emu; kill $$; break; }; done ) & WD=$!
$A wait-for-device; t=0; until [ "$($A shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || [ $t -gt 400 ]; do sleep 5; t=$((t+5)); done
t1=$(date +%s); echo "[e2e] $(date +%T) booted in $((t1-t0))s"; sleep 30
$A install "$APK" | tail -1; $A shell cmd connectivity airplane-mode enable
$A push "$M/bge-small-en-v1.5-q8_0.gguf" "$M/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf" "$D/corpus-standard.json" "$D/corpus-full.json" /sdcard/Download/ | tail -1
for f in bge-small-en-v1.5-q8_0.gguf Qwen2.5-1.5B-Instruct-Q4_K_M.gguf corpus-standard.json corpus-full.json; do $A shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$f" >/dev/null; done
t2=$(date +%s); echo "[e2e] $(date +%T) app+files ready in $((t2-t1))s; running $(basename "$FLOW")"
$HOME/.maestro/bin/maestro test "$FLOW" -e APP_ID=$P --test-output-dir "$OUT" > "$OUT/maestro.out" 2>&1; rc=$?
t3=$(date +%s); grep -E "COMPLETED|FAILED|Assert|not found" "$OUT/maestro.out" | tail -30
$A exec-out screencap -p > "$OUT/final.png" 2>/dev/null
kill $WD 2>/dev/null; echo "[e2e] rc=$rc flow $((t3-t2))s total $((t3-t0))s; free $(free) GB; out $OUT"
exit $rc
