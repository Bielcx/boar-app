import { describe, it, expect } from "vitest";
import type { Place } from "./answerEvents";
import {
  coordinatesText,
  cuisineLabels,
  dietLabels,
  formatDistance,
  geoUri,
  openState,
  parseOpeningHours,
  placeA11yLabel,
  placeDetailLine,
  spokenDistance,
} from "./placesFormat";

const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}${JSON.stringify(opts)}` : key);
// 2026-09-28 is a Monday.
const at = (hh: number, mm = 0, dayOffset = 0) => new Date(2026, 8, 28 + dayOffset, hh, mm);

describe("formatDistance", () => {
  const cases: [number, string, string][] = [
    [0, "0 m", "0 m"],
    [9, "10 m", "10 m"],
    [349, "350 m", "350 m"],
    [351, "350 m", "350 m"],
    [999, "1.0 km", "1,0 km"],
    [1000, "1.0 km", "1,0 km"],
    [1049, "1.0 km", "1,0 km"],
    [1250, "1.3 km", "1,3 km"],
    [9950, "10 km", "10 km"],
    [12400, "12 km", "12 km"],
  ];
  it.each(cases)("%i m → %s (EN) / %s (PT)", (m, en, pt) => {
    expect(formatDistance(m, "en-US")).toBe(en);
    expect(formatDistance(m, "pt-BR")).toBe(pt);
  });

  it("spells the unit for screen readers", () => {
    expect(spokenDistance(350, "pt-BR", t)).toBe('chat.places.m{"value":"350"}');
    expect(spokenDistance(1250, "pt-BR", t)).toBe('chat.places.km{"value":"1,3"}');
  });
});

describe("dietLabels", () => {
  it("tells a vegan place from one with vegan options, and skips 'no'", () => {
    expect(dietLabels({ vegan: "only" }, t)).toEqual(["chat.places.diet.vegan.only"]);
    expect(dietLabels({ vegetarian: "only", vegan: "yes" }, t)).toEqual([
      "chat.places.diet.vegan.yes",
      "chat.places.diet.vegetarian.only",
    ]);
    expect(dietLabels({ vegan: "no" }, t)).toEqual([]);
    expect(dietLabels(undefined, t)).toEqual([]);
  });
});

describe("cuisineLabels", () => {
  it("formats OSM values and drops diet words", () => {
    expect(cuisineLabels(["vegan", "fine_dining", "indian", "thai"])).toEqual(["Fine dining", "Indian"]);
  });
});

describe("opening hours", () => {
  it("reads common forms and says open until / closed", () => {
    expect(openState("Mo-Fr 11:00-22:00; Sa 12:00-23:00", at(12))).toEqual({ open: true, closesAt: "22:00" });
    expect(openState("Mo-Fr 11:00-22:00", at(9))).toEqual({ open: false, opensAt: "11:00" });
    expect(openState("Mo-Fr 11:00-22:00", at(23))).toEqual({ open: false, opensAt: undefined });
    expect(openState("Mo-Fr 11:00-22:00; Sa,Su off", at(12, 0, 5))).toEqual({ open: false, opensAt: undefined });
    expect(openState("24/7", at(3))).toEqual({ open: true });
  });

  it("handles split hours and times past midnight", () => {
    expect(openState("Mo-Su 12:00-15:00,19:00-23:00", at(16))).toEqual({ open: false, opensAt: "19:00" });
    // Sunday 18:00-02:00, checked at Monday 01:00.
    expect(openState("Su 18:00-02:00", at(1))).toEqual({ open: true, closesAt: "02:00" });
  });

  it("gives up on anything it doesn't understand rather than guess", () => {
    for (const raw of ["Mo-Fr 10:00-18:00; PH off", "sunrise-sunset", "Jan-Mar Mo 10:00-12:00", "Mo 10-12", ""]) {
      expect(parseOpeningHours(raw)).toBeNull();
    }
    expect(openState(undefined, at(12))).toBeNull();
  });
});

describe("rows", () => {
  const place: Place = {
    id: "osm:node/1",
    name: "Mão Verde",
    lat: -23.5505199,
    lon: -46.6333094,
    diet: { vegan: "only" },
    cuisine: ["brazilian"],
    distanceM: 351,
    address: "Rua Augusta 100",
    openingHours: "Mo-Su 11:00-22:00",
    source: "osm",
  };

  it("reads a row as one sentence with units spelled out", () => {
    expect(placeA11yLabel(place, at(12), "pt-BR", t)).toBe(
      'Mão Verde, chat.places.m{"value":"350"}, chat.places.diet.vegan.only, Brazilian, chat.places.openUntil{"time":"22:00"}, Rua Augusta 100, chat.places.fromSource{"source":"chat.places.sourceOsm"}'
    );
  });

  it("marks the detail line closed only with parsed hours", () => {
    expect(placeDetailLine(place, at(23), t).closed).toBe(true);
    expect(placeDetailLine({ ...place, openingHours: "by appointment" }, at(23), t)).toEqual({
      text: "chat.places.diet.vegan.only · Brazilian",
      closed: false,
    });
  });

  it("gives coordinates and a geo: URI for offline maps apps", () => {
    expect(coordinatesText(place)).toBe("-23.55052, -46.63331");
    expect(geoUri(place)).toBe("geo:-23.550520,-46.633309?q=-23.550520,-46.633309(M%C3%A3o%20Verde)");
  });
});
