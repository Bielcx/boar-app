import { describe, expect, it } from "vitest";
import type { ExecutionTelemetryRecord } from "../../services/executionTelemetry.pure";
import { speedsByModel } from "./modelSpeed";

function rec(modelId: string | undefined, tokens: number, genMs: number, createdAt: number, outcome: ExecutionTelemetryRecord["outcome"] = "success"): ExecutionTelemetryRecord {
  return { id: `${createdAt}`, createdAt, adaptiveRoutingUsed: false, modelId, tokensGenerated: tokens, generationLatencyMs: genMs, outcome };
}

describe("speedsByModel", () => {
  it("takes the median over finished answers per model and the latest date", () => {
    const speeds = speedsByModel([
      rec("a", 100, 10_000, 1), // 10 tok/s
      rec("a", 60, 10_000, 3), // 6
      rec("a", 140, 10_000, 2), // 14
      rec("b", 30, 10_000, 5), // 3
    ]);
    expect(speeds.a).toEqual({ medianTokPerSec: 10, samples: 3, lastAt: 3 });
    expect(speeds.b).toEqual({ medianTokPerSec: 3, samples: 1, lastAt: 5 });
  });

  it("ignores failures, cancelled answers, unknown models and missing timings", () => {
    const speeds = speedsByModel([
      rec("a", 100, 10_000, 1, "failure"),
      rec("a", 100, 10_000, 2, "cancelled"),
      rec(undefined, 100, 10_000, 3),
      rec("a", 100, 0, 4),
    ]);
    expect(speeds).toEqual({});
  });
});
