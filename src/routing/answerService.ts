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
import { getDeviceTotalRamBytes } from "ram-monitor";
import { retrieve } from "../rag/retrieve";
import { assemblePrompt, assembleChatMessages } from "../rag/pure";
import { ModelManager } from "../models/ModelManager";
import { MODEL_CATALOG } from "../models/manifest";
import { listDiscoveredModels } from "../models/discoveredModels";
import { getActiveModelId, getAnswerSettings } from "../models/settings";
import { runDeepResearch } from "../services/orchestrator";
import { createAnswerer, InstalledLlm } from "./answer";
import { measuredSpeeds } from "./depth";
import { listRecentExecutions } from "../services/executionTelemetry";
import type { GeoProviders } from "./geo";

let geoProviders: GeoProviders | null = null;

/**
 * Plugs in offline places: the POI pack (src/rag/pois.ts: resolvePlace,
 * searchPois) and device location (src/services/location.ts, which must not
 * prompt for permission). Called once by the app shell when both exist;
 * until then places questions answer "places pack not installed".
 */
export function registerGeoProviders(p: GeoProviders | null): void {
  geoProviders = p;
}

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
      // Catalog field added with the Qwen3-4B default (trust branch); absent on older catalogs.
      answerTier: (s.asset as { answerTier?: "default" | "compact" }).answerTier,
    }));
}

export const { answer, deepen, effectiveModel: effectiveAnswerModel } = createAnswerer({
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
  deviceRamBytes: () => {
    try {
      return getDeviceTotalRamBytes();
    } catch {
      return 0;
    }
  },
  getGeoProviders: () => geoProviders,
  getModelSpeeds: async () => measuredSpeeds(await listRecentExecutions(500)),
});
