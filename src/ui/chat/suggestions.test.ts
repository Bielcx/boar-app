import { describe, it, expect } from "vitest";
import { suggestionsFor } from "./suggestions";

describe("suggestionsFor", () => {
  it("offers only what each model passed in each language", () => {
    expect(suggestionsFor("qwen3-4b-instruct-2507-q4km", "pt")).toEqual(["q1", "q2", "q3", "q4"]);
    expect(suggestionsFor("qwen2.5-1.5b-instruct-q4km", "pt-BR")).toEqual(["q3"]);
    expect(suggestionsFor("qwen2.5-1.5b-instruct-q4km", "en")).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("offers nothing for a model that wasn't validated", () => {
    expect(suggestionsFor("phi-3.5-mini-instruct-q4km", "en")).toEqual([]);
    expect(suggestionsFor(undefined, "en")).toEqual([]);
  });
});
