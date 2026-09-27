#!/usr/bin/env bash
# FS-1 acceptance: live font change on setup step 3 with the download running.
# usage: fs1-accept.sh <outdir> <tag>
set -uo pipefail
A=$HOME/Library/Android/sdk/platform-tools/adb; S=$(dirname "$0"); O=$1; tag=$2; PKG=team.sopa.aoair; mkdir -p $O
ui() { python3 $S/ui.py "$@"; }
fs() { $A shell settings put system font_scale $1; sleep 3; }
start_download() {
  $A shell am force-stop $PKG; $A shell pm clear $PKG >/dev/null; fs $1
  $A shell am start -n $PKG/.MainActivity >/dev/null; ui wait "Get started" 60 >/dev/null; sleep 2
  ui tap "^Get started$" >/dev/null; ui wait "Step 2 of" 30 >/dev/null; ui tap "^Essential, " >/dev/null; sleep 1
  for i in 1 2 3; do ui has "^Download 1(\.1)? GB$" && break; $A shell input swipe 540 1700 540 900 300; sleep 1; done
  $A logcat -c; ui tap "^Download 1(\.1)? GB$" >/dev/null; sleep 10
}
check() { # $1 label: logcat checks since download start
  local log=$O/logcat_$1.txt; $A logcat -d -s ReactNativeJS > $log
  local n=$(grep -c "downloadAsync()" $log); local restarts=$(grep -cE "starting a fresh downloadAsync|resuming an interrupted" $log)
  python3 - "$log" "$1" <<'P'
import re,sys
log,label=sys.argv[1],sys.argv[2]
seq={}
bad=0
for line in open(log):
    m=re.search(r'download:([^\]]+)\] progress: (\d+)/',line)
    if m:
        k,v=m.group(1),int(m.group(2))
        if k in seq and v<seq[k]: bad+=1
        seq[k]=v
print(f"  [{label}] progress monotonic per file: {'YES' if bad==0 else f'NO ({bad} drops)'}; files: {', '.join(f'{k}={v}' for k,v in seq.items())}")
P
  echo "  [$1] 'downloadAsync()' lines: $n ; fresh/resume starts: $restarts (expect 1 fresh per file, 0 new after the font change)"
  grep -nE "starting a fresh downloadAsync|resuming an interrupted" $log | cut -c1-160 | sed 's/^/    /'
}
echo "== seq A: open at 1.0, live 1.0 -> 1.3 during download"
start_download 1.0; pidA=$($A shell pidof $PKG); $A exec-out screencap -p > $O/A0_before_1.0_$tag.png
fs 1.3; $A exec-out screencap -p > $O/A1_live_1.3_$tag.png; sleep 8; $A exec-out screencap -p > $O/A2_live_1.3_later_$tag.png
ui has "^Installing$|Step 3 of|Install, 3" && echo "  still on step 3: YES" || echo "  still on step 3: NO"
echo "  pid before=$pidA after=$($A shell pidof $PKG)"
check A
$A logcat -d -s ReactNativeJS | grep -i fs1 > $O/fs1-grep_A.txt; echo "  fs1 log lines: $(wc -l < $O/fs1-grep_A.txt)"
echo "== seq B: open at 1.3, live 1.3 -> 1.0 -> 1.3 during download"
start_download 1.3; pidB=$($A shell pidof $PKG); $A exec-out screencap -p > $O/B0_before_1.3_$tag.png
fs 1.0; $A exec-out screencap -p > $O/B1_live_1.0_$tag.png; fs 1.3; $A exec-out screencap -p > $O/B2_live_1.3_$tag.png; sleep 8
ui has "^Installing$|Step 3 of|Install, 3" && echo "  still on step 3: YES" || echo "  still on step 3: NO"
echo "  pid before=$pidB after=$($A shell pidof $PKG)"
check B
$A logcat -d -s ReactNativeJS | grep -i fs1 > $O/fs1-grep_B.txt; echo "  fs1 log lines: $(wc -l < $O/fs1-grep_B.txt)"
fs 1.0
echo "== seq C: Display size (wm density 420 -> 480 -> 420) during download"
start_download 1.0; pidC=$($A shell pidof $PKG); $A exec-out screencap -p > $O/C0_before_$tag.png
$A shell wm density 480; sleep 4; $A exec-out screencap -p > $O/C1_density480_$tag.png; $A shell wm density reset; sleep 4; $A exec-out screencap -p > $O/C2_density_reset_$tag.png
ui has "^Installing$|Step 3 of|Install, 3" && echo "  still on step 3: YES" || echo "  still on step 3: NO"
echo "  pid before=$pidC after=$($A shell pidof $PKG)"
check C
$A logcat -d -s ReactNativeJS | grep -i fs1 > $O/fs1-grep_C.txt; echo "  fs1 log lines: $(wc -l < $O/fs1-grep_C.txt)"
