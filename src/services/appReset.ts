import * as FileSystem from "expo-file-system/legacy";
import { llamaEngine } from "../inference/LlamaEngine";
import { embeddingEngine } from "../rag/embed";
import { closeAllPacks } from "../rag/packs";
import { resetDatabase } from "../rag/db";
import { cancelAllDownloads } from "./downloadManager";
import { clearSettings } from "../models/settings";
import { clearDiscoveredModels } from "../models/discoveredModels";
import { closeRegisteredStores, runReset } from "./resetOrder";

// Everything BOAR downloads or imports: models, knowledge packs, places packs,
// and the temp folder of an import that was interrupted.
const DATA_DIRS = ["models", "corpus", "poi", "imports"].map((d) => `${FileSystem.documentDirectory}${d}`);

/**
 * Full app data wipe ("Erase everything" in Settings). Everything persisted
 * lives in the SQLite knowledge base (chat history, all corpus/collection
 * chunks), in files under the document directory, or in small JSON files
 * (settings, the discovered-models list).
 *
 * The order is in resetOrder.ts: nothing is deleted while a download, a
 * model context or a database connection may still touch it. Closing the
 * shared database under a live query crashed natively (Prism RS-1). After
 * this call the app has no models and goes back to the setup wizard.
 */
export function resetAllAppData(): Promise<void> {
  return runReset({
    cancelDownloads: cancelAllDownloads,
    unloadEngines: async () => {
      await Promise.all([llamaEngine.unload(), embeddingEngine.unload()]);
    },
    closeStores: async () => {
      await Promise.all([closeAllPacks(), closeRegisteredStores()]);
    },
    resetDatabase,
    deleteFiles: async () => {
      for (const dir of DATA_DIRS) await FileSystem.deleteAsync(dir, { idempotent: true });
    },
    clearSettings: async () => {
      await clearSettings();
      await clearDiscoveredModels();
    },
  });
}
