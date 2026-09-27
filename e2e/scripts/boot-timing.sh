#!/usr/bin/env bash
# Boot timing (Iris 447c966): cold = force-stop + start, warm = HOME + start (process alive). 3x each.
# Reads '[boot] js-start' / '[boot] hide after=Nms' from ReactNativeJS and Android's am start -W TotalTime.
# usage: boot-timing.sh <outfile>
set -uo pipefail
A=$HOME/Library/Android/sdk/platform-tools/adb; PKG=${PKG:-team.sopa.aoair}; out=$1; : > $out
for kind in cold warm; do
  for i in 1 2 3; do
    if [ $kind = cold ]; then $A shell am force-stop $PKG; sleep 3; else $A shell input keyevent KEYCODE_HOME; sleep 3; fi
    $A logcat -c
    tt=$($A shell am start -W -n $PKG/.MainActivity | grep -E "TotalTime|LaunchState" | tr -d '\r' | tr '\n' ' ')
    sleep 8
    boot=$($A logcat -d -s ReactNativeJS | grep "\[boot\]" | sed -E 's/.*ReactNativeJS: //' | tr '\n' ' ')
    echo "$kind #$i | $tt | ${boot:-(no [boot] log)}" | tee -a $out
  done
done
