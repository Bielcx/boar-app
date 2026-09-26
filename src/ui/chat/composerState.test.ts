import { describe, it, expect } from "vitest";
import { composerNoticeKey, modelStatus } from "./composerState";

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

describe("composerNoticeKey", () => {
  it("never says loading when the load failed", () => {
    expect(composerNoticeKey("error")).toBe("chat.composer.modelError");
    expect(composerNoticeKey("loading")).toBe("chat.composer.notReady");
    expect(composerNoticeKey("ready")).toBeNull();
  });
});
