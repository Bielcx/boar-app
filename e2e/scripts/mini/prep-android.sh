#!/bin/bash
# Network/disk part (outside the heavy lock): clone, checkout, npm ci, expo prebuild. usage: prep-android.sh <sha> <variant>
set -euo pipefail
SHA=${1:?}; V=${2:-offline}; R=$HOME/boar/android/boar-app
floor() { local g; g=$(df -g / | tail -1 | awk '{print $4}'); echo "[prep] $(date +%T) free ${g} GB — $1"; [ "$g" -ge 12 ] || { echo "[prep] STOP: free disk below 12 GB"; exit 3; }; }
t0=$(date +%s); floor start
[ -d "$R/.git" ] || git clone -q https://github.com/r4topunk/boar-app.git "$R"
cd "$R"; git fetch -q origin; git checkout -q --detach "$SHA"; echo "[prep] HEAD $(git log --oneline -1)"
lh=$(shasum package-lock.json | cut -c1-12); if [ "$(cat node_modules/.lockhash 2>/dev/null)" != "$lh" ]; then floor "npm ci"; npm ci --no-audit --no-fund --loglevel=error; echo "$lh" > node_modules/.lockhash; fi
t1=$(date +%s); floor prebuild; export ANDROID_HOME=$HOME/Library/Android/sdk
EXPO_PUBLIC_BOAR_VARIANT=$V CI=1 npx expo prebuild -p android --clean --no-install >/dev/null
echo "$V" > android/.boar-variant; t2=$(date +%s); echo "[prep] times: clone+npm $((t1-t0))s, prebuild $((t2-t1))s"; floor done
