/**
 * The seams where the flow screens meet work still on other branches.
 * Each function has one interim body built on what main has today; swap
 * the body when the branch is integrated, and no screen changes.
 *
 * - Memory fit and pack removal are wired (estimateMemoryFit, removeCorpusPackIndex).
 * - Places: POI_REGIONS and poiCatalogEntries are wired; the gazetteer's
 *   catalog entry is built here until Bramble exports worldPlacesEntry().
 * - Position: modules/offline-location (GPS only, no Google Play Services) is wired.
 */
import type { CatalogModel } from "../../models/manifest";
import { getAvailableRamBytes, getDeviceTotalRamBytes, getMemoryInfo } from "ram-monitor";
import { availableRamFrom, MemoryFit } from "../../inference/memoryFit";
import { defaultContextSize } from "../../inference/LlamaEngine";
import { removeCorpusPackIndex } from "../../rag/seedCorpus";
import { catalogFit } from "./fit";
import type { PoiRegion } from "./poi";
import type { City } from "./travel";
import type { ModelSpeed } from "./modelSpeed";
import { resolvePlace } from "../../rag/pois";
import { POI_REGIONS, poiCatalogEntries, WORLD_PLACES } from "../../rag/poiRegions";
import type { NativePosition } from "../../services/location.pure";
import * as OfflineLocation from "offline-location";

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
  return POI_REGIONS;
}

/** A region as a catalog entry, so downloads, verification and removal reuse the model rows. */
export function poiCatalogEntry(region: PoiRegion): CatalogModel {
  return poiCatalogEntries([region])[0];
}

/**
 * The world gazetteer every places pack needs to resolve place names.
 * Interim copy until Bramble exports worldPlacesEntry() with the same id.
 */
export function worldPlacesEntry(): CatalogModel {
  return {
    id: "poi-world-places",
    kind: "corpus",
    format: "poi-pack",
    label: "World places (GeoNames)",
    filename: WORLD_PLACES.filename,
    sizeBytes: WORLD_PLACES.sizeBytes,
    sha256: WORLD_PLACES.sha256,
    sourceUrl: "",
    license: WORLD_PLACES.license,
    description: "",
    required: false,
  };
}

/** A region pack plus the gazetteer it needs, as one install. */
export function placesInstall(region: PoiRegion): CatalogModel[] {
  return [poiCatalogEntry(region), worldPlacesEntry()];
}

export interface DeviceLocationModule {
  getPermissionStatus(): Promise<"granted" | "denied" | "undetermined">;
  requestPermission(): Promise<"granted" | "denied">;
  getLastKnownPosition?(): Promise<NativePosition | null>;
  getCurrentPosition(opts: { timeoutMs?: number; maxAgeMs?: number }): Promise<NativePosition>;
}

/** The GPS-only native module (modules/offline-location), or null in a build without it. */
export function deviceLocation(): DeviceLocationModule | null {
  return OfflineLocation.isOfflineLocationSupported() ? OfflineLocation : null;
}

/**
 * Cities matching what the user typed, from the offline gazetteer.
 * Interim: exact-name resolvePlace (one match) until Bramble's prefix
 * searchPlaces is integrated.
 */
export async function searchCities(query: string, limit = 8): Promise<City[]> {
  const q = query.trim();
  if (!q) return [];
  const match = await resolvePlace(q);
  return match ? [match].slice(0, limit) : [];
}

/** Map tiles covering a city (Bramble's tilesFor). Interim: null until the tile catalog is decided and built. */
export function cityAreaTiles(_lat: number, _lon: number, _radiusKm: number): CatalogModel[] | null {
  return null;
}

/** The Emergency & Preparedness pack (boar-preparedness). Interim: none until it exists. */
export function preparednessEntry(): CatalogModel | undefined {
  return undefined;
}

/**
 * Whether automatic full answers may use a model, from its measured speed.
 * Interim copy of Tusk's rule (src/routing/depth.ts on feat/engine-routing:
 * DEEP_AUTO_MIN_TOK_PER_SEC = 5, MIN_SPEED_SAMPLES = 2; no measurement or
 * too few samples means not eligible) until it is integrated.
 */
export const MIN_DEEP_TOK_PER_SEC = 5;
export const MIN_SPEED_SAMPLES = 2;
export function deepAutoEligible(speed: ModelSpeed | undefined): boolean {
  return !!speed && speed.samples >= MIN_SPEED_SAMPLES && speed.medianTokPerSec >= MIN_DEEP_TOK_PER_SEC;
}
