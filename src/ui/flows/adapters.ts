/**
 * The seams where the flow screens meet work still on other branches.
 * Each function has one interim body built on what main has today; swap
 * the body when the branch is integrated, and no screen changes.
 *
 * - Memory fit and pack removal are wired (estimateMemoryFit, removeCorpusPackIndex).
 * - Places: POI_REGIONS and poiCatalogEntries (feat/knowledge,
 *   src/rag/poiRegions.ts). Interim: no regions, so the UI shows its empty
 *   state instead of made-up regions.
 * - Position: modules/offline-location ("offline-location") (feat/trust-offline, GPS only, no
 *   Google Play Services). Interim: unavailable.
 */
import type { CatalogModel } from "../../models/manifest";
import { getAvailableRamBytes, getDeviceTotalRamBytes, getMemoryInfo } from "ram-monitor";
import { availableRamFrom, MemoryFit } from "../../inference/memoryFit";
import { defaultContextSize } from "../../inference/LlamaEngine";
import { removeCorpusPackIndex } from "../../rag/seedCorpus";
import { catalogFit } from "./fit";
import type { PoiRegion } from "./poi";
import type { NativePosition } from "../../services/location.pure";

/** Tusk's estimate against the RAM the OS says is available right now. */
export function fitFor(model: CatalogModel): MemoryFit | undefined {
  let totalBytes = 0;
  let availableBytes = 0;
  try {
    totalBytes = getDeviceTotalRamBytes();
    availableBytes = availableRamFrom({ totalBytes, rssBytes: getMemoryInfo().rssBytes, availBytes: getAvailableRamBytes() });
  } catch {
    return undefined;
  }
  return catalogFit(model, { totalBytes, availableBytes }, defaultContextSize());
}

/** Deletes a JSON pack's indexed chunks or closes a sqlite pack, before the file goes. */
export async function removePackIndex(model: CatalogModel): Promise<void> {
  await removeCorpusPackIndex(model);
}

export function poiRegions(): PoiRegion[] {
  return [];
}

/** A region as a catalog entry, so downloads, verification and removal reuse the model rows. */
export function poiCatalogEntry(region: PoiRegion): CatalogModel {
  return {
    id: region.id,
    kind: "corpus",
    label: region.name.en,
    filename: region.filename,
    sizeBytes: region.sizeBytes,
    sha256: region.sha256,
    sourceUrl: region.sourceUrl,
    license: region.license,
    description: "",
    required: false,
    format: "sqlite-pack",
  };
}

export interface DeviceLocationModule {
  getPermissionStatus(): Promise<"granted" | "denied" | "undetermined">;
  requestPermission(): Promise<"granted" | "denied">;
  getLastKnownPosition?(): Promise<NativePosition | null>;
  getCurrentPosition(opts: { timeoutMs?: number; maxAgeMs?: number }): Promise<NativePosition>;
}

export function deviceLocation(): DeviceLocationModule | null {
  return null;
}
