import { describe, expect, it } from "vitest";
import { saveNavState, savedNavState } from "./navState";

describe("saved navigation state", () => {
  it("returns what was saved last, so a remount reopens the same screen", () => {
    const state = { index: 1, routes: [{ name: "Main" }, { name: "Settings" }] };
    saveNavState(state);
    expect(savedNavState()).toBe(state);
  });
});
