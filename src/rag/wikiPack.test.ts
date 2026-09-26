/// <reference types="node" />
import { describe, it, expect, beforeAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decompress } from "fzstd";
import { nodeSqliteDatabase } from "./testing/nodeSqlite";
import { WikiPack, countAtBoundary, coverage, sectionAt, titleCandidates } from "./wikiPack";

// A pack built by the real builder from a fixture of six made-up, test-only
// articles (src/rag/testing/fixtures/mini-wiki.jsonl), read back with fzstd,
// the decompressor the app uses.
let pack: WikiPack;

beforeAll(async () => {
  const out = join(mkdtempSync(join(tmpdir(), "boar-pack-")), "mini.sqlite");
  execFileSync(process.execPath, [
    "scripts/build-wiki-pack.mjs", "--out", out, "--shards", "src/rag/testing/fixtures/mini-wiki.jsonl", "--no-embed", "--chunk-chars", "300",
  ], { stdio: "pipe" });
  pack = await WikiPack.open(nodeSqliteDatabase(out), decompress);
}, 60000);

describe("pure helpers", () => {
  it("finds the heading path at an offset", () => {
    const text = "# T\n\nlead\n\n## A\n\na\n\n### B\n\nb\n\n## C\n\nc";
    expect(sectionAt(text, text.indexOf("lead"))).toBe("");
    expect(sectionAt(text, text.indexOf("\nb") + 1)).toBe("A > B");
    expect(sectionAt(text, text.lastIndexOf("c"))).toBe("C");
  });
  it("counts stem prefixes at word boundaries only", () => {
    expect(countAtBoundary("hole", "black holes and wholesome holes")).toBe(2);
    expect(coverage("Black holes bend light", [{ stem: "hole", idf: 3 }, { stem: "galaxi", idf: 1 }])).toBe(0.75);
  });
  it("proposes title n-grams without edge stopwords, longest first", () => {
    const c = titleCandidates("Compare the French Revolution and the Industrial Revolution");
    expect(c.indexOf("French Revolution")).toBeGreaterThanOrEqual(0);
    expect(c.indexOf("Industrial Revolution")).toBeGreaterThanOrEqual(0);
    expect(c.every((t) => !/^(the|and) /i.test(t))).toBe(true);
    expect(c.indexOf("French Revolution")).toBeLessThan(c.indexOf("French"));
  });
});

describe("WikiPack", () => {
  it("reads articles back from the compressed blocks", async () => {
    const id = await pack.resolveTitle("black hole");
    const a = await pack.article(id!);
    expect(a.title).toBe("Black hole");
    expect(a.text.startsWith("# Black hole\n\nA black hole is a region")).toBe(true);
  });

  it("puts the article the question names first (title boost), not a keyword neighbour", async () => {
    const hits = await pack.search("What is a black hole and how does one form?");
    expect(hits[0]).toMatchObject({ title: "Black hole", via: "title", lead: true });
    expect(hits.some((h) => h.title === "Black hole" && h.section === "Formation")).toBe(true);
    expect(hits.findIndex((h) => h.title === "Black Sea")).not.toBe(0);
  });

  it("covers both sides of a comparison", async () => {
    const hits = await pack.search("Compare the French Revolution and the Industrial Revolution.", { k: 4 });
    expect(hits.slice(0, 4).map((h) => h.title).sort()).toEqual(["French Revolution", "French Revolution", "Industrial Revolution", "Industrial Revolution"]);
  });

  it("resolves plural question words to the singular title", async () => {
    const hits = await pack.search("How do vaccines train the immune system?");
    expect(hits[0].title).toBe("Vaccine");
  });

  it("reports popularity so callers can go sources-first on the long tail", async () => {
    const hits = await pack.search("Why was Kuala Kubu Bharu rebuilt?");
    expect(hits[0]).toMatchObject({ title: "Kuala Kubu Bharu", views: 900 });
  });

  it("asks the expansion callback only when the keyword search comes back thin", async () => {
    const expand = vi.fn(async () => ["Black hole"]);
    await pack.search("What is a black hole?", { expand });
    expect(expand).not.toHaveBeenCalled();
    const hits = await pack.search("Where do photons stay stuck eternally?", { expand, minHits: 1 });
    expect(expand).toHaveBeenCalledTimes(1);
    expect(hits.some((h) => h.title === "Black hole")).toBe(true);
  });

  it("resolves multi-word titles fuzzily but never single words", async () => {
    expect(await pack.resolveTitle("Kuala Kubu")).not.toBeNull();
    expect(await pack.resolveTitle("Kuala")).toBeNull();
  });
});
