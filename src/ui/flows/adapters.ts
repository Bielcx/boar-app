/**
 * The seams where the flow screens meet work still on other branches.
 * Each function has one interim body built on what main has today; swap
 * the body when the branch is integrated, and no screen changes.
 *
 * - Memory fit and pack removal are wired (estimateMemoryFit, removeCorpusPackIndex).
 * - Places: POI_REGIONS, poiCatalogEntries, worldPlacesEntry and
 *   searchPlaces are wired. Still interim: map tiles and the preparedness pack.
 * - Position: modules/offline-location (GPS only, no Google Play Services) is wired.
 */
import type { CatalogModel } from "../../models/manifest";
import { getAvailableRamBytes, getDeviceTotalRamBytes, getMemoryInfo } from "ram-monitor";
import { availableRamFrom, contextSizeForRam, MemoryFit } from "../../inference/memoryFit";
import { removeCorpusPackIndex } from "../../rag/seedCorpus";
import { catalogFit } from "./fit";
import type { PoiRegion } from "./poi";
import type { City } from "./travel";
import { searchPlaces } from "../../rag/pois";
import { POI_REGIONS, poiCatalogEntries, worldPlacesEntry } from "../../rag/poiRegions";
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
  return catalogFit(model, { totalBytes, availableBytes }, contextSizeForRam(totalBytes));
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

/** The world gazetteer every places pack needs to resolve place names. */
export { worldPlacesEntry };

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

/** Cities matching what the user typed (prefix, alternate names, most populous first), from the offline gazetteer. */
export async function searchCities(query: string, limit = 8): Promise<City[]> {
  const q = query.trim();
  if (!q) return [];
  return searchPlaces(q, limit);
}

/** Map tiles covering a city (Bramble's tilesFor). Interim: null until the tile catalog is decided and built. */
export function cityAreaTiles(_lat: number, _lon: number, _radiusKm: number): CatalogModel[] | null {
  return null;
}

/** The Emergency & Preparedness pack (boar-preparedness). Interim: none until Bramble's export is integrated. */
export function preparednessEntry(): CatalogModel | undefined {
  return undefined;
}

export interface PackSource {
  name: string;
  license: string;
  url?: string;
}

/** Document count and attributed sources of the preparedness pack. Interim: nothing until Bramble's export is integrated. */
export function preparednessInfo(): { docCount: number; sources: PackSource[] } | undefined {
  return undefined;
}
