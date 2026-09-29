#!/bin/bash
# Android SDK for the mini (Piston). Stops if free disk < 12 GB.
set -euo pipefail
SDK=$HOME/Library/Android/sdk; mkdir -p "$SDK/cmdline-tools"
floor() { local g; g=$(df -g / | tail -1 | awk '{print $4}'); echo "[sdk] free ${g} GB"; [ "$g" -ge 12 ] || { echo "[sdk] STOP: free disk below 12 GB"; exit 3; }; }
floor
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  f=$(curl -fsSL https://dl.google.com/android/repository/repository2-1.xml | grep -oE 'commandlinetools-mac-[0-9]+_latest\.zip' | sort -t- -k3 -n | tail -1)
  echo "[sdk] cmdline-tools: $f"; tmp=$(mktemp -d); curl -fsSL -o "$tmp/c.zip" "https://dl.google.com/android/repository/$f"
  unzip -q "$tmp/c.zip" -d "$tmp"; rm -rf "$SDK/cmdline-tools/latest"; cp -R "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"; rm -rf "$tmp"
fi
SM="$SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK"
yes | $SM --licenses >/dev/null || true
for p in "platform-tools" "platforms;android-36" "build-tools;36.0.0" "cmake;3.22.1" "ndk;27.1.12297006"; do floor; echo "[sdk] installing $p"; $SM --install "$p" | tail -1; done
floor; $SM --list_installed | sed -n '1,20p'; du -sh "$SDK"
