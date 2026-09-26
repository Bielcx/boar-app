import { describe, it, expect } from "vitest";
import { allAssets } from "../models/assetRegistry";
import { POI_REGIONS, WORLD_PLACES, poiCatalogEntries, regionForPoint, regionsForTimeZone, worldPlacesEntry } from "./poiRegions";

describe("poiRegions", () => {
  it("finds the region containing a point, and none in the ocean", () => {
    expect(regionForPoint(-23.55, -46.63)?.id).toBe("sao-paulo");
    expect(regionForPoint(52.52, 13.4)?.id).toBe("berlin");
    expect(regionForPoint(0, -30)).toBeNull();
  });
  it("suggests regions from the device time zone", () => {
    expect(regionsForTimeZone("America/Sao_Paulo").map((r) => r.id)).toEqual(["sao-paulo"]);
    expect(regionsForTimeZone("Europe/Lisbon")).toEqual([]);
  });
  it("exposes catalog entries the download manager understands", () => {
    const e = poiCatalogEntries();
    expect(e).toHaveLength(POI_REGIONS.length);
    for (const x of e) {
      expect(x).toMatchObject({ kind: "corpus", format: "poi-pack", required: false });
      expect(x.filename).toMatch(/^poi\/[a-z-]+\.sqlite$/);
      expect(x.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(x.sizeBytes).toBeGreaterThan(0);
    }
    expect(worldPlacesEntry()).toMatchObject({ id: "poi-world-places", format: "poi-pack", filename: WORLD_PLACES.filename, sha256: WORLD_PLACES.sha256 });
  });

  it("registers the places packs and the gazetteer in the asset registry", () => {
    const ids = allAssets().map((a) => a.id);
    expect(ids).toContain("poi-world-places");
    for (const r of POI_REGIONS) expect(ids).toContain(`poi-${r.id}`);
  });
});
