#!/usr/bin/env bash
# RS-1: Erase everything right after launch, while the seed index is being built.
# Pass = no SIGABRT/am_crash, lands on Setup, models/ corpus/ poi/ gone. usage: rs1.sh <outdir> <tag> <run#>
set -uo pipefail
A=$HOME/Library/Android/sdk/platform-tools/adb; S=$(dirname "$0"); O=$1; tag=$2; n=$3; PKG=${PKG:-team.sopa.aoair}; mkdir -p $O
ui() { python3 $S/ui.py "$@"; }
F=/data/data/$PKG/files
echo "== RS-1 run $n ($tag)"
echo "  before: $($A shell "ls $F 2>/dev/null | tr '\n' ' '")"
$A shell du -sh $F/models $F/corpus $F/poi 2>/dev/null | tr '\n' ' '; echo
$A logcat -c; $A logcat -b events -c; $A shell 'rm -f /data/tombstones/*'
$A shell am force-stop $PKG; $A shell am start -n $PKG/.MainActivity >/dev/null
ui wait "Open menu" 60 >/dev/null; sleep 1
$A logcat -d -s ReactNativeJS | grep -iE "seed|index" | tail -2 | cut -c19-170 | sed 's/^/  log: /'
ui tap "^Open menu$" >/dev/null; sleep 2; ui tap "^Settings$" >/dev/null; sleep 2
ui has "Erase all data" || for i in 1 2 3 4 5; do $A shell input swipe 540 1800 540 700 250; sleep 1; ui has "Erase all data" && break; done
$A logcat -b all > $O/rs1-run${n}-logcat-all_$tag.txt 2>&1 & LC=$!   # streaming capture from before the tap (Prism)
ui tap "^Erase all data$" >/dev/null; sleep 1; ui tap "^Erase everything$" >/dev/null; t0=$(date +%s)
ui wait "Get started" 60 >/dev/null && echo "  Setup shown after $(( $(date +%s)-t0 ))s: YES" || echo "  Setup shown: NO"
sleep 2; $A exec-out screencap -p > $O/rs1-run${n}_$tag.png
echo "  top: $($A shell dumpsys activity activities | grep -m1 topResumed | grep -oE '[a-z.]+/[.A-Za-z]+' | head -1)"
echo "  am_crash/proc_died: $($A logcat -b events -d | grep -E 'am_crash|am_proc_died' | grep -c aoair)  finish(app-request): $($A logcat -b events -d | grep -c 'wm_finish_activity.*aoair.*app-request')"
echo "  tombstones: $($A shell ls /data/tombstones 2>/dev/null | wc -l | tr -d ' ')  SIGABRT in logcat: $($A logcat -d | grep -c 'SIGABRT\|Scudo ERROR')"
echo "  after: models=$($A shell "[ -e $F/models ] && ls $F/models | wc -l || echo gone") corpus=$($A shell "[ -e $F/corpus ] && ls $F/corpus | wc -l || echo gone") poi=$($A shell "[ -e $F/poi ] && ls $F/poi | wc -l || echo gone")"
$A logcat -d -s ReactNativeJS | grep -iE "reset|erase|close|RS-1|queued" | cut -c19-200 > $O/rs1-run${n}-logcat_$tag.txt; echo "  reset log lines: $(wc -l < $O/rs1-run${n}-logcat_$tag.txt)"
sleep 2; kill $LC 2>/dev/null; echo "  logcat -b all: $(wc -l < $O/rs1-run${n}-logcat-all_$tag.txt) lines -> $O/rs1-run${n}-logcat-all_$tag.txt"
