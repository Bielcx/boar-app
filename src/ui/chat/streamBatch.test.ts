import { describe, it, expect } from "vitest";
import { flushDelay, STREAM_FLUSH_MS } from "./streamBatch";

describe("flushDelay (audit #6)", () => {
  it("batches tokens over a window longer than the on-device gap between tokens", () => {
    expect(flushDelay({ answerId: "a", type: "token", tier: "fast", text: "x" })).toBe(STREAM_FLUSH_MS);
    // 30 tok/s is 33 ms apart: a window must hold more than one of them.
    expect(STREAM_FLUSH_MS).toBeGreaterThan(2 * 33);
    expect(STREAM_FLUSH_MS).toBeLessThanOrEqual(120);
  });
  it("shows stage changes, sources and done at once", () => {
    expect(flushDelay({ answerId: "a", type: "stage", stage: "generating", tier: "fast", at: 1 })).toBe(0);
    expect(flushDelay({ answerId: "a", type: "sources", tier: "fast", sources: [] })).toBe(0);
    expect(flushDelay({ answerId: "a", type: "warning", code: "weak_sources" } as never)).toBe(0);
  });
});
