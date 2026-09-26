import { describe, it, expect } from "vitest";
import { modelErrorKind, modelErrorPrimary } from "./modelError";

describe("modelErrorKind", () => {
  it("reads the engine's error text", () => {
    expect(modelErrorKind("Failed to allocate 2.1 GB")).toBe("memory");
    expect(modelErrorKind("OOM while creating context")).toBe("memory");
    expect(modelErrorKind("size mismatch: expected 1000 got 900")).toBe("corrupt");
    expect(modelErrorKind("sha256 hash differs")).toBe("corrupt");
    expect(modelErrorKind("ENOENT: no such file or directory")).toBe("missing");
    expect(modelErrorKind("model file not found")).toBe("missing");
    expect(modelErrorKind("context init failed")).toBe("general");
    expect(modelErrorKind("")).toBe("general");
  });

  it("does not take words that merely contain 'ram' or 'oom' for memory", () => {
    expect(modelErrorKind("bad parameter in program")).toBe("general");
    expect(modelErrorKind("room for improvement")).toBe("general");
  });
});

describe("modelErrorPrimary", () => {
  it("leads with setup when reinstalling fixes it, retry otherwise", () => {
    expect(modelErrorPrimary("memory")).toBe("setup");
    expect(modelErrorPrimary("missing")).toBe("setup");
    expect(modelErrorPrimary("corrupt")).toBe("setup");
    expect(modelErrorPrimary("general")).toBe("retry");
  });
});
