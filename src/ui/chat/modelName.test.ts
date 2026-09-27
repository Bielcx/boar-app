import { describe, it, expect } from "vitest";
import { MODEL_CATALOG } from "../../models/manifest";
import { modelNameById } from "./modelName";

describe("modelNameById (Ledger displayName)", () => {
  it("shows the catalog's short name, not the technical label", () => {
    expect(modelNameById("qwen3-4b-instruct-2507-q4km", "Qwen3-4B-Instruct-2507 (Q4_K_M)")).toBe("Qwen3 4B");
  });
  it("keeps the label for a model outside the catalog, or without an id", () => {
    expect(modelNameById("hf/SmolLM3-3B", "SmolLM3-3B-Q4_K_M")).toBe("SmolLM3-3B-Q4_K_M");
    expect(modelNameById(undefined, "Some model")).toBe("Some model");
  });
  it("every chat model in the catalog has a short name", () => {
    for (const m of MODEL_CATALOG.filter((x) => x.kind === "llm")) expect(m.displayName, m.id).toBeTruthy();
  });
});
