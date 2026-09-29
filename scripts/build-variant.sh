#!/usr/bin/env bash
# Builds one Android release variant locally and audits it.
#   scripts/build-variant.sh offline      -> dist/boar-offline-<version>-arm64.apk
#   scripts/build-variant.sh downloader   -> dist/boar-downloader-<version>-arm64.apk
# Needs the Android SDK/NDK and JDK 17 (see README "Build from source").
# EXPO_PUBLIC_BOAR_VOICE=1 keeps voice input (RECORD_AUDIO) in the offline build.
set -euo pipefail
cd "$(dirname "$0")/.."

variant=${1:?usage: $0 offline|downloader}
case "$variant" in offline|downloader) ;; *) echo "unknown variant: $variant" >&2; exit 2 ;; esac

export EXPO_PUBLIC_BOAR_VARIANT=$variant
version=$(node -p "require('./app.json').expo.version")

# --clean: the android/ folder is generated, and a leftover one from the
# other variant would carry its permissions and applicationId.
npx expo prebuild -p android --clean --no-install
(cd android && ./gradlew --no-daemon :app:assembleRelease -PreactNativeArchitectures=arm64-v8a)

mkdir -p dist
out="dist/boar-${variant}-${version}-arm64.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$out"
(cd dist && shasum -a 256 "$(basename "$out")" > "$(basename "$out").sha256")

AUDIT_VARIANT=$variant scripts/audit-offline-apk.sh "$out"
echo "built $out"
