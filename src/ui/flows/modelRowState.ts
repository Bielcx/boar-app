/**
 * One state, one badge and one primary action per catalog row (models and
 * knowledge packs), so the Models and Knowledge screens and the setup
 * wizard can't disagree about what an asset is doing.
 *
 * The download phase, error kind and permanence fields come from the
 * extended DownloadState on feat/trust-offline; the memory verdict comes
 * from estimateMemoryFit on feat/engine-routing. Both are optional here
 * until those land, and a row without them falls back to today's fields.
 */

export type DownloadPhase = "downloading" | "copying" | "verifying" | "verified" | "error";
export type DownloadErrorKind =
  | "hash-mismatch"
  | "size-mismatch"
  | "network"
  | "storage"
  | "offline-variant"
  | "unknown";
export type FitVerdict = "resident" | "streaming" | "thrashing" | "insufficient";
export type ModelRole = "answer" | "deep" | "search";

/** Structural subset of downloadManager's DownloadState. */
export interface RowDownload {
  downloading: boolean;
  progress: number;
  error: string | null;
  phase?: DownloadPhase;
  verifyBytes?: number;
  verifyTotal?: number;
  errorKind?: DownloadErrorKind;
  permanent?: boolean;
}

export interface RowInput {
  present: boolean;
  /** null = never verified (e.g. a Hugging Face file with no published sha256). */
  checksumOk?: boolean | null;
  download?: RowDownload;
  /** Roles this asset currently fills; empty when it is installed but unused. */
  roles: ModelRole[];
  /** This model is being loaded after "Use". */
  loading?: boolean;
  /** Last load attempt failed with this message. */
  loadError?: string | null;
  fit?: FitVerdict;
}

export type RowState =
  | { kind: "not-installed" }
  | { kind: "downloading"; phase: "downloading" | "copying"; progress: number }
  | { kind: "verifying"; progress: number | null }
  | { kind: "failed"; errorKind: DownloadErrorKind | "load"; message: string; permanent: boolean }
  | { kind: "loading" }
  | { kind: "in-use"; roles: ModelRole[]; verified: boolean }
  | { kind: "installed"; verified: boolean };

export type PrimaryAction = "download" | "retry" | "use" | "none";
export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface RowView {
  state: RowState;
  primary: PrimaryAction;
  tone: BadgeTone;
  /** The remove action explains itself instead of running (the row is in use). */
  removeBlocked: boolean;
  /** Memory warning to show next to the row; "insufficient" only warns, never hides the row. */
  fitWarning: FitVerdict | null;
}

function stateOf(input: RowInput): RowState {
  const dl = input.download;
  if (input.loading) return { kind: "loading" };
  if (dl?.error) {
    return {
      kind: "failed",
      errorKind: dl.errorKind ?? "unknown",
      message: dl.error,
      permanent: dl.permanent ?? false,
    };
  }
  if (dl?.downloading) {
    if (dl.phase === "verifying") {
      const progress = dl.verifyTotal ? (dl.verifyBytes ?? 0) / dl.verifyTotal : null;
      return { kind: "verifying", progress };
    }
    return { kind: "downloading", phase: dl.phase === "copying" ? "copying" : "downloading", progress: dl.progress };
  }
  if (!input.present) return { kind: "not-installed" };
  if (input.loadError) return { kind: "failed", errorKind: "load", message: input.loadError, permanent: false };
  const verified = input.checksumOk === true;
  if (input.roles.length > 0) return { kind: "in-use", roles: input.roles, verified };
  return { kind: "installed", verified };
}

export function modelRowView(input: RowInput): RowView {
  const state = stateOf(input);
  const fitWarning = input.fit && input.fit !== "resident" ? input.fit : null;
  const base = { removeBlocked: state.kind === "in-use", fitWarning };
  switch (state.kind) {
    case "not-installed":
      return { ...base, state, primary: "download", tone: "neutral" };
    case "downloading":
    case "verifying":
      return { ...base, state, primary: "none", tone: "info" };
    case "loading":
      return { ...base, state, primary: "none", tone: "info" };
    case "failed":
      return { ...base, state, primary: "retry", tone: "danger" };
    case "in-use":
      return { ...base, state, primary: "none", tone: "success" };
    case "installed":
      // Unverified is a caution, never an error.
      return { ...base, state, primary: "use", tone: state.verified ? "neutral" : "warning" };
  }
}

/** The setup wizard may auto-retry a failure only when retrying can help. */
export function canAutoRetry(state: RowState): boolean {
  return state.kind === "failed" && !state.permanent && state.errorKind !== "load";
}
