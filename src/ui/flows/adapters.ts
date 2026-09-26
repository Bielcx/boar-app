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
 * - Places: POI_REGIONS and poiCatalogEntries (feat/knowledge,
 *   src/rag/poiRegions.ts). Interim: no regions, so the UI shows its empty
 *   state instead of made-up regions.
 * - Position: modules/offline-location ("offline-location") (feat/trust-offline, GPS only, no
 *   Google Play Services). Interim: unavailable.
 */
import type { CatalogModel } from "../../models/manifest";
import { computeCompatibility } from "../../models/compatibility";
import { closePack } from "../../rag/packs";
import type { FitVerdict } from "./modelRowState";
import type { PoiRegion } from "./poi";
import type { NativePosition } from "../../services/location.pure";

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
