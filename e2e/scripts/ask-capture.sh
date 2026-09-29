#!/usr/bin/env bash
# New chat, ask, wait, scroll to top, save PNG + text dump. usage: ask-capture.sh <outdir> <name> <question with %s for spaces>
set -uo pipefail
A=$HOME/Library/Android/sdk/platform-tools/adb; S=$(dirname "$0"); O=$1; name=$2; q=$3; mkdir -p $O
python3 $S/ui.py tap "^(Open menu|Abrir menu)$" >/dev/null; sleep 3; python3 $S/ui.py tap "^(New chat|Nova conversa)$" >/dev/null || echo "  NEW CHAT NOT FOUND"; sleep 2; python3 $S/ui.py tap "^(Ask something|Pergunte algo)$" >/dev/null; sleep 1; $A shell input text "$q"; sleep 1
python3 $S/ui.py tap "^(Send|Enviar)$" >/dev/null; sleep 4; python3 $S/ui.py gone "Stop answer|Parar resposta" 400 >/dev/null; sleep 2
for i in 1 2 3; do $A shell input swipe 589 800 589 2000 250; done; sleep 1; $A exec-out screencap -p > $O/$name.png
$A exec-out uiautomator dump /dev/tty | python3 -c "
import sys,re,html
x=sys.stdin.read(); seen=[]
for t in re.findall(r'(?:text|content-desc)=\"([^\"]*)\"',x):
    t=html.unescape(t)
    if t in seen or len(t)<12 or t.startswith(('Delete','Ask:','Open menu','Offline','On device')): continue
    seen.append(t)
print('\n'.join(seen))" > $O/$name.txt
grep -E "^Performance|^Source|Not a substitute|general knowledge|conhecimento" $O/$name.txt | head -8 | sed 's/^/    /'
awk 'length>60' $O/$name.txt | grep -vE "^Performance|^Source|^Sources" | head -2 | cut -c1-400 | sed 's/^/    ANSWER: /'
