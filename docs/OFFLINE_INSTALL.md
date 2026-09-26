# Installing models without network (offline build)

TL;DR: download the files below on a computer, check their SHA-256, copy them to
the phone, and import them in BOAR. The app identifies each file by its size and
SHA-256, not its name, and rejects anything that doesn't match.

```bash
# On the computer: fetch the two required files and check them
curl -LO https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/d32f8c040ea3b516330eeb75b72bcc2d3a780ab7/bge-small-en-v1.5-q8_0.gguf
curl -LO https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/9eadc66189c7641e1ddd226b8267a9119b2ce2d4/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf
shasum -a 256 *.gguf     # compare with the table below (Linux: sha256sum)

# Copy to the phone (or use a USB stick / SD card / file transfer)
adb push *.gguf /sdcard/Download/
```

Then in BOAR: setup → **Import from file**, pick the files. Each one is copied
into the app and hashed while copying; a match shows it as verified, anything
else is deleted with the reason. Import works in both builds.

## Files

Every URL is pinned to an immutable revision. The table is generated from
`src/models/manifest.ts`, which is the source of truth; `npm run manifest:verify`
re-checks every entry against its host.

| Asset | Size | Download | SHA-256 |
|---|---|---|---|
| bge-small-en-v1.5 (Q8_0) **(required)** | 36.8 MB | [link](https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/d32f8c040ea3b516330eeb75b72bcc2d3a780ab7/bge-small-en-v1.5-q8_0.gguf) | `ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514` |
| Qwen2.5-1.5B-Instruct (Q4_K_M) **(required)** | 986.0 MB | [link](https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/9eadc66189c7641e1ddd226b8267a9119b2ce2d4/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf) | `1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370` |
| Phi-3.5-mini-instruct (Q4_K_M) | 2393.2 MB | [link](https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/6d70da17e749a471ccb62ade694486011a75cda3/Phi-3.5-mini-instruct-Q4_K_M.gguf) | `e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5` |
| Qwen2.5-7B-Instruct (Q4_K_M) | 4683.1 MB | [link](https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/8911e8a47f92bac19d6f5c64a2e2095bd2f7d031/Qwen2.5-7B-Instruct-Q4_K_M.gguf) | `65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423` |
| LFM2.5-8B-A1B (Q4_K_M) | 5155.6 MB | [link](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/49c14831707011e64d70b2ebd8462ba08d608434/LFM2.5-8B-A1B-Q4_K_M.gguf) | `4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0` |
| Gemma 4 E4B (QAT Q4_0) | 5154.9 MB | [link](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/4b4a2c1d584be7264f87aac328a1bc739ce81b6c/gemma-4-E4B_q4_0-it.gguf) | `676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee` |
| Standard knowledge base (+1,000 topics) | 0.6 MB | [link](https://raw.githubusercontent.com/rferrari/boar-app/9e46dc4d8f9a95bc7716194b94117f769504c0e0/assets/corpus/corpus-standard.json) | `2aeff76db48098851e1304fb37dc8013d9facf9214395897e7e05f276f85d2ff` |
| Full knowledge base (+4,000 topics) | 2.5 MB | [link](https://raw.githubusercontent.com/rferrari/boar-app/9e46dc4d8f9a95bc7716194b94117f769504c0e0/assets/corpus/corpus-full.json) | `6d602003bb9da59200e3e55b75b9e15bb073a4b9b1357da2c2d47b2803c570be` |
| Wikipedia Vital Articles (+50,000 articles) | 163.6 MB | [link](https://github.com/rferrari/boar-app/releases/download/knowledge-pack-v1/wiki-vital5.sqlite) | `d3b87d562baba3489f6878bf99783f50d504db94c347029771e53f6d1aecc666` |

## What the app checks

1. Size: the file must be exactly the size of a catalog entry, or it's rejected
   before anything is copied.
2. Copy + SHA-256 in one pass (native, 1 MiB chunks, so a 5 GB model never sits
   in memory), into a temporary file inside the app.
3. The hash must match that entry's SHA-256. Then the file is moved into place
   and remembered as verified; otherwise the copy is deleted.
4. The same check runs after every in-app download (downloader build).

The storage budget (50 GB for BOAR's files, plus free space on the phone) is
checked before the copy starts.
