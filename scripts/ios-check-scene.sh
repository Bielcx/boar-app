#!/usr/bin/env bash
# Checks that the generated ios/ project uses the scene life cycle (plugins/withIosSceneLifecycle.js).
# Without it, iOS 27 kills the app at launch when it is built with the iOS 27 SDK (Xcode 27).
#   scripts/ios-check-scene.sh [ios-dir]   # exit 0 = ok, 1 = missing (re-run the prebuild)
set -euo pipefail
IOS="${1:-ios}"
SCHEME=$(basename "$(ls -d "$IOS"/*.xcworkspace | head -1)" .xcworkspace)
PLIST="$IOS/$SCHEME/Info.plist"; AD="$IOS/$SCHEME/AppDelegate.swift"
fail() { echo "ios-check-scene: $*" >&2; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :UIApplicationSceneManifest:UISceneConfigurations:UIWindowSceneSessionRoleApplication:0:UISceneDelegateClassName' "$PLIST" 2>/dev/null)" == EXExpoAppSceneDelegate ]] \
  || fail "$PLIST has no UIApplicationSceneManifest with EXExpoAppSceneDelegate"
grep -q 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider' "$AD" || fail "$AD does not conform to ExpoReactNativeFactoryProvider"
! grep -q 'factory.startReactNative(' "$AD" || fail "$AD still starts React Native itself (the scene delegate does)"
echo "ios-check-scene: ok ($SCHEME)"
