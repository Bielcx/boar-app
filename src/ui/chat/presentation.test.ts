import { describe, it, expect } from "vitest";
import type { AnswerState } from "./answerReducer";
import { phaseAnnouncement, previewText, receiptDetails, receiptLine, receiptShort, stageLine, stageIcon, loadCrashMessage } from "./presentation";

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

  it("announces how many places were found, or asks for the city", () => {
    const places = (coverage: "ok" | "none" | "no_pack" | "needs_place", n: number): AnswerState => ({
      answerIds: ["a"],
      sources: [],
      places: {
        places: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, lat: 0, lon: 0, source: "osm" as const })),
        area: { kind: "city", label: "Lisboa" },
        criterion: "diet_match",
        coverage,
        attribution: [],
      },
    });
    expect(phaseAnnouncement("done", places("ok", 4), t)).toEqual({ message: 'chat.announce.placesFound{"count":4}' });
    expect(phaseAnnouncement("done", places("none", 0), t)).toEqual({
      message: 'chat.places.noneInCity{"city":"Lisboa","filter":null}',
    });
    expect(phaseAnnouncement("done", places("no_pack", 0), t)).toEqual({ message: "chat.places.noPackTitle" });
    expect(phaseAnnouncement("done", places("needs_place", 0), t)).toEqual({ message: "chat.places.whichCity" });
  });
});

describe("receiptLine", () => {
  it("lists model, speed, time to first token and total", () => {
    expect(receiptLine(receipt, "pt-BR", t)).toBe(
      'chat.receipt.answeredIn{"time":"6,2 s"} · Qwen3 4B · 14,8 tok/s · chat.receipt.started{"time":"2,1 s"} · chat.receipt.offline'
    );
  });

  it("uses the source-passage form for extractive answers", () => {
    expect(receiptLine({ ...receipt, modelId: "extractive", tokens: 0, totalMs: 400 }, "en-US", t)).toBe(
      'chat.receipt.answeredIn{"time":"0.4 s"} · chat.receipt.sourcePassage · chat.receipt.offline'
    );
    expect(receiptLine({ ...receipt, modelId: "places", tokens: 0, totalMs: 300 }, "en-US", t)).toBe(
      'chat.receipt.answeredIn{"time":"0.3 s"} · chat.receipt.offlineMap · chat.receipt.offline'
    );
  });

  it("omits speed when nothing was generated", () => {
    expect(receiptLine({ ...receipt, tokens: 0, tokPerSec: 0, ttftMs: 0 }, "en-US", t)).toBe(
      'chat.receipt.answeredIn{"time":"6.2 s"} · Qwen3 4B · chat.receipt.offline'
    );
  });
});

describe("receiptShort", () => {
  it("is the total time and speed, numbers only", () => {
    expect(receiptShort(receipt, "pt-BR")).toEqual(["6,2 s", "14,8 tok/s"]);
    expect(receiptShort(receipt, "en-US")).toEqual(["6.2 s", "14.8 tok/s"]);
  });

  it("keeps only the time when no model generated the answer", () => {
    expect(receiptShort({ ...receipt, modelId: "extractive", totalMs: 400 }, "en-US")).toEqual(["0.4 s"]);
    expect(receiptShort({ ...receipt, modelId: "places", totalMs: 300 }, "en-US")).toEqual(["0.3 s"]);
    expect(receiptShort({ ...receipt, tokPerSec: 0 }, "en-US")).toEqual(["6.2 s"]);
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

describe("previewText", () => {
  it("keeps short passages whole and cuts long ones at a word", () => {
    expect(previewText("Pinch the nose.")).toBe("Pinch the nose.");
    const long = "When attempting to stop a nosebleed at home, lean forward, pinch the soft part of the nose and keep the pressure for ten minutes without letting go.";
    const p = previewText(long, 60);
    expect(p.endsWith("…")).toBe(true);
    expect(p.length).toBeLessThanOrEqual(61);
    expect(long.startsWith(p.slice(0, -1))).toBe(true);
    expect(p).not.toMatch(/[ ,]…$/);
  });

  it("flattens line breaks", () => {
    expect(previewText("a\n\nb")).toBe("a b");
  });
});

describe("locating announcement", () => {
  it("says once that the app is finding the position and the city can be typed", () => {
    expect(phaseAnnouncement("locating", { answerIds: [], sources: [] } as AnswerState, t)).toEqual({ message: "chat.announce.locating" });
  });
});

describe("stageIcon", () => {
  it("gives each step the mockup's kind of icon", () => {
    expect(stageIcon("searching")).toBe("search");
    expect(stageIcon("generating")).toBe("zap");
    expect(stageIcon("locating")).toBe("map-pin");
    expect(stageIcon("done")).toBe("circle");
  });
});

describe("loadCrashMessage (Boar CR-2)", () => {
  it("names the model that closed the app and the one we went back to", () => {
    expect(loadCrashMessage({ crashedLabel: "Qwen3 4B", fallbackLabel: "Qwen2.5 1.5B" }, t)).toBe(
      'chat.loadCrash.message{"model":"Qwen3 4B","fallback":"Qwen2.5 1.5B"}'
    );
  });

  it("says nothing without a crash, and doesn't claim a switch back without a previous model", () => {
    expect(loadCrashMessage(null, t)).toBeNull();
    expect(loadCrashMessage({ crashedLabel: "Qwen3 4B", fallbackLabel: "" }, t)).toBe('chat.loadCrash.messageNoFallback{"model":"Qwen3 4B"}');
  });
});
