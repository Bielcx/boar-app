#!/usr/bin/env bash
# Builds BOAR for iOS on a remote Mac (default: r4toMacMini) and copies
# BOAR.app back. Use it when this Mac's Xcode is older than the one Expo
# SDK 57 needs, or to keep builds and inference off this Mac (see
# docs/IOS.md). The work itself is scripts/ios-build-on-host.sh.
#
#   scripts/ios-remote-build.sh sim            # simulator .app -> $IOS_OUT_DIR
#   scripts/ios-remote-build.sh sim-run        # ...and run it (plus the model) on a remote simulator
#   scripts/ios-remote-build.sh device         # signed device .app (IOS_TEAM required)
#   scripts/ios-remote-build.sh device-run     # ...install + launch on IOS_DEVICE from the remote
#   scripts/ios-remote-build.sh device-local   # device build on the remote, install + launch from THIS Mac
#                                              # (fallback when the phone is only paired here)
#
# Env: IOS_BUILD_HOST (r4toMacMini), IOS_REMOTE_DIR (boar-ios-build),
# IOS_OUT_DIR (/Users/r4to/Script/boar/builds/ios), plus everything
# ios-build-on-host.sh reads (IOS_TEAM, IOS_DEVICE, IOS_CONFIG, ...), which
# is forwarded to the remote. Nothing secret is stored in the repo.
set -euo pipefail

MODE="${1:-sim}"
HOST="${IOS_BUILD_HOST:-r4toMacMini}"
REMOTE_DIR="${IOS_REMOTE_DIR:-boar-ios-build}"
OUT_DIR="${IOS_OUT_DIR:-/Users/r4to/Script/boar/builds/ios}"
CONFIG="${IOS_CONFIG:-Release}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="$(node -p "require('$ROOT/app.json').expo.ios.bundleIdentifier")"
log() { printf '[ios-remote-build %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

REMOTE_MODE="$MODE"; SDK=iphonesimulator
case "$MODE" in
  sim|sim-run) ;;
  device|device-run) SDK=iphoneos ;;
  device-local) REMOTE_MODE=device; SDK=iphoneos ;;
  *) echo "unknown mode $MODE" >&2; exit 2 ;;
esac

log "sync $ROOT -> $HOST:$REMOTE_DIR"
rsync -a --delete \
  --exclude node_modules --exclude /ios --exclude /android --exclude .git \
  --exclude .maestri --exclude '*.gguf' --exclude /assets/models --exclude build.log \
  "$ROOT/" "$HOST:$REMOTE_DIR/"

# Forward the IOS_* settings; values are single-quoted for the remote shell.
ENV_ARGS=""
for var in IOS_XCODE_APP IOS_CONFIG IOS_SKIP_DEPS IOS_SIM_DEVICE IOS_MODELS_DIR IOS_TEAM IOS_DEVICE IOS_STRIP_ENTITLEMENTS; do
  [[ -n "${!var:-}" ]] && ENV_ARGS+="$var=$(printf '%q' "${!var}") "
done

# The remote login shell is fish; run under bash -lc.
log "remote: ios-build-on-host.sh $REMOTE_MODE"
ssh "$HOST" "bash -lc \"cd $REMOTE_DIR && $ENV_ARGS scripts/ios-build-on-host.sh $REMOTE_MODE\""

APP_REMOTE="$REMOTE_DIR/ios/build/Build/Products/$CONFIG-$SDK/BOAR.app"
DEST="$OUT_DIR/$SDK/BOAR.app"
mkdir -p "$DEST"
log "fetch BOAR.app -> $DEST"
rsync -a --delete "$HOST:$APP_REMOTE/" "$DEST/"

if [[ "$MODE" == "device-local" ]]; then
  : "${IOS_DEVICE:?set IOS_DEVICE (xcrun devicectl list devices)}"
  log "install + launch on $IOS_DEVICE from this Mac"
  xcrun devicectl device install app --device "$IOS_DEVICE" "$DEST"
  xcrun devicectl device process launch --device "$IOS_DEVICE" "$BUNDLE_ID"
fi
log done
