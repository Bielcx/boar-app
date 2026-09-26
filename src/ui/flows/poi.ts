/**
 * Offline places (P1): which region pack to suggest, and how to summarize
 * it. The region catalog is Bramble's (src/rag/poiRegions.ts on
 * feat/knowledge); this file only decides what the UI shows.
 */

/** Structural copy of Bramble's PoiRegion, until src/rag/poiRegions.ts lands. */
export interface PoiRegion {
  id: string;
  name: { en: string; pt: string };
  sizeBytes: number;
  sha256: string;
  sourceUrl: string;
  filename: string;
  poiCount: number;
  cityCount: number;
  /** The largest cities, biggest first. */
  cities: { name: string; lat: number; lon: number; pois: number }[];
  /** [minLat, minLon, maxLat, maxLon] */
  bbox: [number, number, number, number];
  timeZones: string[];
  license: string;
  osmDate: string;
  builtAt: string;
}

export type SuggestionReason = "location" | "timezone";

export interface RegionSuggestion {
  region: PoiRegion;
  reason: SuggestionReason;
}

function contains(r: PoiRegion, lat: number, lon: number): boolean {
  const [minLat, minLon, maxLat, maxLon] = r.bbox;
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

function area(r: PoiRegion): number {
  const [minLat, minLon, maxLat, maxLon] = r.bbox;
  return (maxLat - minLat) * (maxLon - minLon);
}

/** The region whose box contains the point; the smallest box wins (a city inside its country). */
export function regionForPoint(regions: PoiRegion[], lat: number, lon: number): PoiRegion | null {
  return regions.filter((r) => contains(r, lat, lon)).sort((a, b) => area(a) - area(b))[0] ?? null;
}

export function regionsForTimeZone(regions: PoiRegion[], timeZone: string | undefined): PoiRegion[] {
  if (!timeZone) return [];
  return regions.filter((r) => r.timeZones.includes(timeZone));
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
    const byPoint = regionForPoint(regions, hints.point.lat, hints.point.lon);
    if (byPoint) return { region: byPoint, reason: "location" };
  }
  const byZone = regionsForTimeZone(regions, hints.timeZone).sort((a, b) => b.poiCount - a.poiCount)[0];
  return byZone ? { region: byZone, reason: "timezone" } : null;
}

/** The first `n` city names and how many more the region covers. */
export function citySummary(region: PoiRegion, n = 3): { names: string[]; more: number } {
  const names = region.cities.slice(0, n).map((c) => c.name);
  return { names, more: Math.max(0, region.cityCount - names.length) };
}

export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
