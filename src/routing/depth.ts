/**
 * Depth routing: decides HOW DEEP to answer, never WHICH model writes the
 * normal answer. Replaces the role-based router for ordinary chat
 * (router.ts kept for the evaluation harness).
 *
 * Why: the old router picked "the model for this task type" among installed
 * models. On a default install (one LLM) that was a no-op, and once a user
 * installed and picked a second model ("Use"), routing silently answered most
 * questions with the curated 1.5B instead (docs/ADAPTIVE_ROUTING.md, C1).
 *
 * Tiers:
 *   instant — best source sentence, no LLM (<1s). A preview, or the final
 *             answer to a confident lookup.
 *   fast    — the user's chosen model over compressed sources (~1.2k tokens).
 *   deep    — the "complete answer": the deep model (large MoE) in one pass
 *             over more sources when one is installed and fits; otherwise a
 *             multi-pass decompose → research → synthesize run on the fast
 *             model. Plus verification when a distinct verifier is installed.
 *
 * Pure and deterministic, like router.ts: same inputs, same plan.
 */
import { isRetrievalIrrelevant } from "./classify";
import type { FitVerdict } from "../inference/memoryFit";
import type { AnswerTier } from "./events";
import type { ModelRole, TaskType } from "./types";

export interface DepthModel {
  id: string;
  label: string;
  sizeBytes: number;
  roles: ModelRole[];
  /** From estimateFit; undefined when unknown (treated as usable). */
  fit?: FitVerdict;
}

export interface DepthInput {
  taskType: TaskType;
  requestedTier: "auto" | "fast" | "deep";
  quickFirst: boolean;
  alwaysComplete: boolean;
  /** The model the user picked. Always writes the fast answer. */
  fastModel: DepthModel | null;
  /** Resolved with resolveDeepModel; null when none is installed/usable. */
  deepModel: DepthModel | null;
  /** Installed models that could verify (role "verifier"). */
  verifiers: DepthModel[];
  /** deepen(): sources already retrieved by the answer being deepened. */
  hasReusedSources: boolean;
}

export type InstantMode = "off" | "preview" | "may-finish";

export interface GenerationPlan {
  tier: Exclude<AnswerTier, "instant">;
  modelId: string;
  /** single = one generation; multipass = decompose → per-sub-question → synthesize (orchestrator.ts). */
  mode: "single" | "multipass";
  /** How many chunks to retrieve before compression. */
  retrieveK: number;
  /** Token budget for the compressed context. */
  contextTokens: number;
}

export interface AnswerPlan {
  retrieve: boolean;
  instant: InstantMode;
  generation: GenerationPlan | null;
  verify: { modelId: string } | null;
  /** Emit deep_available after the fast answer. */
  offerDeep: boolean;
  reasonCodes: string[];
}

export const FAST_RETRIEVE_K = 6;
export const FAST_CONTEXT_TOKENS = 1200;
export const DEEP_RETRIEVE_K = 10;
export const DEEP_CONTEXT_TOKENS = 2400;

const usable = (m: DepthModel | null | undefined): m is DepthModel =>
  !!m && m.fit !== "insufficient" && m.fit !== "thrashing";

/**
 * The deep model: the user's explicit choice when installed, else the largest
 * installed LLM curated for "reasoning" — in both cases only if it differs
 * from the fast model and fits (a dense model that would re-read its weights
 * from storage every token is not a usable deep tier). null = explicitly none.
 */
export function resolveDeepModel(
  installed: DepthModel[],
  fastModelId: string | undefined,
  explicitId: string | null | undefined
): DepthModel | null {
  if (explicitId === null) return null;
  const candidates = installed.filter((m) => m.id !== fastModelId && usable(m));
  if (explicitId) return candidates.find((m) => m.id === explicitId) ?? null;
  return (
    candidates
      .filter((m) => m.roles.includes("reasoning"))
      .sort((a, b) => b.sizeBytes - a.sizeBytes)[0] ?? null
  );
}

export function planAnswer(i: DepthInput): AnswerPlan {
  const reasonCodes: string[] = [];
  const retrievalIrrelevant = isRetrievalIrrelevant(i.taskType);
  const retrieve = !retrievalIrrelevant && !i.hasReusedSources;
  reasonCodes.push(
    retrievalIrrelevant ? "retrieve:skipped-task-not-knowledge-based" : i.hasReusedSources ? "retrieve:reusing-sources" : "retrieve:yes"
  );

  const complete = i.requestedTier === "deep" || (i.requestedTier === "auto" && i.alwaysComplete);
  if (complete) reasonCodes.push(i.requestedTier === "deep" ? "depth:deep-requested" : "depth:always-complete");

  // Instant: only as the first layer of an automatic answer, and only when
  // there are sources to quote. It may stand as the whole answer only for a
  // lookup when the user did not ask for complete answers.
  let instant: InstantMode = "off";
  if (i.requestedTier === "auto" && i.quickFirst && !retrievalIrrelevant) {
    instant = !complete && i.taskType === "lookup" ? "may-finish" : "preview";
  }
  reasonCodes.push(`instant:${instant}`);

  let generation: GenerationPlan | null = null;
  if (complete && usable(i.deepModel)) {
    generation = { tier: "deep", modelId: i.deepModel.id, mode: "single", retrieveK: DEEP_RETRIEVE_K, contextTokens: DEEP_CONTEXT_TOKENS };
    reasonCodes.push(`generate:deep-model-${i.deepModel.id}`);
  } else if (complete && i.fastModel) {
    // No deep model: go deeper with the same model instead (several focused passes).
    generation = {
      tier: "deep",
      modelId: i.fastModel.id,
      mode: retrievalIrrelevant ? "single" : "multipass",
      retrieveK: FAST_RETRIEVE_K,
      contextTokens: FAST_CONTEXT_TOKENS,
    };
    reasonCodes.push(`generate:no-deep-model-${generation.mode}-on-${i.fastModel.id}`);
  } else if (i.fastModel) {
    generation = { tier: "fast", modelId: i.fastModel.id, mode: "single", retrieveK: FAST_RETRIEVE_K, contextTokens: FAST_CONTEXT_TOKENS };
    reasonCodes.push(`generate:user-model-${i.fastModel.id}`);
  } else {
    reasonCodes.push("generate:no-model");
  }

  // Verification: part of the complete answer, with evidence to check
  // against, by a model other than the author (self-grading is not a check).
  let verify: AnswerPlan["verify"] = null;
  if (complete && generation && (retrieve || i.hasReusedSources)) {
    const v = i.verifiers.find((m) => m.id !== generation!.modelId && usable(m));
    if (v) {
      verify = { modelId: v.id };
      reasonCodes.push(`verify:${v.id}`);
    } else {
      reasonCodes.push("verify:skipped-no-distinct-verifier");
    }
  }

  const offerDeep =
    !complete && generation?.tier === "fast" && i.taskType !== "greeting" && !retrievalIrrelevant;
  if (offerDeep) reasonCodes.push(usable(i.deepModel) ? "offer-deep:deep-model" : "offer-deep:multipass");

  return { retrieve, instant, generation, verify, offerDeep, reasonCodes };
}
