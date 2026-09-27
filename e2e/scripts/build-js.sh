#!/usr/bin/env bash
# JS-only incremental release rebuild: checkout <sha> over an existing prebuild of the
# same native base, re-run assembleRelease (bundle + package only). usage: build-js.sh <sha> <variant>
set -euo pipefail
sha=$1; v=$2
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}
export ANDROID_HOME=$HOME/Library/Android/sdk PATH=$JAVA_HOME/bin:$PATH
export EXPO_PUBLIC_BOAR_VARIANT=$v
git checkout -q --detach "$sha"
t0=$(date +%s)
(cd android && nice -n 10 ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a)
mkdir -p "${BUILDS_DIR:-dist}"; out=${BUILDS_DIR:-dist}/boar-integration-$(git rev-parse --short HEAD)-$v-arm64.apk
cp android/app/build/outputs/apk/release/app-release.apk "$out"
shasum -a 256 "$out" | tee "$out.sha256"
AUDIT_VARIANT=$v bash scripts/audit-offline-apk.sh "$out" $v || echo "AUDIT FAILED ($v)"
echo "== done $v@$sha in $(( $(date +%s)-t0 ))s -> $out"
