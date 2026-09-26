/**
 * Which answer model a device gets when the user has not picked one (v1.1:
 * Qwen3-4B-Instruct-2507 is the default, Qwen2.5-1.5B the "Compact" option).
 *
 * The 4B is dense: every token reads all 2.5 GB of weights, so it is only a
 * good default when it can stay resident. Rule: the catalog's "default" tier
 * model if the device has more than 4.5 GB of RAM and its memory fit is
 * "resident" or "streaming"; otherwise the "compact" one. 4 GB phones
 * (iPhone 13) always get the compact model.
 *
 * Pure: the setup wizard and the answer pipeline call it with the installed
 * (or offered) models and the device RAM / fit readouts.
 */
import type { FitVerdict } from "../inference/memoryFit";

export const COMPACT_ONLY_MAX_RAM_BYTES = 4.5 * 1024 ** 3;

export interface AnswerModelCandidate {
  id: string;
  /** Catalog tier: "default" (Qwen3-4B) or "compact" (Qwen2.5-1.5B). */
  answerTier?: "default" | "compact";
  /** Memory fit on this device (estimateFit / estimateMemoryFit); undefined = unknown. */
  fit?: FitVerdict;
}

export interface DefaultModelChoice {
  id: string;
  reason: "default-tier" | "compact-low-ram" | "compact-does-not-fit" | "only-installed" | "first-installed";
}

export function pickDefaultAnswerModel(
  candidates: AnswerModelCandidate[],
  totalRamBytes: number
): DefaultModelChoice | null {
  if (!candidates.length) return null;
  const def = candidates.find((c) => c.answerTier === "default");
  const compact = candidates.find((c) => c.answerTier === "compact");
  const lowRam = totalRamBytes > 0 && totalRamBytes <= COMPACT_ONLY_MAX_RAM_BYTES;
  const fits = (c: AnswerModelCandidate) => c.fit !== "thrashing" && c.fit !== "insufficient";

  if (def && !lowRam && fits(def)) return { id: def.id, reason: "default-tier" };
  if (compact) return { id: compact.id, reason: lowRam ? "compact-low-ram" : "compact-does-not-fit" };
  if (def) return { id: def.id, reason: "only-installed" };
  return { id: candidates[0].id, reason: "first-installed" };
}
