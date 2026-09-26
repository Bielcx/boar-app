import { describe, it, expect, beforeEach } from "vitest";
import type { RetrievedChunk } from "../rag/retrieve.types";
import { assemblePrompt, assembleChatMessages } from "../rag/pure";
import { AnswerDeps, createAnswerer, InstalledLlm } from "./answer";
import type { AnswerEvent } from "./events";
import type { AnswerSettings } from "../models/settings";
import type { GenerateOptions } from "../inference/LlamaEngine";
import { approxTokens } from "./context";

const chunk = (chunkId: string, title: string, body: string): RetrievedChunk => ({
  chunkId,
  docId: chunkId,
  title,
  body,
  score: 1,
  matchType: "hybrid",
});
const CANBERRA = chunk(
  "c1",
  "Canberra",
  "Canberra is the capital city of Australia. Founded following the federation of the colonies of Australia as the seat of government for the new nation, it is Australia's largest inland city. " +
    "The city is located at the northern end of the Australian Capital Territory, 280 km south-west of Sydney and 660 km north-east of Melbourne. " +
    "The site of Canberra was selected for the location of the nation's capital in 1908 as a compromise between Sydney and Melbourne. " +
    "The city was designed by the American architects Walter Burley Griffin and Marion Mahony Griffin after an international design contest."
);
const MOLD = chunk(
  "c2",
  "Mold",
  "A mold or mould is one of the structures that certain fungi can form. The dust-like, colored appearance of molds is due to the formation of spores. " +
    "Molds are considered to be microbes and do not form a specific taxonomic or phylogenetic grouping. Mold growth needs moisture."
);
const HALL = chunk(
  "c3",
  "Hall Primary School",
  "Hall Primary School is a government primary school in the village of Hall, in the Australian Capital Territory. It opened in 1912 and serves students from kindergarten to year six. " +
    "The school has a heritage-listed building and a small library."
);

const GB = 1024 ** 3;
const qwen15: InstalledLlm = { id: "qwen1.5", label: "Qwen 1.5B", filename: "models/q15.gguf", sizeBytes: GB, roles: ["fast"], isDefault: true };
const lfm: InstalledLlm = { id: "lfm8", label: "LFM2.5 8B-A1B", filename: "models/lfm.gguf", sizeBytes: 5 * GB, roles: [] };
const qwen7: InstalledLlm = { id: "qwen7", label: "Qwen 7B", filename: "models/q7.gguf", sizeBytes: 4.7 * GB, roles: ["reasoning", "verifier"] };
const moe: InstalledLlm = { id: "moe30", label: "Qwen3 30B-A3B", filename: "models/moe.gguf", sizeBytes: 11 * GB, roles: ["reasoning"] };

interface Fake {
  deps: AnswerDeps;
  loaded: string | null;
  loads: string[];
  generations: GenerateOptions[];
  concurrent: number;
  maxConcurrent: number;
  multipassCalls: number;
  settings: AnswerSettings;
  installed: InstalledLlm[];
  activeId: string | null;
  retrieved: RetrievedChunk[];
  loadError: string | null;
  verdict: string;
}

function makeFake(): Fake {
  let clock = 0;
  let stopped = false;
  const f: Fake = {
    loaded: null,
    loads: [],
    generations: [],
    concurrent: 0,
    maxConcurrent: 0,
    multipassCalls: 0,
    settings: { quickFirst: true, alwaysComplete: false, deepModelId: undefined },
    installed: [qwen15],
    activeId: "qwen1.5",
    retrieved: [CANBERRA, MOLD, HALL],
    loadError: null,
    verdict: "SUPPORTED. Matches [1].",
    deps: null as unknown as AnswerDeps,
  };
  f.deps = {
    now: () => (clock += 5),
    engine: {
      async load(filename) {
        if (f.loadError) throw new Error(f.loadError);
        f.loads.push(filename);
        f.loaded = filename;
        return { fit: null, warning: filename === moe.filename ? "streams from storage" : null };
      },
      async generate(opts) {
        f.generations.push(opts);
        f.concurrent++;
        f.maxConcurrent = Math.max(f.maxConcurrent, f.concurrent);
        stopped = false;
        await new Promise((r) => setTimeout(r, 5));
        if (opts.prompt?.includes("Verdict:")) {
          f.concurrent--;
          return f.verdict;
        }
        const out: string[] = [];
        for (const piece of ["Canberra ", "is ", "the ", "capital ", "[1]."]) {
          if (stopped) break;
          opts.onToken?.(piece);
          out.push(piece);
          await new Promise((r) => setTimeout(r, 1));
        }
        const promptText = opts.messages?.map((m) => m.content).join("\n") ?? opts.prompt ?? "";
        opts.onTimings?.({ promptTokens: approxTokens(promptText), promptMs: 120, predictedTokens: out.length, predictedMs: 50 });
        f.concurrent--;
        return out.join("");
      },
      async stop() {
        stopped = true;
      },
      getModelInfo: () => (f.loaded ? { filename: f.loaded } : null),
      hasEmbeddedChatTemplate: () => true,
      async estimateFit(filename) {
        return filename === moe.filename ? ({ verdict: "streaming" } as any) : ({ verdict: "resident" } as any);
      },
    },
    retrieve: async () => f.retrieved,
    getSettings: async () => f.settings,
    listInstalledLlms: async () => f.installed,
    getActiveModelId: async () => f.activeId,
    runMultipass: async (_q, _s, _h, _m, onProgress, onToken, _stop, options) => {
      f.multipassCalls++;
      onProgress({ stage: "researching", subQuestionIndex: 0, subQuestionCount: 2 });
      options.onSources?.([CANBERRA, HALL]);
      onProgress({ stage: "synthesizing" });
      onToken("Synth [2].");
      return { answer: "Synth [2].", subQuestions: ["a", "b"], citations: [CANBERRA, HALL] };
    },
    assemblePrompt,
    assembleChatMessages,
  };
  return f;
}

const ctx = { maxTokens: 256 };
let f: Fake;
beforeEach(() => {
  f = makeFake();
});

async function collect(query: string, tier?: "auto" | "fast" | "deep") {
  const events: AnswerEvent[] = [];
  const { answer } = createAnswerer(f.deps);
  const h = answer({ query, tier }, (e) => events.push(e), ctx);
  const result = await h.done;
  return { events, result, h };
}

const types = (events: AnswerEvent[]) => events.map((e) => (e.type === "stage" ? `stage:${e.stage}` : e.type));

describe("answer(): instant tier", () => {
  it("answers a confident lookup from the source with no model load", async () => {
    const { events, result } = await collect("What is the capital of Australia?");
    expect(types(events)).toEqual(["stage:retrieving", "sources", "instant", "done"]);
    expect(result.tier).toBe("instant");
    expect(result.receipt.modelId).toBe("extractive");
    expect(result.text).toMatch(/^Canberra is the capital city of Australia\./);
    expect(f.loads).toHaveLength(0);
    const instant = events.find((e) => e.type === "instant")!;
    // sourceIndex points into the emitted (compressed) sources.
    const sources = (events.find((e) => e.type === "sources") as any).sources as RetrievedChunk[];
    expect(sources[(instant as any).snippet.sourceIndex].title).toBe("Canberra");
    expect(sources.map((s) => s.title)).not.toContain("Mold");
  });

  it("every event carries the same answerId", async () => {
    const { events, result } = await collect("Why was Canberra chosen as the capital?");
    expect(new Set(events.map((e) => e.answerId))).toEqual(new Set([result.answerId]));
  });
});

describe("answer(): fast tier", () => {
  it("previews the source, then answers with the user's picked model over compressed context", async () => {
    f.installed = [qwen15, lfm];
    f.activeId = "lfm8";
    const { events, result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(types(events)).toEqual([
      "stage:retrieving",
      "sources",
      "instant",
      "stage:loading_model",
      "stage:prefill",
      "stage:generating",
      "token",
      "token",
      "token",
      "token",
      "token",
      "done",
      "deep_available",
    ]);
    expect(f.loads).toEqual([lfm.filename]);
    expect(result.tier).toBe("fast");
    expect(result.receipt).toMatchObject({ modelId: "lfm8", tokens: 5, prefillMs: 120, tokPerSec: 100 });
    // Measured prompt size before/after compression (PR evidence).
    const full = assembleChatMessages("Why was Canberra chosen as the capital of Australia?", f.retrieved).map((m) => m.content).join("\n");
    const before = approxTokens(full);
    const after = result.receipt.ctxTokens!;
    console.log(`[answer] prompt tokens: ${before} -> ${after}`);
    expect(after).toBeLessThan(before);
  });

  it("does not reload a model that is already resident", async () => {
    f.loaded = qwen15.filename;
    f.settings.quickFirst = false;
    const { events } = await collect("Tell me about Canberra's design");
    expect(types(events)).not.toContain("stage:loading_model");
  });

  it("reports load failures with an error code instead of throwing", async () => {
    f.settings.quickFirst = false;
    f.loadError = `"x" needs ~3GB of working memory that cannot be streamed from storage`;
    const { result, events } = await collect("Tell me about Canberra");
    expect(result.outcome).toBe("error");
    expect((events.at(-1) as any).error.code).toBe("oom");
  });

  it("reports no_model when nothing is installed", async () => {
    f.installed = [];
    f.settings.quickFirst = false;
    const { result, events } = await collect("Tell me about Canberra");
    expect((events.at(-1) as any).error.code).toBe("no_model");
    expect(result.outcome).toBe("error");
  });
});

describe("answer(): deep tier", () => {
  it("always-complete uses the deep model, warns that it streams, and verifies with a distinct verifier", async () => {
    f.installed = [qwen15, qwen7, moe];
    f.settings.alwaysComplete = true;
    const { events, result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(result.tier).toBe("deep");
    expect(result.receipt.modelId).toBe("moe30");
    expect(types(events)).toContain("warning");
    expect(types(events)).toContain("stage:verifying");
    expect(result.receipt.verification).toBe("passed");
    expect(f.loads).toEqual([moe.filename, qwen7.filename]);
    expect(types(events)).not.toContain("deep_available");
  });

  it("deepen() reuses the sources and falls back to multi-pass when there is no deep model", async () => {
    const events: AnswerEvent[] = [];
    const { deepen } = createAnswerer(f.deps);
    const result = await deepen("Compare Canberra and Sydney", [CANBERRA], (e) => events.push(e), ctx).done;
    expect(f.multipassCalls).toBe(1);
    expect(result.tier).toBe("deep");
    expect(result.sources.map((s) => s.chunkId)).toEqual(["c1", "c3"]);
    expect(types(events)).toContain("stage:synthesizing");
    expect(types(events)).not.toContain("instant");
  });
});

describe("answer(): double send", () => {
  it("stops the first answer and never runs two generations at once", async () => {
    f.settings.quickFirst = false;
    const { answer } = createAnswerer(f.deps);
    const e1: AnswerEvent[] = [];
    const e2: AnswerEvent[] = [];
    const h1 = answer({ query: "Tell me about Canberra" }, (e) => e1.push(e), ctx);
    const h2 = answer({ query: "Tell me about Canberra's design" }, (e) => e2.push(e), ctx);
    const [r1, r2] = await Promise.all([h1.done, h2.done]);
    expect(f.maxConcurrent).toBe(1);
    expect(r1.outcome).toBe("stopped");
    expect(r2.outcome).toBe("success");
    expect(e2.every((e) => e.answerId === h2.answerId)).toBe(true);
  });
});

describe("answer(): context budget", () => {
  it("shrinks the sources to fit a 2048-token context window", async () => {
    f.settings.quickFirst = false;
    f.deps.contextSize = () => 2048;
    const big = Array.from({ length: 6 }, (_, i) =>
      chunk(`b${i}`, `Canberra ${i}`, Array.from({ length: 30 }, (_, j) => `Canberra fact ${i}-${j} about the capital city design and history.`).join(" "))
    );
    f.retrieved = big;
    const { answer } = createAnswerer(f.deps);
    const r = await answer({ query: "Tell me about Canberra's capital city design" }, () => {}, { maxTokens: 1024 }).done;
    const sourceTokens = r.sources.reduce((acc, c) => acc + approxTokens(`${c.title}\n${c.body}`), 0);
    expect(f.multipassCalls).toBe(0);
    expect(r.sources.length).toBeGreaterThan(0);
    expect(sourceTokens).toBeLessThanOrEqual(2048 - 1024 - 512);
  });
});

describe("answer(): unexpected failures", () => {
  it("still ends with a done event when something throws before generation", async () => {
    f.deps.getSettings = async () => {
      throw new Error("settings file corrupted");
    };
    const { events, result } = await collect("Tell me about Canberra");
    expect(result.outcome).toBe("error");
    expect(events.at(-1)).toMatchObject({ type: "done", outcome: "error", error: { code: "unknown", message: "settings file corrupted" } });
  });
});
