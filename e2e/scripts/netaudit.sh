#!/usr/bin/env bash
# Snapshot of the app uid's sockets and traffic. usage: netaudit.sh <package> <label> <outdir>
set -uo pipefail
A=${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}
pkg=$1; label=$2; out=$3; mkdir -p "$out"
uid=$($A shell dumpsys package "$pkg" | grep -m1 -oE 'appId=[0-9]+' | cut -d= -f2)
f="$out/net-$label.txt"
{
  echo "# $pkg uid=$uid  $(date '+%F %T')  label=$label"
  for t in tcp tcp6 udp udp6; do
    # column 8 (index 7) of /proc/net/* is the uid
    n=$($A shell cat /proc/net/$t | awk -v u="$uid" 'NR>1 && $8==u' | wc -l | tr -d ' ')
    echo "/proc/net/$t sockets for uid $uid: $n"
    $A shell cat /proc/net/$t | awk -v u="$uid" 'NR>1 && $8==u'
  done
  echo "## dumpsys netstats detail (uid=$uid)"
  $A shell dumpsys netstats detail | grep -A3 "uid=$uid" || echo "(no netstats entries for uid=$uid)"
} > "$f"
grep -E "sockets for uid|no netstats" "$f"
echo "-> $f"
