import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, TIERS } from "../../models/manifest";
import { PACKAGES, packageAssets, planPackage, storageShortfall, transferSeconds } from "./packages";

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
