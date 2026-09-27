import * as SQLite from "expo-sqlite";
import { abortAllWork } from "./cancellation";
import { guard, type Guarded } from "./guardedDb";

const DB_NAME = "aoair_knowledge.db";

let dbPromise: Promise<Guarded<SQLite.SQLiteDatabase>> | null = null;
let resetting: Promise<void> | null = null;

/**
 * Opens (and lazily creates) the local knowledge base: an FTS5 virtual table
 * for lexical search plus a parallel table of vector embeddings for semantic
 * search. Entirely local — expo-sqlite is a native binding, no network.
 *
 * The connection is guarded (src/rag/guardedDb.ts): once resetDatabase() starts, calls on it — also through a handle
 * saved earlier — reject with DbClosedError instead of reaching a closing native connection. A call during a reset
 * waits for it and gets a fresh connection.
 */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (resetting) await resetting;
  dbPromise ??= openAndMigrate().then((db) => guard(db, "knowledge base"));
  return (await dbPromise).db;
}

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * A transaction on the shared connection, run after any other one still in
 * progress. Two overlapping withTransactionAsync calls on one connection
 * fail with "cannot start a transaction within a transaction", and
 * withExclusiveTransactionAsync opens and closes a connection per call,
 * which crashed expo-sqlite natively after a few thousand inserts.
 */
export function writeTransaction(
  work: (db: SQLite.SQLiteDatabase) => Promise<void>
): Promise<void> {
  const run = writeChain.then(async () => {
    const db = await getDb();
    await db.withTransactionAsync(() => work(db));
  });
  writeChain = run.catch(() => {});
  return run;
}

/**
 * Closes and deletes the on-disk database (chat history, the whole
 * knowledge base — bundled corpus, downloaded packs, and custom imported
 * collections all live in this one file) and clears the cached connection
 * so the next getDb() call creates a fresh one. Used by appReset.ts's
 * "Clear All Data" — not called during normal operation.
 */
export function resetDatabase(): Promise<void> {
  // Two resets at once share one: the connection is closed and the file deleted once.
  resetting ??= (async () => {
    // Indexing and imports stop first; their next call on the connection rejects in JS.
    abortAllWork();
    const current = dbPromise;
    if (current) {
      const conn = await current.catch(() => null);
      // Writes queued before the reset finish (or fail) first, then the calls still running.
      await writeChain.catch(() => {});
      await conn?.close();
    }
    dbPromise = null;
    await SQLite.deleteDatabaseAsync(DB_NAME);
  })().finally(() => {
    resetting = null;
  });
  return resetting;
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_id UNINDEXED,
      doc_id UNINDEXED,
      title,
      body
    );

    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      source TEXT
    );

    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id),
      -- embedding stored as raw float32 blob for brute-force cosine search
      embedding BLOB NOT NULL,
      dim INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id),
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session
      ON chat_messages(session_id, created_at);

    -- One rating per assistant message (message_id is the primary key, not
    -- an auto-increment id) — a re-tap replaces the row via INSERT OR
    -- REPLACE rather than accumulating a history of rating changes; this
    -- app only needs "the user's current verdict on this answer," not an
    -- edit trail.
    CREATE TABLE IF NOT EXISTS answer_feedback (
      message_id TEXT PRIMARY KEY REFERENCES chat_messages(id),
      rating TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Phase 7 (docs/ADAPTIVE_ROUTING.md) — persistent, model-tagged
    -- execution telemetry, local/offline only, never transmitted. NEVER
    -- stores the user's prompt or the generated response text — this is
    -- engineering/debugging data (timing, model, task classification), not
    -- a copy of conversation history. reason_codes is a JSON-encoded
    -- string array (router.ts's RoutingPlan.reasonCodes), not a joined
    -- table, since it's small and read as a whole, never queried by
    -- individual code.
    CREATE TABLE IF NOT EXISTS execution_telemetry (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      model_id TEXT,
      task_type TEXT,
      adaptive_routing_used INTEGER NOT NULL DEFAULT 0,
      reason_codes TEXT,
      retrieval_used INTEGER,
      model_switches INTEGER,
      cross_message_model_switch INTEGER,
      model_residency TEXT,
      model_load_ms REAL,
      ttft_ms REAL,
      generation_latency_ms REAL,
      total_latency_ms REAL,
      tokens_generated INTEGER,
      tok_per_sec REAL,
      peak_rss_bytes INTEGER,
      outcome TEXT,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_execution_telemetry_created
      ON execution_telemetry(created_at DESC);

    -- User-imported document collections (Settings > Knowledge Base >
    -- Import). Chunks from the bundled/downloaded corpus have no collection
    -- (collection_id IS NULL on the chunks table below) and are always
    -- searched; chunks belonging to a collection are only searched while
    -- that collection's "active" flag is on, so the user can toggle a
    -- custom pack off without deleting it.
    CREATE TABLE IF NOT EXISTS custom_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_filename TEXT,
      doc_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `);

  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(chunks)`);
  if (!columns.some((c) => c.name === "collection_id")) {
    await db.execAsync(`ALTER TABLE chunks ADD COLUMN collection_id TEXT REFERENCES custom_collections(id)`);
  }

  return db;
}

export interface ChunkRecord {
  chunkId: string;
  docId: string;
  title: string;
  body: string;
  source?: string;
  /** Set for chunks from a user-imported collection; omitted for the bundled/downloaded corpus. */
  collectionId?: string;
}

export async function insertChunk(
  chunk: ChunkRecord,
  embedding: Float32Array
): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks (chunk_id, doc_id, title, body, source, collection_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body, chunk.source ?? null, chunk.collectionId ?? null]
    );
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks_fts (chunk_id, doc_id, title, body) VALUES (?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body]
    );
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunk_embeddings (chunk_id, embedding, dim) VALUES (?, ?, ?)`,
      [chunk.chunkId, new Uint8Array(embedding.buffer), embedding.length]
    );
  });
}

/** Deletes seed-corpus chunks (never user-imported ones) by id; ids that aren't there are ignored. */
export async function deleteSeedChunks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const marks = ids.map(() => "?").join(", ");
  const seedRows = `SELECT chunk_id FROM chunks WHERE collection_id IS NULL AND chunk_id IN (${marks})`;
  await writeTransaction(async (txn) => {
    await txn.runAsync(`DELETE FROM chunks_fts WHERE chunk_id IN (${seedRows})`, ids);
    await txn.runAsync(`DELETE FROM chunk_embeddings WHERE chunk_id IN (${seedRows})`, ids);
    await txn.runAsync(seedRows.replace("SELECT chunk_id FROM", "DELETE FROM"), ids);
  });
}

/** Deletes seed-corpus chunks whose id starts with `prefix`; returns how many. */
export async function deleteSeedChunksWithPrefix(prefix: string): Promise<number> {
  // GLOB, not LIKE: case-sensitive, and "_" in an id isn't a wildcard.
  const pattern = `${prefix.replace(/[*?[\]]/g, "")}*`;
  const seedRows = `SELECT chunk_id FROM chunks WHERE collection_id IS NULL AND chunk_id GLOB ?`;
  let removed = 0;
  await writeTransaction(async (txn) => {
    await txn.runAsync(`DELETE FROM chunks_fts WHERE chunk_id IN (${seedRows})`, [pattern]);
    await txn.runAsync(`DELETE FROM chunk_embeddings WHERE chunk_id IN (${seedRows})`, [pattern]);
    const r = await txn.runAsync(seedRows.replace("SELECT chunk_id FROM", "DELETE FROM"), [pattern]);
    removed = r.changes;
  });
  return removed;
}

export interface CustomCollection {
  id: string;
  name: string;
  sourceFilename: string | null;
  docCount: number;
  chunkCount: number;
  sizeBytes: number;
  active: boolean;
  createdAt: number;
}

export async function listCustomCollections(): Promise<CustomCollection[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    source_filename: string | null;
    doc_count: number;
    chunk_count: number;
    size_bytes: number;
    active: number;
    created_at: number;
  }>(`SELECT * FROM custom_collections ORDER BY created_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sourceFilename: r.source_filename,
    docCount: r.doc_count,
    chunkCount: r.chunk_count,
    sizeBytes: r.size_bytes,
    active: r.active === 1,
    createdAt: r.created_at,
  }));
}

export async function createCustomCollection(
  collection: Omit<CustomCollection, "active" | "createdAt">
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO custom_collections (id, name, source_filename, doc_count, chunk_count, size_bytes, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      collection.id,
      collection.name,
      collection.sourceFilename,
      collection.docCount,
      collection.chunkCount,
      collection.sizeBytes,
      Date.now(),
    ]
  );
}

export async function setCustomCollectionActive(id: string, active: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE custom_collections SET active = ? WHERE id = ?`, [active ? 1 : 0, id]);
}

export async function deleteCustomCollection(id: string): Promise<void> {
  // Embeddings reference chunks, so they go first; chunks_fts has no index on
  // chunk_id, so it's cleared in one pass instead of one scan per chunk.
  const rows = `SELECT chunk_id FROM chunks WHERE collection_id = ?`;
  await writeTransaction(async (txn) => {
    await txn.runAsync(`DELETE FROM chunk_embeddings WHERE chunk_id IN (${rows})`, [id]);
    await txn.runAsync(`DELETE FROM chunks_fts WHERE chunk_id IN (${rows})`, [id]);
    await txn.runAsync(`DELETE FROM chunks WHERE collection_id = ?`, [id]);
    await txn.runAsync(`DELETE FROM custom_collections WHERE id = ?`, [id]);
  });
}

export async function getCollectionDocs(
  id: string
): Promise<Array<{ title: string; source: string; body: string }>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ title: string; body: string; source: string | null }>(
    `SELECT DISTINCT title, body, source FROM chunks WHERE collection_id = ? ORDER BY chunk_id`,
    [id]
  );
  return rows.map((r) => ({ title: r.title, body: r.body, source: r.source ?? "" }));
}
