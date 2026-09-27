#!/usr/bin/env bash
# Feed the emulator GNSS continuously like a real receiver. usage: gpsloop.sh <lon> <lat> <seconds>
A=$HOME/Library/Android/sdk/platform-tools/adb
end=$(( $(date +%s) + $3 )); while [ $(date +%s) -lt $end ]; do $A emu geo fix $1 $2 ${4:-100} ${5:-8} >/dev/null 2>&1; sleep 1; done
