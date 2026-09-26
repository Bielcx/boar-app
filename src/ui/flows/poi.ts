/**
 * Offline places (P1): which region pack to suggest, and how to summarize
 * it. The region catalog and the point/time-zone lookups are Bramble's
 * (src/rag/poiRegions.ts); this file only decides what the UI shows.
 */

import { PoiRegion, regionForPoint, regionsForTimeZone } from "../../rag/poiRegions";

export type { PoiRegion };

export type SuggestionReason = "location" | "timezone";

export interface RegionSuggestion {
  region: PoiRegion;
  reason: SuggestionReason;
}

/**
 * A measured position beats the time zone. Among regions sharing the time
 * zone, the one with the most places is the likelier home.
 */
export function suggestRegion(
  regions: PoiRegion[],
  hints: { timeZone?: string; point?: { lat: number; lon: number } }
): RegionSuggestion | null {
  if (hints.point) {
    const byPoint = regionForPoint(hints.point.lat, hints.point.lon, regions);
    if (byPoint) return { region: byPoint, reason: "location" };
  }
  const byZone = (hints.timeZone ? regionsForTimeZone(hints.timeZone, regions) : []).sort((a, b) => b.poiCount - a.poiCount)[0];
  return byZone ? { region: byZone, reason: "timezone" } : null;
}

/** The first `n` of the region's listed places and how many more the pack lists. */
export function citySummary(region: Pick<PoiRegion, "cities">, n = 3): { names: string[]; more: number } {
  const names = region.cities.slice(0, n).map((c) => c.name);
  return { names, more: Math.max(0, region.cities.length - names.length) };
}

export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
