/**
 * Reads what is on disk and applies decideInitialRoute: the route to open,
 * and the answer model to save as active so the chat never loads one that
 * is missing.
 */
import type { AssetStatus, ModelManager } from "../../models/ModelManager";
import { ANSWER_MODELS, MODEL_CATALOG } from "../../models/manifest";
import { listDiscoveredModels } from "../../models/discoveredModels";
import { getActiveModelId, setActiveModelId } from "../../models/settings";
import { decideInitialRoute } from "./initialRoute";

/** Same rule as ModelManager.requiredModelsPresent: on disk and complete. */
const complete = (s: AssetStatus) => s.present && (!s.asset.sizeBytes || s.sizeOnDiskBytes === s.asset.sizeBytes);

export async function initialRoute(modelManager: ModelManager): Promise<"Main" | "Setup"> {
  const [requiredPresent, answerStatuses, activeLlmId] = await Promise.all([
    modelManager.requiredModelsPresent(),
    Promise.all(ANSWER_MODELS.map((m) => modelManager.statusOf(m))),
    getActiveModelId("llm"),
  ]);
  let activeLlmPresent = false;
  if (activeLlmId) {
    const asset = [...MODEL_CATALOG, ...(await listDiscoveredModels())].find((m) => m.id === activeLlmId && m.kind === "llm");
    activeLlmPresent = !!asset && complete(await modelManager.statusOf(asset));
  }
  const decision = decideInitialRoute({
    requiredPresent,
    presentAnswerIds: answerStatuses.filter(complete).map((s) => s.asset.id),
    activeLlmId,
    activeLlmPresent,
  });
  if (decision.setActiveLlmId) await setActiveModelId("llm", decision.setActiveLlmId);
  return decision.route;
}
