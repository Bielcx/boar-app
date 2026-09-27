import { CatalogModel, MODEL_CATALOG } from "./manifest";

/**
 * The one place that knows every asset BOAR can install: the curated
 * MODEL_CATALOG plus whatever other modules register (places packs and the
 * gazetteer from src/rag/poiRegions.ts, later third-party packs). Downloads,
 * file imports and the UI all read from here, so nobody has to union
 * catalogs by hand, and an asset added in one place is installable
 * everywhere, including by file import in the offline build.
 *
 * Pure (no Expo imports) so it runs under vitest.
 */

type Provider = () => CatalogModel[];
const providers = new Map<string, Provider>();

/**
 * Adds (or replaces, by name) a source of catalog entries. Call at module
 * load, e.g. `registerAssetProvider("poi", () => [...poiCatalogEntries(), worldPlacesEntry()])`.
 */
export function registerAssetProvider(name: string, provider: Provider): void {
  providers.set(name, provider);
}

export function unregisterAssetProvider(name: string): void {
  providers.delete(name);
}

/**
 * MODEL_CATALOG first, then providers in registration order. On a duplicate
 * id the first entry wins; two different ids claiming one filename is a bug
 * (one install would overwrite the other) and throws.
 */
export function allAssets(): CatalogModel[] {
  const byId = new Map<string, CatalogModel>();
  const owners = new Map<string, string>();
  for (const entry of [MODEL_CATALOG, ...[...providers.values()].map((p) => p())].flat()) {
    if (byId.has(entry.id)) continue;
    const owner = owners.get(entry.filename);
    if (owner) throw new Error(`Assets "${owner}" and "${entry.id}" both install to ${entry.filename}`);
    owners.set(entry.filename, entry.id);
    byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

export function findAsset(id: string): CatalogModel | undefined {
  return allAssets().find((a) => a.id === id);
}

/**
 * What `asset` must be installed with (its `requires`), resolved in the
 * registry. Ids the registry doesn't know come back in `unknown`: a catalog
 * bug, which the registry tests and manifest:verify --strict catch.
 */
export function requirementsOf(asset: Pick<CatalogModel, "id" | "requires">): { assets: CatalogModel[]; unknown: string[] } {
  const assets: CatalogModel[] = [];
  const unknown: string[] = [];
  for (const id of asset.requires ?? []) {
    if (id === asset.id) continue; // an entry built by a shared helper may list itself
    const found = findAsset(id);
    if (found) assets.push(found);
    else unknown.push(id);
  }
  return { assets, unknown };
}

