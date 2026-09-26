/**
 * Offline places on the phone: the installed places packs (<documents>/poi/*.sqlite:
 * regions and 1° tiles) and the world gazetteer (<documents>/poi/world-places.sqlite),
 * opened read-only. Answers the engine's resolvePlace / searchPois (contract in
 * pois.types.ts) and the UI's city search and "download this city" (tilesFor).
 */
import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import type { CatalogModel } from "../models/manifest";
import { registerAssetProvider } from "../models/assetRegistry";
import { PoiPack, resolvePlaceIn, searchPlacesIn, searchPoiPacks, type PlaceSuggestion, type PoiArea } from "./poiPack";
import { tileBbox, tileEntry, tileIdsFor, type PoiTile } from "./poiRegions";
import type { PlaceMatch, PoiQuery, PoiSearchResult } from "./pois.types";
import type { PackSql } from "./wikiPack";

export type { Diet, DietLevel, PlaceMatch, Poi, PoiQuery, PoiSearchResult } from "./pois.types";
export type { PlaceSuggestion } from "./poiPack";

export const POI_DIR = "poi/";
export const PLACES_FILE = "world-places.sqlite";

const opened = new Map<string, PoiPack>();
let places: PackSql | null = null;
let tileIndex: Map<string, PoiTile> | null = null;

async function open(file: string): Promise<SQLite.SQLiteDatabase> {
  const path = `${FileSystem.documentDirectory}${POI_DIR}${file}`.replace(/^file:\/\//, "");
  const slash = path.lastIndexOf("/");
  return SQLite.openDatabaseAsync(path.slice(slash + 1), { useNewConnection: true }, path.slice(0, slash));
}

async function openPack(file: string): Promise<PoiPack | null> {
  const hit = opened.get(file);
  if (hit) return hit;
  try {
    const p = await PoiPack.open(await open(file));
    opened.set(file, p);
    return p;
  } catch (e: any) {
    console.warn(`[pois] ${file} isn't a places pack:`, e?.message ?? e);
    return null;
  }
}

/**
 * Every installed places pack as a searchable area. A tile's area comes from
 * its file name and the file is opened only when a search reaches it (a
 * continent is hundreds of tiles); a region pack is opened to read its area.
 */
export async function installedPoiAreas(): Promise<PoiArea[]> {
  const names = await FileSystem.readDirectoryAsync(`${FileSystem.documentDirectory}${POI_DIR}`).catch(() => [] as string[]);
  const areas: PoiArea[] = [];
  for (const n of names) {
    if (!n.endsWith(".sqlite") || n === PLACES_FILE) continue;
    const bbox = tileBbox(n.replace(/\.sqlite$/, ""));
    if (bbox) {
      areas.push({
        id: n.replace(/\.sqlite$/, ""),
        bbox,
        within: async (q, r) => (await openPack(n))?.within(q, r) ?? [],
      });
    } else {
      const p = await openPack(n);
      if (p) areas.push(p);
    }
  }
  for (const n of [...opened.keys()]) if (!names.includes(n)) opened.delete(n);
  return areas;
}

/** Forgets an open pack before its file is deleted. */
export function closePoiPack(filename: string): void {
  opened.delete(filename.replace(/^.*\//, ""));
}

export async function searchPois(q: PoiQuery): Promise<PoiSearchResult> {
  return searchPoiPacks(await installedPoiAreas(), q);
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

/**
 * The tile index shipped in the gazetteer (sizes and hashes of every tile that
 * has places), loaded once; its entries are then installable by download or
 * file import like any other asset.
 */
export async function loadTileCatalog(): Promise<Map<string, PoiTile>> {
  if (tileIndex) return tileIndex;
  const db = await gazetteer();
  type Row = { id: string; size_bytes: number; sha256: string; pois: number; vegan: number; osm_date: string; url?: string | null };
  const cols = "id, size_bytes, sha256, pois, vegan, osm_date";
  // Gazetteers built before the tiles were hosted have no url column.
  const rows = db
    ? await db
        .getAllAsync<Row>(`SELECT ${cols}, url FROM tiles`, [])
        .catch(() => db.getAllAsync<Row>(`SELECT ${cols} FROM tiles`, []))
        .catch(() => [] as Row[])
    : [];
  tileIndex = new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, sizeBytes: r.size_bytes, sha256: r.sha256, pois: r.pois, vegan: r.vegan, osmDate: r.osm_date, ...(r.url ? { url: r.url } : {}) },
    ])
  );
  const entries = [...tileIndex.values()].map(tileEntry);
  registerAssetProvider("poi-tiles", () => entries);
  return tileIndex;
}

/**
 * What to download for a trip: the tiles (that have places) covering a circle
 * around a city, e.g. tilesFor(41.89, 12.48, 15) for Rome.
 */
export async function tilesFor(lat: number, lon: number, radiusKm: number): Promise<CatalogModel[]> {
  const index = await loadTileCatalog();
  return tileIdsFor(lat, lon, radiusKm)
    .map((id) => index.get(id))
    .filter((t): t is PoiTile => !!t)
    .map(tileEntry);
}

/** @deprecated Use installedPoiAreas (kept for callers written against the first contract). */
export const installedPoiPacks = installedPoiAreas;
