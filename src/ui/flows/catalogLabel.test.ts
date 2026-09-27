import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { MODEL_CATALOG } from "../../models/manifest";
import { catalogLabel, TRANSLATED_LABEL_IDS } from "./catalogLabel";

const t = ((k: string) => `T:${k}`) as unknown as TFunction;

describe("catalogLabel", () => {
  it("translates the knowledge entries by id", () => {
    expect(catalogLabel({ id: "corpus-standard", label: "Standard knowledge base (+1,000 topics)" }, t)).toBe("T:flows.catalog.label.corpus-standard");
  });
  it("keeps model names as the manifest writes them", () => {
    expect(catalogLabel({ id: "qwen3-4b-instruct-2507-q4km", label: "Qwen3-4B-Instruct-2507 (Q4_K_M)" }, t)).toBe("Qwen3-4B-Instruct-2507 (Q4_K_M)");
  });
  it("only lists ids that exist in the catalog", () => {
    const ids = new Set(MODEL_CATALOG.map((m) => m.id));
    for (const id of TRANSLATED_LABEL_IDS) expect(ids.has(id)).toBe(true);
  });
});
