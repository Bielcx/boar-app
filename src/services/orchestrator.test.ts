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
const EU = chunk("eu", "Europe", "Europe changed deeply after the revolution of 1789 and the industrial revolution.");

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

vi.mock("../rag/retrieve", () => ({
  retrieve: async (q: string) => (q.includes("French") ? [FR, EU] : [EU, IR]),
}));

import { runDeepResearch } from "./orchestrator";

beforeEach(() => {
  calls.length = 0;
  hasTemplate = true;
});

const text = (c: (typeof calls)[number]) => c.messages?.map((m) => m.content).join("\n") ?? c.prompt ?? "";

describe("runDeepResearch citations", () => {
  it("numbers sources globally and deduplicates chunks shared by sub-questions", async () => {
    let emitted: RetrievedChunk[] = [];
    const r = await runDeepResearch("Compare the causes of both revolutions", undefined, undefined, 256, undefined, undefined, undefined, {
      onSources: (s) => (emitted = s),
    });
    // FR=1, EU=2 from the first sub-question; EU keeps [2], IR becomes [3].
    expect(r.citations.map((c) => c.chunkId)).toEqual(["fr", "eu", "ir"]);
    expect(emitted).toEqual(r.citations);
    const second = text(calls[2]);
    expect(second).toMatch(/\[2\] Europe/);
    expect(second).toMatch(/\[3\] Industrial Revolution/);
    expect(second).not.toMatch(/\[1\] Europe/);
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
