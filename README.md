<img src="./assets/boar.png" width="96" alt="BOAR mascot" align="left" />

# BOAR — Adaptive Local Intelligence (Android)

<br clear="left" />

An open-source AI that runs, learns, and adapts locally on your device.

BOAR is an offline-first mobile AI system exploring adaptive model routing,
local retrieval, selective verification, and resource-aware inference. It
chooses how to spend limited device compute based on the task, rather than
relying on a fixed model or an always-on multi-model pipeline — built on
local LLM inference (`llama.cpp` via `llama.rn`) and local hybrid retrieval
(SQLite FTS5 + on-device embeddings). First launch does a one-time model
download (the app's only required network use); after that it works
completely offline. Originally built for the "Best Offline AI Research App"
community bounty.

**Demo**: videos and screenshots from a real phone in airplane mode:
[docs/demo](docs/demo/README.md).

**Why and how**: [MANIFESTO.md](MANIFESTO.md). Requirement-by-requirement status,
with the raw benchmark files: [docs/COMPLIANCE.md](docs/COMPLIANCE.md) and
[docs/evidence](docs/evidence/).

**Bounty**: [poidh.xyz/mainnet/bounty/31](https://poidh.xyz/mainnet/bounty/31)
— submission wallet: `0x32d1C8A4d133241a710d780f1198992A015Ea5Ed`

- ≤ 12GB peak RAM
- ≤ 50GB total on-disk footprint (app + model weights + indexes)
- Works completely offline after a one-time first-run model setup
- Runs on GrapheneOS / no GMS dependency
- Real Android device, not just emulator
- Import your own documents (.txt/.md/.csv/.json/.pdf) into the local knowledge
  base, toggle or delete them per-collection, and export/share a collection
  as a portable JSON pack — see [Custom knowledge base](#custom-knowledge-base) below
- Search Hugging Face for additional GGUF models beyond the curated default
  list, and download them the same way — see
  [Finding more models](#finding-more-models) below
- UI localized in English and Portuguese, switchable in Settings or the
  first-run setup wizard (`src/i18n/`) — manual selection only, no device-locale
  auto-detection, same as every other preference in this app

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design (including exactly how
first-run model setup works and why network permission is present but unused
during chat/inference) and [docs/MODELS.md](./docs/MODELS.md) for the exact
models/datasets/indexes used.

## Status

🚧 Core app, RAG pipeline, and model selection are done and verified. EAS
Build is configured and the project is linked for cloud builds without a
local Android SDK. Not yet verified with an actual compile + install on real
hardware — see open items below.

## Download the app

No building needed: get `boar-v1.0.0-arm64.apk` from the
[latest release](https://github.com/rferrari/boar-app/releases/latest) (any
64-bit ARM Android phone, 122 MB). Check it against the published checksum:

```bash
sha256sum -c boar-v1.0.0-arm64.apk.sha256   # prints "boar-v1.0.0-arm64.apk: OK"
```

Install it (open it on the phone, or `adb install boar-v1.0.0-arm64.apk`), open
BOAR once with an internet connection to download the default model (about
1 GB), then it works fully offline. `make setup` → "Install BOAR on my phone"
does the download, checksum and USB install for you.

## Quickstart

```bash
git clone https://github.com/rferrari/boar-app.git
cd boar-app
npm install

# Build via EAS (no local Android SDK needed) — see eas.json
npx eas-cli build --platform android --profile preview

# OR build locally if you have the Android SDK set up:
npx expo prebuild -p android --clean
npx expo run:android
```

### Guided setup

The easiest way: clone the repo and run the setup wizard, which asks what you
want and walks you through it.

```bash
git clone https://github.com/rferrari/boar-app.git
cd boar-app
make setup         # or: node scripts/setup.mjs
```

It offers:

1. **Install BOAR on my phone:** downloads the latest release APK (checksum
   verified) and installs it over a USB cable, or tells you how to copy it over.
2. **Build the app from source:** checks Node, JDK and the Android SDK and tells
   you exactly what's missing, then builds in the cloud with EAS (no Android SDK
   needed) or locally, and can install the APK over USB.
3. **Developer mode (advanced):** a live-reloading development build over USB.
4. **Build a bigger offline knowledge pack** (optional, see
   [docs/KNOWLEDGE_PACKS.md](docs/KNOWLEDGE_PACKS.md)).

The individual steps are also `make` targets (`make help` lists them):
`make install` (npm dependencies), `make run-android` (local build, needs the
Android SDK), `make build-eas` (cloud build).

On first launch, the app shows a one-time setup screen that downloads the
default model, Qwen2.5-1.5B, plus a small embedding model (about 1 GB total, see
`docs/MODELS.md`) — the only time it needs network access. From
then on it works fully offline, airplane mode included.
An in-app "Models" screen lets you optionally download additional/alternate
models later when you do have connectivity — see
`src/ui/ModelSetupScreen.tsx`, the only place in the app that touches the
network.

## Mixture of experts on a phone, measured

Vitalik's suggestion for phones is extreme mixture of experts: a large model
whose parameters mostly sit on disk, with only a small part active for each
token. BOAR runs that kind of model today, at a smaller scale, and measures it
on a real phone rather than quoting model cards.

[LFM2.5-8B-A1B](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF) has 8B
parameters in total, 32 experts with 4 active, so about 1.5B parameters work on
each token. On a Xiaomi 2311DRK48G (MediaTek Dimensity 8300, 11.6 GB RAM), over
the 17-question evaluation set:

| Model | Architecture | Median tokens/sec | Peak memory |
|---|---|---|---|
| **LFM2.5-8B-A1B** | MoE, 8B total, ~1.5B active | **14.8** | 5.2 GB |
| Qwen2.5-1.5B | dense, 1.5B | 11.4 | 3.1 GB |
| Phi-3.5-mini | dense, 3.8B | 4.0 | 4.8 GB |
| Qwen2.5-7B | dense, 7B | 2.7 | 5.1 GB |

The mixture-of-experts model generated as fast as the 1.5B dense model while
carrying 8B parameters of knowledge (speeds vary with phone temperature: Qwen2.5-1.5B
reached 16-20 tok/s when the phone was cool). It was also the only model to get the
multi-step RAM-budget question right. Its weak spot is that it
reasons before answering, and with a 512-token answer budget 4 of 17 answers ran
out before the final answer, so it needs a larger budget.

Not every MoE model runs yet: Instella-MoE-16B-A3B failed to load because this
llama.cpp build doesn't support its architecture, and the evaluation records that
as a result rather than skipping it. Anyone can repeat or extend these runs on
their own phone with one command, see
[docs/DEVICE_EVALUATION.md](docs/DEVICE_EVALUATION.md).

## Custom knowledge base

Settings > Knowledge Base has an "Import" card alongside the built-in
downloadable corpus packs. It lets you index your own notes into the same
local FTS5 + vector search used everywhere else in the app:

- **Supported formats:** `.txt`, `.md`, `.csv` (naive comma-split, no quoted-field
  escaping), `.json` (either the app's own `{title, source, body}[]` corpus-pack
  shape, or any other JSON — imported as raw text otherwise), and `.pdf`
  (embedded/selectable text only, via [`expo-pdf-text-extract`](https://www.npmjs.com/package/expo-pdf-text-extract) —
  Apache PDFBox-Android on-device, no network, no OCR — so a scanned/image-only
  PDF extracts to empty text, and password-protected PDFs are rejected with a
  clear error rather than attempted).
- Each import is chunked (~500 tokens, 50-token overlap, heuristic
  char-based split) and embedded on-device with the same embedding model used
  for the rest of the knowledge base, then saved as a named, toggleable
  collection — turn one off without deleting it, or delete it outright.
- **Export** re-serializes a collection as `{title, source, body}[]` JSON (the
  same shape as the bundled corpus packs) and hands it to the Android share
  sheet — send it over Bluetooth, Nearby Share, a file manager, whatever the
  recipient's device offers. This is deliberately *not* a raw `.sqlite`
  export: that would bake in this device's specific embedding vectors, which
  are meaningless (or the wrong dimension) on a phone running a different
  embedding model. A recipient re-embeds the JSON locally by importing it the
  same way.
- Everything happens on-device; nothing is uploaded anywhere.

## Finding more models

Settings > Tone & Model has a "Find more models" search box (below the
curated model list) that searches Hugging Face for other GGUF models —
`src/services/modelBrowser.ts` calls Hugging Face's public API, this is the
app's only other network access besides the model-setup downloads, and only
happens when you explicitly search. Tapping a result's file adds it to the
model list above, where you download it through the normal flow (same
progress tracking and post-download size check as every built-in model).

This is deliberately separate from the curated `MODEL_CATALOG` in
`src/models/manifest.ts`: nobody has run these models to confirm they fit
typical phone RAM or work cleanly in `llama.rn`, so check a model's Hugging
Face page yourself (size, license, quantization) before downloading. When
Hugging Face's metadata includes a git-lfs checksum it's kept on the
resulting catalog entry, but — like the rest of the app — only file size is
verified automatically after download, not a full sha256 (reading a
multi-gigabyte file into memory for a hash isn't worth doing on every
download; see `ModelManager.verifyChecksum`'s doc comment).

## Recovering from a bad model load, or starting over

If a model fails to load (corrupted/truncated download, the file went
missing, etc.) the chat screen shows a readable diagnosis instead of a raw
error, with shortcuts to Settings or straight back into the setup wizard —
see `src/ui/ModelLoadErrorCard.tsx`.

Settings > App also has:

- **Re-run Setup Wizard** — jump back into first-run setup any time to
  switch model tiers or re-download the defaults, without losing anything
  else.
- **Danger Zone > Clear All Data & Reset App** — a double-confirmed full
  wipe (`src/services/appReset.ts`): deletes every downloaded model, the
  whole local knowledge base (bundled + downloaded corpus packs + your own
  imported collections), and all chat history/settings, then sends you back
  to the setup wizard. This app doesn't use MMKV/AsyncStorage — persisted
  state is either the SQLite knowledge base or small JSON files under the
  app's document directory, and this is what actually gets cleared.

## iOS

The same app builds for iOS (simulator needs Xcode only; a device needs an Apple ID). Full guide, native module mapping, Apple account needs and the Android/iOS parity table: [docs/IOS.md](docs/IOS.md).

```bash
npx expo prebuild -p ios --no-install && (cd ios && pod install)
npx expo run:ios                                   # simulator, Debug + Metro
scripts/ios-remote-build.sh sim-run                # build + run on a remote Mac with the newer Xcode
eas build -p ios --profile preview-simulator       # cloud simulator build, no Apple credentials
```

Toolchain: with Xcode 26.1 (Swift 6.2.1) the `expo-modules-jsi` pod of Expo SDK 57 does not compile (`weak let`); use the newer Xcode Expo SDK 57 is built with (the package changelog targets Xcode 27; exact minimum `UNKNOWN`). See docs/IOS.md.

## Development

```bash
npm install
npx expo prebuild -p android --clean   # regenerates ./android (gitignored) from app.json
npx expo run:android                   # build + launch on a connected device
```

`--clean` matters any time `app.json`/assets change (app name, icon, plugins): without it,
prebuild can leave a stale `android/` project around with the old values baked in — that's
what a plain `npm install` alone will never fix, since it never touches `android/` at all.

### Blank/white screen or "Failed to connect to \<LAN IP\>" after `make start`

This is a Wi-Fi network problem, not a build problem: some routers (and most phone
hotspots) enable **client/AP isolation**, which silently blocks the phone and this
computer from reaching each other even on the same Wi-Fi network and subnet. The dev
client keeps retrying your computer's LAN IP and timing out. USB debugging isn't
affected — fix it by forcing Metro onto the USB `adb reverse` tunnel instead of Wi-Fi:

```bash
npx expo start --localhost
```

Then reopen the app; if it still shows the old server list, use its "Enter URL
manually" field with `http://127.0.0.1:8081`.

## License

See [LICENSE](./LICENSE).
