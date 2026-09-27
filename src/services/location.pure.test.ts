import { describe, expect, it } from "vitest";
import { isFresh, permissionBlock, toError, toPoint } from "./location.pure";

describe("toPoint", () => {
  it("renames the fields and computes the fix age in seconds", () => {
    const pos = { latitude: -23.55, longitude: -46.63, accuracyM: 25, timestamp: 1_000_000, source: "cached" as const };
    expect(toPoint(pos, 1_090_400)).toEqual({ lat: -23.55, lon: -46.63, accuracyM: 25, ageS: 90 });
  });

  it("never reports a negative age for a clock skew", () => {
    const pos = { latitude: 0, longitude: 0, accuracyM: 5, timestamp: 2000, source: "gps" as const };
    expect(toPoint(pos, 1000)).toMatchObject({ ageS: 0 });
  });
});

describe("toError", () => {
  it("maps the module codes and treats anything else as unavailable", () => {
    expect(toError({ code: "E_PERMISSION" })).toEqual({ error: "denied" });
    expect(toError({ code: "E_TIMEOUT" })).toEqual({ error: "timeout" });
    expect(toError({ code: "E_UNAVAILABLE" })).toEqual({ error: "unavailable" });
    expect(toError(new Error("boom"))).toEqual({ error: "unavailable" });
    expect(toError(null)).toEqual({ error: "unavailable" });
  });
});

describe("isFresh", () => {
  const pos = { latitude: 0, longitude: 0, accuracyM: 5, timestamp: 1000, source: "cached" as const };
  it("accepts a fix within the age limit and rejects older or missing ones", () => {
    expect(isFresh(pos, 1000 + 60_000, 60_000)).toBe(true);
    expect(isFresh(pos, 1000 + 60_001, 60_000)).toBe(false);
    expect(isFresh(null, 0, 60_000)).toBe(false);
  });
});

describe("permissionBlock", () => {
  it("lets a granted permission through and never prompts by itself", () => {
    expect(permissionBlock("granted")).toBeNull();
    expect(permissionBlock("undetermined")).toEqual({ error: "prompt" });
    expect(permissionBlock("denied")).toEqual({ error: "denied" });
  });
});
