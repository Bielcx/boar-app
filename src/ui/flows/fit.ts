/**
 * Memory fit for catalog rows, from Tusk's estimateMemoryFit. A model not
 * downloaded yet has no GGUF header to read, so the estimate runs on the
 * file size plus an expert-fraction hint for mixture-of-experts files.
 */
import type { CatalogModel } from "../../models/manifest";
import { estimateMemoryFit, MemoryFit } from "../../inference/memoryFit";

/** "-a1b", "-a3b": the active-parameter suffix mixture-of-experts files carry. */
const MOE_ID = /-a\d+(\.\d+)?b\b/i;

/** Tusk's guidance: ~0.9-0.95 of the weights are routed experts in A-suffixed MoE models. */
export function expertFractionHint(model: Pick<CatalogModel, "id">): number {
  return MOE_ID.test(model.id) ? 0.9 : 0;
}

export function catalogFit(
  model: Pick<CatalogModel, "id" | "kind" | "sizeBytes">,
  ram: { totalBytes: number; availableBytes: number },
  nCtx: number
): MemoryFit | undefined {
  if (model.kind !== "llm" || ram.totalBytes <= 0 || ram.availableBytes <= 0) return undefined;
  return estimateMemoryFit({
    fileBytes: model.sizeBytes,
    nCtx,
    shape: null,
    expertFractionHint: expertFractionHint(model),
    totalRamBytes: ram.totalBytes,
    availableRamBytes: ram.availableBytes,
  });
}
