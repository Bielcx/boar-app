import { describe, expect, it } from "vitest";
import { citySummary, PoiRegion, suggestRegion, topInstalledCities } from "./poi";

function region(id: string, bbox: PoiRegion["bbox"], timeZones: string[], poiCount: number, cities: string[] = []): PoiRegion {
  return {
    id,
    name: { en: id, pt: id },
    sizeBytes: 1,
    sha256: "",
    sourceUrl: "",
    filename: `poi/${id}.sqlite`,
    poiCount,
    veganCount: 0,
    vegetarianCount: 0,
    cities: cities.map((name) => ({ name, lat: 0, lon: 0, pois: 0 })),
    bbox,
    timeZones,
    osmDate: "",
    builtAt: "",
  };
}

const brazil = region("brazil", [-34, -74, 6, -34], ["America/Sao_Paulo", "America/Manaus"], 500_000);
const saoPaulo = region("sao-paulo", [-24.1, -47.2, -23.3, -46.3], ["America/Sao_Paulo"], 40_000, ["São Paulo", "Guarulhos", "Osasco", "Santo André", "Diadema"]);
const berlin = region("berlin", [52.3, 13.0, 52.7, 13.8], ["Europe/Berlin"], 20_000);
const regions = [brazil, saoPaulo, berlin];

describe("suggestRegion", () => {
  it("prefers a measured position and says so", () => {
    expect(suggestRegion(regions, { timeZone: "Europe/Berlin", point: { lat: -23.55, lon: -46.63 } })).toEqual({
      region: saoPaulo,
      reason: "location",
    });
  });

  it("falls back to the time zone, choosing the region with the most places", () => {
    expect(suggestRegion(regions, { timeZone: "America/Sao_Paulo" })).toEqual({ region: brazil, reason: "timezone" });
  });

  it("uses the time zone when the position is outside every region", () => {
    expect(suggestRegion(regions, { timeZone: "Europe/Berlin", point: { lat: 35.68, lon: 139.69 } })?.reason).toBe("timezone");
  });

  it("suggests nothing when no region matches", () => {
    expect(suggestRegion(regions, { timeZone: "Asia/Tokyo" })).toBeNull();
    expect(suggestRegion([], { timeZone: "America/Sao_Paulo" })).toBeNull();
  });
});

describe("citySummary", () => {
  it("shows the first places and counts the rest of the list", () => {
    expect(citySummary(saoPaulo)).toEqual({ names: ["São Paulo", "Guarulhos", "Osasco"], more: 2 });
    expect(citySummary(berlin)).toEqual({ names: [], more: 0 });
  });
});

describe("topInstalledCities", () => {
  const regions = [
    { id: "sao-paulo", cities: [{ name: "São Paulo", lat: 0, lon: 0, pois: 9000 }, { name: "Campinas", lat: 0, lon: 0, pois: 800 }] },
    { id: "taipei", cities: [{ name: "Taipei", lat: 0, lon: 0, pois: 5000 }, { name: "Keelung", lat: 0, lon: 0, pois: 300 }] },
    { id: "singapore", cities: [{ name: "Singapore", lat: 0, lon: 0, pois: 20000 }] },
  ];

  it("only cities of installed packs, most food places first", () => {
    expect(topInstalledCities(regions, new Set(["sao-paulo", "taipei"]))).toEqual([
      { name: "São Paulo", region: "sao-paulo" },
      { name: "Taipei", region: "taipei" },
      { name: "Campinas", region: "sao-paulo" },
      { name: "Keelung", region: "taipei" },
    ]);
  });

  it("respects the limit and returns nothing when no pack is installed", () => {
    expect(topInstalledCities(regions, new Set(["sao-paulo", "taipei", "singapore"]), 2).map((c) => c.name)).toEqual(["Singapore", "São Paulo"]);
    expect(topInstalledCities(regions, new Set())).toEqual([]);
  });

  it("lists a city name once even if two packs cover it", () => {
    const overlap = [...regions, { id: "sp-tiles", cities: [{ name: "São Paulo", lat: 0, lon: 0, pois: 100 }] }];
    expect(topInstalledCities(overlap, new Set(["sao-paulo", "sp-tiles"])).filter((c) => c.name === "São Paulo")).toHaveLength(1);
  });
});
