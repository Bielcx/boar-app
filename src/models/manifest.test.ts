import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOG,
  REQUIRED_MODELS,
  ANSWER_MODELS,
  DEFAULT_ANSWER_MODEL,
  COMPACT_ANSWER_MODEL,
  CORPUS_CATALOG,
  TIERS,
  STORAGE_BUDGET_BYTES,
  totalManifestBytes,
} from "./manifest";

describe("totalManifestBytes", () => {
  it("sums asset sizes", () => {
    expect(totalManifestBytes(MODEL_CATALOG)).toBe(
      MODEL_CATALOG.reduce((sum, a) => sum + a.sizeBytes, 0)
    );
  });

  it("stays within the 50GB storage budget even if every catalog model were installed", () => {
    expect(totalManifestBytes(MODEL_CATALOG)).toBeLessThanOrEqual(STORAGE_BUDGET_BYTES);
  });
});

describe("answer models and the setup set", () => {
  it("has exactly one default (Qwen3-4B-2507) and one compact (Qwen2.5-1.5B) answer model, neither required", () => {
    expect(ANSWER_MODELS.map((m) => [m.id, m.answerTier])).toEqual([
      ["qwen3-4b-instruct-2507-q4km", "default"],
      ["qwen2.5-1.5b-instruct-q4km", "compact"],
    ]);
    for (const m of ANSWER_MODELS) {
      expect(m.kind).toBe("llm");
      expect(m.required).toBe(false);
    }
    expect(DEFAULT_ANSWER_MODEL.license).toBe("Apache-2.0");
    expect(COMPACT_ANSWER_MODEL.sizeBytes).toBeLessThan(DEFAULT_ANSWER_MODEL.sizeBytes);
  });

  it("requires only the embedding model; the default setup set adds the default answer model (~2.5GB total)", () => {
    expect(MODEL_CATALOG.filter((m) => m.required).map((m) => m.kind)).toEqual(["embedding"]);
    expect(REQUIRED_MODELS.map((m) => m.kind).sort()).toEqual(["embedding", "llm"]);
    expect(REQUIRED_MODELS.find((m) => m.kind === "llm")?.id).toBe("qwen3-4b-instruct-2507-q4km");
    expect(REQUIRED_MODELS.reduce((sum, m) => sum + m.sizeBytes, 0)).toBeLessThan(2.7 * 1024 ** 3);
  });

  it("every setup model has a non-empty checksum and filename", () => {
    for (const m of [...REQUIRED_MODELS, ...ANSWER_MODELS]) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.filename.length).toBeGreaterThan(0);
    }
  });
});

describe("MODEL_CATALOG", () => {
  it("has unique ids and filenames", () => {
    const ids = MODEL_CATALOG.map((m) => m.id);
    const filenames = MODEL_CATALOG.map((m) => m.filename);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(filenames).size).toBe(filenames.length);
  });

  it("every catalog entry has a non-empty checksum, size, and source URL", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.sizeBytes).toBeGreaterThan(0);
      expect(m.sourceUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("TIERS", () => {
  const corpusIds = new Set(CORPUS_CATALOG.map((c) => c.id));

  it("every tier's corpusPackIds reference a real corpus catalog entry", () => {
    for (const tier of TIERS) {
      for (const id of tier.corpusPackIds) {
        expect(corpusIds.has(id)).toBe(true);
      }
    }
  });

  it("higher tiers are supersets of lower tiers' corpus packs (minimum -> standard -> full -> encyclopedia)", () => {
    const byId = Object.fromEntries(TIERS.map((t) => [t.id, new Set(t.corpusPackIds)]));
    for (const id of byId.minimum) expect(byId.standard.has(id)).toBe(true);
    for (const id of byId.standard) expect(byId.full.has(id)).toBe(true);
    for (const id of byId.full) expect(byId.encyclopedia.has(id)).toBe(true);
  });
});

describe("sourceUrl pinning", () => {
  // A branch URL (resolve/main, raw/.../main/) can change under us: the file
  // would then fail its sha256 check and block every new install at setup.
  const IMMUTABLE = [
    /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/[^/]+$/,
    /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//,
    // Release assets are addressed by tag; the sha256 check still guards them.
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/,
  ];

  it("every catalog entry points at a commit or release, never a branch", () => {
    for (const m of MODEL_CATALOG) {
      expect(IMMUTABLE.some((re) => re.test(m.sourceUrl)), `${m.id}: ${m.sourceUrl}`).toBe(true);
    }
  });
});
