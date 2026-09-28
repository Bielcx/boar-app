import { describe, expect, it } from "vitest";
import { sheetAnimates, sheetTravel } from "./sheetMotion";

describe("sheetAnimates (perf audit #12: a Sheet mounted closed)", () => {
  it("a sheet mounted closed does nothing: no native animation, no focus handed back", () => {
    expect(sheetAnimates(false, false)).toBe(false);
  });

  it("opening, and closing one that is on screen, animate", () => {
    expect(sheetAnimates(true, false)).toBe(true);
    expect(sheetAnimates(true, true)).toBe(true);
    expect(sheetAnimates(false, true)).toBe(true);
  });
});

describe("sheetTravel (TR-4: slide by the sheet's own height)", () => {
  it("slides by the measured height, so a tall sheet starts fully off screen", () => {
    expect(sheetTravel(620, 844, false)).toBe(620);
  });
  it("uses the window height before the first layout", () => {
    expect(sheetTravel(0, 844, false)).toBe(844);
  });
  it("does not slide under reduce motion", () => {
    expect(sheetTravel(620, 844, true)).toBe(0);
  });
});
