import { describe, it, expect, vi, beforeEach } from "vitest";

const { native, legacy } = vi.hoisted(() => ({
  native: { size: undefined as undefined | ((uri: string) => Promise<number>) },
  legacy: { info: null as null | { exists: boolean; isDirectory?: boolean; size?: number } },
}));
vi.mock("file-hash", () => ({ FileHashNative: native }));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-file-system/legacy", () => ({ getInfoAsync: async () => legacy.info }));

import { sizeOfFile } from "./fileHash";

const QWEN_4B = 2_497_281_120; // > 2^31 - 1
const URI = "content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2Femulated%2F0%2FDownload%2Fqwen.gguf";

describe("sizeOfFile (IMP-2GB)", () => {
  beforeEach(() => {
    native.size = undefined;
    legacy.info = null;
  });

  it("takes the native Long size over 2 GB, where the legacy call says 0", async () => {
    native.size = async () => QWEN_4B;
    legacy.info = { exists: true, size: 0 };
    expect(await sizeOfFile(URI)).toBe(QWEN_4B);
  });

  it("never takes 0 as a size: native 0 or -1 falls back, and a legacy 0 means unknown", async () => {
    native.size = async () => 0;
    legacy.info = { exists: true, size: 0 };
    expect(await sizeOfFile(URI)).toBeNull();
    native.size = async () => -1;
    legacy.info = { exists: true, size: 986_048_768 };
    expect(await sizeOfFile(URI)).toBe(986_048_768);
  });

  it("falls back to the legacy size on builds without the native function, and to null when the file is gone", async () => {
    legacy.info = { exists: true, size: 986_048_768 };
    expect(await sizeOfFile(URI)).toBe(986_048_768);
    legacy.info = { exists: false };
    expect(await sizeOfFile(URI)).toBeNull();
    native.size = async () => {
      throw new Error("E_OPEN");
    };
    legacy.info = { exists: true, isDirectory: true, size: 4096 };
    expect(await sizeOfFile(URI)).toBeNull();
  });
});
