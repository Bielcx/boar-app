/**
 * Shared catalog state for Models, Knowledge and Setup: what is on disk,
 * what is downloading, which model fills which role, and the device limits.
 * Each screen renders rows from this instead of keeping its own copy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { getDeviceTotalRamBytes } from "ram-monitor";
import { AssetStatus, ModelManager } from "../../models/ModelManager";
import { CatalogModel, MODEL_CATALOG } from "../../models/manifest";
import { getActiveModelId, setActiveModelId } from "../../models/settings";
import { listDiscoveredModels, removeDiscoveredModel } from "../../models/discoveredModels";
import { getDownloadState, importAssetFile, startDownload, subscribeDownloads } from "../../services/downloadManager";
import * as DocumentPicker from "expo-document-picker";
import { AssetIntegrityError, isAbortError } from "../../models/integrity";
import { llamaEngine } from "../../inference/LlamaEngine";
import { networkAllowed } from "../../config/variant";
import { fitFor, poiCatalogEntry, poiRegions, removePackIndex, topicPacks, worldPlacesEntry } from "./adapters";
import type { MemoryFit } from "../../inference/memoryFit";
import { ModelRole, modelRowView, RowView } from "./modelRowState";
import { answerModelChoices } from "./packages";
import { FileImport, importFor } from "./fileImport";
export type { FileImport };

export const modelManager = new ModelManager();

/** One picked file on its way in (offline build, or "import a file"). */

/** Downloadable only with network and a published URL; everything else comes in as a file. */
export function canDownload(model: Pick<CatalogModel, "sourceUrl">): boolean {
  return networkAllowed() && !!model.sourceUrl;
}

export interface CatalogState {
  loaded: boolean;
  discovered: CatalogModel[];
  statuses: Record<string, AssetStatus>;
  activeLlmId?: string;
  activeEmbeddingId?: string;
  deviceRamBytes: number;
  freeBytes: number;
  usedBytes: number;
  /** Id of the model being loaded after "Use". */
  loadingId: string | null;
  loadErrors: Record<string, string>;
  view: (model: CatalogModel) => RowView;
  fit: (model: CatalogModel) => MemoryFit | undefined;
  refresh: () => Promise<void>;
  download: (model: CatalogModel) => Promise<void>;
  remove: (model: CatalogModel) => Promise<void>;
  use: (model: CatalogModel) => Promise<boolean>;
  imports: FileImport[];
  /** Opens the system file picker and imports each chosen file. A cancelled picker does nothing. */
  importFiles: () => Promise<void>;
  /** The file a row asked for, while it matters: being checked, refused, or matched to another item. */
  importFor: (id: string) => FileImport | undefined;
  /** Downloads what can be downloaded; opens the file picker when any item must be imported. */
  install: (models: CatalogModel[]) => Promise<void>;
  /** Stops the import in progress; the cancelled file leaves the list without an error. */
  cancelImports: () => void;
}

/** With no saved choice: the manifest's standard answer model, and the required search model. */
function defaultId(kind: "llm" | "embedding"): string | undefined {
  if (kind === "llm") return answerModelChoices(MODEL_CATALOG).default?.id;
  return MODEL_CATALOG.find((m) => m.kind === kind && m.required)?.id;
}

export function useCatalog(): CatalogState {
  const [loaded, setLoaded] = useState(false);
  const [discovered, setDiscovered] = useState<CatalogModel[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AssetStatus>>({});
  const [activeLlmId, setActiveLlmId] = useState<string>();
  const [activeEmbeddingId, setActiveEmbeddingId] = useState<string>();
  const [freeBytes, setFreeBytes] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);
  const deviceRamBytes = useMemo(() => {
    try {
      return getDeviceTotalRamBytes();
    } catch {
      return 0;
    }
  }, []);

  const refresh = useCallback(async () => {
    const found = await listDiscoveredModels();
    const extra = [...found, ...poiRegions().map(poiCatalogEntry), worldPlacesEntry(), ...topicPacks().map((p) => p.entry)];
    const all = [...(await modelManager.statusAll()), ...(await Promise.all(extra.map((m) => modelManager.statusOf(m))))];
    setDiscovered(found);
    setStatuses(Object.fromEntries(all.map((s) => [s.asset.id, s])));
    setActiveLlmId((await getActiveModelId("llm")) ?? defaultId("llm"));
    setActiveEmbeddingId((await getActiveModelId("embedding")) ?? defaultId("embedding"));
    try {
      setFreeBytes(await FileSystem.getFreeDiskStorageAsync());
    } catch {
      setFreeBytes(0);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => subscribeDownloads(() => setTick((n) => n + 1)), []);

  const view = useCallback(
    (model: CatalogModel) => {
      const status = statuses[model.id];
      const roles: ModelRole[] = [];
      if (model.id === activeLlmId) roles.push("answer");
      if (model.id === activeEmbeddingId) roles.push("search");
      return modelRowView({
        present: status?.present ?? false,
        checksumOk: status?.checksumOk,
        download: getDownloadState(model.id),
        roles: model.kind === "corpus" ? [] : roles,
        loading: loadingId === model.id,
        loadError: loadErrors[model.id] ?? null,
        fit: fitFor(model)?.verdict,
      });
    },
    // getDownloadState reads module state; the tick re-renders on each change.
    [statuses, activeLlmId, activeEmbeddingId, loadingId, loadErrors, deviceRamBytes]
  );

  const download = useCallback(
    async (model: CatalogModel) => {
      setLoadErrors(({ [model.id]: _, ...rest }) => rest);
      await startDownload(model);
      await refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (model: CatalogModel) => {
      await removePackIndex(model);
      await modelManager.deleteModel(model);
      if (model.id.startsWith("hf-")) await removeDiscoveredModel(model.id);
      await refresh();
    },
    [refresh]
  );

  /** Loads first and saves after: an OOM kill mid-load must not leave the model active. */
  const use = useCallback(
    async (model: CatalogModel) => {
      if (loadingId) return false;
      if (model.kind !== "llm") {
        await setActiveModelId(model.kind, model.id);
        await refresh();
        return true;
      }
      setLoadingId(model.id);
      try {
        await llamaEngine.load(model.filename);
        await setActiveModelId("llm", model.id);
        setLoadErrors(({ [model.id]: _, ...rest }) => rest);
        return true;
      } catch (e: any) {
        setLoadErrors((prev) => ({ ...prev, [model.id]: e?.message ?? String(e) }));
        return false;
      } finally {
        setLoadingId(null);
        await refresh();
      }
    },
    [loadingId, refresh]
  );

  const [imports, setImports] = useState<FileImport[]>([]);
  const importAbort = useRef<AbortController | null>(null);
  const cancelImports = useCallback(() => importAbort.current?.abort(), []);
  const pickAndImport = useCallback(async (forIds?: string[]) => {
    const picked = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: false, type: "*/*" });
    if (picked.canceled || picked.assets.length === 0) return;
    const files = picked.assets;
    const patch = (name: string, next: Partial<FileImport>) =>
      setImports((prev) => prev.map((f) => (f.name === name ? { ...f, ...next } : f)));
    setImports((prev) => [
      ...prev.filter((f) => !files.some((p) => p.name === f.name)),
      ...files.map((f) => ({ name: f.name, status: "importing" as const, progress: 0, forIds })),
    ]);
    const controller = new AbortController();
    importAbort.current = controller;
    // One at a time: each file is hashed in full.
    for (const file of files) {
      if (controller.signal.aborted) {
        setImports((prev) => prev.filter((f) => f.name !== file.name));
        continue;
      }
      try {
        const asset = await importAssetFile(
          file.uri,
          (done, total) => patch(file.name, { progress: total > 0 ? done / total : 0 }),
          controller.signal
        );
        patch(file.name, { status: "verified", progress: 1, assetId: asset.id });
      } catch (e: any) {
        // Cancelled by the user: the file just leaves the list.
        if (isAbortError(e)) {
          setImports((prev) => prev.filter((f) => f.name !== file.name));
          continue;
        }
        patch(file.name, {
          status: "failed",
          errorKind: e instanceof AssetIntegrityError ? e.kind : "unknown",
          message: e?.message ?? String(e),
        });
      }
    }
    importAbort.current = null;
    await refresh();
  }, [refresh]);
  // Bound to buttons as onPress: never let the press event through as forIds.
  const importFiles = useCallback(() => pickAndImport(), [pickAndImport]);

  const install = useCallback(
    async (models: CatalogModel[]) => {
      const missing = models.filter((m) => !statuses[m.id]?.present);
      const toImport = missing.filter((m) => !canDownload(m));
      await Promise.all(missing.filter(canDownload).map((m) => download(m)));
      if (toImport.length > 0) await pickAndImport(toImport.map((m) => m.id));
    },
    [statuses, download, pickAndImport]
  );

  const usedBytes = Object.values(statuses).reduce((sum, s) => sum + (s.present ? s.sizeOnDiskBytes : 0), 0);

  return {
    loaded,
    discovered,
    statuses,
    activeLlmId,
    activeEmbeddingId,
    deviceRamBytes,
    freeBytes,
    usedBytes,
    loadingId,
    loadErrors,
    view,
    fit: fitFor,
    refresh,
    download,
    remove,
    use,
    imports,
    importFiles,
    importFor: (id: string) => importFor(imports, id),
    install,
    cancelImports,
  };
}
