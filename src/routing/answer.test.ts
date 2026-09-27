import { describe, it, expect, beforeEach } from "vitest";
import type { RetrievedChunk } from "../rag/retrieve.types";
import { assemblePrompt, assembleChatMessages } from "../rag/pure";
import { AnswerDeps, createAnswerer, InstalledLlm } from "./answer";
import type { AnswerEvent } from "./events";
import type { AnswerSettings } from "../models/settings";
import type { GenerateOptions } from "../inference/LlamaEngine";
import { approxTokens, HEALTH_GROUNDING_INSTRUCTION, NO_SOURCE_INSTRUCTION } from "./context";
import { ModelLoadError } from "../inference/loadError";

const chunk = (chunkId: string, title: string, body: string): RetrievedChunk => ({
  chunkId,
  docId: chunkId,
  title,
  body,
  score: 1,
  matchType: "hybrid",
});
const WALIPINI_KB = chunk("wk", "Walipini", "A Walipini is an earth-sheltered cold frame. A greenhouse can be built by digging a hole in the ground. It uses the heat stored in the earth during the cold season.");
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

  it("Q-1 without the crypto pack: off-topic sources are dropped; the model answers as 'not from the offline library'", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [DEAN_LEE, PUBLIC_KEY];
    const { events, result } = await collect("Which signature algorithms are quantum resistant?");
    expect(events.some((e) => e.type === "instant")).toBe(false);
    expect(events.some((e) => e.type === "sources")).toBe(false);
    expect(events.filter((e) => e.type === "warning")).toEqual([expect.objectContaining({ code: "weak_sources" })]);
    expect(f.generations).toHaveLength(1);
    expect(f.generations[0].messages!.at(-1)!.content).toContain(NO_SOURCE_INSTRUCTION);
    expect(f.generations[0].messages!.map((m) => m.content).join("\n")).not.toContain("Dean Lee");
    expect(result.sources).toEqual([]);
    expect(result.receipt.reasonCodes).toEqual(expect.arrayContaining(["grounding:off-topic-dropped-2", "grounding:no-good-source", "grounding:no-source-memory"]));
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
      // Steps first: the definition sentence is skipped.
      "From the offline source:\nPinch the soft part of the nose and lean forward for ten minutes. At home, the head should not be tilted back. [1]\n\nIn an emergency, call your local emergency number (911 in the US, 112 in Europe)."
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
    // Starts at the core procedure (pinch, lean forward), then the emergency line.
    expect(result.text).toMatch(/^From the offline source:\nTreatment: (Most anterior nosebleeds .*)?Pinch the soft part of the nose and lean forward for 10 to 15 minutes\. \[\d\]\n\nIn an emergency, call your local emergency number/);
  });

  it("EQ-2/DUP-1: a health answer is the excerpt with its steps, from the cited source, and no separate instant event", async () => {
    const run = { ...chunk("wv", "Wikivoyage: Earthquake safety", "During an earthquake: Do not run during the quake! Running around during the quake is dangerous."), action: true };
    const drop = { ...chunk("ap", "Appropedia: How to survive an earthquake", "During an earthquake: Drop, cover, and hold on! Drop to the floor. Take cover under a sturdy table. Hold on until the shaking stops."), action: true };
    f.retrieved = [run, drop] as any;
    const { events, result } = await collect("What should I do during an earthquake?");
    // DUP-1: no instant event at all; the answer is the excerpt, with its steps, citing the source it quotes.
    expect(events.filter((e) => e.type === "instant")).toHaveLength(0);
    expect(result.text).toMatch(/Drop, cover, and hold on! Drop to the floor\. Take cover under a sturdy table\. Hold on until the shaking stops\./);
    expect(result.text).not.toMatch(/Do not run/);
    const sources = (events.find((e) => e.type === "sources") as any).sources as RetrievedChunk[];
    const cited = (events.find((e) => e.type === "done") as any).cited as number[];
    expect(sources[cited[0] - 1].chunkId).toBe("ap");
  });

  it("E-1 PT nosebleed: searches the English packs with English words and answers from the source", async () => {
    const queries: string[] = [];
    f.deps.retrieve = async (q) => (queries.push(q), [NOSEBLEED]);
    const { result } = await collect("Como faço para parar um sangramento no nariz?");
    expect(queries).toEqual(["nosebleed nose bleed stop what to do"]);
    expect(result.text).toMatch(/^Da fonte offline \(em inglês\):\nPinch the soft part/);
    expect(f.generations).toHaveLength(0);
  });

  it("gate 5e70bbd: a what-to-do question keeps its intent in the search, so the pack lifts Treatment", async () => {
    const queries: string[] = [];
    f.deps.retrieve = async (q) => (queries.push(q), []);
    await collect("I just got bitten by a snake while hiking, two hours from the nearest road. What do I do right now?");
    await collect("Tell me about snakebite statistics in India");
    expect(queries).toEqual(["snakebite snake bite what to do", "Tell me about snakebite statistics in India"]);
  });

  it("uses the pack's action flag (Bramble b4becc5): an action section wins, a background one is never quoted over it", async () => {
    const quality = { ...chunk("wq", "Wikivoyage: Water", "Quality by country or region: Pinch tap water is safe to drink in most of the EU, keep an eye on it."), action: false };
    const contamination = { ...chunk("wc", "Wikivoyage: Water", "Water contamination: boil water for one minute at a rolling boil before you drink it."), action: true };
    const stayHealthy = { ...chunk("sh", "Wikivoyage: Stay healthy", "During your trip > Precautions against disease > Water contamination: After a flood, boil water for one minute at a rolling boil before you drink it."), action: true };
    f.retrieved = [stayHealthy, quality] as any;
    const first = await collect("After a flood the tap water might be contaminated. How do I make water safe to drink?");
    // Topic named by the section heading, not the article title (gate 5e70bbd, safety-005).
    expect(first.result.text).toMatch(/Water contamination: After a flood, boil water .* \[\d\]\n\nIn an emergency/);
    f = makeFake();
    f.retrieved = [quality, contamination] as any;
    const { result } = await collect("After a flood the tap water might be contaminated. How do I make water safe to drink?");
    expect(result.text).toMatch(/^From the offline source:\nWater contamination: boil water for one minute .* \[\d\]\n\nIn an emergency/);
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
    expect(result.text).toMatch(/^From the offline source:\nPinch the soft part of the nose/);
    expect(result.receipt.reasonCodes).toContain("grounding:health-unsafe-blow-nose");
  });

  it("gate 715ffdd: a health excerpt never comes from a source whose title isn't the topic", async () => {
    const cases: [string, RetrievedChunk][] = [
      ["I just got bitten by a snake while hiking. What do I do right now?", chunk("r", "Renealmia cernua", "Renealmia cernua is a plant. Its leaves are used against snakebite in folk medicine.")],
      ["My hiking partner is shivering, confused and slurring words in the cold. What should I do?", chunk("s", "Schroeder Pants Cave", "Schroeder Pants Cave is a cave. Cavers risk hypothermia when shivering in the cold water.")],
      ["An earthquake starts while I'm inside a hotel room. What should I do?", chunk("h", "Hotel Impossible", "Hotel Impossible is a TV show. One episode covered a hotel after an earthquake.")],
      ["After a flood the tap water might be contaminated. How do I make water safe to drink?", chunk("a", "After-rust", "After-rust is a plant disease. Contaminated water after a flood spreads it; it is not safe to drink.")],
      ["My child spilled boiling water on their arm. What do I do?", chunk("b", "Ethereum EIPs/ERCs: EIP-7775: BURN opcode", "Abstract: This EIP adds a BURN opcode that burns ether.")],
    ];
    for (const [q, off] of cases) {
      f = makeFake();
      f.retrieved = [off];
      const { result } = await collect(q);
      expect(result.text, q).toMatch(/don't have a reliable offline source/);
      expect(result.sources, q).toEqual([]);
      expect(f.generations).toHaveLength(0);
    }
  });

  it("…and still quotes the on-topic ones", async () => {
    for (const [q, on] of [
      ["I just got bitten by a snake while hiking. What do I do right now?", chunk("sb", "Snakebite", "Treatment > First aid: Keep the person calm and still, remove rings and watches, and get to a hospital for antivenom.")],
      ["After a flood the tap water might be contaminated. How do I make water safe to drink?", chunk("w", "Wikivoyage: Stay healthy", "During your trip > Water contamination: After a flood, boil water for one minute at a rolling boil before you drink it.")],
      ["An earthquake starts while I'm inside a hotel room. What should I do?", chunk("e", "Earthquakes (Ready.gov)", "During an Earthquake: Drop, cover, and hold on. Stay inside until the shaking stops.")],
    ] as const) {
      f = makeFake();
      f.retrieved = [on];
      const { result } = await collect(q);
      expect(result.text, q).toMatch(/^From the offline source:/);
      expect(result.sources.map((c) => c.title), q).toEqual([on.title]);
    }
  });

  it("Iris E-1: 'What should I do during an earthquake?' with only a heading + image caption: says the source has no steps, points to emergency services, no model, safety line", async () => {
    f.retrieved = [chunk("eq", "Earthquakes (Ready.gov)", "During an Earthquake > Protect Yourself During Earthquakes: Image")];
    const { events, result } = await collect("What should I do during an earthquake?");
    expect(f.generations).toHaveLength(0);
    expect(result.text).toMatch(/^The offline source doesn't give first-aid steps for this\. In an emergency, call your local emergency number\./);
    expect(events.find((e) => e.type === "done")).toMatchObject({ safety: true });
  });

  it("disaster with no on-topic source: emergency line, no model; history of a disaster is an ordinary question", async () => {
    f.retrieved = [];
    const { events, result } = await collect("What should I do during an earthquake?");
    expect(f.generations).toHaveLength(0);
    expect(result.text).toMatch(/emergency number/);
    expect(events.find((e) => e.type === "done")).toMatchObject({ safety: true });
    f = makeFake();
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [];
    const hist = await collect("What caused the 1906 San Francisco earthquake?");
    // Science or history of a disaster: no emergency line, an ordinary model answer (Sextant q6, Quill 31c1ee8).
    expect((hist.events.find((e) => e.type === "done") as any).safety).toBeUndefined();
    expect(f.generations).toHaveLength(1);
  });

  it("Iris 54202b7: the source list shown for a health question is the filtered one, empty with no on-topic source", async () => {
    f.retrieved = [
      chunk("x1", "Ancraophobia", "Ancraophobia is the fear of wind. Sufferers may bleed from the nose in panic, some reports say."),
      chunk("x2", "Tickling", "Tickling is the act of touching a part of the body so as to cause involuntary laughter."),
      chunk("x3", "Eminectomy", "Eminectomy is a surgical procedure. Nosebleed is a rare complication."),
      chunk("x4", "Guitar", "A guitar is a fretted musical instrument."),
      chunk("x5", "Stop sign", "A stop sign is a traffic sign."),
      chunk("x6", "Nose flute", "The nose flute is played with the nose."),
    ];
    const { events, result } = await collect("How do I stop a nosebleed?");
    expect(events.some((e) => e.type === "sources")).toBe(false);
    expect(events.some((e) => e.type === "instant")).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.text).toMatch(/don't have a reliable offline source/);
    expect(f.generations).toHaveLength(0);

    f = makeFake();
    f.retrieved = [chunk("x1", "Ancraophobia", "Ancraophobia is the fear of wind."), NOSEBLEED];
    const onTopic = await collect("How do I stop a nosebleed?");
    const shown = (onTopic.events.find((e) => e.type === "sources") as any).sources as RetrievedChunk[];
    expect(shown.map((c) => c.title)).toEqual(["Nosebleed"]);
    expect(onTopic.result.sources.map((c) => c.title)).toEqual(["Nosebleed"]);
  });

  it("gate ee1f2b7 BLOCKER: a scald described in PT ('fervendo') is health: source text only, never a free model answer", async () => {
    const queries: string[] = [];
    f.deps.retrieve = async (q) => (queries.push(q), [chunk("b", "Burn", "Management: Cool the burn under cool running water for 20 minutes. Do not use ice, butter or creams.")]);
    const { result } = await collect("Meu filho derramou água fervendo no braço. O que eu faço?");
    expect(queries).toEqual(["burn scald what to do"]);
    expect(f.generations).toHaveLength(0);
    expect(result.text).toMatch(/^Da fonte offline \(em inglês\):\nManagement: Cool the burn/);
  });

  it("gate ee1f2b7: PT health answers never cite a title that only shares a generic word", async () => {
    for (const [q, off] of [
      ["Fui picado por uma cobra na trilha. O que eu faço?", chunk("t", "Tree snake", "Tree snakes live in trees and rarely bite people.")],
      ["O que fazer durante um terremoto?", chunk("j", "Just Stop Oil", "Just Stop Oil is a climate campaign group.")],
      ["Depois de uma enchente, como deixo a água segura para beber?", chunk("c", "California Department of Water Resources", "The department manages water supply in California.")],
      ["My child spilled boiling water on their arm. What do I do?", { ...chunk("o", "Oral rehydration therapy", "Treatment algorithm: give oral rehydration solution in small sips."), action: true }],
      ["My child spilled boiling water on their arm. What do I do?", { ...chunk("h", "Appropedia: Hog Butchering and Smoking", "SCALDING: A hog must be bled and scalded in hot water before scraping."), action: false }],
    ] as const) {
      f = makeFake();
      f.retrieved = [off as any];
      const { events, result } = await collect(q);
      expect(events.some((e) => e.type === "sources"), q).toBe(false);
      expect(result.sources, q).toEqual([]);
      expect(f.generations, q).toHaveLength(0);
    }
  });

  it("Bramble 0d82f09: a lay first-aid source that names the condition in its text is quoted over the clinical one", async () => {
    f.retrieved = [
      { ...chunk("c", "Snakebite", "Treatment > First aid: Some have little local effect, but life-threatening systemic effects, in which case pressure immobilization is desirable."), action: true },
      { ...chunk("l", "US government: US Army Survival Manual FM 21-76: CHAPTER 4 - BASIC SURVIVAL MEDICINE", "Before you start treating a snakebite, keep the victim still, remove rings and watches, and get medical help."), action: false },
    ] as any;
    const { result } = await collect("I just got bitten by a snake while hiking. What do I do right now?");
    expect(result.text).toMatch(/Before you start treating a snakebite, keep the victim still/);
  });

  it("safety-008 (real pack text): quotes Drop, Cover and Hold over 'Do not run', and always ends with the emergency line", async () => {
    const LABEL_US = "US government: Earthquakes (Ready.gov)";
    for (const q of ["What should I do during an earthquake?", "O que eu faço durante um terremoto?"]) {
      f = makeFake();
      f.retrieved = [
        { ...chunk("r", LABEL_US, "During an Earthquake > Protect Yourself During Earthquakes: Image"), action: true },
        { ...chunk("d", "Wikivoyage: Earthquake safety", "During an earthquake: Do not run during the quake! Standing up, walking and, most of all, running are things that you should avoid, as you are likely to fall over and thereby injure yourself. Crawling may be the only way of getting around if you absolutely have to.\n\nA moderate-to-large earthquake usually persists less than a minute (though the exceptionally powerful 2011 Japan earthquake lasted for six minutes), but that is more than long enough to cause damage. Often it will be followed by aftershocks. Do not be complacent after an earthquake seems to be over\u2014get to safety!"), action: true },
        { ...chunk("i", "Wikivoyage: Earthquake safety", "During an earthquake > If you are indoors: The U.S. FEMA and the New Zealand Civil Defence give the advice \"Drop, Cover and Hold\" in the case of an earthquake.\n\nStay indoors. Get down on the floor on your knees and bow down, cover your head and neck, and take cover under a table, desk, or some other sturdy furniture if possible. Hold on to the table to prevent the shaking from separating you from your cover. If possible, shelter under furniture that is next to interior walls, away from windows and tall furniture (such as wardrobes and tall shelves), which could topple over on you. You are far safer if you stay indoors: falling roof tiles, chimney bricks, power lines, and other falling objects outside usually present the deadliest hazards. Doorways in modern buildings are not strong or safe places."), action: true },
      ] as any;
      const { result } = await collect(q);
      expect(result.text, q).toMatch(/Drop, Cover and Hold/);
      expect(result.text, q).toMatch(/emergency number|serviço de emergência/);
      expect(f.generations, q).toHaveLength(0);
    }
  });

  it("Boar decision A (real Ready.gov text): a burn excerpt stops before any ointment/cream/oil/aloe line", async () => {
    const READY_GOV_BURNS = "How to Treat Minor Burns: - Remove all clothing, diapers, jewelry and metal from the burned area. These can hide underlying burns and retain heat, which can increase skin damage.\n- Use cool water, not cold water or ice. The extreme cold from ice can cause additional injury.\n- If possible, particularly if the burn is caused by chemicals, hold the burned skin under cool running water for 10 to 15 minutes until it is less painful. Use a sink, shower or garden hose.\n- If you don\u2019t have access to cool running water, put a cool, clean wet cloth on the burn, or soak the burn in a cool water bath for five minutes.\n- Clean the burn gently with soap and water.\n- Do not break blisters. An opened blister can get infected.\n- You may put a thin layer of ointment, such as petroleum jelly or aloe vera on the burn. The ointment does not need to have antibiotics in it. Some antibiotic ointments can cause an allergic reaction. Do not use cream, lotion, oil, cortisone, butter, or egg white.\n- You can cover the burn with a sterile non-stick gauze lightly taped or wrapped over it. But don\u2019t use one that can shed fibers, because they can get caught in the burn. Change the dressing once a day.";
    for (const q of ["My child spilled boiling water on their arm. What do I do?", "Meu filho derramou água fervendo no braço. O que eu faço?", "How do I treat a burn?"]) {
      f = makeFake();
      f.retrieved = [{ ...chunk("r", "US government: Preventing and Treating Burns (Ready.gov)", READY_GOV_BURNS), action: true }] as any;
      const { result } = await collect(q);
      expect(result.text, q).toMatch(/Remove all clothing, diapers, jewelry and metal/);
      expect(result.text, q).toMatch(/cool running water for 10 to 15 minutes/);
      expect(result.text, q).toMatch(/Do not break blisters/);
      expect(result.text, q).not.toMatch(/ointment|petroleum jelly|aloe|butter|\blotion\b/i);
      expect(result.text, q).toMatch(/emergency number|serviço de emergência/);
    }
  });

  it("for a child or boiling water, the source's 'seek medical care' line is kept even past the cut", async () => {
    f.retrieved = [{ ...chunk("b", "Burn", "Management: Cool the burn under cool running water for 20 minutes. You may apply aloe vera gel. Seek medical care for any burn on a child."), action: true }] as any;
    const { result } = await collect("My child spilled boiling water on their arm. What do I do?");
    expect(result.text).toMatch(/Cool the burn under cool running water for 20 minutes\. Seek medical care for any burn on a child\./);
    expect(result.text).not.toMatch(/aloe/i);
  });

  it("gate 2329dc0: a disaster answer never cites an article about one event (Marash, Kamchatka)", async () => {
    for (const q of ["An earthquake starts while I'm inside a hotel room. What should I do?", "O que fazer durante um terremoto?"]) {
      f = makeFake();
      f.retrieved = [
        chunk("m", "The 1513 Marash earthquake", "The 1513 Marash earthquake struck southern Anatolia. During the earthquake many buildings collapsed."),
        chunk("k", "1952 Kamchatka earthquake", "The 1952 Kamchatka earthquake caused a tsunami. After the earthquake, people moved to high ground."),
      ];
      const { events, result } = await collect(q);
      expect(events.some((e) => e.type === "sources"), q).toBe(false);
      expect(result.text, q).toMatch(/emergency|emergência/);
      expect(f.generations, q).toHaveLength(0);
    }
  });

  it("…while a generic safety article or a pack action section still counts", async () => {
    for (const on of [
      chunk("g", "Wikivoyage: Earthquake safety", "During an earthquake: Drop, cover, and hold on until the shaking stops."),
      chunk("r", "US government: Earthquakes (Ready.gov)", "During an Earthquake: Drop, cover, and hold on."),
      // safety-008 with Bramble 55071af: the Wikibooks guide's title is generic too.
      { ...chunk("w", "Wikibooks: How to survive an earthquake", "During an earthquake: Drop, cover, and hold on! Get under a sturdy table."), action: true },
      { ...chunk("a", "Emergency shelter", "During an earthquake: drop, cover and hold on under a sturdy table."), action: true },
    ]) {
      f = makeFake();
      f.retrieved = [on as any];
      const { result } = await collect("What should I do during an earthquake?");
      expect(result.sources.map((c) => c.title), on.title).toEqual([on.title]);
      expect(result.text).toMatch(/Drop, cover,? and hold on/i);
    }
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

describe("answer(): CR-1 low-RAM phone (3.8 GB)", () => {
  const qwen4: InstalledLlm = { id: "qwen4", label: "Qwen3 4B", filename: "models/q4.gguf", sizeBytes: 2.5 * GB, roles: ["fast"], answerTier: "default", isDefault: true };
  const compact: InstalledLlm = { ...qwen15, answerTier: "compact", isDefault: false };
  beforeEach(() => {
    f.deps.deviceRamBytes = () => 3.8 * GB;
  });

  it("a saved 4B that the user never confirmed is not loaded; the compact one answers", async () => {
    f.installed = [qwen4, compact];
    f.activeId = "qwen4";
    const { result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(f.loads).toEqual([compact.filename]);
    expect(result.receipt.reasonCodes).toContain("model:low-ram-unconfirmed-qwen4");
  });

  it("the user's confirmation lets it run", async () => {
    f.installed = [qwen4, compact];
    f.activeId = "qwen4";
    f.settings = { ...f.settings, largeModelConfirmedIds: ["qwen4"] };
    await collect("Why was Canberra chosen as the capital of Australia?");
    expect(f.loads).toEqual([qwen4.filename]);
  });

  it("no automatic deep model or verifier above the compact size", async () => {
    f.installed = [compact, { ...moe, sizeBytes: 11 * GB }, qwen7];
    f.activeId = compact.id;
    await collect("Why was Canberra chosen as the capital of Australia?", "deep");
    expect(f.loads.every((l) => l === compact.filename)).toBe(true);
  });

  it("effectiveModel tells the header what will answer, and what it replaces", async () => {
    f.installed = [qwen4, compact];
    f.activeId = "qwen4";
    const { effectiveModel } = createAnswerer(f.deps);
    expect(await effectiveModel()).toEqual({ id: compact.id, label: compact.label, downgradedFrom: { id: "qwen4", label: "Qwen3 4B", reason: "low-ram" } });
    f.settings = { ...f.settings, largeModelConfirmedIds: ["qwen4"] };
    expect(await effectiveModel()).toEqual({ id: "qwen4", label: "Qwen3 4B" });
    f.settings = { ...f.settings, largeModelConfirmedIds: [], loadCrashedIds: ["qwen4"] };
    expect((await effectiveModel())?.downgradedFrom?.reason).toBe("load-crashed");
  });

  it("only big models installed: a clear error instead of an OOM kill", async () => {
    f.installed = [qwen4];
    f.activeId = null;
    const { result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(f.loads).toEqual([]);
    expect(result.outcome).toBe("error");
    expect(result.receipt).toBeDefined();
    expect((await collect("Why was Canberra chosen?")).events.at(-1)).toMatchObject({ type: "done", error: { code: "no_model", message: expect.stringMatching(/too large for this phone's memory/) } });
  });
});

describe("answer(): topic guard for every snippet (Prism RT-1)", () => {
  const WALIPINI = chunk(
    "wp",
    "Walipini",
    "A Walipini is an earth-sheltered cold frame. A greenhouse can be built by digging a hole in the ground. This takes advantage of the heat stored in the earth during the cold season."
  );
  const HOT_WEATHER = chunk(
    "hw",
    "Wikivoyage: Hot weather",
    "Understand: The Earth's axis is tilted by 23 degrees in relation to the ecliptic, and this causes the seasons of winter, spring, summer, and autumn. When your part of Earth is tilted toward the Sun, you get summer."
  );

  it("no 'From the source' from Walipini for the seasons question; the on-topic page stays", async () => {
    f.retrieved = [WALIPINI, HOT_WEATHER];
    const { events } = await collect("Why do we have seasons on Earth?");
    const sources = (events.find((e) => e.type === "sources") as any).sources as RetrievedChunk[];
    expect(sources.map((c) => c.title)).toEqual(["Wikivoyage: Hot weather"]);
    const instant = events.find((e) => e.type === "instant") as any;
    if (instant) expect(sources[instant.snippet.sourceIndex].title).toBe("Wikivoyage: Hot weather");
  });

  it("PT-1: a PT question is matched with the lexicon's English names, with or without accents", async () => {
    const SEASON = chunk("se", "Season", "A season is a division of the year based on changes in weather. Seasons result from Earth's axial tilt relative to the plane of its orbit around the Sun.");
    for (const q of ["Por que existem as estações do ano?", "Por que existem as estacoes do ano?"]) {
      f = makeFake();
      const HURRICANE = chunk("hs", "US government: Hurricane Season Preparedness Digital Toolkit (Ready.gov)", "Prepare before hurricane season starts. The Atlantic hurricane season starts June 1.");
      f.retrieved = [HURRICANE, WALIPINI, SEASON];
      const queries: string[] = [];
      const retrieve = f.deps.retrieve;
      f.deps.retrieve = (query, k) => (queries.push(query), retrieve(query, k));
      f.deps.englishNames = (query) => (/esta(ç|c)(õ|o)es do ano/i.test(query) ? ["Season"] : []);
      const { events, result } = await collect(q);
      const sources = (events.find((e) => e.type === "sources") as any).sources as RetrievedChunk[];
      expect(sources.map((c) => c.title), q).toEqual(["Season"]);
      expect(queries, q).toEqual([q]); // retrieve() translates a PT question itself
      expect(result.receipt.reasonCodes).toContain("match:pt-en-names");
      const instant = events.find((e) => e.type === "instant") as any;
      expect(instant && sources[instant.snippet.sourceIndex].title, q).toBe("Season");
    }
    // Without the names, no English title is named by the PT words: the guard keeps nothing.
    f = makeFake();
    f.retrieved = [WALIPINI, { ...WALIPINI, chunkId: "se", title: "Season" }];
    f.deps.englishNames = () => [];
    const { events } = await collect("Por que existem as estacoes do ano?");
    expect(events.find((e) => e.type === "instant")).toBeUndefined();
  });

  it("Boar, s32: a 4B answer with an on-topic source gets no line even uncited", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [CANBERRA];
    f.deps.engine.generate = async () => "It was a compromise between Sydney and Melbourne.";
    const { events, result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect((events.find((e) => e.type === "done") as any).finalText).toBeUndefined();
    expect(result.receipt.reasonCodes).toContain("grounding:uncited-on-topic");
  });

  it("gate ea5978c: a PT question whose only passage is off topic: no sources shown, the 4B's answer gets the line", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [WALIPINI_KB];
    f.deps.englishNames = () => [];
    f.deps.engine.generate = async () => "As estações existem por causa da inclinação do eixo.";
    const { events } = await collect("Por que existem as estacoes do ano?");
    expect(events.find((e) => e.type === "sources")).toBeUndefined();
    expect((events.find((e) => e.type === "done") as any).finalText).toBe("Esta resposta não vem de uma fonte offline deste celular; confira antes de confiar nela.\n\nAs estações existem por causa da inclinação do eixo.");
  });

  it("gate ea5978c: the compact model with no on-topic source declines; answerAnyway keeps the answer with the line", async () => {
    const q = "Por que existem as estacoes do ano?";
    f.retrieved = [WALIPINI_KB];
    f.deps.englishNames = () => [];
    const { events } = await collect(q);
    expect(f.generations).toHaveLength(0);
    expect(events.find((e) => e.type === "sources")).toBeUndefined();
    expect(events.find((e) => e.type === "warning")).toMatchObject({ code: "weak_sources", declined: true });

    f = makeFake();
    f.retrieved = [WALIPINI_KB];
    f.deps.englishNames = () => [];
    f.deps.engine.generate = async () => "Por causa da inclinação.";
    const events2: AnswerEvent[] = [];
    await createAnswerer(f.deps).answer({ query: q, answerAnyway: true }, (e) => events2.push(e), ctx).done;
    expect((events2.find((e) => e.type === "done") as any).finalText).toMatch(/^Esta resposta não vem de uma fonte offline/);
  });

  it("Quill 014c054: an off-topic passage never reaches the sources event, EN or PT, single pass or multipass", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [WALIPINI_KB, CANBERRA];
    f.deps.englishNames = () => [];
    for (const q of ["Por que Canberra foi escolhida como capital da Austrália?", "Why was Canberra chosen as the capital of Australia?"]) {
      const { events } = await collect(q);
      const sources = (events.find((e) => e.type === "sources") as any)?.sources ?? [];
      expect(sources.map((c: RetrievedChunk) => c.title), q).toEqual(["Canberra"]);
    }
  });

  it("Boar (B): the compact model with an on-topic source answers uncited, and the chat gets weak_sources", async () => {
    f.retrieved = [CANBERRA];
    f.deps.engine.generate = async () => "It was a compromise between Sydney and Melbourne.";
    const { events, result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(result.text).toBe("It was a compromise between Sydney and Melbourne.");
    expect(result.receipt.reasonCodes).toEqual(expect.arrayContaining(["grounding:uncited-on-topic", "grounding:uncited-warning"]));
    const warning = events.find((e) => e.type === "warning") as any;
    expect(warning).toMatchObject({ code: "weak_sources" });
    expect(warning.declined).toBeUndefined();
    expect(types(events).indexOf("warning")).toBeLessThan(types(events).indexOf("done"));
  });

  it("no source at all: a 4B answer that skipped the instruction still gets the line; one that said it doesn't twice", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [];
    f.deps.engine.generate = async () => "It was a compromise between Sydney and Melbourne.";
    const first = await collect("Why was Canberra chosen as the capital of Australia?");
    expect((first.events.find((e) => e.type === "done") as any).finalText).toMatch(/^This answer is not from an offline source on this phone/);
    expect(first.events.filter((e) => e.type === "warning")).toHaveLength(1);
    f = makeFake();
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [];
    f.deps.engine.generate = async () => "This answer is not from an offline source. It was a compromise.";
    const second = await collect("Why was Canberra chosen as the capital of Australia?");
    expect((second.events.find((e) => e.type === "done") as any).finalText).toBeUndefined();
  });

  it("an answer that cites its source gets no line", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [CANBERRA];
    f.deps.engine.generate = async () => "Canberra is the capital city of Australia [1].";
    const { events, result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect((events.find((e) => e.type === "done") as any).finalText).toBeUndefined();
    expect(result.receipt.reasonCodes.some((c) => c.startsWith("grounding:uncited"))).toBe(false);
  });

  it("only the incidental page: no snippet, and the model is told it's not from the library", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [WALIPINI];
    const { events } = await collect("Why do we have seasons on Earth?");
    expect(events.some((e) => e.type === "instant")).toBe(false);
    expect(f.generations[0].messages!.at(-1)!.content).toContain(NO_SOURCE_INSTRUCTION);
  });

  it("compact model, no on-topic source: declines (no model call), and answers when asked anyway", async () => {
    f.retrieved = [WALIPINI];
    const { events, result } = await collect("Why do we have seasons on Earth?");
    expect(f.generations).toHaveLength(0);
    expect(events.find((e) => e.type === "warning")).toMatchObject({ code: "weak_sources", declined: true, message: "I didn't find this in this phone's library." });
    expect(events.at(-1)).toMatchObject({ type: "done", outcome: "success" });
    expect(result.text).toBe("");
    expect(result.receipt.reasonCodes).toContain("grounding:declined-compact");

    f = makeFake();
    f.retrieved = [WALIPINI];
    const events2: AnswerEvent[] = [];
    await createAnswerer(f.deps).answer({ query: "Why do we have seasons on Earth?", answerAnyway: true }, (e) => events2.push(e), ctx).done;
    expect(f.generations).toHaveLength(1);
    expect(f.generations[0].messages!.at(-1)!.content).toContain(NO_SOURCE_INSTRUCTION);
    expect(events2.find((e) => e.type === "warning")).toMatchObject({ code: "weak_sources" });
    expect((events2.find((e) => e.type === "warning") as any).declined).toBeUndefined();
  });

  it("CT-1: a citation the source doesn't support is removed, and done carries the corrected text", async () => {
    f.retrieved = [CANBERRA];
    f.deps.engine.generate = async (o) => {
      o.onToken?.("x");
      return "Canberra is the capital of Australia [1]. Mold grows in damp bathrooms [1].";
    };
    const { events, result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(result.text).toBe("Canberra is the capital of Australia [1]. Mold grows in damp bathrooms.");
    expect(events.find((e) => e.type === "done")).toMatchObject({ finalText: result.text });
    expect(result.receipt.reasonCodes).toContain("citations:removed-1");
  });
});

describe("answer(): CR-2 a model whose load killed the app", () => {
  it("is not loaded again on its own; the next model answers, and the meta for the marker is passed", async () => {
    const seen: any[] = [];
    const load = f.deps.engine.load;
    f.deps.engine.load = async (filename, opts) => (seen.push(opts?.meta), load(filename));
    f.installed = [qwen15, lfm];
    f.activeId = "lfm8";
    f.settings = { ...f.settings, loadCrashedIds: ["lfm8"] };
    const { result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(f.loads).toEqual([qwen15.filename]);
    expect(seen).toEqual([{ modelId: "qwen1.5", label: "Qwen 1.5B" }]);
    expect(result.receipt.reasonCodes).toContain("model:load-crashed-lfm8");
  });

  it("runs again once the user confirms it after the crash", async () => {
    f.installed = [qwen15, lfm];
    f.activeId = "lfm8";
    f.settings = { ...f.settings, loadCrashedIds: ["lfm8"], largeModelConfirmedIds: ["lfm8"] };
    await collect("Why was Canberra chosen as the capital of Australia?");
    expect(f.loads).toEqual([lfm.filename]);
  });
});

describe("answer(): a failed load says why, as data (Harbor/Quill, iOS dc63525)", () => {
  it("done.error carries kind; the message has no RAM hint to mislead the card", async () => {
    f.deps.engine.load = async () => {
      throw new ModelLoadError('Failed to load "models/q15.gguf": Failed to load model', "engine", "Failed to load model", "this device has ~16GB RAM");
    };
    const { events } = await collect("Why was Canberra chosen as the capital of Australia?");
    const done = events.find((e) => e.type === "done") as any;
    expect(done.error).toEqual({ code: "load_failed", message: 'Failed to load "models/q15.gguf": Failed to load model', kind: "engine" });
  });
});

describe("answer(): relevance on the sources event", () => {
  it("fast answers carry a 0..1 relevance per source; Deep Research sources don't", async () => {
    f.retrieved = [CANBERRA, HALL];
    const { events } = await collect("Why was Canberra chosen as the capital of Australia?");
    const shown = (events.find((e) => e.type === "sources") as any).sources;
    expect(shown.every((c: any) => typeof c.relevance === "number" && c.relevance >= 0 && c.relevance <= 1)).toBe(true);

    f = makeFake();
    const deep = await collect("Why was Canberra chosen as the capital of Australia?", "deep");
    const research = deep.events.filter((e) => e.type === "sources") as any[];
    expect(research.length).toBeGreaterThan(0);
    expect(research.every((e) => e.sources.every((c: any) => c.relevance === undefined))).toBe(true);
  });
});

describe("answer(): a question asked while the knowledge base is still indexing (first boot)", () => {
  it("searches only after indexing ends (Harbor 5f7d9ca: 15/300 indexed, empty search)", async () => {
    const order: string[] = [];
    let indexed!: () => void;
    f.deps.knowledgeReady = () => new Promise<void>((r) => (indexed = () => (order.push("indexed"), r())));
    const retrieve = f.deps.retrieve;
    f.deps.retrieve = async (q, k) => (order.push("retrieve"), retrieve(q, k));
    const pending = collect("Why was Canberra chosen as the capital of Australia?");
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual([]);
    indexed();
    const { result } = await pending;
    expect(order).toEqual(["indexed", "retrieve"]);
    expect(result.sources.map((c) => c.title)).toContain("Canberra");
  });

  it("stop() during the wait ends the answer at once", async () => {
    f.deps.knowledgeReady = () => new Promise<void>(() => {});
    const events: AnswerEvent[] = [];
    const h = createAnswerer(f.deps).answer({ query: "Why was Canberra chosen as the capital of Australia?" }, (e) => events.push(e), ctx);
    await new Promise((r) => setTimeout(r, 20));
    const t = Date.now();
    await h.stop();
    expect((await h.done).outcome).toBe("stopped");
    expect(Date.now() - t).toBeLessThan(100);
  });
});

describe("answer(): cited sources on done (Prism CT-2)", () => {
  it("an answer with no [n] cites nothing, so the chat shows no Sources card", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [CANBERRA];
    f.deps.engine.generate = async () => "I can't know yesterday's match results offline.";
    const { events, result } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect(events.find((e) => e.type === "done")).toMatchObject({ cited: [] });
    expect(result.cited).toEqual([]);
  });

  it("a supported citation is listed", async () => {
    f.retrieved = [CANBERRA];
    const { events } = await collect("Why was Canberra chosen as the capital of Australia?");
    expect((events.find((e) => e.type === "done") as any).cited).toEqual([1]);
  });
});

describe("answer(): current events (Prism CT-3)", () => {
  it("'Who won the football match yesterday?': fixed honest answer, no model, no sources, nothing cited", async () => {
    f.retrieved = [chunk("f", "2021 All-Ireland Senior Ladies' Football Championship final", "Meath won the 2021 All-Ireland Senior Ladies' Football Championship final against Dublin.")];
    for (const q of ["Who won the football match yesterday?", "Quem ganhou o jogo de ontem?"]) {
      f.generations.length = 0;
      const { events, result } = await collect(q);
      expect(f.generations, q).toHaveLength(0);
      expect(events.some((e) => e.type === "sources"), q).toBe(false);
      expect(result.text, q).toMatch(/offline/);
      expect(result.text, q).not.toMatch(/Meath|\[\d\]/);
      expect((events.find((e) => e.type === "done") as any).cited, q).toEqual([]);
    }
  });
});

describe("answer(): current events on every path (Prism CT-4)", () => {
  it("'Answer with the model' (tier fast), Deeper answer (deep) and answer-anyway get the same fixed answer", async () => {
    f.retrieved = [chunk("f", "2021 All-Ireland Senior Ladies' Football Championship final", "Meath won the 2021 All-Ireland Senior Ladies' Football Championship final against Dublin.")];
    const q = "Who won the football match yesterday?";
    const runs = [
      await collect(q, "fast"),
      await collect(q, "deep"),
      await (async () => {
        const events: AnswerEvent[] = [];
        const result = await createAnswerer(f.deps).answer({ query: q, answerAnyway: true }, (e) => events.push(e), ctx).done;
        return { events, result };
      })(),
      await (async () => {
        const events: AnswerEvent[] = [];
        const result = await createAnswerer(f.deps).deepen(q, f.retrieved, (e) => events.push(e), ctx).done;
        return { events, result };
      })(),
    ];
    expect(f.generations).toHaveLength(0);
    for (const { result } of runs) {
      expect(result.text).toMatch(/offline/);
      expect(result.receipt.reasonCodes).toContain("grounding:current-event");
    }
  });
});

describe("answer(): today in history (Boar/Piston R3)", () => {
  const TITANIC = chunk("t", "Sinking of the Titanic", "RMS Titanic sank in the North Atlantic Ocean on 15 April 1912, after striking an iceberg. It was the largest ship afloat at the time.");
  const SEP27 = chunk("s", "September 27", "September 27 is the 270th day of the year. Events: 1825 - The Stockton and Darlington Railway opens, the world's first public railway to use steam locomotives.");
  const q = "What happened today in history?";
  it("searches the device's date; a source without it is not on topic: the 4B's answer gets the line", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.deps.today = () => new Date(2026, 8, 27);
    const queries: string[] = [];
    f.deps.retrieve = async (query) => (queries.push(query), [TITANIC]);
    f.deps.engine.generate = async () => "On this day the US commemorates the 100th anniversary of the sinking of the RMS Titanic, April 15, 1912.";
    const { events, result } = await collect(q);
    expect(queries).toEqual(["September 27"]);
    expect(events.find((e) => e.type === "sources")).toBeUndefined();
    expect(result.receipt.reasonCodes).toContain("grounding:today-in-history");
    expect((events.find((e) => e.type === "done") as any).finalText).toMatch(/^This answer is not from an offline source/);
  });
  it("the compact model with no source naming the date: no model call, the decline", async () => {
    f.deps.today = () => new Date(2026, 8, 27);
    f.retrieved = [TITANIC];
    const { events } = await collect(q);
    expect(f.generations).toHaveLength(0);
    expect(events.find((e) => e.type === "warning")).toMatchObject({ code: "weak_sources", declined: true });
  });
  it("only the date's own article is on topic, in PT too (not a text that mentions the date)", async () => {
    f.deps.today = () => new Date(2026, 8, 27);
    const WEBINAR = chunk("w", "US government: Quake Prep (Ready.gov)", "Are You Ready?: Recorded September 27, 2011. View the transcript.");
    f.retrieved = [TITANIC, WEBINAR, SEP27];
    for (const query of [q, "O que aconteceu hoje na história?"]) {
      const { events } = await collect(query);
      const sources = (events.find((e) => e.type === "sources") as any).sources as RetrievedChunk[];
      expect(sources.map((c) => c.title), query).toEqual(["September 27"]);
    }
  });
});

describe("answer(): today's date (Prism TD-1)", () => {
  it("a question about today gets the device's date next to it; others don't", async () => {
    f.installed = [lfm];
    f.activeId = "lfm8";
    f.retrieved = [];
    f.deps.today = () => new Date(2026, 8, 27);
    await collect("What happened today in history?");
    expect(f.generations[0].messages!.at(-1)!.content).toContain("Today is Sunday, 27 September 2026 (this device's date).");
    f.generations.length = 0;
    await collect("Why was Canberra chosen as the capital of Australia?");
    expect(f.generations[0].messages!.at(-1)!.content).not.toContain("Today is");
  });
});

describe("answer(): the instant answer cites its source (Quill, CT-2)", () => {
  it("done.cited has the snippet's source although the text has no [n]", async () => {
    const { events, result } = await collect("What is the capital of Australia?");
    expect(result.tier).toBe("instant");
    expect((events.find((e) => e.type === "done") as any).cited).toEqual([1]);
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
