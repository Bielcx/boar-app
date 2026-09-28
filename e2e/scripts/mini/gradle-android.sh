#!/bin/bash
# Heavy part (inside the lock): assembleRelease with a disk watchdog (abort < 10 GB, Boar 2026-09-27; 12 GB elsewhere), copy, sha256, audit, cleanup.
# Low RAM/swap: GRADLE_WORKERS=2 CMAKE_JOBS=3 (swapfiles grow on the same volume and eat the disk margin).
set -uo pipefail
R=$HOME/boar/android/boar-app; OUT=$HOME/boar/android/apk; mkdir -p "$OUT"; cd "$R"; V=$(cat android/.boar-variant)
export JAVA_HOME=$(/usr/libexec/java_home -v 17) ANDROID_HOME=$HOME/Library/Android/sdk CMAKE_BUILD_PARALLEL_LEVEL=${CMAKE_JOBS:-6} EXPO_PUBLIC_BOAR_VARIANT=$V ANDROID_SDK_ROOT=$HOME/Library/Android/sdk
free() { df -g / | tail -1 | awk '{print $4}'; }
grep -q "org.gradle.workers.max" ~/.gradle/gradle.properties 2>/dev/null || { mkdir -p ~/.gradle; printf '\norg.gradle.workers.max=4\n' >> ~/.gradle/gradle.properties; }
t0=$(date +%s); echo "[gradle] $(date +%T) start $(git log --oneline -1) variant=$V free $(free) GB (floor ${GRADLE_FLOOR:-10}) workers=${GRADLE_WORKERS:-4} cmake=${CMAKE_JOBS:-6} swap: $(sysctl -n vm.swapusage)"
(cd android && exec ./gradlew --no-daemon -Dorg.gradle.workers.max=${GRADLE_WORKERS:-4} :app:assembleRelease -PreactNativeArchitectures=arm64-v8a -q) & GP=$!
minfree=99; aborted=0
while kill -0 $GP 2>/dev/null; do f=$(free); [ "$f" -lt "$minfree" ] && minfree=$f; if [ "$f" -lt "${GRADLE_FLOOR:-10}" ]; then echo "[gradle] ABORT: free $f GB < ${GRADLE_FLOOR:-10}"; pkill -P $GP; kill $GP; pkill -f GradleDaemon; aborted=1; break; fi; sleep 10; done
wait $GP; rc=$?; t1=$(date +%s)
echo "[gradle] rc=$rc aborted=$aborted gradle $((t1-t0))s; min free during build ${minfree} GB"
if [ $rc -eq 0 ] && [ $aborted -eq 0 ]; then
  apk="$OUT/boar-integration-$(git rev-parse --short HEAD)-$V-arm64.apk"; cp android/app/build/outputs/apk/release/app-release.apk "$apk"; shasum -a 256 "$apk" | tee "$apk.sha256"
  AUDIT_VARIANT=$V bash scripts/audit-offline-apk.sh "$apk" $V | tail -2 || echo "AUDIT FAILED"
fi
# cleanup intermediates, keep the llama.rn .cxx cache
rm -rf android/app/build node_modules/llama.rn/android/build; for d in node_modules/*/android/build node_modules/@*/*/android/build; do [ -d "$d" ] && rm -rf "$d"; done
(cd android && ./gradlew --stop >/dev/null 2>&1 || true); echo "[gradle] cleanup done; free $(free) GB; .cxx kept: $(du -sh node_modules/llama.rn/android/.cxx 2>/dev/null | cut -f1)"
exit $rc
