import { describe, expect, it } from "vitest";
import type { FileImport } from "./fileImport";
import type { RowState } from "./modelRowState";
import { withVerifiedImport } from "./importProgress";

const verified = (assetId: string): FileImport => ({ name: `${assetId}.bin`, status: "verified", progress: 1, assetId });
const importing = (name: string): FileImport => ({ name, status: "importing", progress: 0.4 });

describe("withVerifiedImport (Prism L3-3)", () => {
  it("a file verified in the running pick counts as installed before the catalog refreshes", () => {
    expect(withVerifiedImport({ kind: "not-installed" }, "qwen", [verified("qwen")])).toEqual({ kind: "installed", verified: true });
  });
  it("leaves other items and a file still being copied alone", () => {
    expect(withVerifiedImport({ kind: "not-installed" }, "bge", [verified("qwen"), importing("bge.bin")])).toEqual({ kind: "not-installed" });
  });
  it("never overrides a real state", () => {
    const inUse: RowState = { kind: "in-use", roles: ["answer"], verified: true };
    expect(withVerifiedImport(inUse, "qwen", [verified("qwen")])).toBe(inUse);
  });
  it("the file counter advances as files verify: 'File n of 4'", () => {
    const imports = [verified("a"), verified("b"), importing("c.bin")];
    const present = ["a", "b", "c", "d"].filter((id) => withVerifiedImport({ kind: "not-installed" }, id, imports).kind === "installed").length;
    expect(Math.min(present + 1, 4)).toBe(3);
  });
});
