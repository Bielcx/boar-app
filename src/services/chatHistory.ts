import { getDb, writeTransaction } from "../rag/db";

export interface ChatSession {
  id: string;
  title: string;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  /** null = no rating given. Present so reopening a past session restores previously-given thumbs. */
  feedback: "up" | "down" | null;
  /** JSON the chat stores with an answer (sources, receipt, outcome); null for older messages and user turns. */
  meta: string | null;
}

// Sources and receipt of each answer, kept apart from chat_messages so the
// shared schema in src/rag/db.ts stays untouched. Created on first use.
let metaTableReady: Promise<void> | null = null;
function ensureMetaTable(): Promise<void> {
  metaTableReady ??= getDb()
    .then((db) =>
      db.execAsync(
        `CREATE TABLE IF NOT EXISTS chat_message_meta (
           message_id TEXT PRIMARY KEY REFERENCES chat_messages(id),
           meta TEXT NOT NULL
         )`
      )
    )
    .catch((e) => {
      metaTableReady = null;
      throw e;
    });
  return metaTableReady;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createSession(title = "New chat"): Promise<ChatSession> {
  const db = await getDb();
  const now = Date.now();
  const session: ChatSession = { id: newId(), title, summary: null, createdAt: now, updatedAt: now };
  await db.runAsync(
    `INSERT INTO chat_sessions (id, title, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [session.id, session.title, session.summary, session.createdAt, session.updatedAt]
  );
  return session;
}

export async function listSessions(): Promise<ChatSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    summary: string | null;
    created_at: number;
    updated_at: number;
  }>(`SELECT id, title, summary, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
  await ensureMetaTable();
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    session_id: string;
    role: "user" | "assistant";
    text: string;
    created_at: number;
    rating: "up" | "down" | null;
    meta: string | null;
  }>(
    `SELECT m.id, m.session_id, m.role, m.text, m.created_at, f.rating, x.meta
     FROM chat_messages m
     LEFT JOIN answer_feedback f ON f.message_id = m.id
     LEFT JOIN chat_message_meta x ON x.message_id = m.id
     WHERE m.session_id = ? ORDER BY m.created_at ASC`,
    [sessionId]
  );
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    text: r.text,
    createdAt: r.created_at,
    feedback: r.rating,
    meta: r.meta ?? null,
  }));
}

/** Stores (or replaces) the chat's JSON for an answer. */
export async function setMessageMeta(messageId: string, meta: string): Promise<void> {
  await ensureMetaTable();
  const db = await getDb();
  await db.runAsync(`INSERT OR REPLACE INTO chat_message_meta (message_id, meta) VALUES (?, ?)`, [messageId, meta]);
}

/**
 * `id` is optional and defaults to a freshly generated one, but ChatScreen
 * always passes its own in-memory message id explicitly (the same one used
 * as the FlatList key / React state id) — so a thumbs-up/down tap can
 * reference `item.id` directly as `setMessageFeedback`'s foreign key,
 * rather than needing a separate id-mapping step.
 */
export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  text: string,
  id: string = newId()
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO chat_messages (id, session_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, sessionId, role, text, now]
  );
  await db.runAsync(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`, [now, sessionId]);
}

/** `rating: null` clears any existing feedback (tapping the same thumb again to un-rate). */
export async function setMessageFeedback(messageId: string, rating: "up" | "down" | null): Promise<void> {
  const db = await getDb();
  if (rating === null) {
    await db.runAsync(`DELETE FROM answer_feedback WHERE message_id = ?`, [messageId]);
    return;
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO answer_feedback (message_id, rating, created_at) VALUES (?, ?, ?)`,
    [messageId, rating, Date.now()]
  );
}

export async function setSessionTitle(sessionId: string, title: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE chat_sessions SET title = ? WHERE id = ?`, [title, sessionId]);
}

export async function setSessionSummary(sessionId: string, summary: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE chat_sessions SET summary = ? WHERE id = ?`, [summary, sessionId]);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await ensureMetaTable();
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `DELETE FROM chat_message_meta WHERE message_id IN (SELECT id FROM chat_messages WHERE session_id = ?)`,
      [sessionId]
    );
    await txn.runAsync(
      `DELETE FROM answer_feedback WHERE message_id IN (SELECT id FROM chat_messages WHERE session_id = ?)`,
      [sessionId]
    );
    await txn.runAsync(`DELETE FROM chat_messages WHERE session_id = ?`, [sessionId]);
    await txn.runAsync(`DELETE FROM chat_sessions WHERE id = ?`, [sessionId]);
  });
}

export async function clearAllHistory(): Promise<void> {
  await ensureMetaTable();
  await writeTransaction(async (txn) => {
    await txn.runAsync(`DELETE FROM chat_message_meta`);
    await txn.runAsync(`DELETE FROM answer_feedback`);
    await txn.runAsync(`DELETE FROM chat_messages`);
    await txn.runAsync(`DELETE FROM chat_sessions`);
  });
}

/** Deletes the oldest sessions beyond `maxSessions` (0 = unlimited). */
export async function pruneSessions(maxSessions: number): Promise<void> {
  if (maxSessions <= 0) return;
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM chat_sessions ORDER BY updated_at DESC LIMIT -1 OFFSET ?`,
    [maxSessions]
  );
  for (const row of rows) {
    await deleteSession(row.id);
  }
}
