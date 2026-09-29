#!/usr/bin/env bash
# Full release build of one variant with limited C++ parallelism (ninja -j3 + nice),
# keeping the llama.rn .cxx cache. usage: e2e/scripts/build.sh offline|downloader
set -euo pipefail
v=$1
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
export CMAKE_BUILD_PARALLEL_LEVEL=4
NJ=$ANDROID_HOME/cmake/3.22.1/bin/ninja
sha=$(git rev-parse --short HEAD)
t0=$(date +%s)
echo "== $v @ $sha $(date)"
EXPO_PUBLIC_BOAR_VARIANT=$v CI=1 npx expo prebuild -p android --clean --no-install
export EXPO_PUBLIC_BOAR_VARIANT=$v
# llama.rn C++ (cache kept)
for d in node_modules/llama.rn/android/.cxx/RelWithDebInfo/*/arm64-v8a; do nice -n 10 $NJ -j3 -C $d; done
# app codegen C++
(cd android && nice -n 10 ./gradlew ":app:configureCMakeRelWithDebInfo[arm64-v8a]" -PreactNativeArchitectures=arm64-v8a)
for d in android/app/.cxx/RelWithDebInfo/*/arm64-v8a; do nice -n 10 $NJ -j3 -C $d; done
(cd android && nice -n 10 ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a)
mkdir -p "${BUILDS_DIR:-dist}"; out=${BUILDS_DIR:-dist}/boar-integration-$sha-$v-arm64.apk
cp android/app/build/outputs/apk/release/app-release.apk "$out"
shasum -a 256 "$out" | tee "$out.sha256"
AUDIT_VARIANT=$v bash scripts/audit-offline-apk.sh "$out" $v || echo "AUDIT FAILED ($v)"
echo "== done $v in $(( $(date +%s)-t0 ))s -> $out"
