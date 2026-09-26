import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// In-memory stand-in for expo-file-system/legacy: path -> bytes.
const files = new Map<string, Buffer>();
let mtime = 1;
const mtimes = new Map<string, number>();
const put = (path: string, data: Buffer) => {
  files.set(path, data);
  mtimes.set(path, mtime++);
};

type Progress = (d: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void;
let serverBody: Buffer = Buffer.alloc(0);
let serverAnnouncedSize: number | null = null;

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///doc/",
  getInfoAsync: async (path: string) =>
    files.has(path)
      ? { exists: true, isDirectory: false, size: files.get(path)!.length, modificationTime: mtimes.get(path) }
      : { exists: false },
  deleteAsync: async (path: string) => {
    files.delete(path);
  },
  makeDirectoryAsync: async () => {},
  readDirectoryAsync: async () => [],
  getFreeDiskStorageAsync: async () => 100 * 1024 ** 3,
  readAsStringAsync: async (path: string) => {
    if (!files.has(path)) throw new Error("ENOENT");
    return files.get(path)!.toString("utf8");
  },
  writeAsStringAsync: async (path: string, text: string) => put(path, Buffer.from(text)),
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    put(to, files.get(from)!);
    files.delete(from);
  },
  createDownloadResumable: (_url: string, dest: string, _opts: unknown, cb: Progress) => {
    let paused = false;
    return {
      pauseAsync: async () => {
        paused = true;
      },
      downloadAsync: async () => {
        const total = serverAnnouncedSize ?? serverBody.length;
        cb({ totalBytesWritten: Math.min(1, serverBody.length), totalBytesExpectedToWrite: total });
        if (paused) return undefined;
        put(dest, serverBody);
        cb({ totalBytesWritten: serverBody.length, totalBytesExpectedToWrite: total });
        return { uri: dest, status: 200 };
      },
      resumeAsync: async () => undefined,
    };
  },
}));

const excludeFromBackup = vi.fn();
vi.mock("bundled-assets", () => ({ copyBundledAssetToFile: vi.fn(), excludeFromBackup: (p: string) => excludeFromBackup(p) }));

let offline = false;
vi.mock("../config/variant", () => ({ networkAllowed: () => !offline }));

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
vi.mock("./fileHash", () => ({
  sha256OfFile: async (uri: string, onProgress?: (d: number, t: number) => void) => {
    const data = files.get(uri)!;
    onProgress?.(data.length, data.length);
    return sha(data);
  },
  copyWithSha256: async (src: string, dest: string) => {
    const data = files.get(src)!;
    put(dest, data);
    return { sha256: sha(data), bytes: data.length };
  },
}));

import { ModelManager, resetVerifiedCacheForTests } from "./ModelManager";
import { AssetIntegrityError } from "./integrity";
import type { CatalogModel } from "./manifest";

const body = Buffer.from("pretend this is a GGUF file");
const asset = (over: Partial<CatalogModel> = {}): CatalogModel => ({
  id: "m",
  kind: "llm",
  label: "Model",
  filename: "models/m.gguf",
  sizeBytes: body.length,
  sha256: sha(body),
  sourceUrl: "https://huggingface.co/a/b/resolve/0000000000000000000000000000000000000000/m.gguf",
  license: "MIT",
  description: "",
  required: false,
  ...over,
});
const DEST = "file:///doc/models/m.gguf";

beforeEach(() => {
  files.clear();
  mtimes.clear();
  resetVerifiedCacheForTests();
  serverBody = body;
  serverAnnouncedSize = null;
  offline = false;
  excludeFromBackup.mockClear();
});

async function rejection(p: Promise<unknown>): Promise<AssetIntegrityError> {
  const e = await p.then(
    () => null,
    (x) => x
  );
  expect(e).toBeInstanceOf(AssetIntegrityError);
  return e as AssetIntegrityError;
}

describe("downloadCatalogModel integrity", () => {
  it("keeps a file whose sha256 matches, reports a verifying phase, and marks it verified", async () => {
    const a = asset();
    const phases: string[] = [];
    await new ModelManager([a]).downloadCatalogModel(a, (p) => phases.push(p.phase ?? "?"));
    expect(files.get(DEST)).toEqual(body);
    expect(phases).toContain("verifying");
    expect(phases.indexOf("verifying")).toBeGreaterThan(phases.indexOf("downloading"));
    const status = await new ModelManager([a]).statusOf(a);
    expect(status).toMatchObject({ present: true, checksumOk: true });
    expect(excludeFromBackup).toHaveBeenCalledWith(DEST);
  });

  it("deletes a same-size file with the wrong sha256 and fails permanently", async () => {
    serverBody = Buffer.from("pretend this is a GGUF fil3");
    const a = asset();
    const e = await rejection(new ModelManager([a]).downloadCatalogModel(a));
    expect(e.kind).toBe("hash-mismatch");
    expect(e.permanent).toBe(true);
    expect(files.has(DEST)).toBe(false);
  });

  it("aborts at the first callback when the server announces a different size (no hang, no retry loop)", async () => {
    serverAnnouncedSize = body.length + 1000;
    const a = asset();
    const e = await rejection(new ModelManager([a]).downloadCatalogModel(a));
    expect(e.kind).toBe("size-mismatch");
    expect(e.permanent).toBe(true);
    expect(files.has(DEST)).toBe(false);
  });

  it("refuses to touch the network in the offline variant", async () => {
    offline = true;
    const a = asset();
    const e = await rejection(new ModelManager([a]).downloadCatalogModel(a));
    expect(e.kind).toBe("offline-variant");
    expect(files.has(DEST)).toBe(false);
  });
});

describe("importFromFile", () => {
  const SRC = "content://picker/doc/1";

  it("identifies the file by size + sha256, whatever its name, and installs it verified", async () => {
    put(SRC, body);
    const other = asset({ id: "other", filename: "models/o.gguf", sha256: "0".repeat(64) });
    const target = asset();
    const mm = new ModelManager([other, target]);
    const installed = await mm.importFromFile(SRC);
    expect(installed.id).toBe("m");
    expect(files.get(DEST)).toEqual(body);
    expect(await mm.statusOf(target)).toMatchObject({ present: true, checksumOk: true });
    expect(excludeFromBackup).toHaveBeenCalledWith(DEST);
    expect([...files.keys()].some((k) => k.includes("/imports/"))).toBe(false);
  });

  it("rejects a file of unknown size without copying it", async () => {
    put(SRC, Buffer.from("short"));
    const e = await rejection(new ModelManager([asset()]).importFromFile(SRC));
    expect(e.kind).toBe("unknown-file");
    expect([...files.keys()]).toEqual([SRC]);
  });

  it("rejects a right-size file with the wrong hash and leaves nothing behind", async () => {
    put(SRC, Buffer.from("pretend this is a GGUF fil3"));
    const e = await rejection(new ModelManager([asset()]).importFromFile(SRC));
    expect(e.kind).toBe("hash-mismatch");
    expect(files.has(DEST)).toBe(false);
    expect([...files.keys()].filter((k) => k !== SRC && !k.endsWith("integrity.json"))).toEqual([]);
  });

  it("works in the offline variant (import needs no network)", async () => {
    offline = true;
    put(SRC, body);
    expect((await new ModelManager([asset()]).importFromFile(SRC)).id).toBe("m");
  });
});

describe("statusOf verified flag", () => {
  it("is null for a present file never hashed, and drops back to null if the file changes", async () => {
    const a = asset();
    const mm = new ModelManager([a]);
    put(DEST, body);
    expect((await mm.statusOf(a)).checksumOk).toBeNull();
    expect(await mm.verifyChecksum(a)).toBe(true);
    expect((await mm.statusOf(a)).checksumOk).toBe(true);
    put(DEST, Buffer.from("pretend this is a GGUF fil3")); // same size, new mtime
    expect((await mm.statusOf(a)).checksumOk).toBeNull();
  });
});

describe("assets without a known sha256 (Hugging Face search results)", () => {
  it("are kept after a size-checked download instead of being deleted", async () => {
    const a = asset({ sha256: "" });
    await new ModelManager([a]).downloadCatalogModel(a);
    expect(files.get(DEST)).toEqual(body);
  });
});
