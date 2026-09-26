import { describe, it, expect } from "vitest";
import { DepthInput, DepthModel, planAnswer, resolveDeepModel } from "./depth";

const GB = 1024 ** 3;
const qwen15: DepthModel = { id: "qwen1.5", label: "Qwen 1.5B", sizeBytes: 1 * GB, roles: ["fast"] };
const lfm8: DepthModel = { id: "lfm8", label: "LFM2.5 8B-A1B", sizeBytes: 5 * GB, roles: [] };
const qwen7: DepthModel = { id: "qwen7", label: "Qwen 7B", sizeBytes: 4.7 * GB, roles: ["reasoning", "verifier"] };
const moe30: DepthModel = { id: "qwen3-30b", label: "Qwen3 30B-A3B", sizeBytes: 11 * GB, roles: ["reasoning"], fit: "streaming" };

const base = (over: Partial<DepthInput> = {}): DepthInput => ({
  taskType: "chat",
  requestedTier: "auto",
  quickFirst: true,
  alwaysComplete: false,
  fastModel: qwen15,
  deepModel: null,
  verifiers: [],
  hasReusedSources: false,
  ...over,
});

describe("planAnswer respects the user's model", () => {
  it("answers every task type with the picked model, never a curated 'fast' one (review C1)", () => {
    for (const taskType of ["chat", "lookup", "summarize", "compare", "research"] as const) {
      const plan = planAnswer(base({ taskType, fastModel: lfm8 }));
      expect(plan.generation?.modelId).toBe("lfm8");
      expect(plan.generation?.tier).toBe("fast");
    }
  });

  it("reports no model instead of inventing one", () => {
    const plan = planAnswer(base({ fastModel: null }));
    expect(plan.generation).toBeNull();
    expect(plan.reasonCodes).toContain("generate:no-model");
  });
});

describe("planAnswer toggle matrix (answerQuickFirst / answerAlwaysComplete)", () => {
  it("on/off (default): instant may finish a lookup; other questions get a preview, the fast answer and a deep offer", () => {
    const lookup = planAnswer(base({ taskType: "lookup" }));
    expect(lookup.instant).toBe("may-finish");
    expect(lookup.generation?.tier).toBe("fast");
    const chat = planAnswer(base({ taskType: "chat" }));
    expect(chat.instant).toBe("preview");
    expect(chat.offerDeep).toBe(true);
  });

  it("on/on: instant is only a preview, then straight to the complete answer (no fast pass)", () => {
    const plan = planAnswer(base({ taskType: "lookup", alwaysComplete: true, deepModel: moe30 }));
    expect(plan.instant).toBe("preview");
    expect(plan.generation).toMatchObject({ tier: "deep", modelId: "qwen3-30b", mode: "single" });
    expect(plan.offerDeep).toBe(false);
  });

  it("off/on: no preview, complete answer", () => {
    const plan = planAnswer(base({ quickFirst: false, alwaysComplete: true }));
    expect(plan.instant).toBe("off");
    expect(plan.generation?.tier).toBe("deep");
  });

  it("off/off: no preview, always the picked model, deepening only on request", () => {
    const plan = planAnswer(base({ quickFirst: false, taskType: "lookup" }));
    expect(plan.instant).toBe("off");
    expect(plan.generation).toMatchObject({ tier: "fast", modelId: "qwen1.5" });
    expect(plan.offerDeep).toBe(true);
  });
});

describe("planAnswer deep tier", () => {
  it("uses the deep model in one pass over more context when one is usable", () => {
    const plan = planAnswer(base({ requestedTier: "deep", deepModel: moe30 }));
    expect(plan.generation).toMatchObject({ tier: "deep", modelId: "qwen3-30b", mode: "single", retrieveK: 10, contextTokens: 2400 });
    expect(plan.instant).toBe("off");
  });

  it("falls back to multi-pass on the picked model when no deep model fits (research preset reachable on a default install)", () => {
    const plan = planAnswer(base({ requestedTier: "deep", deepModel: { ...moe30, fit: "thrashing" } }));
    expect(plan.generation).toMatchObject({ tier: "deep", modelId: "qwen1.5", mode: "multipass" });
  });

  it("verifies the complete answer with a distinct verifier (verification reachable)", () => {
    const plan = planAnswer(base({ alwaysComplete: true, deepModel: moe30, verifiers: [qwen7] }));
    expect(plan.verify).toEqual({ modelId: "qwen7" });
  });

  it("never lets a model verify its own answer", () => {
    const plan = planAnswer(base({ alwaysComplete: true, fastModel: qwen7, verifiers: [qwen7] }));
    expect(plan.verify).toBeNull();
    expect(plan.reasonCodes).toContain("verify:skipped-no-distinct-verifier");
  });

  it("reuses the deepened answer's sources instead of retrieving again", () => {
    const plan = planAnswer(base({ requestedTier: "deep", hasReusedSources: true, deepModel: moe30, verifiers: [qwen7] }));
    expect(plan.retrieve).toBe(false);
    expect(plan.verify).toEqual({ modelId: "qwen7" });
  });

  it("skips retrieval, instant and deep offers for greetings and calculations", () => {
    for (const taskType of ["greeting", "calculate"] as const) {
      const plan = planAnswer(base({ taskType }));
      expect(plan.retrieve).toBe(false);
      expect(plan.instant).toBe("off");
      expect(plan.offerDeep).toBe(false);
    }
  });
});

describe("resolveDeepModel", () => {
  it("picks the largest usable reasoning model other than the fast one", () => {
    expect(resolveDeepModel([qwen15, qwen7, moe30], "qwen1.5", undefined)?.id).toBe("qwen3-30b");
    expect(resolveDeepModel([qwen15, qwen7, moe30], "qwen3-30b", undefined)?.id).toBe("qwen7");
  });

  it("honors an explicit choice, including 'none'", () => {
    expect(resolveDeepModel([qwen15, lfm8, moe30], "qwen1.5", "lfm8")?.id).toBe("lfm8");
    expect(resolveDeepModel([qwen15, moe30], "qwen1.5", null)).toBeNull();
    expect(resolveDeepModel([qwen15], "qwen1.5", "missing")).toBeNull();
  });

  it("drops models that would not fit", () => {
    expect(resolveDeepModel([qwen15, { ...moe30, fit: "insufficient" }], "qwen1.5", undefined)).toBeNull();
  });
});
