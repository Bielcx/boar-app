#!/bin/bash
# Emulator + AOSP arm64 image + Maestro (network/disk, outside the lock). Stops below 12 GB free.
set -euo pipefail
SDK=$HOME/Library/Android/sdk; export JAVA_HOME=$(/usr/libexec/java_home -v 17)
floor() { local g; g=$(df -g / | tail -1 | awk '{print $4}'); echo "[emu] $(date +%T) free ${g} GB — $1"; [ "$g" -ge 12 ] || { echo "[emu] STOP: free disk below 12 GB"; exit 3; }; }
SM="$SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK"
floor start; $SM --install "emulator" | tail -1
floor image; $SM --install "system-images;android-35;default;arm64-v8a" | tail -1
floor avd
echo no | $SDK/cmdline-tools/latest/bin/avdmanager create avd -n boar_api35 -k "system-images;android-35;default;arm64-v8a" -d pixel_7 --force >/dev/null
C=$HOME/.android/avd/boar_api35.avd/config.ini
sed -i '' -e 's/^hw.ramSize=.*/hw.ramSize=4096/' -e 's/^hw.ramSize = .*/hw.ramSize = 4096/' "$C" 2>/dev/null || true
grep -q '^hw.ramSize' "$C" || echo 'hw.ramSize=4096' >> "$C"
grep -q '^disk.dataPartition.size' "$C" && sed -i '' 's/^disk.dataPartition.size.*/disk.dataPartition.size=6G/' "$C" || echo 'disk.dataPartition.size=6G' >> "$C"
grep -E 'ramSize|dataPartition|image.sysdir' "$C"
floor maestro; [ -x "$HOME/.maestro/bin/maestro" ] || curl -fsSL "https://get.maestro.mobile.dev" | bash >/dev/null 2>&1
"$HOME/.maestro/bin/maestro" --version 2>/dev/null | tail -1
du -sh "$SDK" "$HOME/.android" "$HOME/.maestro" 2>/dev/null; floor done
