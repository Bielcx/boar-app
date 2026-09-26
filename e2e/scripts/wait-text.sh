#!/usr/bin/env bash
# Wait until <text> is on screen (Maestri portal snapshot; uiautomator dump fails
# while animations run). Prints elapsed seconds. Usage: wait-text.sh "<text>" [timeout_s] [portal]
set -uo pipefail
text="$1"; limit="${2:-600}"; portal="${3:-Pixel}"; start=$(date +%s)
while :; do
  if maestri portal snapshot "$portal" 2>/dev/null | grep -qF -- "$text"; then
    echo "$(( $(date +%s) - start ))"; exit 0
  fi
  [ $(( $(date +%s) - start )) -ge "$limit" ] && { echo "timeout waiting for '$text'" >&2; exit 1; }
  sleep 3
done
