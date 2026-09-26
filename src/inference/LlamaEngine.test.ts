import { describe, it, expect, vi, beforeEach } from "vitest";

type FakeContext = {
  model: string;
  released: boolean;
  release: () => Promise<void>;
  completion: (params: unknown, onToken: (d: { token: string }) => void) => Promise<{ text: string }>;
  stopCompletion: () => Promise<void>;
  releasedWhileGenerating: boolean;
};
const created: FakeContext[] = [];
const initParams: Record<string, unknown>[] = [];
const ram = { total: 12 * 1024 ** 3, rss: 1024 ** 3, avail: 0 };
let fileSize = 1_000_000;
let header: Record<string, string> | null = null;
let inFlightInits = 0;
let maxConcurrentInits = 0;

vi.mock("llama.rn", () => ({
  loadLlamaModelInfo: async () => {
    if (!header) throw new Error("no header");
    return header;
  },
  initLlama: async (params: { model: string }) => {
    const { model } = params;
    initParams.push(params);
    inFlightInits++;
    maxConcurrentInits = Math.max(maxConcurrentInits, inFlightInits);
    await new Promise((r) => setTimeout(r, 5));
    inFlightInits--;
    let finish: (() => void) | null = null;
    let generating = false;
    const ctx: FakeContext = {
      model,
      released: false,
      releasedWhileGenerating: false,
      release: async () => {
        if (generating) ctx.releasedWhileGenerating = true;
        ctx.released = true;
      },
      // Like llama.cpp: runs until stopped, and settles a moment after the stop (prompt still processing).
      completion: (_params, onToken) =>
        new Promise((resolve) => {
          generating = true;
          onToken({ token: "Hi" });
          finish = () =>
            setTimeout(() => {
              generating = false;
              resolve({ text: "Hi" });
            }, 20);
        }),
      stopCompletion: async () => {
        finish?.();
      },
    };
    created.push(ctx);
    return ctx;
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async () => ({ exists: true, size: fileSize }),
}));
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => ram.total,
  getMemoryInfo: () => ({ rssBytes: ram.rss }),
  getAvailableRamBytes: () => ram.avail,
}));

import { LlamaEngine, defaultContextSize } from "./LlamaEngine";

const live = () => created.filter((c) => !c.released);

beforeEach(() => {
  created.length = 0;
  initParams.length = 0;
  Object.assign(ram, { total: 12 * 1024 ** 3, rss: 1024 ** 3, avail: 0 });
  fileSize = 1_000_000;
  header = null;
  inFlightInits = 0;
  maxConcurrentInits = 0;
});

describe("LlamaEngine load/unload", () => {
  it("never leaves an orphaned context when loads overlap (quick model swaps)", async () => {
    const engine = new LlamaEngine();
    await Promise.all([engine.load("models/a.gguf"), engine.load("models/b.gguf"), engine.load("models/a.gguf")]);
    expect(maxConcurrentInits).toBe(1);
    expect(live()).toHaveLength(1);
    expect(live()[0].model).toBe("file:///docs/models/a.gguf");
    expect(engine.getModelInfo()?.filename).toBe("models/a.gguf");
  });

  it("skips a load of the model that is already loaded", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await Promise.all([engine.load("models/a.gguf"), engine.load("models/a.gguf")]);
    expect(created).toHaveLength(1);
  });

  it("serializes unload with a pending load, leaving nothing loaded", async () => {
    const engine = new LlamaEngine();
    await Promise.all([engine.load("models/a.gguf"), engine.unload()]);
    expect(live()).toHaveLength(0);
    expect(engine.isLoaded).toBe(false);
  });

  it("keeps working after a failed load", async () => {
    const engine = new LlamaEngine();
    const fs = await import("expo-file-system/legacy");
    const spy = vi.spyOn(fs, "getInfoAsync").mockResolvedValueOnce({ exists: false } as any);
    await expect(engine.load("models/missing.gguf")).rejects.toThrow(/not found/);
    await engine.load("models/b.gguf");
    expect(engine.getModelInfo()?.filename).toBe("models/b.gguf");
    spy.mockRestore();
  });

  it("stops and waits for a running generation before releasing its model", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "say hi" });
    await engine.load("models/b.gguf");
    await expect(reply).resolves.toBe("Hi");
    expect(created[0].released).toBe(true);
    expect(created[0].releasedWhileGenerating).toBe(false);
    expect(engine.getModelInfo()?.filename).toBe("models/b.gguf");
  });
});

const GiB = 1024 ** 3;
const QWEN3_MOE_HEADER = {
  "general.architecture": "qwen3moe",
  "qwen3moe.block_count": "48",
  "qwen3moe.embedding_length": "2048",
  "qwen3moe.attention.head_count": "32",
  "qwen3moe.attention.head_count_kv": "4",
  "qwen3moe.attention.key_length": "128",
  "qwen3moe.attention.value_length": "128",
  "qwen3moe.expert_count": "128",
  "qwen3moe.expert_used_count": "8",
  "qwen3moe.expert_feed_forward_length": "768",
  "qwen3moe.vocab_size": "151936",
};

describe("LlamaEngine pre-flight memory check (mmap-aware)", () => {
  it("loads a MoE file larger than free RAM with a streaming warning instead of throwing", async () => {
    fileSize = 11 * GiB;
    ram.avail = 7 * GiB;
    header = QWEN3_MOE_HEADER;
    const engine = new LlamaEngine();
    const result = await engine.load("models/qwen3-30b-a3b.gguf");
    expect(engine.isLoaded).toBe(true);
    expect(result.fit?.verdict).toBe("streaming");
    expect(result.warning).toMatch(/streams from storage/);
    expect(initParams[0]).toMatchObject({ use_mmap: true, use_mlock: false });
  });

  it("returns the same warning when the already-loaded model is re-requested", async () => {
    fileSize = 11 * GiB;
    ram.avail = 7 * GiB;
    header = QWEN3_MOE_HEADER;
    const engine = new LlamaEngine();
    await engine.load("models/m.gguf");
    const again = await engine.load("models/m.gguf");
    expect(created).toHaveLength(1);
    expect(again.fit?.verdict).toBe("streaming");
  });

  it("still refuses when KV + buffers alone cannot fit, without creating a context", async () => {
    header = QWEN3_MOE_HEADER;
    ram.avail = 200 * 1024 ** 2;
    const engine = new LlamaEngine();
    await expect(engine.load("models/m.gguf")).rejects.toThrow(/cannot be streamed/);
    expect(created).toHaveLength(0);
  });

  it("falls back to total − RSS − 2GB when the native module has no available-RAM readout", async () => {
    // 12 − 1 − 2 = 9GB available, 1MB dense file without header → resident.
    const engine = new LlamaEngine();
    const result = await engine.load("models/a.gguf");
    expect(result.fit?.availableBytes).toBe(9 * GiB);
    expect(result.fit?.fromMetadata).toBe(false);
    expect(result.warning).toBeNull();
  });

  it("skips the check when RAM readouts are unavailable", async () => {
    ram.total = 0;
    const engine = new LlamaEngine();
    const result = await engine.load("models/a.gguf");
    expect(result.fit).toBeNull();
    expect(engine.isLoaded).toBe(true);
  });

  it("estimates a downloaded model without loading it", async () => {
    fileSize = 11 * GiB;
    ram.avail = 7 * GiB;
    header = QWEN3_MOE_HEADER;
    const engine = new LlamaEngine();
    const fit = await engine.estimateFit("models/m.gguf");
    expect(fit?.verdict).toBe("streaming");
    expect(created).toHaveLength(0);
  });
});

describe("LlamaEngine generate queue (double-send race)", () => {
  it("never runs two completions on one context at once", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const ctx = created[0] as any;
    let running = 0;
    let maxRunning = 0;
    ctx.completion = (_p: unknown, onToken: (d: { token: string }) => void) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      onToken({ token: "x" });
      return new Promise((resolve) =>
        setTimeout(() => {
          running--;
          resolve({ text: "x", timings: { prompt_n: 12, prompt_ms: 30, predicted_n: 1, predicted_ms: 5 }, tokens_cached: 8 });
        }, 10)
      );
    };
    const timings: unknown[] = [];
    const [a, b] = await Promise.all([
      engine.generate({ prompt: "one", onTimings: (t) => timings.push(t) }),
      engine.generate({ prompt: "two" }),
    ]);
    expect([a, b]).toEqual(["x", "x"]);
    expect(maxRunning).toBe(1);
    expect(timings[0]).toEqual({ promptTokens: 12, promptMs: 30, predictedTokens: 1, predictedMs: 5, cachedTokens: 8 });
  });

  it("keeps serving after a failed generation", async () => {
    const engine = new LlamaEngine();
    await expect(engine.generate({ prompt: "x" })).rejects.toThrow(/not loaded/);
    await engine.load("models/a.gguf");
    const first = engine.generate({ prompt: "x" });
    await new Promise((r) => setTimeout(r, 0));
    const queued = engine.generate({ prompt: "y" });
    await engine.stop();
    // The running one ends with what it had; the queued one never starts.
    await expect(first).resolves.toBe("Hi");
    await expect(queued).resolves.toBe("");
  });
});

describe("default context size", () => {
  it("uses 2048 on 4GB devices and 4096 otherwise (or when RAM is unknown)", async () => {
    ram.total = 4 * 1024 ** 3;
    expect(defaultContextSize()).toBe(2048);
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(initParams[0]).toMatchObject({ n_ctx: 2048 });
    ram.total = 12 * 1024 ** 3;
    expect(defaultContextSize()).toBe(4096);
    ram.total = 0;
    expect(defaultContextSize()).toBe(4096);
  });
});
