/**
 * Sentence-level context selection. Two uses:
 *
 * 1. Instant tier: pick the single best source sentence for a question and
 *    show it in <1s with no LLM (selectInstant).
 * 2. Context compression: prefill is the hidden cost of RAG on a phone CPU
 *    (~70 tok/s for a 1.5B, so 4 chunks x 500 tokens is ~30s before the first
 *    word). compressContext keeps only the sentences that match the question,
 *    up to a token budget (~1.2k by default), in document order.
 *
 * Pure and deterministic: lexical scoring (IDF-weighted query-term coverage),
 * no embeddings, so it runs in milliseconds in JS. When the knowledge layer
 * returns pre-scored sentences (src/rag passages), those scores can be fed in
 * instead; this module is the fallback over plain RetrievedChunks.
 */
import type { RetrievedChunk } from "../rag/retrieve.types";

export interface ScoredSentence {
  chunkIndex: number;
  /** Position inside the chunk, for restoring document order. */
  position: number;
  text: string;
  /** 0..1, absolute: share of the question's (IDF-weighted) terms this sentence covers. */
  score: number;
}

const STOPWORDS = new Set(
  (
    "a an the and or but if then else of to in on at by for with from as is are was were be been being " +
    "do does did doing have has had having it its this that these those there here what which who whom whose " +
    "when where why how can could should would will shall may might must i you he she we they me him her us them " +
    "my your his our their not no yes so than too very just about into over under between vs versus also " +
    "tell explain describe give me please much many more most some any all each other such only own same " +
    "o a os as um uma de do da dos das em no na nos nas por para com que qual quais quem como quando onde porque é"
  ).split(/\s+/)
);

export function tokenizeTerms(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Tiny suffix stripper: enough to match "revolutions"/"revolution", "caused"/"causes". */
function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && (t.endsWith("es") || t.endsWith("ed"))) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  return t;
}

/**
 * Splits on sentence ends while keeping abbreviations and decimals intact
 * ("U.S.", "3.5", "e.g.") — good enough for encyclopedia prose.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  // Candidate boundary: terminal punctuation (optionally closing quote/paren),
  // whitespace, then something that can open a sentence. Newlines always split.
  const re = /[.!?]+["')\]]*\s+(?=["'(\[]?[A-Z0-9])|\n+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].trimEnd().length;
    const candidate = text.slice(start, end);
    // Not a boundary after a single capital ("U.S.") or a known abbreviation ("e.g.").
    if (m[0][0] === "." && /(?:\b[A-Z]|\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Dr|St|No|approx|c|ca))\.$/.test(candidate.trimEnd())) continue;
    if (candidate.trim()) out.push(candidate.trim());
    start = m.index + m[0].length;
  }
  if (text.slice(start).trim()) out.push(text.slice(start).trim());
  return out;
}

/** Scores every sentence of every chunk against the question. */
export function scoreSentences(query: string, chunks: RetrievedChunk[]): ScoredSentence[] {
  const qTerms = [...new Set(tokenizeTerms(query))];
  const all: { chunkIndex: number; position: number; text: string; terms: Set<string> }[] = [];
  chunks.forEach((c, chunkIndex) => {
    splitSentences(c.body).forEach((text, position) => {
      all.push({ chunkIndex, position, text, terms: new Set(tokenizeTerms(text)) });
    });
  });
  if (qTerms.length === 0) return all.map((s) => ({ chunkIndex: s.chunkIndex, position: s.position, text: s.text, score: 0 }));

  // IDF over the candidate sentences: a term every sentence has says little.
  const n = all.length;
  const idf = new Map<string, number>();
  for (const t of qTerms) {
    const df = all.reduce((acc, s) => acc + (s.terms.has(t) ? 1 : 0), 0);
    idf.set(t, Math.log(1 + (n + 1) / (df + 0.5)));
  }
  const totalWeight = qTerms.reduce((acc, t) => acc + idf.get(t)!, 0);

  return all.map((s) => {
    let covered = 0;
    for (const t of qTerms) if (s.terms.has(t)) covered += idf.get(t)!;
    // A sentence that also names the article title is on-topic even when it
    // uses a pronoun for the subject: small bonus, capped at 1.
    const titleTerms = tokenizeTerms(chunks[s.chunkIndex].title);
    const titleHit = titleTerms.some((t) => qTerms.includes(t)) ? 0.1 : 0;
    const score = Math.min(1, covered / totalWeight + (covered > 0 ? titleHit : 0));
    return { chunkIndex: s.chunkIndex, position: s.position, text: s.text, score };
  });
}

/** Rough token count (~4 chars/token for English BPE) when no tokenizer is at hand. */
export const approxTokens = (s: string) => Math.ceil(s.length / 4);

/** Minimum confidence for the instant snippet to stand as the final answer to a lookup. */
export const INSTANT_FINAL_CONFIDENCE = 0.75;
/** Below this, the snippet is not worth showing even as a preview. */
export const INSTANT_MIN_CONFIDENCE = 0.34;

export interface InstantSnippet {
  text: string;
  /** 0-based index into the chunks passed in (= sources[sourceIndex]). */
  sourceIndex: number;
  confidence: number;
}

/**
 * Best single source sentence for the question, with the sentence after it
 * when the best one is very short (a bare "It is the capital." needs its
 * neighbor). Null when nothing clears INSTANT_MIN_CONFIDENCE.
 */
export function selectInstant(query: string, chunks: RetrievedChunk[]): InstantSnippet | null {
  const scored = scoreSentences(query, chunks);
  let best: ScoredSentence | null = null;
  for (const s of scored) {
    // Near-ties go to the denser (shorter) sentence: "X is the capital of Y."
    // beats a long sentence that mentions the same words in passing. Exact
    // ties keep the earlier chunk (better retrieval rank).
    if (!best || s.score > best.score + 0.01 || (Math.abs(s.score - best.score) <= 0.01 && s.text.length < best.text.length)) best = s;
  }
  if (!best || best.score < INSTANT_MIN_CONFIDENCE) return null;
  let text = best.text;
  if (text.length < 80) {
    const next = scored.find((s) => s.chunkIndex === best!.chunkIndex && s.position === best!.position + 1);
    if (next) text = `${text} ${next.text}`;
  }
  return { text, sourceIndex: best.chunkIndex, confidence: best.score };
}

export interface CompressOptions {
  /** Token budget for all selected sentences together. Default 1200. */
  tokenBudget?: number;
  maxSentencesPerChunk?: number;
  /** Real tokenizer when available (llama.rn tokenize); approxTokens otherwise. */
  countTokens?: (s: string) => number;
}

export interface CompressedContext {
  /** Same chunks (same order, so [n] numbering is preserved) with bodies cut to the selected sentences; chunks with nothing relevant are dropped. */
  chunks: RetrievedChunk[];
  /** Index into the input array for each output chunk. */
  keptIndices: number[];
  tokensBefore: number;
  tokensAfter: number;
}

/**
 * Keeps the best sentences across all chunks until the token budget is
 * spent. Each kept chunk always opens with its first sentence (it usually
 * names the subject, so later sentences' pronouns resolve), and sentences
 * are restored to document order. A chunk whose sentences all score 0 is
 * dropped — unless nothing scores at all, in which case the first sentences
 * of the top chunks are kept so the model still sees its best sources.
 */
export function compressContext(query: string, chunks: RetrievedChunk[], opts: CompressOptions = {}): CompressedContext {
  const budget = opts.tokenBudget ?? 1200;
  const perChunk = opts.maxSentencesPerChunk ?? 4;
  const count = opts.countTokens ?? approxTokens;
  const tokensBefore = chunks.reduce((acc, c) => acc + count(`${c.title}\n${c.body}`), 0);

  const scored = scoreSentences(query, chunks);
  const anyMatch = scored.some((s) => s.score > 0);
  // Rank: matching sentences by score (ties → retrieval rank, then position);
  // with no match at all, fall back to each chunk's opening sentence.
  const ranked = (anyMatch ? scored.filter((s) => s.score > 0) : scored.filter((s) => s.position === 0)).sort(
    (a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex || a.position - b.position
  );

  const picked = new Map<number, Set<number>>();
  let used = 0;
  const cost = (s: ScoredSentence) => count(s.text) + 1;
  const tryAdd = (s: ScoredSentence): boolean => {
    const set = picked.get(s.chunkIndex) ?? new Set<number>();
    if (set.has(s.position)) return true;
    const c = cost(s);
    if (used + c > budget) return false;
    set.add(s.position);
    picked.set(s.chunkIndex, set);
    used += c;
    return true;
  };

  for (const s of ranked) {
    const set = picked.get(s.chunkIndex);
    if (set && set.size >= perChunk) continue;
    // Opening a new chunk: its title line and first sentence come first.
    if (!set) {
      const titleCost = count(chunks[s.chunkIndex].title) + 1;
      if (used + titleCost + cost(s) > budget) continue;
      used += titleCost;
      const first = scored.find((x) => x.chunkIndex === s.chunkIndex && x.position === 0);
      if (first && first !== s && !tryAdd(first)) {
        used -= titleCost;
        continue;
      }
    }
    tryAdd(s);
  }

  const keptIndices = [...picked.keys()].sort((a, b) => a - b);
  const out = keptIndices.map((ci) => {
    const positions = [...picked.get(ci)!].sort((a, b) => a - b);
    const body = positions
      .map((p) => scored.find((s) => s.chunkIndex === ci && s.position === p)!.text)
      .join(" ");
    return { ...chunks[ci], body };
  });
  const tokensAfter = out.reduce((acc, c) => acc + count(`${c.title}\n${c.body}`), 0);
  return { chunks: out, keptIndices, tokensBefore, tokensAfter };
}

/**
 * Global, deduplicated source list for multi-retrieval answers: the same
 * chunk retrieved by two sub-questions gets one number. Returns the merged
 * list and, per input list, the global 0-based index of each of its chunks.
 */
export function mergeSources(lists: RetrievedChunk[][]): { sources: RetrievedChunk[]; indexMaps: number[][] } {
  const sources: RetrievedChunk[] = [];
  const byId = new Map<string, number>();
  const indexMaps = lists.map((list) =>
    list.map((c) => {
      const key = c.chunkId;
      let idx = byId.get(key);
      if (idx === undefined) {
        idx = sources.length;
        sources.push(c);
        byId.set(key, idx);
      }
      return idx;
    })
  );
  return { sources, indexMaps };
}
