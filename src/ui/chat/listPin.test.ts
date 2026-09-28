import { describe, it, expect } from "vitest";
import { heightChanged } from "./listPin";

describe("heightChanged (audit #8/#10)", () => {
  it("pins on the first layout and while the keyboard moves the list", () => {
    expect(heightChanged(null, 600)).toBe(true);
    expect(heightChanged(600, 580)).toBe(true);
    expect(heightChanged(580, 600)).toBe(true);
  });
  it("ignores layouts that leave the height as it was", () => {
    expect(heightChanged(600, 600)).toBe(false);
    expect(heightChanged(600, 600.4)).toBe(false);
  });
});
