import { describe, it, expect } from "vitest";
import {
  IMPORT_LIMITS,
  MAX_ASSET_IMPORT_BYTES,
  checkImportSize,
  formatBytes,
  importKindOfAsset,
  importKindOfDocument,
} from "./importLimits";
import { MODEL_CATALOG } from "./manifest";

describe("checkImportSize", () => {
  it("accepts a file exactly at the limit and rejects one byte over, with a clear message", () => {
    const limit = IMPORT_LIMITS["document-text"];
    expect(checkImportSize("document-text", limit)).toEqual({ ok: true });
    const r = checkImportSize("document-text", limit + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.limitBytes).toBe(limit);
      expect(r.message).toMatch(/^This file is 25\.0 MB\. Notes and text documents can be at most 25\.0 MB\. Split it/);
    }
  });

  it("has a cap per kind, tight for documents read into memory and loose for streamed assets", () => {
    expect(IMPORT_LIMITS["document-text"]).toBeLessThan(IMPORT_LIMITS["corpus-json"]);
    expect(IMPORT_LIMITS["corpus-json"]).toBeLessThan(IMPORT_LIMITS["places-pack"]);
    expect(IMPORT_LIMITS["places-pack"]).toBeLessThan(IMPORT_LIMITS.llm);
    expect(checkImportSize("places-pack", 5 * 1000 ** 3)).toMatchObject({ ok: false });
    expect(checkImportSize("llm", 13 * 1000 ** 3)).toEqual({ ok: true });
  });

  it("never rejects a curated catalog asset", () => {
    for (const a of MODEL_CATALOG) expect(checkImportSize(importKindOfAsset(a), a.sizeBytes), a.id).toEqual({ ok: true });
    expect(Math.max(...MODEL_CATALOG.map((a) => a.sizeBytes))).toBeLessThanOrEqual(MAX_ASSET_IMPORT_BYTES);
  });
});

describe("kinds", () => {
  it("maps catalog entries and document names", () => {
    expect(importKindOfAsset({ kind: "llm" })).toBe("llm");
    expect(importKindOfAsset({ kind: "embedding" })).toBe("embedding");
    expect(importKindOfAsset({ kind: "corpus", format: "poi-pack" })).toBe("places-pack");
    expect(importKindOfAsset({ kind: "corpus", format: "sqlite-pack" })).toBe("knowledge-pack");
    expect(importKindOfAsset({ kind: "corpus" })).toBe("corpus-json");
    expect(importKindOfDocument("Notes.PDF")).toBe("document-pdf");
    expect(importKindOfDocument("trip.md")).toBe("document-text");
  });

  it("formats sizes for people", () => {
    expect(formatBytes(20_811_776)).toBe("20.8 MB");
    expect(formatBytes(986_048_768)).toBe("986.0 MB");
    expect(formatBytes(24 * 1000 ** 3)).toBe("24.0 GB");
    expect(formatBytes(10)).toBe("1 kB");
  });

  it("uses decimal units, as Android's file picker does (Prism N-14)", () => {
    // The crypto pack: 35.96 MB in the system picker, so 36.0 MB here, not 34.3 MB.
    expect(formatBytes(35_962_880)).toBe("36.0 MB");
    expect(formatBytes(1_500)).toBe("2 kB");
    expect(formatBytes(999_999_999)).toBe("1.0 GB");
    expect(formatBytes(999_600)).toBe("1.0 MB");
    expect(formatBytes(999_400)).toBe("999 kB");
    expect(formatBytes(1_000_000_000)).toBe("1.0 GB");
  });
});
