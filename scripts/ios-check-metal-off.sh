#!/usr/bin/env bash
# Checks that the generated AppDelegate turns Metal off for llama.rn before React Native starts
# (plugins/withIosMetalOff.js, v1.1 decision).   scripts/ios-check-metal-off.sh [ios-dir]
set -euo pipefail
IOS="${1:-ios}"
SCHEME=$(basename "$(ls -d "$IOS"/*.xcworkspace | head -1)" .xcworkspace)
AD="$IOS/$SCHEME/AppDelegate.swift"
env_line=$(grep -n 'setenv("GGML_METAL_DEVICES", "0", 0)' "$AD" | head -1 | cut -d: -f1)
rn_line=$(grep -n 'let delegate = ReactNativeDelegate()' "$AD" | head -1 | cut -d: -f1)
[[ -n "$env_line" ]] || { echo "ios-check-metal-off: $AD does not set GGML_METAL_DEVICES=0" >&2; exit 1; }
[[ -n "$rn_line" && "$env_line" -lt "$rn_line" ]] || { echo "ios-check-metal-off: setenv must come before React Native starts in $AD" >&2; exit 1; }
echo "ios-check-metal-off: ok ($SCHEME)"
