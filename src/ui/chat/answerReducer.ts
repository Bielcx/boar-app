import type { RetrievedChunk } from "../../rag/retrieve.types";
import {
  type AnswerErrorCode,
  type AnswerEvent,
  type AnswerOutcome as Outcome,
  type AnswerReceipt as Receipt,
  type AnswerStageName as Stage,
  type StageDetail,
} from "./answerEvents";

type PlacesEvent = Extract<AnswerEvent, { type: "places" }>;
export type PlacesResult = Omit<PlacesEvent, "type" | "answerId" | "tier">;
export type LocationStatus = Extract<AnswerEvent, { type: "location" }>["status"];

/** One model pass (fast or deep) inside an answer. */
export interface TierState {
  text: string;
  stage: Stage | null;
  detail?: StageDetail;
  outcome?: Outcome;
  receipt?: Receipt;
  error?: { code: AnswerErrorCode; message: string };
}

/** Everything the chat shows for one assistant message. */
export interface AnswerState {
  /** answer() calls whose events land here: the first answer, then a Deepen on the same message. */
  answerIds: string[];
  /** Global, deduplicated list: "[n]" in any tier's text is sources[n - 1]. */
  sources: RetrievedChunk[];
  instant?: { text: string; sourceIndex: number; confidence: number };
  fast?: TierState;
  deep?: TierState;
  /**
   * The instant tier finished: the source passage (receipt.modelId
   * "extractive") or the places list ("places") was the whole answer, no model ran.
   */
  instantDone?: { outcome: Outcome; receipt: Receipt; error?: { code: AnswerErrorCode; message: string } };
  /** A places answer: the list and how it was chosen, exactly as the engine sent it. */
  places?: PlacesResult;
  /** Device location lookup for a "near me" question. */
  location?: { status: LocationStatus; accuracyM?: number; ageS?: number };
  deepAvailable?: { estSeconds?: number; reason?: string };
  /** The model's weights stream from storage: answers will be slower than usual. */
  streamsFromStorage?: boolean;
}

export function initialAnswer(answerId: string): AnswerState {
  return { answerIds: [answerId], sources: [] };
}

/** Routes a follow-up answer() (Deepen) into this message. */
export function attachAnswer(state: AnswerState, answerId: string): AnswerState {
  return state.answerIds.includes(answerId) ? state : { ...state, answerIds: [...state.answerIds, answerId] };
}

function mergeSources(current: RetrievedChunk[], incoming: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set(current.map((c) => c.chunkId));
  const added = incoming.filter((c) => !seen.has(c.chunkId) && seen.add(c.chunkId));
  return added.length > 0 ? [...current, ...added] : current;
}

function updateTier(state: AnswerState, tier: "fast" | "deep", patch: (t: TierState) => TierState): AnswerState {
  const current = state[tier] ?? { text: "", stage: null };
  return { ...state, [tier]: patch(current) };
}

/**
 * Folds engine events into the state of one answer. Events for another
 * answer (a stopped or replaced one still flushing) are ignored, and
 * nothing changes a tier after its "done".
 */
export function answerReducer(state: AnswerState, event: AnswerEvent): AnswerState {
  if (!state.answerIds.includes(event.answerId)) return state;

  switch (event.type) {
    case "sources":
      return { ...state, sources: mergeSources(state.sources, event.sources) };

    case "instant":
      return { ...state, instant: { ...event.snippet, confidence: event.confidence } };

    case "deep_available":
      return { ...state, deepAvailable: { estSeconds: event.estSeconds, reason: event.reason } };

    case "places": {
      const { type: _type, answerId: _id, tier: _tier, ...result } = event;
      return { ...state, places: result };
    }

    case "location":
      return { ...state, location: { status: event.status, accuracyM: event.accuracyM, ageS: event.ageS } };

    case "warning":
      return event.code === "model_streams_from_storage" ? { ...state, streamsFromStorage: true } : state;

    case "stage":
      if (event.tier === "instant" || state[event.tier]?.outcome) return state;
      return updateTier(state, event.tier, (t) => ({ ...t, stage: event.stage, detail: event.detail }));

    case "token":
      if (event.tier === "instant" || state[event.tier]?.outcome) return state;
      return updateTier(state, event.tier, (t) => ({ ...t, stage: "generating", text: t.text + event.text }));

    case "done":
      if (event.tier === "instant") {
        if (state.instantDone) return state;
        return { ...state, instantDone: { outcome: event.outcome, receipt: event.receipt, error: event.error } };
      }
      if (state[event.tier]?.outcome) return state;
      return updateTier(state, event.tier, (t) => ({
        ...t,
        stage: null,
        outcome: event.outcome,
        receipt: event.receipt,
        error: event.error,
      }));
  }
}

/** What the answer is doing right now, for the stage indicator and announcements. */
export type AnswerPhase =
  | "searching"
  /** Waiting for the device's position for a "near me" question (up to ~10 s); a city can be typed meanwhile. */
  | "locating"
  | "loading_model"
  | "reading"
  | "generating"
  | "verifying"
  | "synthesizing"
  | "done"
  | "stopped"
  | "timeout"
  | "interrupted"
  | "error";

const STAGE_PHASE: Record<Stage, AnswerPhase> = {
  retrieving: "searching",
  loading_model: "loading_model",
  prefill: "reading",
  generating: "generating",
  verifying: "verifying",
  synthesizing: "synthesizing",
};

function tierPhase(t: TierState): AnswerPhase {
  if (t.outcome) return t.outcome === "success" ? "done" : t.outcome;
  return t.stage ? STAGE_PHASE[t.stage] : "searching";
}

/** The deep pass wins while it exists; otherwise the fast one; an extractive-only answer is done. */
/**
 * The engine is waiting for a GPS fix (location status "locating", Boar GPS-1) and
 * has not listed anything yet. Read as a string until the engine's status union has it.
 */
export function isLocating(state: AnswerState): boolean {
  return (state.location?.status as string | undefined) === "locating" && !state.places;
}

export function answerPhase(state: AnswerState): AnswerPhase {
  if (isLocating(state)) return "locating";
  if (state.deep) return tierPhase(state.deep);
  if (state.fast) return tierPhase(state.fast);
  if (state.instantDone) return state.instantDone.outcome === "success" ? "done" : state.instantDone.outcome;
  return "searching";
}

export function isAnswerActive(state: AnswerState): boolean {
  const phase = answerPhase(state);
  return !["done", "stopped", "timeout", "interrupted", "error"].includes(phase);
}

/** The Deepen button shows only after a successful fast pass, when the engine offered it. */
export function canDeepen(state: AnswerState): boolean {
  return !!state.deepAvailable && state.fast?.outcome === "success" && !state.deep;
}
