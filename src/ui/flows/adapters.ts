/**
 * The seams where the flow screens meet work still on other branches.
 * Each function has one interim body built on what main has today; swap
 * the body when the branch is integrated, and no screen changes.
 *
 * - Memory fit: estimateMemoryFit / llamaEngine.estimateFit (feat/engine-routing).
 *   Interim: the file-size heuristic in compatibility.ts. It never reports
 *   "insufficient", because only the real estimate may block a model.
 * - Pack removal: removeCorpusPackIndex (feat/knowledge). Interim: closes a
 *   sqlite pack; indexed chunks of a JSON pack stay until that lands.
 */
import type { CatalogModel } from "../../models/manifest";
import { computeCompatibility } from "../../models/compatibility";
import { closePack } from "../../rag/packs";
import type { FitVerdict } from "./modelRowState";

export function fitFor(model: CatalogModel, deviceRamBytes: number): FitVerdict | undefined {
  if (model.kind !== "llm") return undefined;
  const compat = computeCompatibility(model.sizeBytes, deviceRamBytes);
  if (compat === "green") return "resident";
  if (compat === "red") return "thrashing";
  return undefined;
}

export async function removePackIndex(model: CatalogModel): Promise<void> {
  if (model.format === "sqlite-pack") await closePack(model.id);
}
