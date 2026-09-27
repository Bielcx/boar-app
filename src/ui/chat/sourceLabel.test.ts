import { describe, it, expect } from "vitest";
import { groupSources, relevancePercents, sourceParts } from "./sourceLabel";

describe("sourceParts", () => {
  it("splits the corpus 'Name — URL (license)' string (Prism S-2)", () => {
    expect(sourceParts("Wikipedia — https://en.wikipedia.org/wiki/Nosebleed (CC BY-SA 4.0)")).toEqual({
      name: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/Nosebleed",
    });
    expect(sourceParts("Wikibooks (First Aid, Outdoor Survival) — https://en.wikibooks.org/wiki/First_Aid")).toEqual({
      name: "Wikibooks (First Aid, Outdoor Survival)",
      url: "https://en.wikibooks.org/wiki/First_Aid",
    });
  });

  it("keeps a URL with spaces whole (pack URLs carry the raw title, Prism SR-1)", () => {
    expect(sourceParts("Wikipedia — https://en.wikipedia.org/wiki/Quantum cryptography (CC BY-SA 4.0)")).toEqual({
      name: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/Quantum cryptography",
    });
  });

  it("names a bare URL by its host, and keeps a plain name", () => {
    expect(sourceParts("https://www.wikem.org/wiki/Epistaxis")).toEqual({ name: "wikem.org", url: "https://www.wikem.org/wiki/Epistaxis" });
    expect(sourceParts("WikEM")).toEqual({ name: "WikEM", url: null });
    expect(sourceParts(undefined)).toEqual({ name: null, url: null });
  });
});

describe("groupSources", () => {
  it("makes one row per article, keeping citation numbers (Iris: three 'Nosebleed' rows)", () => {
    const g = groupSources([
      { docId: "pack:boar-preparedness:a7", title: "Nosebleed" },
      { docId: "pack:boar-preparedness:a7", title: "Nosebleed" },
      { docId: "pack:boar-preparedness:a9", title: "Emergency bleeding control" },
      { docId: "pack:boar-preparedness:a7", title: "Nosebleed" },
    ]);
    expect(g).toEqual([
      { key: "pack:boar-preparedness:a7", title: "Nosebleed", indexes: [0, 1, 3] },
      { key: "pack:boar-preparedness:a9", title: "Emergency bleeding control", indexes: [2] },
    ]);
  });

  it("never merges sources without an article id", () => {
    expect(groupSources([{ docId: "", title: "A" }, { docId: "", title: "A" }]).length).toBe(2);
  });
});

describe("relevancePercents (measured bar, Boar)", () => {
  it("normalizes the engine's relevance within the answer, the best = 100", () => {
    expect(relevancePercents([{ relevance: 0.8 }, { relevance: 0.75 }, { relevance: 0.4 }])).toEqual([100, 94, 50]);
  });

  it("gives no bar to a source without a measured value", () => {
    expect(relevancePercents([{ relevance: 0.5 }, {}, { relevance: 0 }])).toEqual([100, null, null]);
    expect(relevancePercents([{}, {}])).toEqual([null, null]);
  });

  it("never rounds a measured source down to 0%", () => {
    expect(relevancePercents([{ relevance: 1 }, { relevance: 0.001 }])).toEqual([100, 1]);
  });
});
