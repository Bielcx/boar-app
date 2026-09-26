import { describe, it, expect } from "vitest";
import { pickDefaultAnswerModel } from "./defaultModel";
import { contextSizeForRam, estimateMemoryFit, parseGgufShape, toGb } from "../inference/memoryFit";

const GiB = 1024 ** 3;
// Header of Qwen3-4B-Instruct-2507 Q4_K_M (unsloth, read on the Mac mini).
const QWEN3_4B = parseGgufShape({
  "general.architecture": "qwen3",
  "qwen3.block_count": "36",
  "qwen3.embedding_length": "2560",
  "qwen3.feed_forward_length": "9728",
  "qwen3.attention.head_count": "32",
  "qwen3.attention.head_count_kv": "8",
  "qwen3.attention.key_length": "128",
  "qwen3.attention.value_length": "128",
  "qwen3.vocab_size": "151936",
});
const FILE_4B = 2497281120;

describe("Qwen3-4B memory fit by device (header-based)", () => {
  // availableRamBytes: iOS os_proc_available_memory / Android MemAvailable with the app in front.
  const devices = [
    { name: "iPhone 13, 4 GB", total: 3.7 * GiB, avail: 2.0 * GiB, expect: "thrashing" },
    { name: "Android 6 GB, busy", total: 5.6 * GiB, avail: 3.0 * GiB, expect: "thrashing" },
    { name: "Android 6 GB, light", total: 5.6 * GiB, avail: 3.6 * GiB, expect: "resident" },
    { name: "Android 8 GB", total: 7.5 * GiB, avail: 4.5 * GiB, expect: "resident" },
    { name: "Pixel 12 GB", total: 11.5 * GiB, avail: 7.0 * GiB, expect: "resident" },
  ] as const;

  for (const d of devices) {
    it(`${d.name}: n_ctx ${contextSizeForRam(d.total)} -> ${d.expect}`, () => {
      const nCtx = contextSizeForRam(d.total);
      const fit = estimateMemoryFit({ fileBytes: FILE_4B, nCtx, shape: QWEN3_4B, totalRamBytes: d.total, availableRamBytes: d.avail });
      console.log(`[4B] ${d.name}: ctx ${nCtx}, KV ${toGb(fit.kvCacheBytes)} GB, buffers ${toGb(fit.anonBytes)} GB + weights ${toGb(FILE_4B)} GB vs ${toGb(d.avail)} GB -> ${fit.verdict}`);
      expect(fit.verdict).toBe(d.expect);
      // The KV cache and buffers alone always fit: the 4B never refuses to load, it may only be slow.
      expect(fit.verdict).not.toBe("insufficient");
    });
  }

  it("KV cache is 144 KiB per token (36 layers x 8 KV heads x 256 x 2 bytes)", () => {
    const fit = estimateMemoryFit({ fileBytes: FILE_4B, nCtx: 4096, shape: QWEN3_4B, totalRamBytes: 12 * GiB, availableRamBytes: 8 * GiB });
    expect(fit.kvCacheBytes).toBe(4096 * 36 * 8 * 256 * 2);
  });
});

describe("contextSizeForRam", () => {
  it("2048 up to 4.5 GB, 3072 up to 6.5 GB, 4096 above or unknown", () => {
    expect(contextSizeForRam(3.7 * GiB)).toBe(2048);
    expect(contextSizeForRam(5.6 * GiB)).toBe(3072);
    expect(contextSizeForRam(7.5 * GiB)).toBe(4096);
    expect(contextSizeForRam(0)).toBe(4096);
  });
});

describe("pickDefaultAnswerModel", () => {
  const both = (fit4b?: "resident" | "thrashing") => [
    { id: "qwen3-4b", answerTier: "default" as const, fit: fit4b },
    { id: "qwen2.5-1.5b", answerTier: "compact" as const },
  ];

  it("gives the 4B to devices where it stays resident", () => {
    expect(pickDefaultAnswerModel(both("resident"), 7.5 * GiB)).toEqual({ id: "qwen3-4b", reason: "default-tier" });
  });

  it("gives 4 GB phones the compact model, whatever the fit says", () => {
    expect(pickDefaultAnswerModel(both("resident"), 3.7 * GiB)).toEqual({ id: "qwen2.5-1.5b", reason: "compact-low-ram" });
  });

  it("falls back to compact when the 4B would re-read its weights every token", () => {
    expect(pickDefaultAnswerModel(both("thrashing"), 5.6 * GiB)).toEqual({ id: "qwen2.5-1.5b", reason: "compact-does-not-fit" });
  });

  it("uses what is installed when only one tier is", () => {
    expect(pickDefaultAnswerModel([{ id: "qwen3-4b", answerTier: "default", fit: "thrashing" }], 3.7 * GiB)?.id).toBe("qwen3-4b");
    expect(pickDefaultAnswerModel([{ id: "x" }], 8 * GiB)).toEqual({ id: "x", reason: "first-installed" });
    expect(pickDefaultAnswerModel([], 8 * GiB)).toBeNull();
  });
});
