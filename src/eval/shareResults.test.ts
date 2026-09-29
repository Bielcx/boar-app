import { describe, it, expect } from "vitest";
import { buildSubmission, describeDevice, shareResultFromStatus, submitResultsUrl } from "./shareResults.pure";
import type { EvalResultRow } from "./evalHarness.pure";

const row = (queryId: string) =>
  ({ runId: "eval-1", evalSetVersion: "1", queryId, configId: "model:qwen", outcome: "success" }) as EvalResultRow;

describe("submitResultsUrl", () => {
  it("is null without a URL or a key, so the app shows no share button", () => {
    expect(submitResultsUrl(undefined, "k")).toBeNull();
    expect(submitResultsUrl("https://x.supabase.co", "")).toBeNull();
  });

  it("points at the submit-results function, with or without a trailing slash", () => {
    expect(submitResultsUrl("https://x.supabase.co/", "k")).toBe("https://x.supabase.co/functions/v1/submit-results");
    expect(submitResultsUrl("https://x.supabase.co", "k")).toBe("https://x.supabase.co/functions/v1/submit-results");
  });
});

describe("buildSubmission", () => {
  it("takes the run id and set version from the rows and sends every row", () => {
    const s = buildSubmission([row("a"), row("b")], { platform: "android", osVersion: "15", brand: "POCO", model: "X6", ramBytes: 12e9 }, "install-1", "1.0.0");
    expect(s).toEqual({
      installId: "install-1",
      run: { runId: "eval-1", evalSetVersion: "1", appVersion: "1.0.0", platform: "android", osVersion: "15", deviceBrand: "POCO", deviceModel: "X6", ramBytes: 12e9 },
      rows: [row("a"), row("b")],
    });
  });

  it("leaves out a RAM figure the device couldn't read", () => {
    expect(buildSubmission([row("a")], { platform: "android", ramBytes: 0 }, "i", "1").run.ramBytes).toBeUndefined();
  });
});

describe("shareResultFromStatus", () => {
  it.each([
    [201, "shared"],
    [409, "already-shared"],
    [429, "rate-limited"],
    [400, "rejected"],
    [401, "rejected"],
    [500, "failed"],
    [0, "failed"],
  ] as const)("%i -> %s", (status, result) => {
    expect(shareResultFromStatus(status)).toBe(result);
  });
});

describe("describeDevice", () => {
  it("names the phone, the OS and the RAM", () => {
    expect(describeDevice({ platform: "android", brand: "POCO", model: "2311DRK48G", osVersion: "15", ramBytes: 11.2 * 1024 ** 3 })).toBe(
      "POCO 2311DRK48G · Android 15 · 11 GB RAM"
    );
  });

  it("still says something when nothing is known", () => {
    expect(describeDevice({ platform: "ios" })).toBe("Unknown phone");
  });
});
