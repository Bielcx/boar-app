/**
 * Offline places on the phone: opens the installed places packs
 * (<documents>/poi/*.sqlite) and the world gazetteer
 * (<documents>/poi/world-places.sqlite) read-only and answers the engine's
 * resolvePlace / searchPois (contract in pois.types.ts).
 */
import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { PoiPack, resolvePlaceIn, searchPlacesIn, searchPoiPacks, type PlaceSuggestion } from "./poiPack";
import type { PlaceMatch, PoiQuery, PoiSearchResult } from "./pois.types";
import type { PackSql } from "./wikiPack";

export type { Diet, DietLevel, PlaceMatch, Poi, PoiQuery, PoiSearchResult } from "./pois.types";

export const POI_DIR = "poi/";
export const PLACES_FILE = "world-places.sqlite";

const packs = new Map<string, PoiPack>();
let places: PackSql | null = null;

async function open(file: string): Promise<SQLite.SQLiteDatabase> {
  const path = `${FileSystem.documentDirectory}${POI_DIR}${file}`.replace(/^file:\/\//, "");
  const slash = path.lastIndexOf("/");
  return SQLite.openDatabaseAsync(path.slice(slash + 1), { useNewConnection: true }, path.slice(0, slash));
}

/** The installed places packs, opened once; a file that isn't a valid pack is skipped with a warning. */
export async function installedPoiPacks(): Promise<PoiPack[]> {
  const names = await FileSystem.readDirectoryAsync(`${FileSystem.documentDirectory}${POI_DIR}`).catch(() => [] as string[]);
  for (const n of names) {
    if (!n.endsWith(".sqlite") || n === PLACES_FILE || packs.has(n)) continue;
    try {
      packs.set(n, await PoiPack.open(await open(n)));
    } catch (e: any) {
      console.warn(`[pois] ${n} isn't a places pack:`, e?.message ?? e);
    }
  }
  for (const n of [...packs.keys()]) if (!names.includes(n)) packs.delete(n);
  return [...packs.values()];
}

/** Forgets an open pack before its file is deleted. */
export function closePoiPack(filename: string): void {
  packs.delete(filename.replace(/^.*\//, ""));
}

export async function searchPois(q: PoiQuery): Promise<PoiSearchResult> {
  return searchPoiPacks(await installedPoiPacks(), q);
}

async function gazetteer(): Promise<PackSql | null> {
  if (!places) {
    const info = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}${POI_DIR}${PLACES_FILE}`);
    if (!info.exists) return null;
    places = await open(PLACES_FILE);
  }
  return places;
}

/** A city or town by name, from the world gazetteer; null when unknown or the gazetteer isn't installed. */
export async function resolvePlace(name: string): Promise<PlaceMatch | null> {
  const db = await gazetteer();
  return db ? resolvePlaceIn(db, name) : null;
}

/** City search box: places whose name starts with `query`, most populous first ([] without the gazetteer). */
export async function searchPlaces(query: string, limit = 10): Promise<PlaceSuggestion[]> {
  const db = await gazetteer();
  return db ? searchPlacesIn(db, query, limit) : [];
}

export type { PlaceSuggestion } from "./poiPack";
