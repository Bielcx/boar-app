#!/usr/bin/env bash
# Chat finish states. usage: chat-states.sh <lang en|pt> <scale 1.0|1.3> [suffix e.g. _360]
set -uo pipefail
A=$HOME/Library/Android/sdk/platform-tools/adb; S=$(dirname "$0"); F=${SHOTS_DIR:-shots/finish}; mkdir -p "$F"
lang=$1; sc=$2; sfx=${3:-}; PKG=team.sopa.aoair
ui() { python3 $S/ui.py "$@"; }
shot() { $A exec-out screencap -p > "$F/chat_${1}_${lang}_${sc}${sfx}.png"; echo "chat_${1}_${lang}_${sc}${sfx}"; }
q="Why%sdo%swe%shave%sseasons%son%sEarth?"; [ "$lang" = pt ] && q="Por%sque%sexistem%sas%sestacoes%sdo%sano?"
$A shell settings put system font_scale $sc; sleep 2
# (b) loading: cold start (restores the last non-empty conversation, model loading banner)
$A shell am force-stop $PKG; $A shell am start -n $PKG/.MainActivity >/dev/null; sleep 1.2; shot loading
# (a) empty with model ready: new chat, wait for suggestions, wait for model load
ui wait "Ask something|Pergunte" 60 >/dev/null; sleep 6
for i in 1 2 3; do ui tap "^(New chat|Nova conversa)$" >/dev/null; sleep 2; ui has "TRY ASKING|EXPERIMENTE|EXPERIMENTE PERGUNTAR" && break; done
ui gone "Loading|Carregando" 60 >/dev/null; sleep 1; shot empty
# (c) generating (steps visible)
ui tap "^(Ask something|Pergunte.*)$" >/dev/null; sleep 1; $A shell input text "$q"; sleep 1; $A shell input keyevent KEYCODE_BACK; sleep 1
ui tap "^(Send|Enviar)$" >/dev/null; sleep 3.5; shot generating
# (d) answer, then one source expanded
ui gone "Stop answer|Parar" 600 >/dev/null; sleep 2
for i in 1 2 3; do $A shell input swipe 540 700 540 1900 250; done; sleep 1; shot answer
ui tap "^(Sources?|Fontes?) [0-9]" >/dev/null; sleep 2; shot answer-source-expanded
