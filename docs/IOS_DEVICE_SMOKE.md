# iOS device smoke test

TL;DR: build a signed Release on the build Mac, install on the iPhone, put the default model on it, ask one sourced question online and one in airplane mode, and record times plus memory. Target device: iPhone 13 (iPhone14,5, A15, 4GB RAM), iOS 26.6.2.

```bash
# Xcode 27 and the phone on the same Mac: build, sign, install, launch in one go.
# Only BOAR.app is kept, in builds/ios/iphoneos/ (ios/build is deleted).
IOS_TEAM=<team id> IOS_DEVICE=3498052E-FE1D-5F23-A4F0-F2ABB29B8221 \
  IOS_OUT_DIR=/Users/r4to/Script/boar/builds/ios scripts/ios-build-on-host.sh device-run
# Phone paired with THIS Mac, build on the mini:
IOS_TEAM=<team id> IOS_DEVICE=3498052E-FE1D-5F23-A4F0-F2ABB29B8221 \
  scripts/ios-remote-build.sh device-local
# Phone paired with the mini over the network:
IOS_TEAM=<team id> IOS_DEVICE=3498052E-FE1D-5F23-A4F0-F2ABB29B8221 \
  scripts/ios-remote-build.sh device-run
# Free Apple ID and signing fails on the memory entitlement:
IOS_STRIP_ENTITLEMENTS=com.apple.developer.kernel.increased-memory-limit ...

# Models without network: copy them into the app container (after the first install).
# compact = bge + Qwen2.5-1.5B, 4b = bge + Qwen3-4B-Instruct-2507, all = both LLMs
IOS_DEVICE=3498052E-FE1D-5F23-A4F0-F2ABB29B8221 scripts/ios-device-seed-models.sh /Users/r4to/Script/boar/shared-models all

# Memory trace: relaunch attached to the console, keep it running during the test
xcrun devicectl device process launch --console --terminate-existing \
  --device 3498052E-FE1D-5F23-A4F0-F2ABB29B8221 team.sopa.aoair | tee smoke-mem.log
```

The team id is in Xcode > Settings > Accounts on the build Mac. It stays in the environment and is never committed. The first install of a free-team build needs "trust developer" on the phone (Settings > General > VPN & Device Management).

## Steps

| # | Step | Pass when | Record |
|---|---|---|---|
| 1 | Launch from the home screen | Setup wizard renders, no red box, nothing clipped by the Dynamic Island or home indicator | Screenshot, cold start in seconds |
| 2 | Get the models: downloader build → "minimum" tier (bge 37MB + Qwen2.5-1.5B 986MB) on Wi-Fi. Offline build → import the two GGUFs through the Files picker | Both show "Downloaded"/imported and the wizard completes | Download or import time, size on disk |
| 3 | Lock the phone for 30s mid-download (downloader build only) | Download resumes or continues; no restart from 0% | Behavior (`UNKNOWN` today) |
| 4 | Ask a question the corpus covers, e.g. "What is CRISPR and why does it matter for medicine?" (the built-in corpus has a CRISPR article; Bramble may change the corpus, so pick any title from `assets/corpus/corpus.json`) | Answer cites a source from the local corpus | TTFT, tok/s (Usage stats), `[BOAR mem]` lines during the answer |
| 5 | Turn on airplane mode (Wi-Fi and cellular off), kill and relaunch the app, ask a second question, e.g. "How do black holes form?" | Same quality of answer, no network error anywhere | TTFT, tok/s, memory |
| 6 | Voice button (if shown) | Works only if iOS has an on-device model for the locale; otherwise the button reports unavailable, never silently uses the network | Result |
| 7 | Background the app for 1 min during an answer, return | App is still alive (not jetsam-killed), answer finished or cleanly stopped | Survived yes/no |

## 1.5B vs 4B on the 4GB iPhone (v1.1 default decision)

The v1.1 default is Qwen3-4B-Instruct-2507 Q4_K_M. It stays the default on this phone only if, with n_ctx 2048, it (a) loads and answers without a jetsam kill and (b) decodes at ≥ ~6 tok/s. Otherwise the 4GB iPhone defaults to the Compact model (Qwen2.5-1.5B) via `pickDefaultAnswerModel(installed, totalRamBytes, fits)` in `src/routing/defaultModel.ts` (4B only above 4.5 GB and when its memory fit is not thrashing/insufficient), and the engine owner is told. The 4B catalog entry and id belong to the trust/offline owner.

Run steps 4 and 5 once per model (switch in Settings), same two questions, and fill:

| Model | Load (s) | TTFT (s) | Decode tok/s | Peak footprint (MB) | Min available (MB) | Jetsam? |
|---|---|---|---|---|---|---|
| Qwen2.5-1.5B Q4_K_M (0.94 GB) | | | | | | |
| Qwen3-4B-Instruct-2507 Q4_K_M (2.5 GB) | | | | | | |

Also record `getDeviceTotalRamBytes()` on this phone (expected ~3.7–4 GB, below the 4.5 GB threshold, so the rule picks Compact today).

## Memory to record

The iOS `ram-monitor` prints, at most every 5s while the UI polls memory:

```
[BOAR mem] rss_mb=... footprint_mb=... available_mb=...
```

- `footprint_mb` (phys_footprint) is what jetsam compares against the app's limit.
- `available_mb` (os_proc_available_memory) is the headroom left before the kill. `footprint + available` ≈ the app's limit on this phone.
- Record: at launch, after the model loads, peak during step 4 and step 5.

If the app dies without a log, check Settings > Privacy & Security > Analytics & Improvements > Analytics Data for a `JetsamEvent` report around that time.

## Result template

| Metric | Value |
|---|---|
| Build: team type (free / paid), stripped entitlements | |
| Cold start (s) | |
| Model load (s) | |
| Limit estimate at launch (footprint + available, MB) | |
| Peak footprint during answer (MB) | |
| Min available during answer (MB) | |
| TTFT online / airplane (s) | |
| Decode tok/s online / airplane | |
| Survived background during answer | |
| Screenshots in /Users/r4to/Script/boar/shots/ios/device/ | |
