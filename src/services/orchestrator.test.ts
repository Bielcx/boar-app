import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedChunk } from "../rag/retrieve.types";

const chunk = (id: string, title: string, body: string): RetrievedChunk => ({
  chunkId: id,
  docId: id,
  title,
  body,
  score: 1,
  matchType: "hybrid",
});
const FR = chunk("fr", "French Revolution", "The French Revolution began in 1789 with a financial crisis in France.");
const IR = chunk("ir", "Industrial Revolution", "The Industrial Revolution began in Britain around 1760 with textile machines.");
const EU = chunk("eu", "Europe", "In Europe, the French Revolution and the Industrial Revolution were both caused by deep economic change.");

const calls: { messages?: { role: string; content: string }[]; prompt?: string }[] = [];
let hasTemplate = true;

vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    hasEmbeddedChatTemplate: () => hasTemplate,
    generate: async (opts: { messages?: { role: string; content: string }[]; prompt?: string; onToken?: (p: string) => void }) => {
      calls.push(opts);
      const text = opts.messages?.map((m) => m.content).join("\n") ?? opts.prompt ?? "";
      if (text.includes("Break this research question")) return "What caused the French Revolution?\nWhat caused the Industrial Revolution?";
      opts.onToken?.("ok");
      return "ok [1]";
    },
  },
}));

const OFF = chunk("off", "Dean Lee", "Dean Lee is an American nuclear theorist who works on quantum computing algorithms.");
let withOffTopic = false;
vi.mock("../rag/retrieve", () => ({
  retrieve: async (q: string) => [...(q.includes("French") ? [FR, EU] : [EU, IR]), ...(withOffTopic ? [OFF] : [])],
}));

import { runDeepResearch } from "./orchestrator";

beforeEach(() => {
  calls.length = 0;
  hasTemplate = true;
  withOffTopic = false;
});

const text = (c: (typeof calls)[number]) => c.messages?.map((m) => m.content).join("\n") ?? c.prompt ?? "";

describe("runDeepResearch citations", () => {
  it("numbers sources globally and deduplicates chunks shared by sub-questions", async () => {
    let emitted: RetrievedChunk[] = [];
    const r = await runDeepResearch("Compare the causes of both revolutions", undefined, undefined, 256, undefined, undefined, undefined, {
      onSources: (s) => (emitted = s),
    });
    const ids = r.citations.map((c) => c.chunkId);
    // Every source once, even though both sub-questions retrieved "Europe".
    expect([...ids].sort()).toEqual(["eu", "fr", "ir"]);
    expect(emitted).toEqual(r.citations);
    // "Europe" carries the same global number in both sub-question prompts, matching citations[n-1].
    const euNumber = ids.indexOf("eu") + 1;
    const first = text(calls[1]);
    const second = text(calls[2]);
    expect(first).toContain(`[${euNumber}] Europe`);
    expect(second).toContain(`[${euNumber}] Europe`);
    expect(second).toContain(`[${ids.indexOf("ir") + 1}] Industrial Revolution`);
  });

  it("an off-topic source is not read, numbered or shown (onTopic per sub-question)", async () => {
    withOffTopic = true;
    let emitted: RetrievedChunk[] = [];
    const r = await runDeepResearch("Compare the causes of both revolutions", undefined, undefined, 256, undefined, undefined, undefined, {
      onSources: (s) => (emitted = s),
    });
    expect(r.citations.map((c) => c.chunkId).sort()).toEqual(["eu", "fr", "ir"]);
    expect(emitted.map((c) => c.title)).not.toContain("Dean Lee");
    expect(calls.map(text).join("\n")).not.toContain("Dean Lee");
  });

  it("uses the model's chat template when the GGUF ships one, plain prompts otherwise", async () => {
    await runDeepResearch("Compare the causes of both revolutions", undefined, undefined, 256);
    expect(calls.every((c) => Array.isArray(c.messages) && c.prompt === undefined)).toBe(true);
    calls.length = 0;
    hasTemplate = false;
    await runDeepResearch("Compare the causes of both revolutions", undefined, undefined, 256);
    expect(calls.every((c) => typeof c.prompt === "string" && c.messages === undefined)).toBe(true);
  });

  it("stops between stages", async () => {
    let n = 0;
    const r = await runDeepResearch("q", undefined, undefined, 256, undefined, undefined, () => ++n > 1);
    expect(r.answer).toBe("");
  });
});
