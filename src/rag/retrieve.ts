import { getDb } from "./db";
import { embeddingEngine } from "./embed";
import {
  buildLexicalQuery,
  cosineSimilarity,
  filterByMinScore,
  filterByTermCoverage,
  fuseRetrievalResults,
  gateByRelevance,
  MIN_SEMANTIC_SIMILARITY,
} from "./pure";
import type { RetrievedChunk } from "./retrieve.types";
import { searchPacks } from "./packs";

export type { RetrievedChunk } from "./retrieve.types";

// Extra BM25 candidates fetched so the term-coverage gate has something to
// choose from; the result is still capped at `limit`.
const LEXICAL_CANDIDATE_MULTIPLIER = 4;

/**
 * BM25-ranked FTS5 lexical search over the local knowledge base. The query
 * is reduced to its content words, OR-ed (buildLexicalQuery), and hits
 * must cover enough of those words to count (filterByTermCoverage). That
 * coverage rule is this search's relevance gate. No numeric bm25 floor is
 * applied: bm25's scale depends on the corpus and query.
 */
async function lexicalSearch(query: string, queryVec: Float32Array, limit: number): Promise<RetrievedChunk[]> {
  const lexicalQuery = buildLexicalQuery(query);
  if (!lexicalQuery) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<{
    chunk_id: string;
    doc_id: string;
    title: string;
    body: string;
    rank: number;
    embedding: Uint8Array | null;
  }>(
    `SELECT f.chunk_id, f.doc_id, f.title, f.body, bm25(chunks_fts) AS rank, e.embedding
     FROM chunks_fts f
     JOIN chunks c ON c.chunk_id = f.chunk_id
     LEFT JOIN chunk_embeddings e ON e.chunk_id = f.chunk_id
     LEFT JOIN custom_collections cc ON cc.id = c.collection_id
     WHERE chunks_fts MATCH ? AND (c.collection_id IS NULL OR cc.active = 1)
     ORDER BY rank LIMIT ?`,
    [lexicalQuery.match, limit * LEXICAL_CANDIDATE_MULTIPLIER]
  );
  return filterByTermCoverage(rows, lexicalQuery.terms).slice(0, limit).map((r) => ({
    chunkId: r.chunk_id,
    docId: r.doc_id,
    title: r.title,
    body: r.body,
    score: -r.rank, // bm25() returns lower-is-better; invert for consistent "higher is better"
    // The relevance gate needs a similarity; without it a keyword-only hit would always be dropped.
    similarity: r.embedding ? cosineSimilarity(queryVec, toVector(r.embedding)) : undefined,
    matchType: "lexical" as const,
  }));
}

function toVector(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

/** Brute-force cosine search over stored embeddings; fine at knowledge-base scale on-device. */
async function semanticSearch(queryVec: Float32Array, limit: number): Promise<RetrievedChunk[]> {
  const db = await getDb();

  const rows = await db.getAllAsync<{
    chunk_id: string;
    doc_id: string;
    title: string;
    body: string;
    embedding: Uint8Array;
  }>(
    `SELECT c.chunk_id, c.doc_id, c.title, c.body, e.embedding
     FROM chunk_embeddings e
     JOIN chunks c ON c.chunk_id = e.chunk_id
     LEFT JOIN custom_collections cc ON cc.id = c.collection_id
     WHERE c.collection_id IS NULL OR cc.active = 1`
  );

  const scored = rows.map((r) => {
    const similarity = cosineSimilarity(queryVec, toVector(r.embedding));
    return {
      chunkId: r.chunk_id,
      docId: r.doc_id,
      title: r.title,
      body: r.body,
      score: similarity,
      similarity,
      matchType: "semantic" as const,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return filterByMinScore(scored, MIN_SEMANTIC_SIMILARITY).slice(0, limit);
}

/**
 * Hybrid retrieval: union lexical (BM25, exact-phrase-gated) + semantic
 * (cosine, MIN_SEMANTIC_SIMILARITY-gated) results, re-ranked by a simple
 * weighted-sum fusion (fuseRetrievalResults, src/rag/pure.ts — extracted
 * there so the fusion/threshold mechanics are unit-testable without a real
 * device; see retrieve.relevance.test.ts). No network calls. If neither
 * source has anything relevant, this returns [] — never a forced top-K of
 * whatever happened to be least-irrelevant.
 */
export async function retrieve(query: string, topK = 6): Promise<RetrievedChunk[]> {
  const queryVec = await embeddingEngine.embed(query);
  const [lexical, semantic, packs] = await Promise.all([
    lexicalSearch(query, queryVec, topK * 2),
    semanticSearch(queryVec, topK * 2),
    // Downloaded knowledge packs (src/rag/packs.ts); a failing pack is skipped, never fatal.
    searchPacks(query, queryVec, topK * 2).catch(() => ({ lexical: [], semantic: [] })),
  ]);

  // Keep only the candidates that are actually close to the question, then fuse: a strong first
  // match must not drag weak ones along, an unrelated question gets none, and weak chunks can't
  // take the top-K or per-article slots before the gate sees the rest.
  return fuseRetrievalResults(
    gateByRelevance([...lexical, ...packs.lexical]),
    gateByRelevance([...semantic, ...packs.semantic]),
    topK
  );
}

export { assemblePrompt } from "./pure";
export type { ConversationTurn, ConversationHistory } from "./pure";
