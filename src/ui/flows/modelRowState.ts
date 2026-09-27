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

import type { DownloadErrorDetail, IntegrityErrorKind } from "../../models/integrity";
import { COMPACT_ONLY_MAX_RAM_BYTES } from "../../routing/defaultModel";

export type DownloadPhase = "downloading" | "copying" | "verifying" | "verified" | "error";
/** The trust layer's error kinds (src/models/integrity.ts). */
export type DownloadErrorKind = IntegrityErrorKind;
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
  /** Why a download stopped part-way, with its numbers (Ledger, MD-4); the UI translates it. */
  errorDetail?: DownloadErrorDetail;
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
  /** Loading it can get the app killed on this phone (mayCloseApp). */
  mayCloseApp?: boolean;
}

export type RowState =
  | { kind: "not-installed" }
  | { kind: "downloading"; phase: "downloading" | "copying"; progress: number }
  | { kind: "verifying"; progress: number | null }
  | { kind: "failed"; errorKind: DownloadErrorKind | "load"; message: string; permanent: boolean; detail?: DownloadErrorDetail }
  | { kind: "loading" }
  | { kind: "in-use"; roles: ModelRole[]; verified: boolean }
  | { kind: "installed"; verified: boolean };

/**
 * "explain" replaces "download" when the memory estimate says the model
 * cannot run here: the row explains why, and downloading takes an explicit
 * "download anyway".
 */
export type PrimaryAction = "download" | "explain" | "retry" | "use" | "none";
export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface RowView {
  state: RowState;
  primary: PrimaryAction;
  tone: BadgeTone;
  /** The remove action explains itself instead of running (the row is in use). */
  removeBlocked: boolean;
  /** Memory warning to show next to the row; "insufficient" only warns, never hides the row. */
  fitWarning: FitVerdict | null;
  /** Loading it can get the app killed here: the row says so instead of "May be slow", and Use asks first (CR-1). */
  mayCloseApp: boolean;
}

/**
 * On a phone at or under the compact-only RAM limit (Tusk's
 * COMPACT_ONLY_MAX_RAM_BYTES, the one the setup uses), a language model
 * bigger than the compact one can get BOAR killed by the system when it
 * loads (Piston: Qwen3-4B on 3.8 GB, lowmemorykiller). Unknown RAM (0) is
 * not a reason to warn.
 */
export function mayCloseApp(
  model: { kind: string; sizeBytes: number },
  compactSizeBytes: number | undefined,
  totalRamBytes: number
): boolean {
  return (
    model.kind === "llm" &&
    compactSizeBytes !== undefined &&
    model.sizeBytes > compactSizeBytes &&
    totalRamBytes > 0 &&
    totalRamBytes <= COMPACT_ONLY_MAX_RAM_BYTES
  );
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
      detail: dl.errorDetail,
    };
  }
  if (dl?.downloading) {
    if (dl.phase === "verifying") {
      // downloadManager reports hashed bytes as `progress` in this phase.
      const progress = dl.verifyTotal ? (dl.verifyBytes ?? 0) / dl.verifyTotal : dl.progress;
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
  const closes = input.mayCloseApp ?? false;
  // The stronger warning replaces "May be slow".
  const fitWarning = !closes && input.fit && input.fit !== "resident" ? input.fit : null;
  const base = { removeBlocked: state.kind === "in-use", fitWarning, mayCloseApp: closes };
  switch (state.kind) {
    case "not-installed":
      return { ...base, state, primary: fitWarning === "insufficient" ? "explain" : "download", tone: "neutral" };
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
