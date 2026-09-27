# Installing models without network (offline build)

TL;DR: you need the embedding model plus one answer model (the 4B by default,
the 1.5B on phones with little RAM). Download them, check their SHA-256, get
them onto the phone, and import them in BOAR. The app identifies each file by its size and
SHA-256, not its name, and rejects anything that doesn't match.

```bash
# On the computer: the embedding model plus ONE answer model (default 4B shown;
# use the compact 1.5B instead on phones with 4 GB of RAM)
curl -LO https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/d32f8c040ea3b516330eeb75b72bcc2d3a780ab7/bge-small-en-v1.5-q8_0.gguf
curl -LO https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf
shasum -a 256 *.gguf     # compare with the table below (Linux: sha256sum)

# Copy to the phone (or use a USB stick / SD card / file transfer)
adb push *.gguf /sdcard/Download/
```

### Phone only (no computer, no adb)

The offline build has no network permission, but the phone's browser does:

1. On the phone, open this page in the browser and tap each link in the table
   below. The files land in **Downloads**.
2. In BOAR Offline: setup → **Import from file**, and select all of them at
   once (the picker allows several).
3. Each file is copied into the app and checked; the browser copy in Downloads
   can be deleted afterwards.

### With a computer

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
| Qwen3-4B-Instruct-2507 (Q4_K_M) **(answer model, default)** | 2497.3 MB | [link](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf) | `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597` |
| Qwen2.5-1.5B-Instruct (Q4_K_M) **(answer model, compact: instead of the 4B)** | 986.0 MB | [link](https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/9eadc66189c7641e1ddd226b8267a9119b2ce2d4/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf) | `1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370` |
| Phi-3.5-mini-instruct (Q4_K_M) | 2393.2 MB | [link](https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/6d70da17e749a471ccb62ade694486011a75cda3/Phi-3.5-mini-instruct-Q4_K_M.gguf) | `e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5` |
| Qwen2.5-7B-Instruct (Q4_K_M) | 4683.1 MB | [link](https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/8911e8a47f92bac19d6f5c64a2e2095bd2f7d031/Qwen2.5-7B-Instruct-Q4_K_M.gguf) | `65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423` |
| LFM2.5-8B-A1B (Q4_K_M) | 5155.6 MB | [link](https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/resolve/49c14831707011e64d70b2ebd8462ba08d608434/LFM2.5-8B-A1B-Q4_K_M.gguf) | `4923ec14f06b968b74d663e5949867d2d9c3bf13a20b8be1a9f9af39989b2bb0` |
| Gemma 4 E4B (QAT Q4_0) | 5154.9 MB | [link](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/resolve/4b4a2c1d584be7264f87aac328a1bc739ce81b6c/gemma-4-E4B_q4_0-it.gguf) | `676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee` |
| Standard knowledge base (+1,000 topics) | 0.6 MB | [link](https://raw.githubusercontent.com/rferrari/boar-app/9e46dc4d8f9a95bc7716194b94117f769504c0e0/assets/corpus/corpus-standard.json) | `2aeff76db48098851e1304fb37dc8013d9facf9214395897e7e05f276f85d2ff` |
| Full knowledge base (+4,000 topics) | 2.5 MB | [link](https://raw.githubusercontent.com/rferrari/boar-app/9e46dc4d8f9a95bc7716194b94117f769504c0e0/assets/corpus/corpus-full.json) | `6d602003bb9da59200e3e55b75b9e15bb073a4b9b1357da2c2d47b2803c570be` |
| Wikipedia Vital Articles (+50,000 articles) | 163.6 MB | [link](https://github.com/rferrari/boar-app/releases/download/knowledge-pack-v1/wiki-vital5.sqlite) | `d3b87d562baba3489f6878bf99783f50d504db94c347029771e53f6d1aecc666` |

## Places (restaurants near you) and topic packs

Answering "vegan restaurants in the city I'm in" needs two files: the world
gazetteer (city names → coordinates) and the places pack for that area
(OpenStreetMap food places with diet tags, plus Wikivoyage Eat/Drink). Both
install by file import like any model, and location comes from the phone's GPS,
which works without network.

They are hosted in the dataset
[r4topunk/boar-packs](https://huggingface.co/datasets/r4topunk/boar-packs)
(sources and licenses per pack in its README: ODbL © OpenStreetMap
contributors, CC BY-SA 4.0 wiki text, CC BY 4.0 GeoNames, public domain US
government works, CC0 EIPs, MIT ethereum.org), every link pinned to a dataset commit. Source of truth: `src/rag/poiRegions.ts`,
`src/rag/preparedness.ts`, `src/rag/cryptoPack.ts` and `src/rag/wikiEnPacks.ts`; `npm run manifest:verify` re-checks them.

| Asset | Size | Places (OSM + Wikivoyage) | Download | SHA-256 |
|---|---|---|---|---|
| World gazetteer (GeoNames, 34,149 places) **(needed for any places pack)** | 20.8 MB | — | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6a65cc29fa6ecfdf5ee66ac05716e0eacdc5fa95/places/world-places.sqlite) | `fdb302aa2a2813ad36487b4f0ffa629ba21faec700ee5fcb5c4bf9c3448e9746` |
| Places: São Paulo | 1.4 MB | 7,013 (126 vegan) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/sao-paulo.sqlite) | `42e6caf31e9018ad76e282f26114812dbdf0ab23c2aaf269199b9126bbe935d3` |
| Places: Singapore | 1.9 MB | 10,188 (97 vegan) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/singapore.sqlite) | `bd7c1afcb59f4438bb2a9b0fbde2360720194ea05ac5081ee9dc4fed0c094506` |
| Places: Taipei | 3.4 MB | 18,857 (156 vegan) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/taipei.sqlite) | `0831d93f747e4fa002d850523fc4098bc58ee262058b8b54b6a0b3cc60f5f480` |
| Places: Buenos Aires | 1.5 MB | 8,049 (78 vegan) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/buenos-aires.sqlite) | `dedc896e659e112e16811005d038bd9cff6ead678b8d63b566565eec67ca8b73` |
| Places: Berlin | 3.3 MB | 15,278 (1,979 vegan) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/berlin.sqlite) | `9216b3b0e55eb435390c79fc9460b99bc60d4396520091a8e37c22155e3c7ba3` |
| Places: Edmonton | 0.6 MB | 2,520 (12 vegan) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/edmonton.sqlite) | `76ad021e7048813c4eab394689c97c78123ea5e1bfed73e7b95cc162a6f8cb4c` |
| Places: Qujing | 37 kB | 3 (Wikivoyage only, 0 in OSM) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/qujing.sqlite) | `17a462c6eba34d34a7011295799e3e7372b7a3e44fadf5f9fe7152298e126443` |
| Places: Queens | 4.3 MB | 20,011 (665 vegan) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/queens.sqlite) | `00e0239a7f0aa7e9671607adb8c2893f84eeef94ad1e5e453b65db7b7c9c3f0a` |
| Places: Biên Hòa | 0.6 MB | 3,206 (266 vegan) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/bien-hoa.sqlite) | `d9ce786f500286ac56584b06c4ba01c1d092254ded8d0e78c475d861540318d3` |
| Places: Ciudad Nezahualcoyotl | 1.0 MB | 6,098 (60 vegan) | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/2b5b193b8fbd9f69dcf0af4447fa324066904a4f/places/cities/ciudad-nezahualcoyotl.sqlite) | `7c0818b511f504a4bd824dd069b54d32445ddcf36200d1bc5dff54dbf08f2a6a` |
| Emergency and preparedness (topic pack) | 19.6 MB | — | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6a65cc29fa6ecfdf5ee66ac05716e0eacdc5fa95/topics/boar-preparedness.sqlite) | `65dff5d9988a6fe2bffe17a4d3ab096a1a8f580d20b1ab18d0ada41bbbc0b4e8` |
| Ethereum and cryptography (topic pack) | 36.1 MB | — | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/a55c1ec8a5fe8bbda99c4197c33474637bef1958/topics/boar-crypto.sqlite) | `ae9fbd2c7a46a46a815d46d0283e7b192adb4c342b38a2adc4881e8f9d8831fb` |

```bash
# Example: Berlin, from a computer
B=https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6a65cc29fa6ecfdf5ee66ac05716e0eacdc5fa95/
curl -L -o world-places.sqlite "$B"places/world-places.sqlite
curl -L -o berlin.sqlite "$B"places/cities/berlin.sqlite
shasum -a 256 world-places.sqlite berlin.sqlite   # compare with the table
adb push world-places.sqlite berlin.sqlite /sdcard/Download/
```

The file names don't matter: the app recognises each file by size and SHA-256.

Which cities: São Paulo, Singapore, Taipei, Buenos Aires and Berlin are the
first sample build. The other five were **drawn at random**, reproducibly:
GeoNames `cities15000` with population ≥ 1M (568 cities), minus those five,
sorted by geonameid, shuffled with Fisher-Yates (mulberry32, seed `20261003`),
first five taken (`scripts/draw-poi-cities.mjs`; the draw is in the dataset as
`places/cities/draw-20261003.jsonl`). One of them, Qujing, has no food places in
OpenStreetMap, so there the app has to say it has no restaurant data. Places
for the rest of the world (1°×1° tiles) will be added here when they are
published.

## English Wikipedia (optional, 15 packs)

The whole English Wikipedia, split into 15 packs of about
1.2 GB (18.0 GB and 6,124,620 articles in all). The app searches every pack
that is installed, so any subset works, and each one installs by file import
like the others. Built from FineWiki
([HuggingFaceFW/finewiki](https://huggingface.co/datasets/HuggingFaceFW/finewiki)),
CC BY-SA 4.0. Source of truth: `src/rag/wikiEnPacks.ts`.

| Shard | Size | Articles | Download | SHA-256 |
|---|---|---|---|---|
| 00 | 1.21 GB | 390,522 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6e9afe9658e0f933a36f233749f51967dd57fbe0/wiki/en/boar-wiki-en-00.sqlite) | `89fc7c1cac60c09e61a636d001e9c5b2a2f3f08f6c10ac1150d2e0e9be53ab14` |
| 01 | 1.21 GB | 421,215 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6e9afe9658e0f933a36f233749f51967dd57fbe0/wiki/en/boar-wiki-en-01.sqlite) | `8a8aa91b148cb8a8ceacfcf781e3e8f8b34674a770c940cd1af34c83b8869d99` |
| 02 | 1.20 GB | 418,631 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6e9afe9658e0f933a36f233749f51967dd57fbe0/wiki/en/boar-wiki-en-02.sqlite) | `802799c868f790b12e910cdb8b07cc20b66005ab62c5a0238122827a657bc0b2` |
| 03 | 1.28 GB | 439,892 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6e9afe9658e0f933a36f233749f51967dd57fbe0/wiki/en/boar-wiki-en-03.sqlite) | `f840226abf35d0d118f8d7c840710f5d2b85d67e8241b4054d0e81f7c7ebac9d` |
| 04 | 1.20 GB | 424,238 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6e9afe9658e0f933a36f233749f51967dd57fbe0/wiki/en/boar-wiki-en-04.sqlite) | `af849afa078c43216ad0ac2f82643c88224e8ed8b6c16c5e42cabc89703edf8e` |
| 05 | 1.20 GB | 430,580 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6e9afe9658e0f933a36f233749f51967dd57fbe0/wiki/en/boar-wiki-en-05.sqlite) | `e79d11552a58aaab507df4d01971778669795634d7026994a5bd435b47b48da2` |
| 06 | 1.17 GB | 418,883 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6e9afe9658e0f933a36f233749f51967dd57fbe0/wiki/en/boar-wiki-en-06.sqlite) | `74caefe917f9ca999d9db95875605d9a580a6f74cf7988ebfaa7646a1cc066e2` |
| 07 | 1.21 GB | 403,973 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/6e9afe9658e0f933a36f233749f51967dd57fbe0/wiki/en/boar-wiki-en-07.sqlite) | `2455c805270ac04ecb921176f9110227aa5f1c05fbe7e14830ce13d57a68385b` |
| 08 | 1.19 GB | 410,973 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/ce244fa65789d8628de0d979969b7d526f10d63f/wiki/en/boar-wiki-en-08.sqlite) | `1bd7ef6a215196451042bcc346a4c6de4062f8e6f509b3d003bc3157d6540b48` |
| 09 | 1.19 GB | 385,785 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/ce244fa65789d8628de0d979969b7d526f10d63f/wiki/en/boar-wiki-en-09.sqlite) | `826e991935cfc90ef7f727f7d4916cd45f53ca93b64f247ca76f84a55ea64f1c` |
| 10 | 1.20 GB | 406,962 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/ce244fa65789d8628de0d979969b7d526f10d63f/wiki/en/boar-wiki-en-10.sqlite) | `734e44d8f34ce4a700a05f1607c2a1399465a10f7e21ba1e44ec2b7fc7d4f901` |
| 11 | 1.20 GB | 386,973 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/ce244fa65789d8628de0d979969b7d526f10d63f/wiki/en/boar-wiki-en-11.sqlite) | `47ab500ba03a92fa98c162351d1007c94bf4782324179aed5ed32c04c9530f58` |
| 12 | 1.21 GB | 403,088 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/ce244fa65789d8628de0d979969b7d526f10d63f/wiki/en/boar-wiki-en-12.sqlite) | `23ccdecc6b71b8ef1fd6f0d117ba6762b2c1dcc44bf60a838796bc5b4890cfc8` |
| 13 | 1.14 GB | 372,746 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/ce244fa65789d8628de0d979969b7d526f10d63f/wiki/en/boar-wiki-en-13.sqlite) | `189c1c011ebea6de20c6849ce3233ac723737fa31dae5c570028b42f73cbf24e` |
| 14 | 1.22 GB | 410,159 | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/ce244fa65789d8628de0d979969b7d526f10d63f/wiki/en/boar-wiki-en-14.sqlite) | `abb0edb68c7792767a783b2d5bc5fcc1a6af1253c30c4f721e2cde3227985f34` |

## English Wikivoyage (optional)

Travel guides for 34,002 places (where to go, how to get around, where to eat
and sleep), one pack of 351.1 MB, CC BY-SA 4.0. Source of truth:
`WIKIVOYAGE_EN` in `src/rag/wikiEnPacks.ts`.

| Asset | Size | Download | SHA-256 |
|---|---|---|---|
| Wikivoyage (English) | 351.1 MB | [link](https://huggingface.co/datasets/r4topunk/boar-packs/resolve/9557c7b2a50a1c37fdf36d41db4cd0fdc8c33c0b/wiki/en/boar-wikivoyage-en.sqlite) | `ff8595e32f56b8b84e20464afd8bf88532d47d2d82d799e3df8489440004b66e` |

## Size limits

Files are checked before anything is copied:

| Kind | Max |
|---|---|
| Language model (GGUF) | 24 GB |
| Embedding model | 2 GB |
| Knowledge pack (SQLite) | 30 GB |
| Places pack | 4 GB |
| Topic list (JSON) | 64 MB |
| Your notes and documents (.txt, .md, .csv, .json) | 25 MB each |
| Your PDFs | 100 MB each |

Models and packs are streamed from disk (never loaded whole into memory), so
their limits only reject files that can't be right. Notes and documents are
read into memory to be split and indexed, which is why theirs are small.
Source: `src/models/importLimits.ts`.

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
