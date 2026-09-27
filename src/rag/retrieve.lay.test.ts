import { describe, it, expect, vi } from "vitest";

vi.mock("./db", () => ({ getDb: async () => ({ getAllAsync: async () => [] }) }));
vi.mock("./embed", () => ({ embeddingEngine: { embed: async () => new Float32Array([1, 0, 0, 0]) } }));
vi.mock("./ptLexiconAsset", () => ({ ptLexicon: () => ({}) }));

vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///docs/" }));
vi.mock("expo-sqlite", () => ({}));
const { hit } = vi.hoisted(() => ({
  hit: (chunkId: number, title: string, source: string, score: number) => ({
    articleId: chunkId, chunkId, title, section: "", text: `${title} text.`, start: 0, end: 10, score, via: "bm25" as const, source, views: 0, lead: false, action: false,
  }),
}));
vi.mock("./packs", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    packHitToChunk: actual.packHitToChunk,
    searchPacks: async () => ({ lexical: [], semantic: [] }),
    // Six clinical keyword hits, then the two lay sources the pack search adds past its limit.
    searchWikiPacks: async () => [
      {
        packId: "prep",
        stems: [],
        hits: [
          ...[1, 2, 3, 4, 5, 6].map((i) => hit(i, `Clinical ${i}`, "enwiki", 10 - i)),
          hit(7, "US Army Survival Manual", "usgov", 1),
          hit(8, "Outdoor Survival/First Aid", "enwikibooks", 0.5),
        ],
      },
    ],
  };
});

import { retrieve } from "./retrieve";

describe("retrieve and lay sources", () => {
  it("keeps the lay sources a what-to-do search added past the limit", async () => {
    const titles = (await retrieve("snakebite snake bite what to do", 6)).map((c) => c.title);
    // Non-Wikipedia sources carry their label ("US government: …").
    expect(titles.some((t) => /US Army Survival Manual/.test(t))).toBe(true);
    expect(titles.some((t) => /Outdoor Survival\/First Aid/.test(t))).toBe(true);
  });

  it("cuts at the limit as before for other questions", async () => {
    expect(await retrieve("history of snakes in art", 6)).toHaveLength(6);
  });
});
