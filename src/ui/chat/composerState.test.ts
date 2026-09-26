import { describe, it, expect } from "vitest";
import { composerNotice, modelStatus } from "./composerState";

describe("modelStatus", () => {
  it("puts a load error ahead of the loading flag (iOS shot e927016: both showed at once)", () => {
    expect(modelStatus(false, "model file not found")).toBe("error");
    expect(modelStatus(true, "stale error")).toBe("error");
  });

  it("is loading until the model is ready", () => {
    expect(modelStatus(false, null)).toBe("loading");
    expect(modelStatus(false, "")).toBe("loading");
    expect(modelStatus(true, undefined)).toBe("ready");
  });
});

describe("composerNotice", () => {
  it("on error shows no line under the card, but keeps the reason for screen readers", () => {
    expect(composerNotice("error")).toEqual({ line: null, hint: "chat.composer.modelError" });
  });

  it("never says loading when the load failed", () => {
    const { line, hint } = composerNotice("error");
    expect([line, hint]).not.toContain("chat.composer.notReady");
  });

  it("says loading (line and hint) while the model loads, nothing when ready", () => {
    expect(composerNotice("loading")).toEqual({ line: "chat.composer.notReady", hint: "chat.composer.notReady" });
    expect(composerNotice("ready")).toEqual({ line: null, hint: null });
  });
});
