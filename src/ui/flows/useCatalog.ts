/**
 * Shared catalog state for Models, Knowledge and Setup: what is on disk,
 * what is downloading, which model fills which role, and the device limits.
 * Each screen renders rows from this instead of keeping its own copy.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { getDeviceTotalRamBytes } from "ram-monitor";
import { AssetStatus, ModelManager } from "../../models/ModelManager";
import { CatalogModel, MODEL_CATALOG } from "../../models/manifest";
import { getActiveModelId, setActiveModelId } from "../../models/settings";
import { listDiscoveredModels, removeDiscoveredModel } from "../../models/discoveredModels";
import { getDownloadState, startDownload, subscribeDownloads } from "../../services/downloadManager";
import { llamaEngine } from "../../inference/LlamaEngine";
import { fitFor, removePackIndex } from "./adapters";
import { ModelRole, modelRowView, RowView } from "./modelRowState";

export const modelManager = new ModelManager();

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
  refresh: () => Promise<void>;
  download: (model: CatalogModel) => Promise<void>;
  remove: (model: CatalogModel) => Promise<void>;
  use: (model: CatalogModel) => Promise<boolean>;
}

function defaultId(kind: "llm" | "embedding"): string | undefined {
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
    const all = [...(await modelManager.statusAll()), ...(await Promise.all(found.map((m) => modelManager.statusOf(m))))];
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
        fit: fitFor(model, deviceRamBytes),
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
    refresh,
    download,
    remove,
    use,
  };
}
