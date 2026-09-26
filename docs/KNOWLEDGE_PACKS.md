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

Not measured yet: semantic re-ranking with lead embeddings (the embeddings are
built on the Mac mini; `embed-queries.mjs` + `BOAR_EVAL_QVECS` add that
configuration), questions that span several articles (Sextant's answer-quality
set carries gold titles for those), and latency on a phone.
