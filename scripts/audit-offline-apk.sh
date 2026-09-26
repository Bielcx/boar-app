#!/usr/bin/env bash
# Audits a built BOAR APK (or a merged AndroidManifest.xml) for the offline
# variant's guarantees. Exit 1 on any violation.
#
#   scripts/audit-offline-apk.sh path/to/app-release.apk
#   scripts/audit-offline-apk.sh path/to/merged/AndroidManifest.xml
#   AUDIT_VARIANT=downloader scripts/audit-offline-apk.sh app.apk   # report only
#
# Adapted from Field Atlas's scripts/verify_offline.sh (Apache-2.0,
# https://github.com/0x94t3z/fieldatlas).
set -euo pipefail

target=${1:?usage: $0 <apk|AndroidManifest.xml>}
variant=${AUDIT_VARIANT:-offline}
[[ -f "$target" ]] || { echo "not found: $target" >&2; exit 2; }

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}
fail=0
bad() { echo "FAIL: $*" >&2; fail=1; }

FORBIDDEN_PERMS=(
  android.permission.INTERNET
  android.permission.ACCESS_NETWORK_STATE
  android.permission.ACCESS_WIFI_STATE
  android.permission.CHANGE_NETWORK_STATE
  android.permission.CHANGE_WIFI_STATE
  android.permission.SYSTEM_ALERT_WINDOW
)
if [[ "${EXPO_PUBLIC_BOAR_VOICE:-0}" != "1" ]]; then
  FORBIDDEN_PERMS+=(android.permission.RECORD_AUDIO)
fi

# Network/cloud client libraries the offline build must not ship. OkHttp is
# NOT listed: React Native's core networking module links it in every app.
# Without INTERNET the OS refuses its sockets, and the app's own code never
# calls fetch in this variant (src/config/variant.ts).
FORBIDDEN_PACKAGES=(
  com.google.android.gms
  com.google.firebase
  com.google.mlkit
  expo.modules.updates
  retrofit2
  io.ktor.client
  com.android.volley
  io.sentry
)

if [[ "$target" == *.xml ]]; then
  # Merged manifest: permissions that survive are plain <uses-permission> without tools:node="remove".
  perms=$(grep -o '<uses-permission[^>]*>' "$target" | grep -v 'tools:node="remove"' | grep -o 'android:name="[^"]*"' | cut -d'"' -f2 || true)
  manifest=$(cat "$target")
  packages=""
else
  apkanalyzer=$(ls "$sdk"/cmdline-tools/*/bin/apkanalyzer 2>/dev/null | head -1 || true)
  aapt2=$(ls "$sdk"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)
  if [[ -n "$apkanalyzer" ]]; then
    perms=$("$apkanalyzer" manifest permissions "$target")
    manifest=$("$apkanalyzer" manifest print "$target")
    packages=$("$apkanalyzer" dex packages "$target" | awk '{print $NF}')
  elif [[ -n "$aapt2" ]]; then
    perms=$("$aapt2" dump permissions "$target" | grep -o "name='[^']*'" | cut -d"'" -f2)
    manifest=$("$aapt2" dump xmltree --file AndroidManifest.xml "$target")
    packages=$(unzip -p "$target" 'classes*.dex' | strings | grep -oE 'L[a-z0-9_]+(/[A-Za-z0-9_$]+)+;' | tr '/' '.' | sed 's/^L//' || true)
  else
    echo "Need apkanalyzer or aapt2 under $sdk" >&2; exit 2
  fi
fi

echo "== declared permissions ($variant audit) =="
echo "${perms:-<none>}"

if [[ "$variant" == offline ]]; then
  for p in "${FORBIDDEN_PERMS[@]}"; do
    grep -qx "$p" <<<"$perms" && bad "declares $p"
  done
  grep -Eq 'usesCleartextTraffic(="|\(.*\)=)(false|0|0x0)' <<<"$manifest" || bad "cleartext traffic not explicitly disabled"
  grep -Eq 'allowBackup(="|\(.*\)=)(false|0|0x0)' <<<"$manifest" || bad "allowBackup not disabled"
  if [[ -n "$packages" ]]; then
    for pkg in "${FORBIDDEN_PACKAGES[@]}"; do
      grep -q "^${pkg//./\\.}" <<<"$packages" && bad "ships network/cloud package $pkg"
    done
    grep -q '^okhttp3' <<<"$packages" && echo "note: okhttp3 present (React Native core); inert without INTERNET"
  fi
fi

if [[ "$target" == *.apk ]]; then
  echo "bytes=$(wc -c <"$target" | tr -d ' ')"
  echo "sha256=$(shasum -a 256 "$target" | awk '{print $1}')"
fi

if [[ $fail -ne 0 ]]; then echo "RESULT: FAIL" >&2; exit 1; fi
echo "RESULT: PASS ($variant)"
