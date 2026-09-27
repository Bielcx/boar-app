import { describe, it, expect, vi } from "vitest";

const calls: string[] = [];
vi.mock("./db", () => ({ getDb: async () => ({ getAllAsync: async () => [] }) }));
vi.mock("./embed", () => ({ embeddingEngine: { embed: async () => new Float32Array([1, 0, 0, 0]) } }));
vi.mock("./ptLexiconAsset", () => ({ ptLexicon: () => ({}) }));
vi.mock("./packs", () => ({
  packHitToChunk: () => {
    throw new Error("unused");
  },
  searchWikiPacks: async () => [],
  // Stands in for an English source: only English words match.
  searchPacks: async (query: string) => {
    calls.push(query);
    const lexical = /season/i.test(query)
      ? [{ chunkId: "pack:vital5:1", docId: "pack:vital5:Season", title: "Season", body: "A season is a division of the year.", source: "Wikipedia", score: 9, matchType: "lexical" as const }]
      : /cultivo|jardim/i.test(query)
        ? [{ chunkId: "pack:prep:9", docId: "pack:prep:Jardim", title: "Jardim Vertical", body: "Jardim vertical para cultivo o ano todo.", source: "Appropedia", score: 3, matchType: "lexical" as const }]
        : [];
    return { lexical, semantic: [] };
  },
}));

import { retrieve } from "./retrieve";

const lexicon = { "estacao do ano": "Season", terra: "Earth" };

describe("retrieve with Portuguese questions", () => {
  it("searches again with the English names a Portuguese question mentions, and puts those results first", async () => {
    calls.length = 0;
    const hits = await retrieve("Por que existem estações do ano na Terra? (cultivo)", 6, { lexicon });
    expect(calls).toContain("Season Earth");
    expect(hits[0]?.title).toBe("Season");
    expect(hits.map((h) => h.title)).toContain("Jardim Vertical");
  });

  it("leaves English questions alone", async () => {
    calls.length = 0;
    await retrieve("Why do we have seasons on Earth?", 6, { lexicon });
    expect(calls).toEqual(["Why do we have seasons on Earth?"]);
  });
});
