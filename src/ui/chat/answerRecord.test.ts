import { describe, it, expect } from "vitest";
import type { AnswerState } from "./answerReducer";
import { answerTextForHistory, fromStoredAnswer, toStoredAnswer } from "./answerRecord";

const receipt = { modelId: "q", modelLabel: "Qwen", tokens: 9, tokPerSec: 12, ttftMs: 800, totalMs: 2000, reasonCodes: [] };

const finished: AnswerState = {
  answerIds: ["m1", "m1-deep"],
  sources: [
    { chunkId: "c1", docId: "d1", title: "Raft", body: "Raft elects…", source: "Wikipedia", score: 0.7, matchType: "hybrid" },
  ],
  instant: { text: "Raft elects a leader.", sourceIndex: 1, confidence: 0.6 },
  fast: { text: "Short [1].", stage: null, outcome: "success", receipt },
  deep: { text: "Long [1].", stage: null, outcome: "stopped", receipt },
  deepAvailable: { estSeconds: 90 },
};

describe("answer records", () => {
  it("round-trips sources, snippet, passes and receipts", () => {
    const back = fromStoredAnswer("m1", "Short [1].", toStoredAnswer(finished));
    expect(back.sources[0]).toMatchObject({ chunkId: "c1", title: "Raft", source: "Wikipedia" });
    expect(back.instant?.text).toBe("Raft elects a leader.");
    expect(back.fast).toMatchObject({ text: "Short [1].", outcome: "success", receipt });
    expect(back.deep?.outcome).toBe("stopped");
    // Deepen is an in-session offer, not something to restore.
    expect(back.deepAvailable).toBeUndefined();
  });

  it("falls back to plain text for messages saved without meta or with bad meta", () => {
    for (const meta of [null, "{not json", JSON.stringify({ v: 99 })]) {
      const back = fromStoredAnswer("m2", "Old answer", meta);
      expect(back.fast).toMatchObject({ text: "Old answer", outcome: "success" });
      expect(back.sources).toEqual([]);
    }
  });

  it("restores an answer saved mid-generation as interrupted", () => {
    const running: AnswerState = { answerIds: ["m3"], sources: [], fast: { text: "part", stage: "generating" } };
    expect(fromStoredAnswer("m3", "part", toStoredAnswer(running)).fast?.outcome).toBe("interrupted");
  });

  it("keeps the error code", () => {
    const failed: AnswerState = {
      answerIds: ["m4"],
      sources: [],
      fast: { text: "", stage: null, outcome: "error", error: { code: "oom", message: "x" } },
    };
    expect(fromStoredAnswer("m4", "", toStoredAnswer(failed)).fast?.error?.code).toBe("oom");
  });

  it("gives later turns the deepest answer text", () => {
    expect(answerTextForHistory(finished)).toBe("Long [1].");
    expect(answerTextForHistory({ ...finished, deep: undefined })).toBe("Short [1].");
    expect(answerTextForHistory({ answerIds: ["x"], sources: [], instant: finished.instant })).toBe("Raft elects a leader.");
  });
});
