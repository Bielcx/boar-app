/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nodeSqliteDatabase } from "../rag/testing/nodeSqlite";

let current: ReturnType<typeof nodeSqliteDatabase>;
let files: Record<string, string> = {};
let onEmbed: () => void = () => {};
let deleted: string[] = [];
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: async () => current, deleteDatabaseAsync: async () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async (uri: string) => {
    if (!(uri in files)) throw new Error(`no such file ${uri}`);
    return files[uri];
  },
  cacheDirectory: "file:///cache/",
  deleteAsync: async (uri: string) => void deleted.push(uri),
}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-sharing", () => ({}));
vi.mock("expo-pdf-text-extract", () => ({ extractText: async () => "" }));
vi.mock("../rag/embed", () => ({
  embeddingEngine: { embed: async () => (onEmbed(), new Float32Array([1, 0, 0, 0])) },
}));

const asset = (name: string) => ({ uri: `file:///${name}`, name, size: 10 }) as any;
const count = (sql: string) => (current.raw.prepare(sql).get() as { n: number }).n;

describe("importDocuments", () => {
  beforeEach(() => {
    vi.resetModules();
    current = nodeSqliteDatabase();
    onEmbed = () => {};
    deleted = [];
    files = { "file:///notes.txt": "word ".repeat(1200), "file:///b.md": "short note" };
  });

  it("indexes the files and reports the collection as indexed", async () => {
    const { importDocuments } = await import("./documentImporter");
    const { getCollectionIndexStatus } = await import("../rag/indexStatus");
    const c = await importDocuments([asset("notes.txt"), asset("b.md")], "My notes");
    expect(c).toMatchObject({ name: "My notes", docCount: 2, chunkCount: 5 });
    expect(getCollectionIndexStatus()[c.id]).toEqual({ state: "indexed", done: 5, total: 5 });
    expect(count(`SELECT COUNT(*) AS n FROM chunks WHERE collection_id = '${c.id}'`)).toBe(5);
  });

  it("cancelling mid-import removes everything and leaves no state, as if it never started", async () => {
    const { importDocuments, ImportCancelledError } = await import("./documentImporter");
    const { getCollectionIndexStatus } = await import("../rag/indexStatus");
    const ctrl = new AbortController();
    let n = 0;
    onEmbed = () => {
      if (++n === 2) ctrl.abort();
    };
    await expect(importDocuments([asset("notes.txt"), asset("b.md")], "Big", undefined, ctrl.signal)).rejects.toBeInstanceOf(ImportCancelledError);
    expect(count("SELECT COUNT(*) AS n FROM chunks")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM chunks_fts")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM custom_collections")).toBe(0);
    expect(Object.keys(getCollectionIndexStatus()).filter((k) => k.endsWith("-big"))).toEqual([]);
  });

  it("a failed import reports an error and leaves no orphaned chunks", async () => {
    const { importDocuments } = await import("./documentImporter");
    const { getCollectionIndexStatus } = await import("../rag/indexStatus");
    await (await import("../rag/db")).getDb();
    await expect(importDocuments([asset("b.md"), asset("missing.txt")], "Broken")).rejects.toThrow(/no such file/);
    const errors = Object.entries(getCollectionIndexStatus()).filter(([k, v]) => k.endsWith("-broken") && v.state === "error");
    expect(errors).toHaveLength(1);
    expect(count("SELECT COUNT(*) AS n FROM chunks")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM custom_collections")).toBe(0);
  });

  it("deletes the picker's cache copies after an import, successful or not, and never the originals", async () => {
    const { importDocuments } = await import("./documentImporter");
    files["file:///cache/DocumentPicker/secret.txt"] = "private words";
    await importDocuments([asset("cache/DocumentPicker/secret.txt"), asset("b.md")], "Secret");
    expect(deleted).toEqual(["file:///cache/DocumentPicker/secret.txt"]);
    deleted = [];
    await expect(importDocuments([asset("cache/DocumentPicker/secret.txt"), asset("missing.txt")], "Broken")).rejects.toThrow(/no such file/);
    expect(deleted).toEqual(["file:///cache/DocumentPicker/secret.txt"]);
  });

  it("refuses a document over the size limit before reading it", async () => {
    const { importDocuments } = await import("./documentImporter");
    await (await import("../rag/db")).getDb();
    const huge = { uri: "file:///huge.txt", name: "huge.txt", size: 26 * 1024 * 1024 } as any;
    await expect(importDocuments([huge], "Huge")).rejects.toThrow(/at most 25/);
    expect(count("SELECT COUNT(*) AS n FROM custom_collections")).toBe(0);
  });
});
