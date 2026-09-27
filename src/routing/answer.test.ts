import { describe, it, expect, beforeEach } from "vitest";
import type { RetrievedChunk } from "../rag/retrieve.types";
import { assemblePrompt, assembleChatMessages } from "../rag/pure";
import { AnswerDeps, createAnswerer, InstalledLlm } from "./answer";
import type { AnswerEvent } from "./events";
import type { AnswerSettings } from "../models/settings";
import type { GenerateOptions } from "../inference/LlamaEngine";
import { approxTokens, HEALTH_GROUNDING_INSTRUCTION, NO_SOURCE_INSTRUCTION } from "./context";

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
        if (opts.messages?.[0]?.content.startsWith("You are checking whether an answer")) {
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

  it("keeps generating when the confident snippet can't answer the question alone", async () => {
    const { events, result } = await collect("What is the capital of Australia and where is it?");
    expect(types(events)).toContain("instant");
    expect(result.tier).toBe("fast");
    expect(result.receipt.reasonCodes).toContain("instant:not-final-compound");
    expect(result.receipt.reasonCodes).not.toContain("instant:final");
    expect(f.generations).toHaveLength(1);
  });

  it("every event carries the same answerId", async () => {
    const { events, result } = await collect("Why was Canberra chosen as the capital?");
    expect(new Set(events.map((e) => e.answerId))).toEqual(new Set([result.answerId]));
  });
});

describe("answer(): grounding guard (Prism Q-1, E-1)", () => {
  const DEAN_LEE = chunk(
    "dl",
    "Dean Lee",
    "Dean Lee (born 1971) is an American nuclear theorist. He also works on new technologies and computational paradigms such as eigenvector continuation, machine learning tools to find correlations, and quantum computing algorithms for the nuclear many-body problem."
  );
  const PUBLIC_KEY = chunk(
    "pk",
    "Public-key cryptography",
    "Public-key cryptography is the field of cryptographic systems that use pairs of related keys. There are many kinds of public-key cryptosystems, including digital signature, Diffie-Hellman key exchange and public-key encryption."
  );
  const NOSEBLEED = chunk(
    "nb",
    "Nosebleed",
    "A nosebleed is bleeding from the nose. Pinch the soft part of the nose and lean forward for ten minutes. At home, the head should not be tilted back."
  );

  it("Q-1 without the crypto pack: off-topic sources only -> says so, no model, no snippet, no sources", async () => {
    f.retrieved = [DEAN_LEE, PUBLIC_KEY];
    const { events, result } = await collect("Which signature algorithms are quantum resistant?");
    expect(f.generations).toHaveLength(0);
    expect(events.some((e) => e.type === "instant")).toBe(false);
    expect(events.some((e) => e.type === "sources")).toBe(false);
    expect(events.find((e) => e.type === "warning")).toMatchObject({ code: "weak_sources" });
    expect(result.text).toMatch(/didn't find a good source for this in the offline library/);
    expect(result.sources).toEqual([]);
    expect(result.receipt.modelId).toBe("grounding-guard");
    expect(result.receipt.reasonCodes).toContain("grounding:no-source-answer");
  });

  it("nothing retrieved for a knowledge question: the model answers, told to say it's not from an offline source", async () => {
    f.retrieved = [];
    const { events, result } = await collect("Which signature algorithms are quantum resistant?");
    expect(f.generations).toHaveLength(1);
    expect(f.generations[0].messages!.at(-1)!.content).toContain(NO_SOURCE_INSTRUCTION);
    expect(events.find((e) => e.type === "warning")).toMatchObject({ code: "weak_sources" });
    expect(result.receipt.reasonCodes).toContain("grounding:no-source-memory");
  });

  it("drops an off-topic source when an on-topic one exists", async () => {
    f.retrieved = [DEAN_LEE, CANBERRA];
    const { events } = await collect("Why was Canberra chosen as the capital of Australia?");
    const sources = (events.find((e) => e.type === "sources") as any).sources as RetrievedChunk[];
    expect(sources.map((c) => c.title)).toEqual(["Canberra"]);
  });

  it("E-1 nosebleed: the answer is the source's own text, cited, with no model", async () => {
    f.retrieved = [NOSEBLEED];
    const { result } = await collect("How do I stop a nosebleed?");
    expect(f.generations).toHaveLength(0);
    expect(result.tier).toBe("instant");
    expect(result.receipt.modelId).toBe("extractive");
    expect(result.text).toBe(
      "From the offline source:\nA nosebleed is bleeding from the nose. Pinch the soft part of the nose and lean forward for ten minutes. At home, the head should not be tilted back. [1]"
    );
    expect(result.receipt.reasonCodes).toContain("grounding:health-extractive");
  });

  it("E-1: quotes the source that says what to do, not the definition", async () => {
    const lead = chunk("n1", "Nosebleed", "A nosebleed, also known as epistaxis, is bleeding from the nasal cavity. Most cases are minor.");
    const treatment = chunk(
      "n2",
      "Nosebleed",
      "Treatment: Most anterior nosebleeds can be stopped by applying direct pressure. Pinch the soft part of the nose and lean forward for 10 to 15 minutes."
    );
    f.retrieved = [lead, treatment];
    const { result } = await collect("How do I stop a nosebleed?");
    expect(result.text).toMatch(/^From the offline source:\nTreatment: Most anterior nosebleeds .* lean forward for 10 to 15 minutes\. \[2\]$/);
  });

  it("E-1 PT nosebleed: searches the English packs with English words and answers from the source", async () => {
    const queries: string[] = [];
    f.deps.retrieve = async (q) => (queries.push(q), [NOSEBLEED]);
    const { result } = await collect("Como faço para parar um sangramento no nariz?");
    expect(queries).toEqual(["nosebleed stop"]);
    expect(result.text).toMatch(/^Da fonte offline \(em inglês\):\nA nosebleed is bleeding/);
    expect(f.generations).toHaveLength(0);
  });

  it("E-1 'Deeper answer' on a health question: the model may only restate the sources", async () => {
    f.installed = [qwen15, moe];
    f.retrieved = [NOSEBLEED];
    const { result } = await collect("How do I stop a nosebleed?", "deep");
    expect(result.receipt.reasonCodes).toContain("grounding:health-no-multipass");
    expect(f.multipassCalls).toBe(0);
    expect(f.generations).toHaveLength(1);
    expect(f.generations[0].messages!.at(-1)!.content).toContain(HEALTH_GROUNDING_INSTRUCTION);
  });

  it("'Deeper answer' on health: temperature 0, nothing streamed, and a dangerous model line falls back to the source", async () => {
    f.installed = [qwen15, moe];
    f.retrieved = [NOSEBLEED];
    const seen: any[] = [];
    f.deps.engine.generate = async (o) => {
      seen.push(o);
      o.onToken?.("streamed");
      return "Pinch the soft part of your nose and blow your nose gently [1].";
    };
    const { events, result } = await collect("How do I stop a nosebleed?", "deep");
    expect(seen[0].temperature).toBe(0);
    expect(events.filter((e) => e.type === "token").map((e: any) => e.text)).toEqual([result.text]);
    expect(result.text).toMatch(/^From the offline source:\nA nosebleed is bleeding from the nose\./);
    expect(result.receipt.reasonCodes).toContain("grounding:health-unsafe-blow-nose");
  });

  it("E-1 snake bite / burn without a good source: emergency services, no model", async () => {
    for (const [q, retrieved] of [
      ["What should I do after a snake bite?", []],
      ["How do I treat a burn?", [MOLD]],
      ["O que fazer em caso de picada de cobra?", []],
    ] as const) {
      f = makeFake();
      f.retrieved = [...retrieved];
      const { result } = await collect(q);
      expect(f.generations).toHaveLength(0);
      expect(result.text).toMatch(/emergency|emergência/);
      expect(result.receipt.reasonCodes).toContain("grounding:health-no-source");
    }
  });

  it("leaves Portuguese questions alone (English sources can't be matched word for word)", async () => {
    f.retrieved = [CANBERRA];
    const { result } = await collect("Por que Canberra virou a capital da Austrália?");
    expect(f.generations).toHaveLength(1);
    expect(result.receipt.reasonCodes.some((c) => c.startsWith("grounding:"))).toBe(false);
  });
});

describe("answer(): backend fallback", () => {
  it("records in the receipt that the model loaded on CPU after the GPU backend failed", async () => {
    const load = f.deps.engine.load;
    f.deps.engine.load = async (filename) => ({ ...(await load(filename)), backend: { kind: "cpu-fallback", reason: "failed to initialize MTL0 backend" } });
    const { result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(result.outcome).toBe("success");
    expect(result.receipt.reasonCodes).toContain("backend:cpu-fallback");
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
    f.deps.getModelSpeeds = async () => new Map([["moe30", 5.8], ["qwen7", 6.1]]);
    f.settings.alwaysComplete = true;
    const { events, result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(result.tier).toBe("deep");
    expect(result.receipt.modelId).toBe("moe30");
    expect(types(events)).toContain("warning");
    expect(types(events)).toContain("stage:verifying");
    expect(result.receipt.verification).toBe("passed");
    expect(f.loads).toEqual([moe.filename, qwen7.filename]);
    // Deep-tier contract: short answer, no thinking block, small context.
    const deepGen = f.generations.find((g) => g.enableThinking === false)!;
    expect(deepGen.nPredict).toBe(200);
    expect(deepGen.thinkingBudget).toBeUndefined();
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

describe("answer(): rule D6", () => {
  it("does not auto-pick a deep model measured below 5 tok/s; goes multi-pass on the picked model instead", async () => {
    f.installed = [qwen15, qwen7];
    f.settings.alwaysComplete = true;
    f.deps.getModelSpeeds = async () => new Map([["qwen7", 2.7]]);
    const { result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(f.loads).not.toContain(qwen7.filename);
    expect(f.multipassCalls).toBe(1);
    expect(result.receipt.reasonCodes).toContain("deep-auto:skip-qwen7-too-slow-2.7tps");
  });

  it("uses a slow deep model when the user picked it explicitly", async () => {
    f.installed = [qwen15, qwen7];
    f.settings.alwaysComplete = true;
    f.settings.deepModelId = "qwen7";
    f.deps.getModelSpeeds = async () => new Map([["qwen7", 2.7]]);
    const { result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(result.receipt.modelId).toBe("qwen7");
  });
});

describe("answer(): device-dependent default model", () => {
  const q4b: InstalledLlm = { id: "qwen3-4b", label: "Qwen3 4B", filename: "models/q4b.gguf", sizeBytes: 2.5 * GB, roles: ["fast"], answerTier: "default" };
  const q15c: InstalledLlm = { ...qwen15, isDefault: false, answerTier: "compact" };

  it("uses the 4B when the user has not picked a model and it fits", async () => {
    f.installed = [q15c, q4b];
    f.activeId = null;
    f.settings.quickFirst = false;
    f.deps.deviceRamBytes = () => 7.5 * GB;
    const { result } = await collect("Tell me about Canberra");
    expect(result.receipt.modelId).toBe("qwen3-4b");
  });

  it("uses the compact model on a 4 GB phone", async () => {
    f.installed = [q15c, q4b];
    f.activeId = null;
    f.settings.quickFirst = false;
    f.deps.deviceRamBytes = () => 3.7 * GB;
    const { result } = await collect("Tell me about Canberra");
    expect(result.receipt.modelId).toBe("qwen1.5");
  });

  it("still respects the model the user picked", async () => {
    f.installed = [q15c, q4b];
    f.activeId = "qwen1.5";
    f.settings.quickFirst = false;
    f.deps.deviceRamBytes = () => 12 * GB;
    const { result } = await collect("Tell me about Canberra");
    expect(result.receipt.modelId).toBe("qwen1.5");
  });
});
