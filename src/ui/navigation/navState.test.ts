import { describe, expect, it } from "vitest";
import { fontScaleKey, saveNavState, savedNavState } from "./navState";

describe("fontScaleKey", () => {
  it("changes when the system font size changes", () => {
    expect(fontScaleKey(1)).not.toBe(fontScaleKey(1.3));
  });

  it("ignores float noise below a hundredth", () => {
    expect(fontScaleKey(1.3)).toBe(fontScaleKey(1.3000001));
    expect(fontScaleKey(0.85)).toBe("fs:0.85");
  });
});

describe("saved navigation state", () => {
  it("returns what was saved last, so a remount reopens the same screen", () => {
    const state = { index: 1, routes: [{ name: "Main" }, { name: "Settings" }] };
    saveNavState(state);
    expect(savedNavState()).toBe(state);
  });
});
