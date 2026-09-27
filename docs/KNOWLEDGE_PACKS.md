# Knowledge packs

BOAR answers from an offline knowledge base on the phone. It always has the small
built-in one (300 Wikipedia introductions, plus 1,000 or 5,000 more with the
Standard and Full setup tiers). A **knowledge pack** adds many more articles in
one ready-made file: text, a keyword search index and embeddings, all built on a
computer so the phone doesn't have to index anything.

There are two pack formats:

| | Format 1 (`build-knowledge-pack.mjs`) | Format 2 (`build-wiki-pack.mjs`) |
|---|---|---|
| Content | Wikipedia introductions, ≤3 chunks each, from the API | Full text of the most-read articles, leads of the rest, from the FineWiki dump; Wikivoyage |
| Scale | ~50k articles (Vital Articles) | all of English Wikipedia (~6.5M articles) |
| Text | plain in SQLite | zstd blocks (~3.2× smaller) |
| Index | FTS5 with a copy of the text | contentless FTS5 (no second copy) |
| Titles | — | redirects table (729k in the sample) |
| Embeddings | every chunk, int8 | leads of the most-read articles only, int8 |
| Search | `src/rag/packs.ts` | `src/rag/wikiPack.ts` |

Format 2 is described in [Large packs](#large-packs-format-2) below.

## Using the ready-made pack

The setup wizard offers the Wikipedia Vital Articles pack as an optional
download, and Settings → Offline Knowledge Base lists it too. You don't need
anything below unless you want a bigger or custom pack.

## Building your own

You need a computer with Node.js and this repository (`npm install` done), and an
internet connection for the build (the phone stays offline).

```bash
npm run pack:build                        # Wikipedia Vital Articles level 5 (~50k articles, ~2-3 hours)
npm run pack:build -- --level 4           # level 4 (~10k articles, ~30 minutes)
npm run pack:build -- --titles my.txt     # your own list: one Wikipedia article title per line
npm run pack:build -- --limit 200         # a quick test build
npm run pack:build -- --help              # all options
```

Or with make: `make knowledge-pack` (level 5) or `make knowledge-pack-small` (level 4).

What the builder does:

1. Gets the list of titles: every article linked from Wikipedia's
   [Vital Articles](https://en.wikipedia.org/wiki/Wikipedia:Vital_articles) lists
   at the chosen level, or your own list.
2. Downloads each article's introduction through the Wikipedia API.
3. Splits the introductions into chunks of about 600 characters (at most 3 per
   article).
4. Embeds every chunk with the same bge-small-en-v1.5 model the app uses
   (`assets/models/embedding.gguf`, downloaded and checksum-verified if missing),
   using llama.cpp through `node-llama-cpp`. Desktop and phone embeddings match
   (cosine similarity 0.9999).
5. Writes one SQLite file with the chunks, an FTS5 keyword index and the
   embeddings (8-bit), plus metadata.

During embedding, `node-llama-cpp` may warn that tokenizing and detokenizing the
model "resulted in a different text". That's expected for this model (its
tokenizer lowercases text) and doesn't affect the embeddings.

Every step is cached in `build/knowledge-pack/<id>/`, so if the build stops you
can run the same command again and it continues where it left off.

The result:

```
build/knowledge-pack/<id>.sqlite        the pack
build/knowledge-pack/<id>.sqlite.json   its size, SHA-256, article and chunk counts
```

Wikipedia text is CC BY-SA 4.0; keep the attribution if you share a pack.

## Putting a pack on your phone

**For testing, over USB** (a development build of BOAR, USB debugging on):

```bash
npm run pack:push -- build/knowledge-pack/<id>.sqlite
```

It copies the file into the app's storage and verifies it. BOAR uses any valid
pack in its `corpus/` folder from the next question on, no code changes needed.

**For everyone who installs your build**, add it to the catalog so the app can
download it:

1. Upload the `.sqlite` file somewhere public, for example as a GitHub Release
   asset (files over 100 MB can't go in the git repository itself).
2. Add an entry to `CORPUS_CATALOG` in `src/models/manifest.ts` with
   `kind: "corpus"`, `format: "sqlite-pack"`, `filename: "corpus/<id>.sqlite"`,
   and the size and SHA-256 from the `.json` summary.
3. To offer it in the setup wizard, add its id to a tier's `corpusPackIds`
   (`TIERS` in the same file).

## How the app searches a pack

For each question, the pack's keyword index picks up to 400 candidate chunks, and
only those are compared with the question's embedding. The results are merged
with the built-in knowledge base, keeping at most 2 chunks per article so one
article can't crowd out another topic. Comparing a question against every
embedding in a 100k-chunk pack would take seconds on the phone, so candidates
come from keywords first. A pack built with a different embedding model is
ignored with a warning, since its embeddings wouldn't match the app's.

## Large packs (format 2)

`scripts/build-wiki-pack.mjs` builds one SQLite file with English Wikipedia and
Wikivoyage. The design (pageview tiering, contentless index over compressed
blocks, redirects) follows [AndroidLM](https://github.com/Phineas1500/AndroidLM)
(Apache-2.0); chunking, tiering and the Wikivoyage cleanup are ported from its
`build_corpus.py` / `wikivoyage_to_parquet.py`, and the search design from its
`Corpus.kt`.

TL;DR (a sample build, one of the 15 Wikipedia shards):

```bash
# inputs (~3.2 GB): one FineWiki shard, redirects, the title index, Wikivoyage, one day of pageviews
B=https://huggingface.co/datasets/HuggingFaceFW/finewiki/resolve/8bd13e72e6a002407649b3e898535f42ceb1aeb9/data/enwiki
curl -LO $B/000_00007.parquet
curl -LO https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-redirect.sql.gz
curl -LO https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles-multistream-index.txt.bz2
curl -LO https://dumps.wikimedia.org/enwikivoyage/latest/enwikivoyage-latest-pages-articles.xml.bz2
curl -sL https://dumps.wikimedia.org/other/pageview_complete/2025/2025-08/pageviews-20250815-user.bz2 | bzcat \
  | awk '$1=="en.wikipedia" && $3 ~ /^[0-9]+$/ {v[$3]+=$5} END{for(k in v) print k"\t"v[k]}' > pageviews-en.tsv

node scripts/build-wiki-pack.mjs --out boar-wiki-sample.sqlite --shards 000_00007.parquet \
  --pageviews pageviews-en.tsv --pageview-days 1 --full-top 1000000 \
  --redirects enwiki-latest-redirect.sql.gz --index enwiki-latest-pages-articles-multistream-index.txt.bz2 \
  --wikivoyage enwikivoyage-latest-pages-articles.xml.bz2 --no-embed
```

For the full build pass all 15 shard URLs to `--shards`: each is downloaded one
ahead of use and deleted after it's in the pack, so the inputs never take more
than ~5 GB. `--min-free-gb 20` pauses the build while the disk is short, and
`--no-optimize` skips the final FTS merge, which needs free space about the size
of the index. Embeddings are a second step (`--embed-only`) on a machine that can
run the embedding model. Needs Node ≥ 23.8 (zstd in `node:zlib`) and `bzcat`.

### Sources

| Source | Version | License |
|---|---|---|
| [FineWiki](https://huggingface.co/datasets/HuggingFaceFW/finewiki) English | revision `8bd13e72e6a0`, Wikimedia Enterprise HTML dumps of August 2025; no redirects or disambiguation pages | CC BY-SA 4.0 |
| Wikipedia redirects + title index | `enwiki-latest-*` of 2026-09-03 | CC BY-SA 4.0 |
| Wikivoyage English | `enwikivoyage-latest-pages-articles` of 2026-09-01 | CC BY-SA 4.0 |
| Pageviews | one day (2025-08-15), scaled ×30 to a month | CC0 |

One day of pageviews is a noisy popularity signal; a full month is a 5.6 GB
stream (not stored) and is the better choice for a release build.

### What's in the file

| Table | Content |
|---|---|
| `blocks` | article text, UTF-8, in zstd blocks of 64 KB uncompressed (the app decompresses one block per article with `fzstd`) |
| `articles` | id, source (0 Wikipedia, 1 Wikivoyage), page id, title, monthly views, block and byte range |
| `chunks` | ~1,000-character spans of an article (UTF-16 offsets), never crossing a heading |
| `fts` | contentless FTS5 (`porter unicode61 remove_diacritics 2`, `detail=full`) over title, section heading and chunk text; table-like chunks aren't indexed |
| `redirects` | alternative titles → article |
| `df` | document counts of terms in ≥ 2,000 chunks (query-time idf without reading long posting lists) |
| `lead_vecs` | int8 bge-small embedding of an article's lead (only the articles picked for embeddings) |
| `meta` | `format`, `formatVersion` 2, sources, parameters, embedding model SHA-256 |

Articles in the top 1,000,000 by pageviews keep their full text; the others keep
their lead section (≤ 2,500 characters). Every article, full or lead, is findable
by title and keywords.

### Measured sizes (sample build, 2026-09-26)

Shard `000_00007` (436,482 rows, 1/15 of FineWiki English) + all of Wikivoyage:

| | Value |
|---|---|
| Wikipedia articles | 403,973 (66,518 in full text) |
| Wikivoyage guides | 34,002 |
| Chunks / indexed | 2,462,151 / 2,130,224 |
| Text, uncompressed | 1.73 GB (Wikipedia 1.45 GB, Wikivoyage 0.28 GB) |
| Redirects kept | 728,844 |
| **Pack file** | **1,552,769,024 bytes (1.55 GB)**, SHA-256 `3bb19971aa5d082bbff3b4d2c8462541648249bf77bb8120f24e6feabd97af30` |
| of which FTS index | 826 MB |
| of which text blocks | 545 MB (3.2× compression) |
| of which chunk/article tables + indexes | 122 MB |
| of which redirects | 24 MB |
| Build time | ~4 min on an M4 Mac mini, text + index + redirects (no embeddings) |

### Projected full build

| | Size |
|---|---|
| Wikipedia, 15 shards × ~1.30 GB | ~19.5 GB |
| Wikivoyage | ~0.25 GB |
| Lead embeddings: top 500k articles by pageviews + all Wikivoyage (~534k × ~400 B) | ~0.21 GB |
| **Total** | **~20–21 GB** (budget ≤ 25 GB) |

The projection assumes the shards are alike (FineWiki shards are split by page
id, not by topic). The top 500k articles cover 81.6% of English Wikipedia's
pageviews (top 1M: 89.7%), measured on the same day of pageviews. Articles
without an embedding are still found by keywords and titles; they just aren't
re-ranked semantically.

### Retrieval quality (sample pack)

`eval/retrieval/questions.v1.jsonl`: 160 known-item questions about 80 articles
sampled from the sample pack by popularity (20 each: head ≥ 5,000 views/month,
tail, no recorded views, Wikivoyage), one question naming the subject and one
describing it without the title's distinctive words. The gold answer is the
article. They were written by Claude Opus 5.5 from each article's lead
(`questions.v1.written.json`), which favors words that appear in the lead, so
treat the numbers as an upper bound for real users' wording. Odd article ids are
the **dev** half (ranking constants were chosen there), even ids the **test**
half (never tuned on).

```bash
BOAR_EVAL_PACK=/path/boar-wiki-sample.sqlite npx vitest run eval/retrieval/recall.test.ts
```

Article-level results on the **test** half (84 questions), searched on a Mac (M1,
under heavy load from other builds; phone latency is UNKNOWN until measured):

| Ranking | recall@1 | recall@3 | recall@6 | MRR@10 | p50 | p95 |
|---|---|---|---|---|---|---|
| Format-1 style: content words OR-ed, plain BM25, term-coverage gate | 0.833 | 0.905 | 0.952 | 0.878 | 362 ms | 1301 ms |
| BM25 with title weight + popularity prior only | 0.786 | 0.893 | 0.940 | 0.849 | 137 ms | 265 ms |
| **`WikiPack.search`** (named subject first, redirects, gated BM25) | **0.845** | **0.976** | **0.976** | **0.907** | **98 ms** | **206 ms** |

All 160 questions: `WikiPack.search` 0.863 / 0.969 / 0.975, MRR 0.915.
Raw results, per category and per question misses, are in
`eval/retrieval/results/`.

What the measurement changed:

- Putting every title found in the question first (AndroidLM's approach, which
  relies on a model planning the titles) hurt descriptive questions: a side
  mention ("Daily Bugle" in a question about an actor) outranked the subject.
  A name now goes first only when it carries at least half of the question's
  term weight (`NAMED_MIN_SHARE`).
- AndroidLM's title-column weight 8 and popularity prior 2 lost 6 points of test
  recall@1 against weights 2/1/1 and prior 0.5 (grid in
  `results/*-grid.json`, chosen on dev).
- Wikivoyage is the weakest category (named-voyage recall@1 0.65 before the
  travel-intent change): a same-named Wikipedia article or town competes with
  the guide. Titles now resolve in both sources, the guide first when the
  question reads like travel.
- Article text is read only for the candidates that make the result (it used
  to be read for all ~80 BM25 candidates); p50 went from ~640 ms to ~100 ms,
  though the two runs were under different machine load.

Semantic re-ranking with lead embeddings (67,636 leads in the sample: the top
33,333 Wikipedia articles by pageviews, i.e. the 500k criterion scaled to one
shard, plus every Wikivoyage guide; built with Metal on an M4 mini in ~5 min):

| | dev recall@1 | test recall@1 | test recall@3 | test MRR |
|---|---|---|---|---|
| keyword ranking only (default) | 0.882 | 0.845 | 0.976 | 0.907 |
| + rerank, missing vector = 0 | 0.789 | 0.714 | 0.869 | 0.802 |
| + rerank, missing vector = candidates' median, weight 0.5 | 0.895 | 0.833 | 0.988 | 0.903 |

With embeddings on popular articles only, a missing vector counted as 0 sinks
exactly the long-tail articles people look up offline. With the median fix the
rerank is neutral on these questions (±1 question), so it ships off
(`semanticWeight: 0`). The embeddings still pay for themselves as a relevance
gate: a keyword hit whose lead is ≥ 0.7 similar to the question is kept even
without the question's words.

The same measurement set the built-in corpus's semantic floor
(`MIN_SEMANTIC_SIMILARITY`, `src/rag/pure.ts`): question → right article p5
0.573 / median 0.776, question → random article median 0.380 / p99 0.530. The
old floor 0.45 let 13% of random articles through; 0.55 keeps 98% of right
articles and 0.6% of random ones.

Not measured yet: questions that span several articles (Sextant's
answer-quality set carries gold titles for those) and latency on a phone.

### Post-quantum signatures (the question Vitalik asked)

"Which signature algorithms are quantum resistant?" was answered from RSA
sources. Cause, reproduced on the built-in corpus: it has no post-quantum
article; the lexical gate dropped every keyword hit ("Jump flooding
algorithm", "Signature quilt", …), and the semantic floor of 0.45 let
"Public-key cryptography" (RSA) through as context.

With the Wikipedia articles present (`src/rag/wikiPack.pq.test.ts`: 19 real
articles on post-quantum and classic signatures, fetched 2026-09-26 as a
test-only fixture), `WikiPack.search` answers from "Digital signature § Some
digital signature algorithms" (CRYSTALS-Dilithium and Falcon as
quantum-resistant), "Merkle signature scheme" and "Post-quantum cryptography";
RSA and "Public-key cryptography" stay out of the top 3. "What are the
post-quantum signature schemes NIST standardized?" reaches "In August 2024, NIST
officially standardized CRYSTALS-Dilithium under the name ML-DSA". English
Wikipedia names ML-DSA, SLH-DSA and FN-DSA in the text of "Post-quantum
cryptography" and "NIST Post-Quantum Cryptography Standardization"; "ML-DSA" is
a redirect to "Lattice-based cryptography", not an article.

UNKNOWN until the full pack is built: the same result on FineWiki's August
2025 text (the fixture is the live 2026 article text) with 6.5M competing
articles.

## Topic packs: Emergency and preparedness (`boar-preparedness`)

A small format-2 pack for travelers and anyone offline in an emergency: first
aid, survival skills, disaster response and evacuation, water purification and
sanitation, food preservation, self-sufficiency and small-scale agriculture.
Same search as the Wikipedia pack; every document keeps its own URL and license
(`article_meta`), shown with each passage (`Passage.source.url` / `.license`).

```bash
node scripts/fetch-preparedness.mjs build/preparedness          # all sources (network, polite rate)
# relevance filter on the category crawls (Jev, build time only)
node scripts/filter-relevance.mjs --topic "…" --task prep-relevance --drop-translations --report report.json build/preparedness/appropedia.jsonl
node scripts/filter-relevance.mjs --topic "…" --task prep-relevance --report report.json --titles build/preparedness/wikipedia-titles.json --out kept.json
PREP_WP_TITLES=kept.json node scripts/fetch-preparedness.mjs build/preparedness wikipedia
node scripts/build-wiki-pack.mjs --out boar-preparedness.sqlite --shards <kept shards> --manifest manifest.json --name "Emergency and preparedness"
```

| Source | License | Documents |
|---|---|---|
| Wikipedia: categories First aid, Wilderness medical emergencies, Survival skills, Emergency management, Disaster preparedness, Water treatment, Food preservation, Sustainable agriculture, Permaculture (depth 1), relevance-filtered | CC BY-SA 4.0 | 869 of 3,066 |
| Appropedia: Water treatment, Sanitation, Emergency management, Food and agriculture, Agriculture, Health (depth 1), English only, relevance-filtered | CC BY-SA 4.0 | 567 of 1,309 (+1,594 translations dropped) |
| Wikibooks: *First Aid*, *Outdoor Survival* (all subpages) | CC BY-SA 4.0 | 71 |
| Wikivoyage: Stay healthy, Stay safe, Water, Hiking, Wilderness backpacking, Cold weather, Hot weather, Earthquake safety | CC BY-SA 4.0 | 8 |
| Ready.gov (every English guidance page in its sitemap) and NPS hiking safety | Public domain (17 U.S.C. §105) | 182 |
| US Army FM 21-76 *Survival* (1992), OCR text from archive.org (Public Domain Mark) | Public domain | 24 chapters |

Not included: FEMA, CDC and USDA pages (their sites answer 403 to automated
requests; not worked around), WikiHow (non-commercial license), Red Cross and
WHO material (non-commercial or unclear), copyrighted books.

**Relevance filter.** The category crawls bring in people, companies and
events (depth 2 of the Wikipedia categories gave 9,591 titles, mostly off
topic, so the crawl stops at depth 1). Each candidate's title and beginning go
to Jev as one yes/no question ("useful reference material for an offline pack
about …? no if mainly a person, company, brand, organization, fiction, a
specific event or place"), kept at ≥ 0.5. Curated sources (Wikibooks,
Wikivoyage, government pages, the manual) aren't filtered. Everything dropped,
with its probability, is in `docs/packs/boar-preparedness.relevance.json`; the
documents kept are in `docs/packs/boar-preparedness.manifest.json`. Cost: US$0.092.
The grey zone is visible there: pages such as "Rain garden", "Home gardens" and
"Do not resuscitate" sit at 0.49 and were dropped.

**Result** (2026-09-26): 1,721 documents, 13.3 MB of text, 20,446 chunks;
pack **19,554,304 bytes**, SHA-256 `65dff5d9988a6fe2bffe17a4d3ab096a1a8f580d20b1ab18d0ada41bbbc0b4e8`,
lead embeddings for all 1,721 documents. Spot checks: "How do I purify water in
an emergency?" → Appropedia *Water supply and purification for emergencies §
Purification methods*, Wikipedia *Water purification*; "What should I do during
an earthquake?" → Ready.gov *Earthquakes § During an Earthquake*; "How can I
start a fire without matches?" → FM 21-76 ch. 7 *Firecraft*; "How to treat a
snake bite?" → Wikibooks *First Aid/Wilderness First Aid § Snakes*.

**v2** (2026-09-26, the published one): the first build had no Wikipedia
*Burn* or *Earthquake* article (the category crawl doesn't reach them), which
matched the wrong burn and earthquake answers in Sextant's safety check. v2
adds 51 core first-aid and disaster articles by name (`WP_CORE` in
`fetch-preparedness.mjs`; 33 were missing), cleans image captions that spanned
several lines, keeps every English Wikipedia redirect to its articles, and adds
**Portuguese aliases** from Wikipedia's interlanguage links
(`scripts/add-langlink-aliases.mjs --lang pt`: 729 names for 266 articles, e.g.
Queimadura → *Burn*, Terremoto/Sismo → *Earthquake*, Picada de cobra →
*Snakebite*, Sangramento nasal → *Nosebleed*, Engasgo → *Choking*). 1,754
documents; pack **16,490,496 bytes**, SHA-256
`d68cec86e56e1d4c205152c0e37e0978a3d5e396a5f0fb063b918d45e04708fd`, dataset
commit `9b1ea56` (v1 stays at `6a65cc2`). Portuguese questions now put the
right article first: "O que fazer em caso de queimadura?" → *Burn*, "O que fazer
num terremoto?" → *Earthquake*, "Como parar um sangramento nasal?" → *Nosebleed*.

Attribution: CC BY-SA 4.0 requires crediting each page; the app shows every
passage's source title, URL and license, and the pack's `meta.license` lists
all licenses. Public-domain text needs no license, but the source is still
shown.

## Topic packs: Ethereum and cryptography (`boar-crypto`)

For the questions a cryptographer or an Ethereum researcher asks: post-quantum
signatures, EIPs by number, the consensus specs, zero-knowledge proofs, Bitcoin
wallets. Primary sources first (the EIP itself, the spec, the BIP), Wikipedia
for the concepts around them. Same format-2 search; every document keeps its
URL and license.

```bash
node scripts/fetch-crypto.mjs clone build/crypto-src                     # sparse clones, ~300 MB
node scripts/fetch-crypto.mjs build build/crypto-src build/crypto eips bips specs ethereumorg wikipedia-titles
node scripts/filter-relevance.mjs --topic "cryptography, Ethereum, Bitcoin and blockchain technology" --task crypto-relevance \
  --budget 0.10 --report build/crypto/relevance-report.json --titles build/crypto/wikipedia-titles.json --out build/crypto/wikipedia-kept.json
CRYPTO_WP_TITLES=build/crypto/wikipedia-kept.json node scripts/fetch-crypto.mjs build build/crypto-src build/crypto wikipedia
node scripts/build-wiki-pack.mjs --out boar-crypto.sqlite --shards build/crypto/{eips,bips,specs,ethereumorg,wikipedia}.jsonl \
  --manifest pack-manifest.json --name "Ethereum and cryptography" --no-embed
# lead embeddings where models may run (the Mac mini): --embed-only on the same --out
```

| Source | License | Documents |
|---|---|---|
| EIPs ([ethereum/EIPs](https://github.com/ethereum/EIPs)) and ERCs ([ethereum/ERCs](https://github.com/ethereum/ERCs)), front matter kept as status/type/requires lines | CC0 1.0 | 591 + 617 |
| Consensus specs (every fork and feature), execution-specs overview pages (its test-tooling docs left out), execution APIs, Portal Network specs (test vectors left out) | CC0 1.0 | 129 |
| Ethereum Yellow Paper, one document per section (display math dropped, inline math as text) | CC BY-SA 4.0 | 27 |
| ethereum.org content pages, English (videos, contributing, community, stories and site pages left out) | MIT | 228 |
| Bitcoin BIPs whose `License:` header is permissive (BSD-2/3, MIT, CC0, PD, CC BY 4.0, FSFAP, Apache-2.0, or an `OR` with one of these) | per BIP | 180 of 213 (33 without such a header, incl. 3 CC BY-SA-only, left out) |
| Wikipedia: categories Cryptography, Cryptographic algorithms, Cryptographic hash functions, Digital signature schemes, Elliptic curve cryptography, Post-quantum cryptography, Zero-knowledge proofs, Cryptographic protocols, Blockchains, Ethereum, Cryptocurrencies, Smart contracts, Decentralized finance (depth 1), relevance-filtered, plus ML-DSA, Kyber, ML-KEM, SLH-DSA and Falcon by name | CC BY-SA 4.0 | 1,369 (1,413 of 2,312 kept by the filter) |

Not included: the Solidity documentation (GPL-3.0), *Mastering Ethereum* and
*Mastering Bitcoin* (non-commercial / no-derivatives licenses).

**Names as aliases.** EIP/ERC/BIP numbers get every common spelling as an alias
("ERC-20", "ERC20", "EIP-20", "BIP 32", "BIP32"), and the redirects Wikipedia
itself returns become aliases of their target ("ML-DSA" → *Lattice-based
cryptography*, "SLH-DSA" → *SPHINCS+*, "Kyber" → *ML-KEM*; Wikipedia has no
separate ML-DSA article). They go into the pack's `redirects` table, so "What is
ML-DSA?" resolves by name. In a multi-source pack an exact title or alias of a
primary source counts as the question's subject even when its words are common
in the pack ("ERC-20" among hundreds of ERCs).

**Relevance filter.** Same Jev yes/no as the preparedness pack, topic
"cryptography, Ethereum, Bitcoin and blockchain technology", kept at ≥ 0.5:
1,413 of 2,312 Wikipedia candidates. Dropped titles with probabilities in
`docs/packs/boar-crypto.relevance.json` (people, companies, wartime codebreaking
history, films). Cost: US$0.022. The curated git sources are not filtered.

**Result** (2026-09-26): 3,141 documents; pack **36,093,952 bytes**, SHA-256
`ae9fbd2c7a46a46a815d46d0283e7b192adb4c342b38a2adc4881e8f9d8831fb`, lead
embeddings for all 3,141 documents (bge-small, Metal, on the Mac mini). Hosted at
`topics/boar-crypto.sqlite` in the dataset r4topunk/boar-packs, commit `a55c1ec`
(the first build, without the Wikipedia redirect dump, stays at `b309ba9`).

**All Wikipedia redirects.** The build takes `--redirects enwiki-latest-redirect.sql.gz
--index …multistream-index.txt.bz2` like the Wikipedia packs: of 12,417,761
redirects, the 4,619 that point at an article in the pack are kept (+131 KB).
Common names resolve by title: of 24 spellings tried (SHA-256, SHA256, ECDSA,
zk-SNARK, EdDSA, Ed25519, Diffie-Hellman, NFT, DeFi, PoS, …) 18 now reach
their article, against 4 before. The 20 eval questions don't use those
spellings, and their scores are unchanged (same weights).
Every document is listed in `docs/packs/boar-crypto.manifest.json`.

**Retrieval** (`eval/retrieval/questions.crypto.v1.jsonl`, 20 questions written
before looking at any search result, 10 naming the subject and 10 describing it;
gold can list several documents that answer):

| Configuration | recall@1 | recall@3 | recall@6 | MRR@10 |
|---|---|---|---|---|
| format-1 baseline (OR-ed words, plain BM25) | 0.40 | 0.65 | 0.80 | 0.568 |
| full (named titles first) — the app's default | **0.65** | **0.80** | **0.90** | **0.728** |
| full + lead-embedding rerank, w 0.5 | 0.65 | 0.85 | 0.90 | 0.750 |

Twenty questions is too few to tell the rerank apart from noise, so it stays
off, as on the Wikipedia sample. The title-subject rule above was found on a
dev question (odd id) and moved "full" from 0.60/0.75/0.85/0.678. What still
fails: descriptive questions that avoid the article's words ("computation on
encrypted data without decrypting it" → *Homomorphic encryption* is not in the
top 6; "a tree of hashes checked by light clients" → *Merkle tree* misses), and
Vitalik's question "Which signature algorithms are quantum resistant?" puts
*Quantum cryptography* (key distribution, not signatures) first and
*Post-quantum cryptography* third.

### Search latency with the full English Wikipedia (15 packs)

Measured 2026-09-26 on the Mac mini (M4, 16 GB) with `eval/retrieval/latency.mts`, bundled with esbuild and run on
4 of the 15 shards (00, 04, 09, 14, downloaded from their pinned URLs and hash-checked), over the 180 eval questions
(v1 + crypto). The app searches installed packs one after the other (`searchWikiPacks`), so the tool times the whole
question over N = 1..4 packs, no query vector (the default path), cold (first pass) and warm (second pass).
Raw numbers: `eval/retrieval/results/latency-en-4of15.json`.

| Packs | p50 warm | p95 warm | p50 cold | p95 cold |
|---|---|---|---|---|
| 1 | 43 ms | 94 ms | 50 ms | 106 ms |
| 2 | 90 ms | 206 ms | 98 ms | 210 ms |
| 3 | 133 ms | 285 ms | 137 ms | 315 ms |
| 4 | 175 ms | 366 ms | 174 ms | 367 ms |
| **15 (linear fit)** | **~660 ms** | **~1.36 s** | ~630 ms | ~1.36 s |

Time grows linearly, ~44 ms per pack at the median and ~90 ms at p95, so a phone with all 15 shards spends well over
half a second searching on this machine's speed alone; a phone is slower. UNKNOWN: on-device numbers (not measured).
Options to measure next: search packs concurrently (expo-sqlite opens each pack as its own database), or stop early
once a named article is found.

## Portuguese questions against English sources (PT-1)

The keyword index and the embedder (bge-small, English) barely match Portuguese words, so a Portuguese question used
to retrieve noise ("Por que existem as estações do ano?" → a Portuguese Appropedia page). `retrieve()` now detects a
Portuguese question (`looksPortuguese`: two Portuguese function words, or one plus an accented lower-case word; 0 false
positives on 348 English eval questions, 90 of 91 Portuguese detected) and runs a second search with the English
article names it mentions, those results first, and an article whose title is one of the names ahead of the rest.

The names come from `assets/lexicon/pt-en.json` (104,677 Portuguese names, 4.0 MB), built by
`scripts/build-pt-lexicon.mjs` from Wikipedia itself: for each English title of the bundled corpora, wiki-vital5 and
the topic packs (57,159), the title of the same article on pt.wikipedia and its Portuguese redirects. An exact title
beats one with a "(…)" qualifier, which beats a redirect; a one-word name only comes from an exact title (a single
word spelled like an English title, "Fahrenheit", also counts). No model, no network on the phone.

Measured on Sextant's Portuguese questions with the English questions' gold titles (`eval/retrieval/pt.test.ts`,
42 questions, packs: crypto, preparedness v2, English Wikivoyage, Wikipedia sample; `results/pt-vs-en-sextant-v2.json`):

| Mode | recall@1 | recall@3 | recall@6 |
|---|---|---|---|
| English question | 0.095 | 0.214 | 0.429 |
| Portuguese question as typed | 0.024 | 0.048 | 0.071 |
| **Portuguese + English names (what `retrieve()` does)** | **0.548** | **0.619** | **0.643** |

The English row is lower because an English question only gets the title boost when it names the article exactly;
the Portuguese route always searches by name. On wiki-vital5 (format 1, keyword only) the suggestion questions put the
right article first: estações do ano → *Season*, vacinas → *Immune system*/*Vaccine*, vírus, queimadura → *Burn*,
efeito estufa, monções, pandemia/epidemia, fissão nuclear, Rota da Seda, Grande Barreira de Corais, sangramento nasal
→ *Nosebleed*, Fahrenheit. Misses: "picada de abelha" (wiki-vital5 has no *Bee sting*). Remaining noise: a few generic
names ("homem" → *Man*). Not measured yet: a model translating the question, and a multilingual embedder.
