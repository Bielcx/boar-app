# e2e — device lab suite (Android emulator, Maestro)

TL;DR: Maestro YAML flows for the product paths, plus the adb scripts the device lab
used to produce the release evidence (FS-1, network audit, places, shots).

```bash
make -C e2e syntax                         # check every flow
make -C e2e build VARIANT=downloader       # full APK (emulator OFF while compiling)
make -C e2e build-js SHA=<commit>          # JS-only rebuild on the same native base (~1 min)
make -C e2e android                        # all flows, downloader build installed
make -C e2e flow F=04-places-berlin        # one flow
make -C e2e fs1 TAG=<build>                # FS-1 acceptance (live font change on setup step 3)
```

Toolchain and emulator setup: `docs/DEVICE_LAB.md`.

## Why Maestro (not Detox)

- YAML flows run against the release APK: no test build, no JS instrumentation.
- Same flows run on the iOS simulator (`appId` is the bundle id), so Harbor can
  reuse them on the mini.
- The app has no `testID`s; Maestro matches visible text and accessibility labels,
  which the UI primitives already set (`Button`, `ListRow`, `Chip`, …).

## Flows (`e2e/flows/`)

| Flow | Covers |
|---|---|
| `01-setup-downloader` | onboarding → Essential → download → chat |
| `01-setup-offline-import` | offline build: import every file from Downloads at once |
| `02-ask-with-sources` | answer with sources, expand a source |
| `03-airplane-mode` | answer with no network |
| `04-places-berlin` | vegan places: explicit city, near me (mock GPS), city with no data (Qujing) |
| `05-switch-model` | switch the answer model in Models |
| `06-knowledge` | topic packs listed |
| `99-reset` | erase all data → onboarding |

Status (first `maestro test` run, integration 54202b7 downloader, AVD 3.8 GB, 2026-09-27):

| Flow | Result |
|---|---|
| `01-setup-downloader` | PASS (7 min, real download) |
| `06-knowledge` | PASS |
| `05-switch-model` | failed with one answer model installed → now logs `SKIP` instead |
| `99-reset` | FAIL: after "Erase everything" the app closes itself instead of opening setup (RS-1, app bug) |
| `02`, `03`, `04`, `01-setup-offline-import` | UNKNOWN: not run end to end yet (run interrupted to free the machine) |

The first run also hit a native crash in expo-sqlite (`closeDatabase` → `sqlite3_finalize`,
Scudo "corrupted chunk header") when the app was stopped and relaunched between flows.

## Scripts (`e2e/scripts/`), used for the evidence

| Script | What it does |
|---|---|
| `ui.py` | adb + uiautomator: `dump`, `tap <regex>`, `wait`/`gone <regex>`, `has` (no Maestri portal) |
| `px.py` | colour of one screen pixel (theme checks, e.g. Moonlight `#0E1330`) |
| `gpsloop.sh` | feeds the emulator GNSS every second, like a real receiver |
| `netaudit.sh` | sockets in `/proc/net/*` and `netstats` for the app uid |
| `fs1-accept.sh` | live font/density change on setup step 3 during download: shots, PID, no new `downloadAsync`, monotonic progress |
| `chat-states.sh` | chat finish shots: loading, empty, generating, answer, source expanded |
| `build.sh`, `build-js.sh` | release APK with ninja -j3 + nice; JS-only incremental rebuild |
| `shot.sh`, `tap.sh`, `wait-text.sh`, `matrix-shots.sh` | older portal-based helpers |

## Emulator gotchas

- AOSP keyboard autocorrects `adb shell input text` ("Qujing" → "Quaking"): for text
  entry disable it (`adb root; adb shell pm disable-user --user 0 com.android.inputmethod.latin`),
  re-enable it for keyboard tests.
- `adb emu geo fix` is a single fix; the app asks for a fresh GPS fix with a short
  timeout, so use `gpsloop.sh` or a test provider
  (`cmd location providers set-test-provider-location gps --location lat,lon`).
- The AOSP image has no TalkBack and no Gboard: screen-reader and Gboard checks need a
  real phone.
- `adb emu kill` can leave qemu alive: check `pgrep -x qemu-system-aarch64`.
