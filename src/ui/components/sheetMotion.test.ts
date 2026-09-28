import { describe, expect, it } from "vitest";
import { sheetAnimates } from "./sheetMotion";

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
