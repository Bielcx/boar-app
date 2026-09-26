# Bounty compliance

How BOAR meets each requirement of the
[poidh bounty 31](https://poidh.xyz/mainnet/bounty/31), with the evidence behind
every status. Statuses are only what has been checked:

- **PASS**: met, with evidence linked.
- **PARTIAL**: met with a stated limitation.
- **OPEN**: not done or not verified yet.

Raw benchmark files (JSONL, answers, reports) are in [evidence/](evidence/);
the demo videos and screenshots are in [demo/](demo/README.md).

Last reviewed: 2026-09-26 (items 5, 10 and 14); 2026-09-25 for the rest. Test device: Xiaomi 2311DRK48G, MediaTek MT6897
(Dimensity 8300), 11.6 GB RAM, Android 16.

| # | Requirement | Status |
|---|---|---|
| 1 | Runs on Android and compatible GrapheneOS hardware | PARTIAL |
| 2 | Operates within 12 GB of RAM | PASS |
| 3 | Uses at most 50 GB for app, models, indexes and assets | PASS |
| 4 | Works completely offline once installed | PASS |
| 5 | No API calls, remote inference, web searches or network requests during use | PARTIAL |
| 6 | Doesn't require Google Play Services for core functionality | PASS |
| 7 | Handles explanation, comparison, synthesis and reasoning | PARTIAL |
| 8 | Responds at speeds usable for real lookups | PARTIAL |
| 9 | Published in a public GitHub repository | PASS |
| 10 | Includes all code, assets, dependencies and instructions to reproduce | PASS |
| 11 | Documents the models, datasets, indexes and other resources | PASS |
| 12 | Works on real Android hardware at submission time | PASS |
| 13 | Someone can get it running within a few minutes | PARTIAL |
| 14 | Required assets included or with clear download instructions | PASS |
| 15 | Public demo on X or Farcaster | PASS |
| 16 | Demo shows offline use, hard queries, repo link and approach | PARTIAL |
| 17 | Screenshot and links submitted to poidh | OPEN |
| 18 | Repository contains the functional submitted version at claim time | PASS |
| 19 | Not fraudulent, malicious, plagiarized or otherwise in violation | PASS |
| 20 | ">50% as good as internet + frontier models" | OPEN |

## Details

### 1. Android and GrapheneOS — PARTIAL
- Runs on a physical Android 16 phone (above), measured across 85 benchmark
  answers in one session (see 7 and 8).
- Not yet run on GrapheneOS. The design doesn't depend on Google services (see
  6), but that's not a substitute for a real GrapheneOS run.

### 2. 12 GB RAM — PASS
- Highest measured process peak in the benchmark: 5.07 GB (Qwen2.5-7B Q4_K_M).
  Qwen2.5-1.5B steady state is about 1.6 GB, Phi-3.5-mini about 3.1–3.8 GB.
- Only one generation model is loaded at a time. Loads and unloads are
  serialized so rapid model switching can't leave a second model in memory
  (`src/inference/LlamaEngine.ts`, tested in `LlamaEngine.test.ts`).
- Before loading, the app checks the model's estimated working set against free
  RAM and refuses with a clear message rather than crashing
  (`LlamaEngine.estimateFit`).

### 3. 50 GB storage — PASS
- Default install: about 1 GB of models (Qwen2.5-1.5B 0.99 GB, bge-small
  0.04 GB) plus a few MB of knowledge base.
- Every optional catalog model (Phi-3.5-mini, Qwen2.5-7B, LFM2.5-8B-A1B,
  Gemma 4 E4B) adds about 17.4 GB, and the Wikipedia Vital Articles knowledge
  pack 0.16 GB, for about 18.6 GB in total.
- Enforced before every download (`checkStorageForDownload`,
  `src/models/storageBudget.ts`, called from `ModelManager.downloadCatalogModel`):
  what BOAR already stores (models, knowledge packs, database) plus downloads in
  progress, a 1 GB reserve for the app itself and the new file must stay within
  `STORAGE_BUDGET_BYTES` (50 GB), and the phone must have the space free.
  Otherwise the download is refused with a message before any data is fetched.

### 4. Works offline once installed — PASS
- After the one-time first-run download, answering questions uses only the
  on-device model (llama.rn / llama.cpp) and the local SQLite knowledge base
  and packs.
- Recorded on the test phone with airplane mode on and Wi-Fi off: four queries,
  a follow-up and the knowledge pack answering
  ([demo/](demo/README.md), 2026-09-24).

### 5. No network requests during use — PARTIAL
Two Android builds exist ([BUILD_VARIANTS.md](BUILD_VARIANTS.md)):

| Build | Network permissions | How models arrive |
|---|---|---|
| **offline** (`make apk-offline`) | none: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` and the `CHANGE_*` ones are removed from the merged manifest | imported from files, checked by size + SHA-256 ([OFFLINE_INSTALL.md](OFFLINE_INSTALL.md)) |
| downloader (`make apk-downloader`, the v1.0.0 release) | `INTERNET` | downloaded in the app, checked by size + SHA-256; file import also works |

Permissions the published **v1.0.0** APK declares (`aapt dump permissions`):
`INTERNET`, `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, `VIBRATE`, `WAKE_LOCK`,
`READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` (max SDK 32). It does
**not** declare `ACCESS_NETWORK_STATE`; an earlier version of this page said it
did. From the next release both builds drop `SYSTEM_ALERT_WINDOW` (left over
from the development template) and the storage permissions (imports use the
system file picker), and set `allowBackup="false"` and
`usesCleartextTraffic="false"`. The offline build also drops `RECORD_AUDIO`
unless built with `EXPO_PUBLIC_BOAR_VOICE=1`.

The only network code in the app (`src/`), both refusing to run in the offline
build (`networkAllowed()`, `src/config/variant.ts`):
- `ModelManager.downloadCatalogModel` — model and knowledge-pack downloads,
  started by the setup wizard or an explicit Download tap.
- `src/services/modelBrowser.ts` — Hugging Face model search, only when the user
  searches.

A test (`src/config/networkAudit.test.ts`) fails if a new network call site
appears anywhere else, or if a network/cloud client library (Firebase, Sentry,
expo-updates, …) is added. CI audits the offline build's merged manifest on
every pull request and builds and audits the full APK on `main`
(`scripts/audit-offline-apk.sh`, which also rejects Play Services, Firebase,
ML Kit, expo-updates, Retrofit, Ktor, Volley and Sentry classes in the dex).
OkHttp is present in every React Native app; without `INTERNET` the OS refuses
its sockets.

Inference, retrieval, chat history, telemetry and evaluation make no network
calls.

Voice input is off by default. When turned on, BOAR uses Android 12+'s
on-device speech recognizer. The regular system recognizer (usually Google's,
which may send audio to its servers even with `EXTRA_PREFER_OFFLINE`) is used
only if the user explicitly accepts that warning, and never in the offline
build (`src/voice/voicePolicy.ts`). Typing always works.

Why PARTIAL: the offline APK's audit has to be run on a built APK
(`make apk-offline`), and a network capture during use on a real phone hasn't
been recorded yet.

### 6. No Google Play Services — PASS
- The release build's runtime dependencies contain no Play Services or Firebase
  (`./gradlew :app:dependencies --configuration releaseRuntimeClasspath`).
- The development build does include `play-services-code-scanner`, pulled in
  by `expo-dev-launcher` (the dev client's QR scanner). That's development
  tooling only and absent from release builds.
- The app code never calls Google services.

### 7. Research beyond recall — PARTIAL
- A fixed 17-question evaluation set covers greeting, factual, explanation,
  comparison, synthesis, reasoning, retrieval-grounded and no-knowledge-base
  questions ([docs/EVAL_QUERIES.md](EVAL_QUERIES.md)).
- First real-device baseline, 2026-09-24: all 68 answers from the four
  configurations that loaded completed. Phi-3.5-mini gave the most complete
  comparisons and syntheses.
- Knowledge pack run, 2026-09-24: with the Wikipedia Vital Articles pack
  (49,832 articles), Qwen2.5-1.5B answered 6 of 6 factual, retrieval-grounded
  and no-built-in-knowledge questions correctly, each from retrieved articles
  (e.g. Napoleon's dates, which aren't in the built-in knowledge base).
- LFM2.5-8B-A1B (mixture of experts, ~1.5B active), 2026-09-24: 17 of 17
  completed at 14.8 tok/s median, the first model to get the RAM-budget
  question right, but 4 answers were lost to reasoning that used the whole
  token budget.
- Limitations seen: arithmetic errors (every model missed the RAM-budget
  question), invented citations, and 9 answers truncated by the 120-second step
  timeout.

### 8. Usable speed — PARTIAL
Median time per answer in the baseline (retrieval on, 512-token budget):

| Configuration | Median total | Median TTFT | Median tok/s |
|---|---|---|---|
| Qwen2.5-1.5B | 21 s | 13.6 s | 11.4 |
| Adaptive routing | 25 s | 14.1 s | 11.4 |
| Phi-3.5-mini | 73 s | 44.0 s | 4.0 |
| Qwen2.5-7B | 107 s | 70.5 s | 2.7 |

Most of the wait is processing the retrieved context before the first token.
Since then retrieval sends 4 chunks instead of 6: in the knowledge pack run
Qwen2.5-1.5B averaged 10.6 s per answer (6.4 s to the first word, 17.5 tok/s),
on 6 questions rather than the full set.

### 9. Public repository — PASS
[github.com/rferrari/boar-app](https://github.com/rferrari/boar-app). Confirm
it's public at claim time (18).

### 10. Code, assets, dependencies, instructions — PASS
- Build and install: [README.md](../README.md) Quickstart,
  [AGENTS.md](../AGENTS.md), `Makefile`, `eas.json`.
- Knowledge base: `assets/corpus/*.json`, committed. The Wikipedia Vital
  Articles pack is a [release asset](https://github.com/rferrari/boar-app/releases/tag/knowledge-pack-v1),
  built reproducibly with `npm run pack:build`
  ([docs/KNOWLEDGE_PACKS.md](KNOWLEDGE_PACKS.md)).
- Models: downloaded by the in-app setup wizard from the URLs in
  `src/models/manifest.ts`, which also records each file's size and SHA-256.
  Every URL is pinned to an immutable revision (a Hugging Face commit, a repo
  commit, or a release asset); `npm run manifest:verify` re-checks sizes and
  hashes against the hosts. On the phone every download and every imported
  file is hashed in streaming (native SHA-256 in 1 MiB chunks) and deleted if
  it doesn't match.

### 11. Models and datasets documented — PASS
[docs/MODELS.md](MODELS.md) and `src/models/manifest.ts`: every model and
knowledge pack with source, size, checksum and license. The knowledge base and
packs are Wikipedia-derived, CC BY-SA 4.0.

### 12. Real hardware at submission — PASS
Smoke test on 2026-09-25 with the published v1.0.0 APK on the test phone (the
installed APK's SHA-256 matches the release): clean install, first-run setup,
then a correct answer at about 7 tok/s with Qwen2.5-1.5B.

### 13. Running within a few minutes — PARTIAL
- No build needed: download the APK from the
  [release](https://github.com/rferrari/boar-app/releases/tag/v1.0.0), check its
  checksum and install it (the README's "Download the app"), or let
  `make setup` do all three over USB.
- The first run downloads about 1 GB, so total time depends on the connection;
  the install-to-first-answer time hasn't been measured with a stopwatch.

### 14. Assets or download instructions — PASS
The first-run setup wizard downloads every required model and optional
knowledge pack in the app (downloader build), or imports them from files
(both builds; the only way in the offline build, see
[OFFLINE_INSTALL.md](OFFLINE_INSTALL.md)). `scripts/setup-models.sh` plus
`plugins/withBundledModels.js` is an alternative that bundles models into the
APK (see [docs/MODELS.md](MODELS.md)).

### 15–17. Public demo and poidh submission — PASS / PARTIAL / OPEN
- Posted on X: [x.com/arferrari/status/2103677576380387484](https://x.com/arferrari/status/2103677576380387484), with the demo clips from
  [demo/](demo/README.md): airplane mode, a synthesis prompt, a follow-up and
  knowledge-pack facts.
- Still to do: submit a screenshot and links to poidh.

### 18. Submitted version matches the repository — PASS
[v1.0.0](https://github.com/rferrari/boar-app/releases/tag/v1.0.0): the APK
(SHA-256 `de9e3156b4593c48e74a91a28931f044be8b64fd6d941e91b9a07a97eb4d3c01`)
and its `.sha256` file, built from the tagged commit `8ae9d44`.

### 19. Not fraudulent, malicious or plagiarized — PASS
- Original code, MIT licensed ([LICENSE](../LICENSE)).
- Models and data are third-party, used under their licenses (Apache-2.0, MIT,
  CC BY-SA 4.0) and credited in [docs/MODELS.md](MODELS.md).

### 20. ">50% as good as internet + frontier models" — OPEN
Not measured yet. The on-device evaluation harness and device CLI
(`npm run eval:device`, [docs/EVAL_QUERIES.md](EVAL_QUERIES.md)) produce the
BOAR side. Still needed: reference answers from a frontier model with web
search, rubric scoring against them, and blind human spot checks, with every
raw file committed.

## Evidence

| Run | What | Files |
|---|---|---|
| `eval-2026-09-24T03-12-53-754Z` | Baseline: 17 queries × 5 configurations | [evidence/2026-09-24-baseline-5-configs](evidence/2026-09-24-baseline-5-configs/) |
| `eval-2026-09-24T05-42-38-163Z` | LFM2.5-8B-A1B, 17 queries | [evidence/2026-09-24-lfm2.5-8b-a1b](evidence/2026-09-24-lfm2.5-8b-a1b/) |
| `eval-2026-09-24T20-41-45-071Z` | Qwen2.5-1.5B with the Vital Articles pack, 6 queries | [evidence/2026-09-24-vital-articles-pack](evidence/2026-09-24-vital-articles-pack/) |

The `.jsonl` files are the raw per-answer records written on the phone; the
reports and answer sheets are generated from them (`npm run eval:summary`).
