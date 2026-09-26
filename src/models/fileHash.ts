import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { FileHashNative } from "file-hash";
import { sha256Chunked } from "./integrity";

export type HashProgress = (bytesHashed: number, totalBytes: number) => void;

let jobCounter = 0;
const nextJobId = () => `hash-${Date.now()}-${++jobCounter}`;

function withNativeProgress<T>(jobId: string, onProgress: HashProgress | undefined, run: () => Promise<T>): Promise<T> {
  const sub = onProgress
    ? FileHashNative!.addListener("onProgress", (e) => {
        if (e.jobId === jobId) onProgress(e.bytesHashed, e.totalBytes);
      })
    : null;
  return run().finally(() => sub?.remove());
}

/** JS fallback: reads 4 MiB at a time and yields between chunks. Slower, same memory profile. */
async function sha256InJs(uri: string, onProgress?: HashProgress): Promise<string> {
  const file = new File(uri);
  const handle = file.open();
  return sha256Chunked(
    { read: (n) => handle.readBytes(n), close: () => handle.close() },
    { totalBytes: file.size ?? -1, onProgress, yieldBetweenChunks: () => new Promise((r) => setTimeout(r, 0)) }
  );
}

/** Streaming SHA-256 (lowercase hex) of a file:// or content:// URI. Never loads the whole file. */
export async function sha256OfFile(uri: string, onProgress?: HashProgress): Promise<string> {
  if (FileHashNative) {
    const jobId = nextJobId();
    return withNativeProgress(jobId, onProgress, () => FileHashNative!.sha256(uri, jobId));
  }
  return sha256InJs(uri, onProgress);
}

/**
 * Copies srcUri to destUri and returns the SHA-256 of what was written. The
 * native module does both in one pass; the fallback copies, then hashes the
 * copy (the copy is what gets used, so that's the bytes that matter).
 */
export async function copyWithSha256(
  srcUri: string,
  destUri: string,
  onProgress?: HashProgress
): Promise<{ sha256: string; bytes: number }> {
  if (FileHashNative) {
    const jobId = nextJobId();
    return withNativeProgress(jobId, onProgress, () => FileHashNative!.copyWithSha256(srcUri, destUri, jobId));
  }
  await FileSystem.copyAsync({ from: srcUri, to: destUri });
  const info = await FileSystem.getInfoAsync(destUri);
  const sha256 = await sha256InJs(destUri, onProgress);
  return { sha256, bytes: info.exists ? info.size ?? 0 : 0 };
}
