import { describe, it, expect } from "vitest";
import type { AnswerState } from "./answerReducer";
import { phaseAnnouncement, receiptDetails, receiptLine, stageLine } from "./presentation";

// Echoes the key and options, so tests check which string is picked and with what.
const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}${JSON.stringify(opts)}` : key);

const chunk = { chunkId: "c", docId: "d", title: "T", body: "b", score: 0, matchType: "hybrid" as const };
const receipt = { modelId: "q", modelLabel: "Qwen3 4B", tokens: 90, tokPerSec: 14.8, ttftMs: 2100, totalMs: 6200, reasonCodes: [] };

describe("stageLine", () => {
  it("says searching before anything happens", () => {
    expect(stageLine({ answerIds: ["a"], sources: [] }, t)).toBe("chat.stage.searching");
  });

  it("counts the sources being read", () => {
    const s: AnswerState = { answerIds: ["a"], sources: [chunk, chunk], fast: { text: "", stage: "prefill" } };
    expect(stageLine(s, t)).toBe('chat.stage.reading{"count":2}');
  });

  it("numbers the parts of a deep pass from 1", () => {
    const s: AnswerState = {
      answerIds: ["a"],
      sources: [],
      fast: { text: "x", stage: null, outcome: "success" },
      deep: { text: "", stage: "synthesizing", detail: { index: 0, count: 3 } },
    };
    expect(stageLine(s, t)).toBe('chat.stage.part{"index":1,"count":3}');
  });

  it("shows nothing once text streams or the answer is done", () => {
    expect(stageLine({ answerIds: ["a"], sources: [], fast: { text: "x", stage: "generating" } }, t)).toBeNull();
    expect(stageLine({ answerIds: ["a"], sources: [], fast: { text: "x", stage: null, outcome: "success" } }, t)).toBeNull();
  });
});

describe("phaseAnnouncement", () => {
  const state: AnswerState = { answerIds: ["a"], sources: [chunk, chunk, chunk] };
  it("announces transitions, never tokens, and errors assertively", () => {
    expect(phaseAnnouncement("searching", state, t)).toEqual({ message: "chat.announce.searching" });
    expect(phaseAnnouncement("done", state, t)).toEqual({ message: 'chat.announce.ready{"count":3}' });
    expect(phaseAnnouncement("error", state, t)).toEqual({ message: "chat.error.generic", assertive: true });
    expect(phaseAnnouncement("reading", state, t)).toBeNull();
  });
});

describe("receiptLine", () => {
  it("lists model, speed, time to first token and total", () => {
    expect(receiptLine(receipt, "pt-BR", t)).toBe(
      'Qwen3 4B · 14,8 tok/s · chat.receipt.started{"time":"2,1 s"} · 6,2 s · chat.receipt.offline'
    );
  });

  it("uses the source-passage form for extractive answers", () => {
    expect(receiptLine({ ...receipt, modelId: "extractive", tokens: 0, totalMs: 400 }, "en-US", t)).toBe(
      "chat.receipt.sourcePassage · 0.4 s · chat.receipt.offline"
    );
  });

  it("omits speed when nothing was generated", () => {
    expect(receiptLine({ ...receipt, tokens: 0, tokPerSec: 0, ttftMs: 0 }, "en-US", t)).toBe(
      "Qwen3 4B · 6.2 s · chat.receipt.offline"
    );
  });
});

describe("receiptDetails", () => {
  it("includes measured prefill and context only when present", () => {
    const labels = (r: typeof receipt & Record<string, unknown>) => receiptDetails(r, "en-US", t).map((d) => d.label);
    expect(labels(receipt)).not.toContain("chat.receipt.prefill");
    expect(labels({ ...receipt, prefillMs: 900, ctxTokens: 1100 })).toEqual(
      expect.arrayContaining(["chat.receipt.prefill", "chat.receipt.context"])
    );
  });
});
