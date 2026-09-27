/**
 * Search over a large knowledge pack (format 2, built by
 * scripts/build-wiki-pack.mjs): Wikipedia + Wikivoyage text in zstd blocks, a
 * contentless FTS5 index, a redirects table and per-article popularity.
 *
 * Takes the database through a small interface (PackSql) so the same code
 * runs on the phone (expo-sqlite) and in tests (node:sqlite).
 *
 * The retrieval design is ported from AndroidLM's Corpus.kt / rag.py
 * (https://github.com/Phineas1500/AndroidLM, Apache-2.0): rarest-first query
 * stems with a df cut, whole-index BM25 with a title-column weight and a
 * popularity prior, titles resolved through redirects, and per-article
 * passages (lead + best sections). Additions here: title candidates taken
 * from the question itself (no LLM call), and an optional expansion callback
 * that's only used when the keyword search comes back thin.
 */

import { cosineSimilarityInt8 } from "./pure";

export interface PackSql {
  getAllAsync<T>(sql: string, params: any[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: any[]): Promise<T | null>;
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: any[]): Promise<unknown>;
}

export type Decompress = (data: Uint8Array) => Uint8Array;

export interface Stem {
  stem: string;
  idf: number;
}

export type PackSource = "enwiki" | "enwikivoyage" | "enwikibooks" | "appropedia" | "usgov" | "eips" | "ethspecs" | "ethereumorg" | "bips";

/** A ranked BM25 chunk before its text is read. */
export interface Candidate {
  chunkId: number;
  articleId: number;
  start: number;
  end: number;
  score: number;
}

export interface Article {
  id: number;
  title: string;
  source: PackSource;
  views: number;
  text: string;
  /** Page URL and license, when the pack records them per article (multi-source packs). */
  url?: string;
  license?: string;
}

export interface PackHit {
  articleId: number;
  chunkId: number;
  title: string;
  /** Heading path of the passage inside the article ("History > Early years"), "" for the lead. */
  section: string;
  text: string;
  start: number;
  end: number;
  score: number;
  /** "title": the article was named by the question or the planner; "bm25": whole-index keyword hit. */
  via: "title" | "bm25";
  source: PackSource;
  /** Monthly pageviews of the article (0 when unknown). */
  views: number;
  lead: boolean;
  /** The source page and its license, when the pack records them (otherwise derive from title and source). */
  url?: string;
  license?: string;
}

export interface PackSearchOptions {
  /** Article titles to look up first, e.g. proposed by the model. The question's own n-grams are always tried. */
  titles?: string[];
  k?: number;
  /**
   * Called only when the keyword search finds fewer than `minHits` passages:
   * returns extra titles or keywords (e.g. from one short LLM turn), which are
   * searched once more. Keeps the LLM off the common path.
   */
  expand?: (query: string) => Promise<string[]>;
  minHits?: number;
  /**
   * The question's embedding (the app's embedding model). With it, keyword
   * hits are re-ranked by how close their article's lead is to the question,
   * and a hit that misses the question's words but is semantically close
   * (>= SEMANTIC_KEEP) is kept.
   */
  queryVec?: Float32Array;
}

// Index = articles.source code written by scripts/build-wiki-pack.mjs.
const SOURCES: PackSource[] = ["enwiki", "enwikivoyage", "enwikibooks", "appropedia", "usgov", "eips", "ethspecs", "ethereumorg", "bips"];

/** Share of the question's term weight a name in it must carry to be treated as the question's subject. */
export const NAMED_MIN_SHARE = 0.5;

/** Questions that read like travel planning: a same-named Wikivoyage guide goes before the encyclopedia article. */
const TRAVEL_INTENT = /\b(visit|visiting|things to (see|do)|what (can|should) (i|we) (see|do)|see and do|travel|trip|get (to|there|around)|getting (to|around)|stay|hotel|hostel|eat|restaurants?|sights?|tourists?|itinerary|by (train|bus|car|ferry)|airport)\b/i;

/** Cosine (bge-small) of a lead that's about the question even without its words. */
export const SEMANTIC_KEEP = 0.7;

/** Monthly views below which a topic is "long tail": answer from the sources, not the model's memory. */
export const LONG_TAIL_VIEWS = 5000;

/** Portuguese and Spanish function words, left out of a question's subject weight (not of its search terms). */
const FOREIGN_FUNCTION_WORDS = new Set(
  "o os a as um uma uns umas de do da dos das em no na nos nas num numa por para com sem que como qual quais quando onde porque se ao aos el la los las un una del al en con por para que como cual cuando donde es son y e ou".split(" ")
);

const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are as at be because been before being below " +
    "between both but by can could compare comparison describe did difference differences do does doing down " +
    "during each explain few for from further give had has have having he her here hers him his how i if in " +
    "into is it its itself just know like me mean means more most much my no nor not now of off on once only " +
    "or other our out over own please same she should show so some such summarize tell than that the their " +
    "them then there these they this those through to too under until up us very versus vs was we were what " +
    "when where which while who whom whose why will with would you your"
  ).split(" ")
);

const HEADING = /^(#{1,6})\s+(.*)$/gm;
const BLOCK_CACHE = 16;
const ARTICLE_CACHE = 16;

/** Heading path in force at UTF-16 offset `start` of an article's text (chunks store offsets only). */
export function sectionAt(text: string, start: number): string {
  const path: string[] = [];
  for (const m of text.slice(0, start).matchAll(HEADING)) {
    const level = m[1].length;
    path.length = level - 1;
    path[level - 1] = m[2].trim();
  }
  return path.slice(1).filter(Boolean).join(" > ");
}

/**
 * FTS5 term for a stem. Porter turns a final y into i ("purify" → "purifi")
 * but "purification" into "purif", so a stem ending in "i" is matched as a
 * prefix of the stem without it; others match exactly (a prefix on every stem
 * would let "water" match "watermelon").
 */
export function matchTerm(stem: string): string {
  const q = (t: string) => `"${t.replace(/"/g, '""')}"`;
  return stem.endsWith("i") && stem.length > 4 ? `${q(stem.slice(0, -1))}*` : q(stem);
}

/** Surface-form prefix of a porter stem (porter turns a final y into i: energy → energi). */
export function prefixOf(stem: string): string {
  return stem.endsWith("i") && stem.length > 3 ? stem.slice(0, -1) : stem;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Occurrences of `prefix` starting at a word boundary in `text` (both lower-cased). */
export function countAtBoundary(prefix: string, text: string, firstOnly = false): number {
  let n = 0;
  for (let i = text.indexOf(prefix); i >= 0; i = text.indexOf(prefix, i + 1)) {
    if (isWordChar(text[i - 1])) continue;
    n++;
    if (firstOnly) break;
  }
  return n;
}

/** Share of the question's idf mass whose terms occur in `text`. */
/**
 * Whether two passages say nearly the same thing (one article copying another's paragraph:
 * "NSA cryptography" and "NSA Suite B Cryptography"): Jaccard similarity of their word 5-grams.
 */
export function nearDuplicate(a: string, b: string, threshold = 0.5): boolean {
  const grams = (t: string) => {
    const w = t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const out = new Set<string>();
    for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(" "));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return false;
  let both = 0;
  for (const g of ga) if (gb.has(g)) both++;
  return both / (ga.size + gb.size - both) >= threshold;
}

export function coverage(text: string, stems: Stem[]): number {
  const low = text.toLowerCase();
  const total = stems.reduce((s, x) => s + x.idf, 0) || 1;
  return stems.filter((s) => countAtBoundary(prefixOf(s.stem), low, true) > 0).reduce((s, x) => s + x.idf, 0) / total;
}

/**
 * Word n-grams of the question that could be article titles, longest first:
 * no leading/trailing stopword, at least one capitalized or rare-looking word.
 */
export function titleCandidates(query: string, maxLen = 5): string[] {
  const words = query.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? [];
  const clean = words.map((w) => w.replace(/[.'’-]+$/, ""));
  const out: string[] = [];
  const seen = new Set<string>();
  for (let len = Math.min(maxLen, clean.length); len >= 1; len--) {
    for (let i = 0; i + len <= clean.length; i++) {
      const gram = clean.slice(i, i + len);
      const first = gram[0].toLowerCase();
      const last = gram[len - 1].toLowerCase();
      if (STOPWORDS.has(first) || STOPWORDS.has(last)) continue;
      if (gram.every((w) => STOPWORDS.has(w.toLowerCase()))) continue;
      const title = gram.join(" ");
      const key = title.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(title);
      }
    }
  }
  return out;
}

/** Plural → singular guesses for title lookup ("vaccines" → "vaccine"). */
function singularTitle(title: string): string | null {
  if (/ies$/i.test(title)) return title.replace(/ies$/i, "y");
  if (/[^s]s$/i.test(title) && title.length > 4) return title.slice(0, -1);
  return null;
}

class Lru<K, V> extends Map<K, V> {
  constructor(private max: number) {
    super();
  }
  put(k: K, v: V): V {
    this.delete(k);
    this.set(k, v);
    if (this.size > this.max) this.delete(this.keys().next().value as K);
    return v;
  }
}

function utf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
  // Fallback for runtimes without TextDecoder.
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (b < 0xf0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

/** Ranking constants, measured on eval/retrieval (docs/KNOWLEDGE_PACKS.md). */
export interface PackTuning {
  /** bm25() column weights: title, section heading, body. */
  weights: [number, number, number];
  /** Popularity prior: + prior × log10(1 + monthly views). */
  prior: number;
  /** Share of the question's term weight a name in it must carry to go first. */
  namedMinShare: number;
  /** BM25 candidate chunks before the per-article cap and relevance gate. */
  pool: number;
  /** Weight of the lead-embedding similarity when a query vector is given (0 = keyword order only). */
  semanticWeight: number;
}

// Chosen on the dev half of eval/retrieval/questions.v1 (2026-09-26): AndroidLM's title
// weight 8 and prior 2 cost 6 points of test recall@1 on these questions.
export const DEFAULT_TUNING: PackTuning = { weights: [2, 1, 1], prior: 0.5, namedMinShare: NAMED_MIN_SHARE, pool: 80, semanticWeight: 0 };

export class WikiPack {
  tuning: PackTuning = { ...DEFAULT_TUNING };
  private blocks = new Lru<number, Uint8Array>(BLOCK_CACHE);
  private articles = new Lru<number, Article>(ARTICLE_CACHE);
  private resolved = new Lru<string, number | null>(512);

  private constructor(
    private db: PackSql,
    private decompress: Decompress,
    readonly meta: Record<string, string>,
    private nIndexed: number,
    private hasRedirects: boolean,
    private hasDf: boolean,
    private hasMeta: boolean,
    /** Sources besides Wikipedia and Wikivoyage in a multi-source pack (EIPs, BIPs…): their titles count as names too. */
    private topicSources: PackSource[] = []
  ) {}

  static async open(db: PackSql, decompress: Decompress): Promise<WikiPack> {
    const rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM meta", []);
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (meta.format !== "boar-knowledge-pack" || meta.formatVersion !== "2") {
      throw new Error("not a format-2 knowledge pack");
    }
    // Vocabulary views: fts_v gives each stem's document count, qtok stems a question with the index's tokenizer.
    await db.execAsync(`
      CREATE VIRTUAL TABLE IF NOT EXISTS temp.fts_v USING fts5vocab(main, fts, row);
      CREATE VIRTUAL TABLE IF NOT EXISTS temp.qtok USING fts5(x, tokenize='porter unicode61 remove_diacritics 2');
      CREATE VIRTUAL TABLE IF NOT EXISTS temp.qtok_v USING fts5vocab(temp, qtok, row);
    `);
    const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'", []);
    const has = (n: string) => tables.some((t) => t.name === n);
    // Only multi-source packs (small topic packs) record article_meta, so the scan stays cheap.
    const topicSources = has("article_meta")
      ? (await db.getAllAsync<{ source: number }>("SELECT DISTINCT source FROM articles", []))
          .map((r) => SOURCES[r.source])
          .filter((x): x is PackSource => !!x && x !== "enwiki" && x !== "enwikivoyage")
      : [];
    return new WikiPack(db, decompress, meta, Number(meta.indexedChunks) || 1, has("redirects"), has("df"), has("article_meta"), topicSources);
  }

  /** [stem, idf] for the content words of `text`, stemmed by FTS5 itself. */
  async stems(text: string): Promise<Stem[]> {
    const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w));
    if (!words.length) return [];
    await this.db.execAsync("DELETE FROM temp.qtok");
    await this.db.runAsync("INSERT INTO temp.qtok (x) VALUES (?)", [words.join(" ")]);
    const terms = await this.db.getAllAsync<{ term: string }>("SELECT term FROM temp.qtok_v", []);
    const out: Stem[] = [];
    for (const { term } of terms) {
      // A common term's count is precomputed in df; a rarer one's posting list is short enough to count.
      const row =
        (this.hasDf ? await this.db.getFirstAsync<{ doc: number }>("SELECT doc FROM df WHERE term = ?", [term]) : null) ??
        (await this.db.getFirstAsync<{ doc: number }>("SELECT doc FROM temp.fts_v WHERE term = ?", [term]));
      if (row && row.doc > 0) out.push({ stem: term, idf: Math.log(this.nIndexed / row.doc) });
    }
    return out;
  }

  /** Rarest-first stems, dropping those in more than `maxDf` of all chunks while `keepMin` rarer ones remain. */
  queryTerms(stems: Stem[], maxDf = 0.02, keepMin = 3): string[] {
    const ranked = [...stems].sort((a, b) => b.idf - a.idf);
    const kept = ranked.filter((s) => s.idf >= Math.log(1 / maxDf)).map((s) => s.stem);
    return kept.length >= keepMin ? kept : ranked.slice(0, keepMin).map((s) => s.stem);
  }

  private async block(id: number): Promise<Uint8Array> {
    const hit = this.blocks.get(id);
    if (hit) return hit;
    const row = await this.db.getFirstAsync<{ zdata: Uint8Array }>("SELECT zdata FROM blocks WHERE id = ?", [id]);
    if (!row) throw new Error(`pack block ${id} missing`);
    return this.blocks.put(id, this.decompress(new Uint8Array(row.zdata)));
  }

  async article(id: number): Promise<Article> {
    const hit = this.articles.get(id);
    if (hit) return hit;
    const a = await this.db.getFirstAsync<{ title: string; source: number; views: number; block_id: number; off: number; len: number }>(
      "SELECT title, source, views, block_id, off, len FROM articles WHERE id = ?",
      [id]
    );
    if (!a) throw new Error(`pack article ${id} missing`);
    const block = await this.block(a.block_id);
    const text = utf8(block.subarray(a.off, a.off + a.len));
    const m = this.hasMeta
      ? await this.db.getFirstAsync<{ url: string | null; license: string | null }>("SELECT url, license FROM article_meta WHERE article_id = ?", [id])
      : null;
    return this.articles.put(id, {
      id,
      title: a.title,
      source: SOURCES[a.source] ?? "enwiki",
      views: a.views,
      text,
      ...(m?.url ? { url: m.url } : {}),
      ...(m?.license ? { license: m.license } : {}),
    });
  }

  /**
   * Article id for a title: exact (case-insensitive), then redirects, then,
   * when `fuzzy`, a title search preferring the most-read candidate with at
   * most one extra word. One-word titles never go fuzzy (too often another entity).
   */
  async resolveTitle(title: string, opts: { fuzzy?: boolean; source?: PackSource } = {}): Promise<number | null> {
    const { fuzzy = true, source = "enwiki" } = opts;
    const key = `${fuzzy ? "f" : "x"}:${source}:${title}`;
    if (this.resolved.has(key)) return this.resolved.get(key)!;
    const src = SOURCES.indexOf(source);
    let id =
      (await this.db.getFirstAsync<{ id: number }>(
        "SELECT id FROM articles WHERE title = ? COLLATE NOCASE AND source = ? ORDER BY views DESC LIMIT 1",
        [title, src]
      ))?.id ?? null;
    if (id === null && this.hasRedirects) {
      id =
        (await this.db.getFirstAsync<{ article_id: number }>(
          `SELECT r.article_id FROM redirects r JOIN articles a ON a.id = r.article_id
           WHERE r.title = ? AND a.source = ? ORDER BY a.views DESC LIMIT 1`,
          [title, src]
        ))?.article_id ?? null;
    }
    const words = title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    if (id === null && fuzzy && words.length >= 2) {
      const match = `title:(${words.map((w) => `"${w}"`).join(" AND ")})`;
      const rows = await this.db.getAllAsync<{ title: string; views: number; id: number }>(
        `SELECT a.id, a.title, a.views FROM (SELECT rowid FROM fts WHERE fts MATCH ? ORDER BY bm25(fts, 8.0, 0.0, 0.0) LIMIT 30) f
         JOIN chunks c ON c.id = f.rowid JOIN articles a ON a.id = c.article_id WHERE a.source = ?`,
        [match, src]
      );
      let best = -Infinity;
      for (const r of rows) {
        const extra = Math.max(0, (r.title.match(/[\p{L}\p{N}]+/gu) ?? []).length - words.length);
        if (extra > 1) continue;
        const k = Math.log10(10 + r.views) - 0.5 * extra;
        if (k > best) [best, id] = [k, r.id];
      }
    }
    this.resolved.put(key, id);
    return id;
  }

  /** BM25-like score of a passage for the question, 0..1; question terms in the heading count double. */
  private passageScore(text: string, start: number, end: number, stems: Stem[]): number {
    const body = text.slice(start, end).toLowerCase();
    const heading = sectionAt(text, start).toLowerCase();
    const total = stems.reduce((s, x) => s + x.idf, 0) || 1;
    let score = 0;
    for (const { stem, idf } of stems) {
      const p = prefixOf(stem);
      const tf = countAtBoundary(p, body) + 2 * countAtBoundary(p, heading);
      score += (idf * tf) / (tf + 1.5);
    }
    return score / total;
  }

  private async hit(articleId: number, chunkId: number, start: number, end: number, score: number, via: PackHit["via"], lead = false): Promise<PackHit> {
    const a = await this.article(articleId);
    return {
      articleId,
      chunkId,
      title: a.title,
      section: sectionAt(a.text, start),
      text: a.text.slice(start, end).trim(),
      start,
      end,
      score: Math.round(score * 100) / 100,
      via,
      source: a.source,
      views: a.views,
      lead,
      ...(a.url ? { url: a.url } : {}),
      ...(a.license ? { license: a.license } : {}),
    };
  }

  /** The article's lead chunk plus its `nSections` chunks that best cover the question. */
  async articlePassages(articleId: number, stems: Stem[], nSections = 2): Promise<PackHit[]> {
    const a = await this.article(articleId);
    const rows = await this.db.getAllAsync<{ id: number; start: number; end: number }>(
      "SELECT id, start, end FROM chunks WHERE article_id = ? ORDER BY id",
      [articleId]
    );
    if (!rows.length) return [];
    // The first chunk is often only the infobox facts; the prose lead follows it.
    const lead = a.text.startsWith("Key facts:", rows[0].start) && rows.length > 1 ? rows[1] : rows[0];
    const scored = rows
      .filter((r) => r !== lead)
      .map((r) => ({ r, s: this.passageScore(a.text, r.start, r.end, stems) }))
      .sort((x, y) => y.s - x.s || y.r.start - x.r.start)
      .slice(0, nSections)
      .filter((x) => x.s > 0.15);
    return Promise.all([
      this.hit(articleId, lead.id, lead.start, lead.end, 1, "title", true),
      ...scored.map((x) => this.hit(articleId, x.r.id, x.r.start, x.r.end, x.s, "title")),
    ]);
  }

  /** Whole-index BM25 (column weights and popularity prior from `tuning`); at most `perArticle` per article. */
  async bm25(stems: Stem[], pool = this.tuning.pool, prior = this.tuning.prior, perArticle = 2): Promise<PackHit[]> {
    const out: PackHit[] = [];
    for (const c of await this.bm25Candidates(stems, pool, prior, perArticle)) out.push(await this.materialize(c));
    return out;
  }

  /** bm25()'s ranking without reading any article text (cheap: index and table rows only). */
  async bm25Candidates(stems: Stem[], pool = this.tuning.pool, prior = this.tuning.prior, perArticle = 2): Promise<Candidate[]> {
    const terms = this.queryTerms(stems);
    if (!terms.length) return [];
    const rows = await this.db.getAllAsync<{ id: number; s: number; article_id: number; start: number; end: number; views: number }>(
      `SELECT f.rowid AS id, f.s, c.article_id, c.start, c.end, a.views
       FROM (SELECT rowid, bm25(fts, ${this.tuning.weights.map(Number).join(", ")}) AS s FROM fts WHERE fts MATCH ? ORDER BY s LIMIT ?) f
       JOIN chunks c ON c.id = f.rowid JOIN articles a ON a.id = c.article_id`,
      [terms.map(matchTerm).join(" OR "), pool]
    );
    const sorted = rows
      .map((r) => ({ chunkId: r.id, articleId: r.article_id, start: r.start, end: r.end, score: -r.s + prior * Math.log10(1 + r.views) }))
      .sort((a, b) => b.score - a.score || b.articleId - a.articleId || b.start - a.start);
    const per = new Map<number, number>();
    return sorted.filter((c) => {
      const n = per.get(c.articleId) ?? 0;
      per.set(c.articleId, n + 1);
      return n < perArticle;
    });
  }

  private materialize(c: Candidate): Promise<PackHit> {
    return this.hit(c.articleId, c.chunkId, c.start, c.end, c.score, "bm25");
  }

  /**
   * Articles named by the question itself: its longest n-grams that are
   * titles or redirects, in Wikipedia and in Wikivoyage (the guide first when
   * the question sounds like travel). `share` is the part of the question's
   * term weight the name accounts for: "Daily Bugle" in a long question
   * about an actor is a side mention, "Fort Naroa" in "Where was Fort Naroa?"
   * is the subject.
   */
  async titlesInQuestion(query: string, stems: Stem[], max = 4): Promise<Array<{ id: number; share: number }>> {
    const rare = new Set(stems.filter((s) => s.idf >= Math.log(1 / 0.002)).map((s) => s.stem));
    // Portuguese/Spanish function words carry no subject; some packs index them (Appropedia's pages in those languages).
    const content = stems.filter((s) => !FOREIGN_FUNCTION_WORDS.has(s.stem));
    const weight = new Map(content.map((s) => [s.stem, s.idf]));
    const total = content.reduce((n, s) => n + s.idf, 0) || 1;
    const sources: PackSource[] = [
      ...(TRAVEL_INTENT.test(query) ? ["enwikivoyage", "enwiki"] as const : ["enwiki", "enwikivoyage"] as const),
      ...this.topicSources,
    ];
    const found: Array<{ id: number; share: number }> = [];
    const used: string[] = [];
    for (const cand of titleCandidates(query)) {
      if (used.length >= max) break;
      const lower = cand.toLowerCase();
      if (used.some((u) => u.includes(lower))) continue; // inside a longer title already found
      const single = !cand.includes(" ");
      // A lone word only counts when it's capitalized in the question, rare in the index, or not in the index at all
      // (then only an exact title or alias can match it: "queimadura" -> Burn through its Portuguese alias).
      if (single && !/^\p{Lu}/u.test(cand) && !(await this.isRare(lower, rare)) && (await this.stems(lower)).length) continue;
      const ids: Array<{ id: number; primary: boolean }> = [];
      for (const source of sources) {
        const id =
          (await this.resolveTitle(cand, { fuzzy: false, source })) ??
          (singularTitle(cand) ? await this.resolveTitle(singularTitle(cand)!, { fuzzy: false, source }) : null);
        if (id !== null && !found.some((f) => f.id === id)) ids.push({ id, primary: this.topicSources.includes(source) });
      }
      if (!ids.length) continue;
      const own = await this.stems(cand);
      const words = new Set((lower.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOPWORDS.has(w)));
      // A name with a word the index doesn't know ("ERC20", "sangramento nasal") can only have matched an exact
      // title or alias: it's the subject, whatever else the question says.
      const share = own.length < words.size ? 1 : own.reduce((n, s) => n + (weight.get(s.stem) ?? 0), 0) / total;
      // So is an exact title or alias of a primary source in a topic pack ("ERC-20", "BIP 32"), however common its words are there.
      for (const { id, primary } of ids) found.push({ id, share: primary ? 1 : share });
      used.push(lower);
    }
    return found;
  }

  private async isRare(word: string, rare: Set<string>): Promise<boolean> {
    const [s] = await this.stems(word);
    return !!s && rare.has(s.stem);
  }

  /**
   * Passages for a question: articles it names (and `titles`) first, their
   * lead and best sections round-robin so each side of a comparison shows up,
   * then BM25 hits that cover at least half of the topic's terms.
   */
  async search(query: string, opts: PackSearchOptions = {}): Promise<PackHit[]> {
    return (await this.searchDetailed(query, opts)).hits;
  }

  /** search(), plus the question's stems (for scoring sentences with the same term weights). */
  async searchDetailed(query: string, opts: PackSearchOptions = {}): Promise<{ hits: PackHit[]; stems: Stem[] }> {
    const { k = 6, titles = [], expand, minHits = 2, queryVec } = opts;
    const stems = await this.stems(query);
    // Only a name that carries enough of the question goes first; side mentions compete in BM25.
    const ids = (await this.titlesInQuestion(query, stems)).filter((t) => t.share >= this.tuning.namedMinShare).map((t) => t.id);
    for (const t of titles) {
      const id = await this.resolveTitle(t);
      if (id !== null && !ids.includes(id)) ids.push(id);
    }
    let hits = await this.titleHits(ids, stems);
    const limit = Math.max(k, ids.length * 2);
    if (hits.length < limit) {
      const topic = titles.length ? await this.stems(titles.join(" ")) : stems;
      const seen = new Set(hits.map((h) => h.chunkId));
      let keyword = await this.bm25Candidates(stems);
      const sem = queryVec ? await this.leadSimilarity(keyword.map((c) => c.articleId), queryVec) : null;
      const w = this.tuning.semanticWeight;
      if (sem && sem.size && w > 0 && keyword.length) {
        // Only the most-read articles have embeddings: one without gets the candidates' median
        // similarity, so a missing vector neither sinks a long-tail article nor lifts it.
        const known = [...sem.values()].sort((a, b) => a - b);
        const median = known[Math.floor(known.length / 2)];
        const max = Math.max(...keyword.map((c) => c.score), 1e-9);
        const blended = (c: Candidate) => (1 - w) * (c.score / max) + w * (sem.get(c.articleId) ?? median);
        keyword = [...keyword].sort((a, b) => blended(b) - blended(a));
      }
      // Text is read only for candidates in rank order, until the result is full.
      for (const c of keyword) {
        if (hits.length >= limit) break;
        if (seen.has(c.chunkId)) continue;
        const h = await this.materialize(c);
        const relevant =
          coverage(`${h.title} ${h.text}`, topic.length ? topic : stems) >= 0.5 || (sem?.get(c.articleId) ?? 0) >= SEMANTIC_KEEP;
        if (relevant && !hits.some((x) => nearDuplicate(x.text, h.text))) {
          hits.push(h);
          seen.add(c.chunkId);
        }
      }
    }
    if (hits.length < minHits && expand) {
      const extra = (await expand(query)).filter((t) => t.trim());
      if (extra.length) {
        const more = await this.search(`${query} ${extra.join(" ")}`, { k, titles: [...titles, ...extra] });
        const seen = new Set(hits.map((h) => h.chunkId));
        hits = [...hits, ...more.filter((h) => !seen.has(h.chunkId))];
      }
    }
    return { hits: hits.slice(0, limit), stems };
  }

  private async titleHits(ids: number[], stems: Stem[], ranks = 5): Promise<PackHit[]> {
    const perTitle: PackHit[][] = [];
    for (const id of ids) perTitle.push(await this.articlePassages(id, stems));
    const hits: PackHit[] = [];
    const seen = new Set<number>();
    const add = (h: PackHit) => {
      if (!seen.has(h.chunkId)) (seen.add(h.chunkId), hits.push(h));
    };
    perTitle[0]?.slice(0, 2).forEach(add);
    for (let r = 0; r < ranks; r++) for (const p of perTitle) if (p[r]) add(p[r]);
    return hits;
  }

  /** Cosine similarity of each article's lead embedding to the question (articles without one are left out). */
  async leadSimilarity(ids: number[], queryVec: Float32Array): Promise<Map<number, number>> {
    const vecs = await this.leadVectors([...new Set(ids)]);
    return new Map([...vecs].map(([id, v]) => [id, cosineSimilarityInt8(queryVec, v)]));
  }

  /** int8 lead embeddings for these articles (only when the pack has them). */
  async leadVectors(ids: number[]): Promise<Map<number, Uint8Array>> {
    const out = new Map<number, Uint8Array>();
    if (!ids.length) return out;
    const rows = await this.db
      .getAllAsync<{ article_id: number; vec: Uint8Array }>(
        `SELECT article_id, vec FROM lead_vecs WHERE article_id IN (${ids.map(() => "?").join(",")})`,
        ids
      )
      .catch(() => []);
    for (const r of rows) out.set(r.article_id, new Uint8Array(r.vec));
    return out;
  }
}
