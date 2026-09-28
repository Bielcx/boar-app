/** Setup import (offline build): what the install step shows while a pick of files is imported. No native imports. */
import type { FileImport } from "./fileImport";
import type { RowState } from "./modelRowState";

/**
 * A file verified in the running pick is on the phone, even though the catalog only refreshes after
 * the whole pick. Without this the counter stayed at "File 1 of 4" and a row went back to "To import"
 * after its file reached 100% (Prism L3-3).
 */
export function withVerifiedImport(state: RowState, assetId: string, imports: FileImport[]): RowState {
  if (state.kind !== "not-installed" && state.kind !== "failed") return state;
  return imports.some((f) => f.status === "verified" && f.assetId === assetId) ? { kind: "installed", verified: true } : state;
}

