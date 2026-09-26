import { requireOptionalNativeModule, EventSubscription } from "expo-modules-core";

export interface FileHashProgressEvent {
  jobId: string;
  bytesHashed: number;
  totalBytes: number;
}

export interface FileHashNativeModule {
  /** Lowercase hex SHA-256 of a file:// or content:// URI, read in chunks. */
  sha256(uri: string, jobId: string): Promise<string>;
  /**
   * Copies srcUri (file:// or content://) to destUri (file://) and returns the
   * SHA-256 of the bytes written, in one pass over the source.
   */
  copyWithSha256(srcUri: string, destUri: string, jobId: string): Promise<{ sha256: string; bytes: number }>;
  addListener(eventName: "onProgress", listener: (event: FileHashProgressEvent) => void): EventSubscription;
}

// Optional: iOS and older builds without this module fall back to the JS
// implementation in src/models/fileHash.ts.
export const FileHashNative = requireOptionalNativeModule<FileHashNativeModule>("FileHash");
