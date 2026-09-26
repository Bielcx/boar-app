import { describe, it, expect } from "vitest";
import type { RetrievedChunk } from "../../rag/retrieve.types";
import type { AnswerEvent, AnswerReceipt as Receipt } from "./answerEvents";
import {
  answerPhase,
  answerReducer,
  attachAnswer,
  canDeepen,
  initialAnswer,
  isAnswerActive,
  type AnswerState,
} from "./answerReducer";

const chunk = (id: string): RetrievedChunk => ({
  chunkId: id,
  docId: `doc-${id}`,
  title: `Title ${id}`,
  body: `Body ${id}`,
  score: 0.5,
  matchType: "hybrid",
});

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  modelId: "qwen3-4b",
  modelLabel: "Qwen3 4B",
  tokens: 120,
  tokPerSec: 14.8,
  ttftMs: 2100,
  totalMs: 6200,
  reasonCodes: [],
  ...over,
});

const run = (events: AnswerEvent[], id = "a1"): AnswerState => events.reduce(answerReducer, initialAnswer(id));

describe("answerReducer", () => {
  it("walks a fast answer through searching, reading, generating and done", () => {
    const steps: AnswerEvent[] = [
      { answerId: "a1", type: "stage", stage: "retrieving", tier: "fast", at: 0 },
      { answerId: "a1", type: "sources", tier: "fast", sources: [chunk("x"), chunk("y")] },
      { answerId: "a1", type: "stage", stage: "prefill", tier: "fast", at: 1 },
      { answerId: "a1", type: "token", tier: "fast", text: "Raft " },
      { answerId: "a1", type: "token", tier: "fast", text: "elects [1]." },
      { answerId: "a1", type: "done", tier: "fast", outcome: "success", receipt: receipt() },
    ];
    const phases = steps.map((_, i) => answerPhase(run(steps.slice(0, i + 1))));
    expect(phases).toEqual(["searching", "searching", "reading", "generating", "generating", "done"]);

    const final = run(steps);
    expect(final.fast?.text).toBe("Raft elects [1].");
    expect(final.fast?.receipt?.tokPerSec).toBe(14.8);
    expect(final.sources.map((s) => s.chunkId)).toEqual(["x", "y"]);
    expect(isAnswerActive(final)).toBe(false);
  });

  it("ignores events from another answer", () => {
    const state = run([
      { answerId: "old", type: "token", tier: "fast", text: "stale" },
      { answerId: "old", type: "sources", tier: "fast", sources: [chunk("z")] },
    ]);
    expect(state).toEqual(initialAnswer("a1"));
  });

  it("keeps source numbering stable and deduplicated across tiers", () => {
    const state = run([
      { answerId: "a1", type: "sources", tier: "fast", sources: [chunk("x"), chunk("y")] },
      { answerId: "a1", type: "sources", tier: "deep", sources: [chunk("y"), chunk("z")] },
    ]);
    expect(state.sources.map((s) => s.chunkId)).toEqual(["x", "y", "z"]);
  });

  it("does not change a tier after its done", () => {
    const state = run([
      { answerId: "a1", type: "token", tier: "fast", text: "partial" },
      { answerId: "a1", type: "done", tier: "fast", outcome: "stopped", receipt: receipt() },
      { answerId: "a1", type: "token", tier: "fast", text: " late" },
      { answerId: "a1", type: "stage", stage: "generating", tier: "fast", at: 9 },
      { answerId: "a1", type: "done", tier: "fast", outcome: "success", receipt: receipt() },
    ]);
    expect(state.fast?.text).toBe("partial");
    expect(answerPhase(state)).toBe("stopped");
  });

  it("carries the error code for the error notice", () => {
    const state = run([
      {
        answerId: "a1",
        type: "done",
        tier: "fast",
        outcome: "error",
        receipt: receipt({ tokens: 0 }),
        error: { code: "oom", message: "out of memory" },
      },
    ]);
    expect(answerPhase(state)).toBe("error");
    expect(state.fast?.error?.code).toBe("oom");
  });

  it("treats an extractive instant answer as done without a model pass", () => {
    const state = run([
      { answerId: "a1", type: "sources", tier: "instant", sources: [chunk("x")] },
      { answerId: "a1", type: "instant", snippet: { text: "Canberra is the capital.", sourceIndex: 1 }, confidence: 0.92 },
      { answerId: "a1", type: "done", tier: "instant", outcome: "success", receipt: receipt({ modelId: "extractive", tokens: 0 }) },
    ]);
    expect(state.instant?.confidence).toBe(0.92);
    expect(state.extractiveReceipt?.modelId).toBe("extractive");
    expect(state.fast).toBeUndefined();
    expect(answerPhase(state)).toBe("done");
  });

  it("offers Deepen only after a successful fast pass, and hands the phase to the deep pass", () => {
    const fastDone: AnswerEvent[] = [
      { answerId: "a1", type: "token", tier: "fast", text: "Short answer." },
      { answerId: "a1", type: "done", tier: "fast", outcome: "success", receipt: receipt() },
    ];
    expect(canDeepen(run(fastDone))).toBe(false);

    const offered = run([...fastDone, { answerId: "a1", type: "deep_available", estSeconds: 120 }]);
    expect(canDeepen(offered)).toBe(true);

    const deepening = answerReducer(attachAnswer(offered, "a2"), {
      answerId: "a2",
      type: "stage",
      stage: "synthesizing",
      tier: "deep",
      at: 5,
      detail: { index: 1, count: 3 },
    });
    expect(canDeepen(deepening)).toBe(false);
    expect(answerPhase(deepening)).toBe("synthesizing");
    expect(deepening.deep?.detail).toEqual({ index: 1, count: 3 });
    expect(deepening.fast?.text).toBe("Short answer.");
  });

  it("flags a model whose weights stream from storage", () => {
    const state = run([
      { answerId: "a1", type: "warning", code: "model_streams_from_storage", message: "slow" },
    ]);
    expect(state.streamsFromStorage).toBe(true);
  });

  it("does not offer Deepen after a stopped fast pass", () => {
    const state = run([
      { answerId: "a1", type: "done", tier: "fast", outcome: "stopped", receipt: receipt() },
      { answerId: "a1", type: "deep_available" },
    ]);
    expect(canDeepen(state)).toBe(false);
  });
});
