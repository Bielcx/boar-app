import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, TIERS } from "../../models/manifest";
import { answerModelChoices, PACKAGES, packageAssets, planPackage, storageShortfall, suggestCompact, transferSeconds } from "./packages";

const tier = (id: string) => TIERS.find((t) => t.id === id)!;

describe("PACKAGES", () => {
  it("maps every package to a tier that exists in the manifest", () => {
    for (const p of PACKAGES) expect(TIERS.some((t) => t.id === p.tier)).toBe(true);
  });
});

describe("packageAssets", () => {
  it("always includes the required models plus the tier's packs", () => {
    const assets = packageAssets(tier("encyclopedia"), MODEL_CATALOG);
    for (const m of MODEL_CATALOG.filter((m) => m.required)) expect(assets).toContain(m);
    expect(assets.map((a) => a.id)).toEqual(expect.arrayContaining(tier("encyclopedia").corpusPackIds));
    expect(assets.filter((a) => a.kind === "llm" && !a.required)).toHaveLength(0);
  });
});

describe("planPackage", () => {
  const assets = packageAssets(tier("full"), MODEL_CATALOG);
  const total = assets.reduce((s, a) => s + a.sizeBytes, 0);

  it("downloads everything on a fresh install", () => {
    const plan = planPackage(assets, {});
    expect(plan.downloadBytes).toBe(total);
    expect(plan.installedBytes).toBe(total);
    expect(plan.pending).toHaveLength(assets.length);
  });

  it("skips what is already on disk but still counts it as installed", () => {
    const llm = assets.find((a) => a.kind === "llm")!;
    const plan = planPackage(assets, { [llm.id]: true });
    expect(plan.downloadBytes).toBe(total - llm.sizeBytes);
    expect(plan.installedBytes).toBe(total);
  });

  it("picks the biggest language model for the memory check", () => {
    const small = { ...MODEL_CATALOG[0], id: "a", kind: "llm" as const, sizeBytes: 1 };
    const big = { ...small, id: "b", sizeBytes: 2 };
    expect(planPackage([small, big], {}).largestLlm?.id).toBe("b");
    expect(planPackage([], {}).largestLlm).toBeUndefined();
  });
});

describe("transferSeconds", () => {
  it("divides by the assumed speed and stays unknown without one", () => {
    expect(transferSeconds(10_000_000, 5_000_000)).toBe(2);
    expect(transferSeconds(1, 0)).toBeUndefined();
    expect(transferSeconds(1, undefined)).toBeUndefined();
  });
});

describe("storageShortfall", () => {
  it("reports missing bytes and never blocks on unknown free space", () => {
    expect(storageShortfall(100, 40)).toBe(60);
    expect(storageShortfall(100, 400)).toBe(0);
    expect(storageShortfall(100, 0)).toBe(0);
  });
});

describe("answer model choice", () => {
  const embedding = MODEL_CATALOG.find((m) => m.kind === "embedding" && m.required)!;
  const big = { ...MODEL_CATALOG[0], id: "qwen3-4b", kind: "llm" as const, required: false, answerTier: "default" as const, sizeBytes: 2_500 };
  const small = { ...MODEL_CATALOG[0], id: "qwen2.5-1.5b", kind: "llm" as const, required: false, answerTier: "compact" as const, sizeBytes: 1_000 };

  it("reads default and compact from answerTier", () => {
    const choices = answerModelChoices([embedding, big, small]);
    expect(choices.default?.id).toBe("qwen3-4b");
    expect(choices.compact?.id).toBe("qwen2.5-1.5b");
  });

  it("falls back to the required language model and no compact option", () => {
    const choices = answerModelChoices(MODEL_CATALOG);
    expect(choices.default?.id).toBe(MODEL_CATALOG.find((m) => m.kind === "llm" && m.required)!.id);
    expect(choices.compact).toBeUndefined();
  });

  it("installs the chosen answer model with the search model and the packs", () => {
    const assets = packageAssets(tier("full"), [embedding, big, small, ...MODEL_CATALOG.filter((m) => m.kind === "corpus")], small);
    expect(assets.filter((a) => a.kind === "llm").map((a) => a.id)).toEqual(["qwen2.5-1.5b"]);
    expect(assets).toContain(embedding);
  });

  it("suggests the compact model only when the default won't run well", () => {
    expect(suggestCompact("insufficient")).toBe(true);
    expect(suggestCompact("thrashing")).toBe(true);
    expect(suggestCompact("streaming")).toBe(false);
    expect(suggestCompact("resident")).toBe(false);
    expect(suggestCompact(undefined)).toBe(false);
  });
});
