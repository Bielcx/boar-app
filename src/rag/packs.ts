/**
 * Knowledge packs: SQLite files built on a computer by
 * scripts/build-knowledge-pack.mjs (docs/KNOWLEDGE_PACKS.md), each with its
 * own FTS5 index and int8 embeddings made with the app's embedding model.
 * They're opened read-only and searched alongside the built-in knowledge base.
 *
 * Search is keyword-first: FTS5 picks up to PACK_CANDIDATES chunks, and only
 * those are compared with the question's embedding. Scanning every embedding
 * of a large pack on each question would take seconds on the phone's JS engine.
 */
import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { CORPUS_CATALOG, MODEL_CATALOG, CatalogModel } from "../models/manifest";
import { buildLexicalQuery, cosineSimilarityInt8, filterByMinScore, filterByTermCoverage, MIN_SEMANTIC_SIMILARITY } from "./pure";
import type { RetrievedChunk } from "./retrieve.types";
import { decompress } from "fzstd";
import { WikiPack, type PackHit, type PackSearchOptions, type Stem } from "./wikiPack";

const PACK_CANDIDATES = 400;
const EMBEDDING_SHA256 = MODEL_CATALOG.find((m) => m.kind === "embedding" && m.required)!.sha256;

const openPacks = new Map<string, SQLite.SQLiteDatabase>();
/** Format-2 packs (scripts/build-wiki-pack.mjs), keyed like openPacks. */
const wikiPacks = new Map<string, WikiPack>();

const CORPUS_DIR = "corpus/";

/**
 * Catalog packs, plus any other pack file in corpus/ (e.g. one built with
 * scripts/build-knowledge-pack.mjs and copied over with npm run pack:push).
 * Those have no catalog size to check, only the format and model checks in openPack.
 */
export async function knowledgePacks(): Promise<CatalogModel[]> {
  const catalog = CORPUS_CATALOG.filter((m) => m.format === "sqlite-pack");
  const names = await FileSystem.readDirectoryAsync(`${FileSystem.documentDirectory}${CORPUS_DIR}`).catch(() => [] as string[]);
  const extra = names
    .filter((n) => n.endsWith(".sqlite") && !catalog.some((c) => c.filename === `${CORPUS_DIR}${n}`))
    .map(
      (n): CatalogModel => ({
        id: `local-${n.replace(/\.sqlite$/, "")}`,
        kind: "corpus",
        format: "sqlite-pack",
        label: n,
        filename: `${CORPUS_DIR}${n}`,
        sizeBytes: 0,
        sha256: "",
        sourceUrl: "",
        license: "",
        description: "",
        required: false,
      })
    );
  return [...catalog, ...extra];
}

export async function closePack(id: string): Promise<void> {
  const db = openPacks.get(id);
  openPacks.delete(id);
  wikiPacks.delete(id);
  await db?.closeAsync().catch(() => {});
}

export async function closeAllPacks(): Promise<void> {
  await Promise.all([...openPacks.keys()].map(closePack));
}

/** The pack's database if it's fully downloaded and built for this app's embedding model, else null. */
async function openPack(pack: CatalogModel): Promise<SQLite.SQLiteDatabase | null> {
  const uri = `${FileSystem.documentDirectory}${pack.filename}`;
  const info = await FileSystem.getInfoAsync(uri);
  // Catalog packs must be complete; a local pack (sizeBytes 0) has nothing to compare against.
  if (!info.exists || (pack.sizeBytes > 0 && info.size !== pack.sizeBytes)) {
    await closePack(pack.id);
    return null;
  }
  const cached = openPacks.get(pack.id);
  if (cached) return cached;

  const path = uri.replace(/^file:\/\//, "");
  const slash = path.lastIndexOf("/");
  const db = await SQLite.openDatabaseAsync(path.slice(slash + 1), { useNewConnection: true }, path.slice(0, slash));
  const meta = await db
    .getAllAsync<{ key: string; value: string }>("SELECT key, value FROM meta")
    .then((rows) => Object.fromEntries(rows.map((r) => [r.key, r.value])))
    .catch(() => ({} as Record<string, string>));
  // Format 2 may be built without embeddings (empty embeddingModelSha256); format 1 always has them.
  const embeddingsOk = meta.embeddingModelSha256 === EMBEDDING_SHA256 || (meta.formatVersion === "2" && !meta.embeddingModelSha256);
  if (meta.format !== "boar-knowledge-pack" || !embeddingsOk) {
    console.warn(`[packs] ${pack.filename} isn't a knowledge pack for this app's embedding model; skipping it`);
    await db.closeAsync().catch(() => {});
    return null;
  }
  if (meta.formatVersion === "2") {
    try {
      wikiPacks.set(pack.id, await WikiPack.open(db, decompress));
    } catch (e: any) {
      console.warn(`[packs] ${pack.filename} failed to open:`, e?.message ?? e);
      await db.closeAsync().catch(() => {});
      return null;
    }
  }
  openPacks.set(pack.id, db);
  return db;
}

export interface WikiPackResult {
  packId: string;
  pack: WikiPack;
  hits: PackHit[];
  stems: Stem[];
}

/** Searches every installed format-2 pack (a failing pack is skipped). */
export async function searchWikiPacks(query: string, opts: PackSearchOptions = {}): Promise<WikiPackResult[]> {
  const out: WikiPackResult[] = [];
  for (const pack of await knowledgePacks()) {
    try {
      if (!(await openPack(pack))) continue;
      const wp = wikiPacks.get(pack.id);
      if (!wp) continue;
      const { hits, stems } = await wp.searchDetailed(query, opts);
      out.push({ packId: pack.id, pack: wp, hits, stems });
    } catch (e: any) {
      console.warn(`[packs] search failed in ${pack.id}:`, e?.message ?? e);
    }
  }
  return out;
}

/** Wikipedia/Wikivoyage URL of a pack article. */
export function articleUrl(title: string, source: PackHit["source"]): string {
  const host = source === "enwikivoyage" ? "en.wikivoyage.org" : "en.wikipedia.org";
  return `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

/** A format-2 pack hit in the shape the chat's retrieval uses. */
export function packHitToChunk(packId: string, h: PackHit): RetrievedChunk {
  const label = h.source === "enwikivoyage" ? "Wikivoyage" : "Wikipedia";
  return {
    chunkId: `pack:${packId}:${h.chunkId}`,
    docId: `pack:${packId}:a${h.articleId}`,
    title: h.source === "enwikivoyage" ? `Wikivoyage: ${h.title}` : h.title,
    body: h.section ? `${h.section}: ${h.text}` : h.text,
    source: `${label} — ${articleUrl(h.title, h.source)}`,
    score: h.score,
    matchType: "lexical",
  };
}

type PackRow = { id: number; title: string; body: string; vec: Uint8Array; rank: number };

/** Lexical and semantic candidates from every installed pack, scored like the built-in ones. */
export async function searchPacks(
  query: string,
  queryVec: Float32Array,
  limit: number
): Promise<{ lexical: RetrievedChunk[]; semantic: RetrievedChunk[] }> {
  const lexicalQuery = buildLexicalQuery(query);
  const lexical: RetrievedChunk[] = [];
  const semantic: RetrievedChunk[] = [];
  if (!lexicalQuery) return { lexical, semantic };

  for (const pack of await knowledgePacks()) {
    try {
      const db = await openPack(pack);
      if (!db || wikiPacks.has(pack.id)) continue;
      const rows = await db.getAllAsync<PackRow>(
        `SELECT c.id, c.title, c.body, c.vec, bm25(chunks_fts) AS rank
         FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
         WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
        [lexicalQuery.match, PACK_CANDIDATES]
      );
      const toChunk = (r: PackRow, score: number, matchType: RetrievedChunk["matchType"]): RetrievedChunk => ({
        chunkId: `pack:${pack.id}:${r.id}`,
        docId: `pack:${pack.id}:${r.title}`,
        title: r.title,
        body: r.body,
        score,
        matchType,
      });
      lexical.push(...filterByTermCoverage(rows, lexicalQuery.terms).slice(0, limit).map((r) => toChunk(r, -r.rank, "lexical")));
      const scored = rows.map((r) => toChunk(r, cosineSimilarityInt8(queryVec, r.vec), "semantic"));
      scored.sort((a, b) => b.score - a.score);
      semantic.push(...filterByMinScore(scored, MIN_SEMANTIC_SIMILARITY).slice(0, limit));
    } catch (e: any) {
      console.warn(`[packs] search failed in ${pack.id}:`, e?.message ?? e);
    }
  }
  return { lexical, semantic };
}
