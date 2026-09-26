import { describe, expect, it } from "vitest";
import { canAutoRetry, DownloadErrorKind, modelRowView, RowInput } from "./modelRowState";

const idle = { downloading: false, progress: 0, error: null };

function view(overrides: Partial<RowInput>) {
  return modelRowView({ present: false, roles: [], ...overrides });
}

describe("modelRowView", () => {
  it("offers download when the asset is not on disk", () => {
    const v = view({});
    expect(v.state).toEqual({ kind: "not-installed" });
    expect(v.primary).toBe("download");
  });

  it("shows download progress without an action", () => {
    const v = view({ download: { downloading: true, progress: 0.4, error: null } });
    expect(v.state).toEqual({ kind: "downloading", phase: "downloading", progress: 0.4 });
    expect(v.primary).toBe("none");
  });

  it("reports copying for an imported file", () => {
    const v = view({ download: { downloading: true, progress: 0.1, error: null, phase: "copying" } });
    expect(v.state).toMatchObject({ kind: "downloading", phase: "copying" });
  });

  it("reports hash progress while verifying, or null when the total is unknown", () => {
    const v = view({
      download: { downloading: true, progress: 1, error: null, phase: "verifying", verifyBytes: 25, verifyTotal: 100 },
    });
    expect(v.state).toEqual({ kind: "verifying", progress: 0.25 });
    expect(view({ download: { downloading: true, progress: 1, error: null, phase: "verifying" } }).state).toEqual({
      kind: "verifying",
      progress: null,
    });
  });

  it("turns a download error into a retry with its kind", () => {
    const v = view({ download: { ...idle, error: "sha256 differs", errorKind: "hash-mismatch", permanent: true } });
    expect(v.state).toEqual({ kind: "failed", errorKind: "hash-mismatch", message: "sha256 differs", permanent: true });
    expect(v.primary).toBe("retry");
    expect(v.tone).toBe("danger");
  });

  it("treats an error without a kind as unknown and retryable", () => {
    const v = view({ download: { ...idle, error: "boom" } });
    expect(v.state).toMatchObject({ kind: "failed", errorKind: "unknown", permanent: false });
  });

  it("offers Use on an installed, unused model", () => {
    const v = view({ present: true, checksumOk: true });
    expect(v.state).toEqual({ kind: "installed", verified: true });
    expect(v.primary).toBe("use");
    expect(v.tone).toBe("neutral");
  });

  it("marks an unverified install as a warning, never as danger", () => {
    const v = view({ present: true, checksumOk: null });
    expect(v.state).toEqual({ kind: "installed", verified: false });
    expect(v.tone).toBe("warning");
  });

  it("blocks removal of a model in use and lists its roles", () => {
    const v = view({ present: true, checksumOk: true, roles: ["answer"] });
    expect(v.state).toEqual({ kind: "in-use", roles: ["answer"], verified: true });
    expect(v.removeBlocked).toBe(true);
    expect(v.primary).toBe("none");
  });

  it("shows loading over everything else", () => {
    expect(view({ present: true, loading: true, roles: ["answer"] }).state).toEqual({ kind: "loading" });
  });

  it("surfaces a failed load as a retryable failure", () => {
    const v = view({ present: true, loadError: "out of memory" });
    expect(v.state).toEqual({ kind: "failed", errorKind: "load", message: "out of memory", permanent: false });
  });

  it("warns about memory fit but never hides the row", () => {
    expect(view({ fit: "resident" }).fitWarning).toBeNull();
    expect(view({ fit: "streaming" }).fitWarning).toBe("streaming");
    const insufficient = view({ fit: "insufficient" });
    expect(insufficient.fitWarning).toBe("insufficient");
    expect(insufficient.state).toEqual({ kind: "not-installed" });
  });

  it("explains instead of downloading a model that cannot run here", () => {
    expect(view({ fit: "insufficient" }).primary).toBe("explain");
    expect(view({ fit: "thrashing" }).primary).toBe("download");
    expect(view({ fit: "streaming" }).primary).toBe("download");
  });
});

describe("canAutoRetry", () => {
  it("retries transient download failures only", () => {
    const failed = (errorKind: DownloadErrorKind, permanent: boolean) =>
      view({ download: { ...idle, error: "x", errorKind, permanent } }).state;
    expect(canAutoRetry(failed("network", false))).toBe(true);
    expect(canAutoRetry(failed("storage", true))).toBe(false);
    expect(canAutoRetry(view({ present: true, loadError: "oom" }).state)).toBe(false);
    expect(canAutoRetry(view({}).state)).toBe(false);
  });
});
