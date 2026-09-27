#!/usr/bin/env bash
# Capture chat (restored session) + settings for the current theme/lang/font on the "Pixel" portal.
# Usage: matrix-shots.sh <out-dir> <suffix e.g. amber_pt_2.0>
set -uo pipefail
out="$1"; sfx="$2"; P=Pixel
S="$(dirname "$0")/shot.sh"
ref() { maestri portal snapshot "$P" | grep -E "$1" | head -1 | grep -oE '^@e[0-9]+'; }
"${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}" shell monkey -p team.sopa.aoair 1 >/dev/null 2>&1
# wait for chat header after an Activity restart
for i in $(seq 1 40); do r=$(ref 'button "(Open Navigation Drawer|Abrir menu)'); [ -n "$r" ] && break; sleep 3; done
x=$(ref 'button "(✕|Dismiss|Dispensar)"'); [ -n "$x" ] && { maestri portal click "$P" "$x" >/dev/null; sleep 1; }
maestri portal click "$P" "$(ref 'button "(Open Navigation Drawer|Abrir menu)')" >/dev/null; sleep 2
"$S" "$out" "drawer_$sfx"
s=$(ref 'text "[0-9]+[mhd] (ago|atrás)|text "(há|agora)'); [ -n "$s" ] && maestri portal click "$P" "$s" >/dev/null; sleep 3
"$S" "$out" "chat-answer_$sfx"
maestri portal click "$P" "$(ref 'button "(Open Navigation Drawer|Abrir menu)')" >/dev/null; sleep 2
maestri portal click "$P" "$(ref 'button ".*(Settings|Configurações|Ajustes)"')" >/dev/null; sleep 2
"$S" "$out" "settings_$sfx"
maestri portal click "$P" "$(ref 'button "(DONE|PRONTO)"')" >/dev/null; sleep 1
