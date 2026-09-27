/** A file picked for import and what happened to it. No native imports. */
import type { IntegrityErrorKind } from "../../models/integrity";

export interface FileImport {
  name: string;
  status: "importing" | "verified" | "failed";
  /** 0..1 of the file hashed so far. */
  progress: number;
  /** The picked file's size, when the system picker reports it. */
  sizeBytes?: number;
  assetId?: string;
  errorKind?: IntegrityErrorKind;
  message?: string;
  /** Catalog items whose row asked for this file, so the row shows the result where the user tapped (Prism IM-1). */
  forIds?: string[];
}

/**
 * What a row should say about the files it asked for: nothing once one of
 * them matched it; else a file still being checked, then a refusal, then a
 * file that turned out to be another item.
 */
export function importFor(imports: FileImport[], id: string): FileImport | undefined {
  const mine = imports.filter((f) => f.forIds?.includes(id));
  if (mine.some((f) => f.status === "verified" && f.assetId === id)) return undefined;
  return mine.find((f) => f.status === "importing") ?? mine.find((f) => f.status === "failed") ?? mine.find((f) => f.status === "verified");
}
