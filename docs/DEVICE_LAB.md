# Device lab (macOS, Apple Silicon)

TL;DR: build the Android app locally with no Android Studio, run it on an arm64
emulator **without Google Play Services** (AOSP image, the same situation as
GrapheneOS), and drive it with Maestro end-to-end flows.

Footprint on disk (measured on an M1, 2026-09-26):

| Piece | Size |
|---|---|
| Android SDK (platform-tools, build-tools 36, platform 36, NDK 27.1, emulator, 1 system image) | ~5.6 GB |
| OpenJDK 17 (Homebrew formula) | ~0.3 GB |
| Maestro CLI | ~0.35 GB |
| Gradle cache (`~/.gradle`) after one build | ~4 GB (UNKNOWN: re-measure) |
| AVD data partition (capped) | ≤ 4 GB |

## 1. Toolchain

Versions come from the project, not from taste:
`node_modules/react-native/gradle/libs.versions.toml` pins compileSdk 36,
build-tools 36.0.0 and NDK 27.1.12297006.

```bash
# JDK 17: the Homebrew *formula*, no sudo (the zulu/temurin casks need sudo)
brew install openjdk@17
# cmdline-tools (sdkmanager, avdmanager)
brew install --cask android-commandlinetools

export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
mkdir -p $ANDROID_HOME/cmdline-tools

# avdmanager derives the SDK root from its own path, so it must live *inside*
# the SDK (a symlink is not enough: it resolves to the Homebrew path).
cp -R /opt/homebrew/share/android-commandlinetools/cmdline-tools/latest \
      $ANDROID_HOME/cmdline-tools/latest

yes | sdkmanager --sdk_root=$ANDROID_HOME --licenses
sdkmanager --sdk_root=$ANDROID_HOME \
  "platform-tools" "emulator" "platforms;android-36" "build-tools;36.0.0" \
  "ndk;27.1.12297006" "system-images;android-35;default;arm64-v8a"
```

fish (the default shell on this machine), in `~/.config/fish/config.fish`:

```fish
set -gx JAVA_HOME /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
set -gx ANDROID_HOME $HOME/Library/Android/sdk
fish_add_path $ANDROID_HOME/platform-tools $ANDROID_HOME/emulator $ANDROID_HOME/cmdline-tools/latest/bin $HOME/.maestro/bin
```

## 2. Emulator without Google Play Services

`default` system images are plain AOSP: no GMS, no Play Store. That is the
bounty's "no Google Play Services" condition, and close to GrapheneOS.

```bash
echo no | avdmanager create avd -n boar_api35 \
  -k "system-images;android-35;default;arm64-v8a" -d pixel_7
# cap disk and give it a phone-like amount of RAM
C=~/.android/avd/boar_api35.avd/config.ini
sed -i '' '/^disk.dataPartition.size=/d;/^hw.ramSize=/d;/^hw.keyboard=/d' $C
printf "disk.dataPartition.size=4G\nhw.ramSize=4096\nhw.keyboard=yes\n" >> $C

emulator -avd boar_api35 -no-snapshot-save -no-boot-anim -gpu host &
adb wait-for-device && adb shell getprop sys.boot_completed   # 1 when ready
```

Check that there is no GMS: `adb shell pm list packages | grep -c google.android.gms` prints `0`.

## 3. Build (release, JS bundle embedded, no Metro)

```bash
npm ci
CI=1 npx expo prebuild -p android --no-install
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a \
  -Porg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g"
# → android/app/build/outputs/apk/release/app-release.apk (debug-signed unless BOAR_UPLOAD_* is set)
```

Only `arm64-v8a` is built: the emulator and every target phone are arm64, and it
cuts build time and disk use by about 4×.

Keep the APK, then drop the intermediates (disk is tight):

```bash
mkdir -p ../../builds/android && cp app/build/outputs/apk/release/app-release.apk ../../builds/android/boar-<branch>-<sha>.apk
rm -rf app/build build .cxx ../modules/*/android/build ../node_modules/*/android/build ../node_modules/*/android/.cxx
```

## 4. Install and run

```bash
adb install -r builds/android/boar-<branch>-<sha>.apk
adb shell monkey -p team.sopa.aoair 1
```

## 5. End-to-end tests (Maestro)

See `e2e/README.md`.

## UNKNOWN

- The Gradle cache size after a clean build (re-measure).
- The emulator runs llama.cpp on the host's CPU through arm64 virtualization, so
  its speeds are **not** phone numbers. The emulator checks flows, not performance.
