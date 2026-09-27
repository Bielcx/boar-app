/**
 * Builds the engine's GeoProviders from the places packs (src/rag/pois.ts)
 * and device location (src/services/location.ts). Pure: the app shell passes
 * the real functions in, tests pass fakes.
 */
import { distanceMeters, GeoProviders } from "./geo";

export interface GeoSources {
  installedPoiPacks(): Promise<unknown[]>;
  getCurrentPoint(opts: { timeoutMs: number }): ReturnType<GeoProviders["getLocation"]>;
  resolvePlace: GeoProviders["resolvePlace"];
  searchPois: GeoProviders["searchPois"];
  /** src/services/location.ts getLocationFix: never a fix older than 5 min as the position. */
  getLocationFix?: NonNullable<GeoProviders["getLocationFix"]>;
  /** Known cities (the places packs' biggest ones), for "your last location was in X". */
  cities?(): Array<{ name: string; lat: number; lon: number; country?: string }>;
}

/** A last fix farther than this from every known city is not named. */
export const NEAREST_CITY_MAX_M = 50_000;

export function geoProvidersFrom(s: GeoSources): GeoProviders {
  return {
    // A failed listing counts as "no pack", so the answer says to install one.
    hasPlaces: async () => (await s.installedPoiPacks().catch(() => [])).length > 0,
    getLocation: ({ timeoutMs }) => s.getCurrentPoint({ timeoutMs }),
    ...(s.getLocationFix ? { getLocationFix: s.getLocationFix } : {}),
    nearestCity: async (p) => {
      let best: { name: string; country?: string } | null = null;
      let bestD = NEAREST_CITY_MAX_M;
      for (const c of s.cities?.() ?? []) {
        const d = distanceMeters(p, c);
        if (d <= bestD) (bestD = d), (best = { name: c.name, ...(c.country ? { country: c.country } : {}) });
      }
      return best;
    },
    resolvePlace: (name) => s.resolvePlace(name),
    searchPois: (q) => s.searchPois(q),
  };
}
