import type { RetrievedChunk } from "../../rag/retrieve.types";
import type { AnswerOutcome, AnswerReceipt } from "./answerEvents";
import type { AnswerState, TierState } from "./answerReducer";

/** What the chat keeps with an answer so a reopened session shows it as it was. */
interface StoredTier {
  text: string;
  outcome?: AnswerOutcome;
  receipt?: AnswerReceipt;
  errorCode?: string;
}

export interface StoredAnswer {
  v: 1;
  sources: Pick<RetrievedChunk, "chunkId" | "docId" | "title" | "body" | "source" | "collectionId">[];
  instant?: { text: string; sourceIndex: number };
  extractiveReceipt?: AnswerReceipt;
  fast?: StoredTier;
  deep?: StoredTier;
}

function storeTier(t: TierState | undefined): StoredTier | undefined {
  if (!t) return undefined;
  return { text: t.text, outcome: t.outcome, receipt: t.receipt, errorCode: t.error?.code };
}

function restoreTier(t: StoredTier | undefined): TierState | undefined {
  if (!t) return undefined;
  // An answer saved mid-flight (app killed) reads as interrupted, never as still running.
  return {
    text: t.text,
    stage: null,
    outcome: t.outcome ?? "interrupted",
    receipt: t.receipt,
    error: t.errorCode ? { code: t.errorCode as NonNullable<TierState["error"]>["code"], message: "" } : undefined,
  };
}

export function toStoredAnswer(state: AnswerState): string {
  const stored: StoredAnswer = {
    v: 1,
    sources: state.sources.map(({ chunkId, docId, title, body, source, collectionId }) => ({
      chunkId,
      docId,
      title,
      body,
      source,
      collectionId,
    })),
    instant: state.instant ? { text: state.instant.text, sourceIndex: state.instant.sourceIndex } : undefined,
    extractiveReceipt: state.extractiveReceipt,
    fast: storeTier(state.fast),
    deep: storeTier(state.deep),
  };
  return JSON.stringify(stored);
}

/**
 * Rebuilds a finished answer. `text` is the message's stored text, used when
 * there is no meta (messages saved before sources were kept).
 */
export function fromStoredAnswer(id: string, text: string, meta: string | null): AnswerState {
  let stored: StoredAnswer | null = null;
  if (meta) {
    try {
      const parsed = JSON.parse(meta);
      if (parsed?.v === 1) stored = parsed;
    } catch {
      // Unreadable meta: fall back to the plain text below.
    }
  }
  if (!stored) {
    return { answerIds: [id], sources: [], fast: { text, stage: null, outcome: "success" } };
  }
  return {
    answerIds: [id],
    sources: stored.sources.map((s) => ({ ...s, score: 0, matchType: "hybrid" as const })),
    instant: stored.instant ? { ...stored.instant, confidence: 1 } : undefined,
    extractiveReceipt: stored.extractiveReceipt,
    fast: restoreTier(stored.fast),
    deep: restoreTier(stored.deep),
  };
}

/** The text a later turn sees as this answer: the deepest finished pass, else the snippet. */
export function answerTextForHistory(state: AnswerState): string {
  if (state.deep?.text) return state.deep.text;
  if (state.fast?.text) return state.fast.text;
  return state.instant?.text ?? "";
}
