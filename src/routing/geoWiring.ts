/**
 * Builds the engine's GeoProviders from the places packs (src/rag/pois.ts)
 * and device location (src/services/location.ts). Pure: the app shell passes
 * the real functions in, tests pass fakes.
 */
import type { GeoProviders } from "./geo";

export interface GeoSources {
  installedPoiPacks(): Promise<unknown[]>;
  getCurrentPoint(opts: { timeoutMs: number }): ReturnType<GeoProviders["getLocation"]>;
  resolvePlace: GeoProviders["resolvePlace"];
  searchPois: GeoProviders["searchPois"];
}

export function geoProvidersFrom(s: GeoSources): GeoProviders {
  return {
    // A failed listing counts as "no pack", so the answer says to install one.
    hasPlaces: async () => (await s.installedPoiPacks().catch(() => [])).length > 0,
    getLocation: ({ timeoutMs }) => s.getCurrentPoint({ timeoutMs }),
    resolvePlace: (name) => s.resolvePlace(name),
    searchPois: (q) => s.searchPois(q),
  };
}
