import { describe, expect, it } from "vitest";
import { catalogFit, expertFractionHint } from "./fit";

const GB = 1024 ** 3;

describe("expertFractionHint", () => {
  it("recognizes mixture-of-experts ids by their active-parameter suffix", () => {
    expect(expertFractionHint({ id: "lfm2.5-8b-a1b-q4km" })).toBe(0.9);
    expect(expertFractionHint({ id: "qwen3.6-35b-a3b-q2" })).toBe(0.9);
    expect(expertFractionHint({ id: "qwen2.5-7b-instruct-q4km" })).toBe(0);
  });
});

describe("catalogFit", () => {
  const ram = { totalBytes: 8 * GB, availableBytes: 4 * GB };

  it("only estimates language models, and only with a RAM reading", () => {
    expect(catalogFit({ id: "bge", kind: "embedding", sizeBytes: GB }, ram, 4096)).toBeUndefined();
    expect(catalogFit({ id: "q", kind: "llm", sizeBytes: GB }, { totalBytes: 0, availableBytes: 0 }, 4096)).toBeUndefined();
  });

  it("keeps a small dense model resident", () => {
    expect(catalogFit({ id: "q15", kind: "llm", sizeBytes: GB }, ram, 4096)?.verdict).toBe("resident");
  });

  it("lets a large MoE stream from storage but a large dense model thrash", () => {
    // 12 GB file, 6 GB free: the MoE hot set (~1.9 GB, doubled for slack) plus buffers fits; the dense file does not.
    const roomy = { totalBytes: 8 * GB, availableBytes: 6 * GB };
    expect(catalogFit({ id: "big-a3b", kind: "llm", sizeBytes: 12 * GB }, roomy, 4096)?.verdict).toBe("streaming");
    expect(catalogFit({ id: "big-dense", kind: "llm", sizeBytes: 12 * GB }, roomy, 4096)?.verdict).toBe("thrashing");
  });

  it("reports insufficient when buffers alone exceed free RAM", () => {
    expect(catalogFit({ id: "huge", kind: "llm", sizeBytes: 60 * GB }, { totalBytes: 8 * GB, availableBytes: GB }, 4096)?.verdict).toBe("insufficient");
  });
});
