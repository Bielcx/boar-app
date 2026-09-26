# Android build variants

TL;DR: `make apk-offline` builds BOAR with **no network permission at all**;
models and knowledge packs are imported from files. `make apk-downloader` builds
the app that downloads them in-app (what v1.0.0 is). Both land in `dist/` with a
`.sha256` file and are audited automatically.

```bash
make apk-offline                     # dist/boar-offline-<version>-arm64.apk
make apk-downloader                  # dist/boar-downloader-<version>-arm64.apk
make apk-both
make audit-apk APK=dist/boar-offline-1.0.0-arm64.apk
EXPO_PUBLIC_BOAR_VOICE=1 make apk-offline   # offline, but keep voice input
```

Needs the Android SDK + NDK and JDK 17 (the same toolchain as
`make run-android`).

## What differs

| | offline | downloader (default) |
|---|---|---|
| `EXPO_PUBLIC_BOAR_VARIANT` | `offline` | unset or `downloader` |
| Application id | `team.sopa.aoair.offline` (installs next to the other) | `team.sopa.aoair` |
| App name | BOAR Offline | BOAR |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_NETWORK_STATE`, `CHANGE_WIFI_STATE` | removed | `INTERNET` kept |
| `RECORD_AUDIO` | removed, unless `EXPO_PUBLIC_BOAR_VOICE=1` | kept (voice is off by default) |
| `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE` | removed | removed |
| `allowBackup`, `usesCleartextTraffic` | `false`, `false` | `false`, `false` |
| Getting models | import from file only | download in-app, or import from file |
| Hugging Face model search | disabled | enabled |
| Voice with the system recognizer | never (on-device only) | only after the user accepts a warning |

## How it works

One environment variable, read in two places, so the APK and the JS can't
disagree:

- `app.config.js` → `plugins/withBuildVariant.js` sets `android.blockedPermissions`
  (Expo writes them as `tools:node="remove"`, which also strips permissions that
  libraries try to merge in), the application id, `allowBackup` and cleartext.
- `src/config/variant.ts` (`APP_VARIANT`, `networkAllowed()`): Expo inlines
  `EXPO_PUBLIC_*` variables into the JS bundle at build time. Every network call
  site checks `networkAllowed()` first; `src/config/networkAudit.test.ts` fails
  if a new one appears unchecked.

`scripts/build-variant.sh` always runs `expo prebuild --clean`: the generated
`android/` folder of one variant must not leak into the other.

The release build ignores `src/debug/AndroidManifest.xml` (where React Native's
dev template adds `SYSTEM_ALERT_WINDOW` and cleartext for Metro), so debug builds
still work with the dev client.

## Audit

`scripts/audit-offline-apk.sh <apk or merged AndroidManifest.xml>` (adapted from
Field Atlas, Apache-2.0) fails when the offline build:

- declares any network permission, `SYSTEM_ALERT_WINDOW`, or `RECORD_AUDIO`
  (unless built with voice);
- doesn't disable cleartext traffic or backup;
- ships Play Services, Firebase, ML Kit, expo-updates, Retrofit, Ktor, Volley or
  Sentry classes. OkHttp is reported but allowed: it's part of React Native
  itself, and without `INTERNET` the OS refuses its sockets.

CI (`.github/workflows/ci.yml`): `offline-manifest-audit` on every pull request
(prebuild + Gradle manifest merge, no native compile), `offline-apk` on `main`
and on demand (full build, dex audit, APK uploaded as an artifact).

## iOS

iOS has no network permission to remove. The iOS side of the offline build
(no downloader, file import via the Files app) is tracked in the iOS docs.
