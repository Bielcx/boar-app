import { describe, it, expect } from "vitest";
import { allAssets } from "../models/assetRegistry";
import { POI_REGIONS, WORLD_PLACES, poiCatalogEntries, regionForPoint, regionsForTimeZone, worldPlacesEntry } from "./poiRegions";
import { preparednessEntry } from "./preparedness";

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

describe("tiles", () => {
  it("names tiles by their south-west corner and back", async () => {
    const { tileIdOf, tileBbox } = await import("./poiRegions");
    expect(tileIdOf(41.89, 12.48)).toBe("t-N41E012");
    expect(tileIdOf(-23.55, -46.63)).toBe("t-S24W047");
    expect(tileBbox("t-S24W047")).toEqual([-24, -47, -23, -46]);
    expect(tileBbox("sao-paulo")).toBeNull();
  });
  it("lists the tiles a city's circle touches", async () => {
    const { tileIdsFor } = await import("./poiRegions");
    expect(tileIdsFor(41.89, 12.48, 8)).toEqual(["t-N41E012"]);
    // Rome at 15 km reaches past 42°N.
    expect(tileIdsFor(41.89, 12.48, 15)).toEqual(["t-N41E012", "t-N42E012"]);
    // Near a corner the circle spans four tiles.
    expect(tileIdsFor(42.0, 13.0, 10).sort()).toEqual(["t-N41E012", "t-N41E013", "t-N42E012", "t-N42E013"]);
  });
});

describe("hosted pack URLs", () => {
  it("pin every hosted file to an upload commit, never a branch", () => {
    const entries = [...poiCatalogEntries(), worldPlacesEntry(), preparednessEntry()].filter((e) => e.sourceUrl);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.sourceUrl).toMatch(/^https:\/\/huggingface\.co\/datasets\/r4topunk\/boar-packs\/resolve\/[0-9a-f]{40}\/[\w./-]+\.sqlite$/);
    }
  });
});
