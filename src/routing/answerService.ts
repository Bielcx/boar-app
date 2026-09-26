/**
 * The layered answer pipeline wired to the real engine, retrieval and
 * settings. This is what the chat UI imports:
 *
 *   const h = answer({ query }, onEvent, { systemPrompt, styleReminder, history, maxTokens });
 *   h.stop(); await h.done;
 *   deepen(query, previousSources, onEvent, ctx);
 *
 * See src/routing/events.ts for the event contract and
 * docs/ADAPTIVE_ROUTING.md for the routing rules.
 */
import { defaultContextSize, llamaEngine } from "../inference/LlamaEngine";
import { retrieve } from "../rag/retrieve";
import { assemblePrompt, assembleChatMessages } from "../rag/pure";
import { ModelManager } from "../models/ModelManager";
import { MODEL_CATALOG } from "../models/manifest";
import { listDiscoveredModels } from "../models/discoveredModels";
import { getActiveModelId, getAnswerSettings } from "../models/settings";
import { runDeepResearch } from "../services/orchestrator";
import { createAnswerer, InstalledLlm } from "./answer";

async function listInstalledLlms(): Promise<InstalledLlm[]> {
  // Models picked from the Hugging Face browser live in discoveredModels, not MODEL_CATALOG.
  const catalog = [...MODEL_CATALOG, ...(await listDiscoveredModels().catch(() => []))].filter((m) => m.kind === "llm");
  const statuses = await new ModelManager(catalog).statusAll();
  return statuses
    .filter((s) => s.present)
    .map((s) => ({
      id: s.asset.id,
      label: s.asset.label,
      filename: s.asset.filename,
      sizeBytes: s.asset.sizeBytes,
      roles: s.asset.capabilities?.roles ?? [],
      isDefault: s.asset.required,
    }));
}

export const { answer, deepen } = createAnswerer({
  engine: llamaEngine,
  retrieve: (q, k) => retrieve(q, k),
  getSettings: getAnswerSettings,
  listInstalledLlms,
  getActiveModelId: () => getActiveModelId("llm"),
  runMultipass: runDeepResearch,
  assemblePrompt,
  assembleChatMessages,
  now: () => performance.now(),
  contextSize: defaultContextSize,
});
