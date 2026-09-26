import { describe, it, expect, afterEach } from "vitest";
import { allAssets, findAsset, registerAssetProvider, unregisterAssetProvider } from "./assetRegistry";
import { MODEL_CATALOG, type CatalogModel } from "./manifest";

const entry = (id: string, filename = `poi/${id}.sqlite`): CatalogModel => ({
  id,
  kind: "corpus",
  format: "poi-pack",
  label: id,
  filename,
  sizeBytes: 100,
  sha256: "a".repeat(64),
  sourceUrl: "",
  license: "ODbL",
  description: "",
  required: false,
});

afterEach(() => {
  unregisterAssetProvider("test");
  unregisterAssetProvider("other");
});

describe("assetRegistry", () => {
  it("is the curated catalog when nothing else registered", () => {
    expect(allAssets().map((a) => a.id)).toEqual(MODEL_CATALOG.map((a) => a.id));
  });

  it("adds registered providers after the catalog, read lazily", () => {
    let regions = [entry("poi-lisbon")];
    registerAssetProvider("test", () => regions);
    expect(allAssets().at(-1)?.id).toBe("poi-lisbon");
    regions = [entry("poi-lisbon"), entry("poi-world-places", "poi/world-places.sqlite")];
    expect(findAsset("poi-world-places")?.filename).toBe("poi/world-places.sqlite");
  });

  it("keeps the first entry on a duplicate id and refuses two ids on one filename", () => {
    registerAssetProvider("test", () => [entry("poi-a")]);
    registerAssetProvider("other", () => [{ ...entry("poi-a"), label: "dup" }]);
    expect(allAssets().filter((a) => a.id === "poi-a")).toHaveLength(1);
    expect(findAsset("poi-a")?.label).toBe("poi-a");
    registerAssetProvider("other", () => [entry("poi-b", "poi/poi-a.sqlite")]);
    expect(() => allAssets()).toThrow(/both install to poi\/poi-a\.sqlite/);
  });
});
