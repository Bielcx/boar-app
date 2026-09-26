#!/usr/bin/env bash
# Runs ON the Mac that builds iOS (the one with the Xcode Expo SDK 57 needs).
# Usually invoked through scripts/ios-remote-build.sh, which syncs the repo
# first; can also be run directly on that Mac from a checkout.
#
#   scripts/ios-build-on-host.sh sim       # Release .app for the simulator
#   scripts/ios-build-on-host.sh sim-run   # ...boot a simulator, install, seed models, launch
#   scripts/ios-build-on-host.sh device    # signed Release .app for a real iPhone
#   scripts/ios-build-on-host.sh device-run   # ...install + launch on IOS_DEVICE via devicectl
#
# Env:
#   IOS_XCODE_APP      Xcode to use (default: highest CFBundleShortVersionString among /Applications/Xcode*.app)
#   IOS_CONFIG         Release | Debug (default Release: JS bundled, no Metro)
#   IOS_SKIP_DEPS      1 = skip npm ci / prebuild / pod install (reuse ios/)
#   IOS_SIM_DEVICE     simulator UDID for sim-run (default: an available iPhone 17 Pro, else any iPhone)
#   IOS_MODELS_DIR     models for sim-run (default ~/boar/shared-models, else /Users/r4to/Script/boar/shared-models)
#   IOS_OUT_DIR        copy the built BOAR.app to $IOS_OUT_DIR/<sdk>/ and delete ios/build
#                      except the pod-install codegen in ios/build/generated (disk rule on the
#                      main Mac); unset = keep ios/build/Build/Products
#   IOS_TEAM           Apple team id for device builds (required; never committed)
#   IOS_DEVICE         device id for device-run (CoreDevice id or UDID, `xcrun devicectl list devices`)
#   IOS_NO_QUEUE       1 = do not go through ~/boar/bin/heavy (on a Mac without the queue
#                      it is skipped automatically)
#   IOS_STRIP_ENTITLEMENTS  comma list of entitlement keys to drop before a device
#                      build, e.g. com.apple.developer.kernel.increased-memory-limit
#                      when the signing team cannot get that capability
set -euo pipefail

MODE="${1:?usage: $0 sim|sim-run|device|device-run}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CONFIG="${IOS_CONFIG:-Release}"
BUNDLE_ID="$(node -p "require('./app.json').expo.ios.bundleIdentifier")"
log() { printf '[ios-build-on-host %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# Heavy steps (npm ci, pod install, xcodebuild) wait for the build host's
# one-job-at-a-time queue when it exists (~/boar/bin/heavy, log in ~/boar/heavy.log).
HEAVY=()
if [[ "${IOS_NO_QUEUE:-0}" != "1" && -x "$HOME/boar/bin/heavy" ]]; then
  HEAVY=("$HOME/boar/bin/heavy" Harbor)
fi
heavy() { ${HEAVY[@]+"${HEAVY[@]}"} "$@"; }

newest_xcode() {
  local app best="" best_v=""
  for app in /Applications/Xcode*.app; do
    local v; v=$(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null) || continue
    if [[ -z "$best" || "$(printf '%s\n%s\n' "$best_v" "$v" | sort -V | tail -1)" == "$v" ]]; then
      best="$app"; best_v="$v"
    fi
  done
  echo "$best"
}
XCODE="${IOS_XCODE_APP:-$(newest_xcode)}"
export DEVELOPER_DIR="$XCODE/Contents/Developer"
log "using $(xcodebuild -version | head -1) at $XCODE"

if [[ "${IOS_SKIP_DEPS:-0}" != "1" ]]; then
  heavy npm ci --no-audit --no-fund
  npx expo prebuild -p ios --no-install --clean
  (cd ios && heavy pod install)
fi

case "$MODE" in
  sim|sim-run)
    # A concrete simulator, not "generic/platform=iOS Simulator": the generic
    # destination wants the runtime matching the SDK (e.g. iOS 27 for Xcode 27),
    # while any installed runtime >= the deployment target (16.4) works here.
    SDK=iphonesimulator
    DEV="${IOS_SIM_DEVICE:-}"
    if [[ -z "$DEV" ]]; then
      DEV=$(xcrun simctl list devices available | grep -E 'iPhone 17 Pro \(' | head -1 | grep -oE '[0-9A-F-]{36}' || true)
      [[ -n "$DEV" ]] || DEV=$(xcrun simctl list devices available | grep iPhone | head -1 | grep -oE '[0-9A-F-]{36}' || true)
    fi
    if [[ -n "$DEV" ]]; then
      DEST_ARGS=(-destination "platform=iOS Simulator,id=$DEV")
    elif [[ "$MODE" == "sim" ]]; then
      # A build host without any simulator runtime (the mini) still has the
      # simulator SDK; the .app then runs on another Mac's runtime.
      log "no simulator available: building with -sdk only"
      DEST_ARGS=()
    else
      echo "sim-run needs an available simulator" >&2; exit 2
    fi
    SIGN_ARGS=(ARCHS=arm64 ONLY_ACTIVE_ARCH=YES)
    ;;
  device|device-run)
    : "${IOS_TEAM:?set IOS_TEAM to the Apple team id (Xcode > Settings > Accounts)}"
    SDK=iphoneos; DEST_ARGS=(-destination "generic/platform=iOS")
    SIGN_ARGS=(-allowProvisioningUpdates DEVELOPMENT_TEAM="$IOS_TEAM" CODE_SIGN_STYLE=Automatic)
    ENT=ios/BOAR/BOAR.entitlements
    IFS=',' read -ra STRIP <<< "${IOS_STRIP_ENTITLEMENTS:-}"
    for key in ${STRIP[@]+"${STRIP[@]}"}; do
      [[ -n "$key" ]] || continue
      log "dropping entitlement $key"
      /usr/libexec/PlistBuddy -c "Delete :$key" "$ENT" 2>/dev/null || true
    done
    ;;
  *) echo "unknown mode $MODE" >&2; exit 2 ;;
esac

log "xcodebuild $CONFIG $SDK"
heavy xcodebuild -workspace ios/BOAR.xcworkspace -scheme BOAR -configuration "$CONFIG" \
  -sdk "$SDK" ${DEST_ARGS[@]+"${DEST_ARGS[@]}"} -derivedDataPath ios/build "${SIGN_ARGS[@]}" \
  > build.log 2>&1 || { grep -E "error:|BUILD FAILED" build.log | head -40; exit 65; }
APP="$ROOT/ios/build/Build/Products/$CONFIG-$SDK/BOAR.app"
log "built $APP ($(du -sh "$APP" | cut -f1))"

if [[ -n "${IOS_OUT_DIR:-}" ]]; then
  mkdir -p "$IOS_OUT_DIR/$SDK"
  rm -rf "$IOS_OUT_DIR/$SDK/BOAR.app"
  cp -R "$APP" "$IOS_OUT_DIR/$SDK/"
  APP="$IOS_OUT_DIR/$SDK/BOAR.app"
  # ios/build/generated holds the codegen written by pod install; keep it so
  # an IOS_SKIP_DEPS=1 rebuild still finds it.
  find ios/build -mindepth 1 -maxdepth 1 ! -name generated -exec rm -rf {} +
  log "kept only $APP (+ ios/build/generated)"
else
  # Keep the product, drop the heavy intermediates.
  rm -rf ios/build/Build/Intermediates.noindex ios/build/Index.noindex
fi

case "$MODE" in
  sim-run)
    xcrun simctl boot "$DEV" 2>/dev/null || true
    xcrun simctl bootstatus "$DEV" -b >/dev/null
    xcrun simctl install "$DEV" "$APP"
    xcrun simctl launch "$DEV" "$BUNDLE_ID" >/dev/null
    MODELS="${IOS_MODELS_DIR:-$HOME/boar/shared-models}"
    [[ -d "$MODELS" ]] || MODELS=/Users/r4to/Script/boar/shared-models
    IOS_SIM_UDID="$DEV" scripts/ios-sim-seed-models.sh "$MODELS"
    xcrun simctl terminate "$DEV" "$BUNDLE_ID" || true
    xcrun simctl launch "$DEV" "$BUNDLE_ID"
    log "simulator UDID: $DEV"
    ;;
  device-run)
    : "${IOS_DEVICE:?set IOS_DEVICE (xcrun devicectl list devices)}"
    xcrun devicectl device install app --device "$IOS_DEVICE" "$APP"
    xcrun devicectl device process launch --device "$IOS_DEVICE" "$BUNDLE_ID"
    ;;
esac
log done
