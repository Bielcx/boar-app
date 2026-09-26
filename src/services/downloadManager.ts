import { ModelManager, DownloadProgress } from "../models/ModelManager";
import { CatalogModel } from "../models/manifest";
import { errorKindOf, IntegrityErrorKind } from "../models/integrity";
import type { HashProgress } from "../models/fileHash";
import { holdWakeLockForDownload } from "./downloadWakeLock";

/**
 * Module-level (not component-local) download state, so it survives the
 * Settings screen unmounting/remounting — e.g. the user closes Settings
 * while a download is running, then reopens it later. Without this, a
 * previous version tracked download progress in ModelSetupScreen's local
 * React state: closing Settings meant losing track of the in-flight
 * download entirely, so reopening Settings showed a plain "Download"
 * button again (as if nothing were happening) even while the original
 * download was still writing to disk. Tapping "Download" again in that
 * state started a SECOND concurrent download to the same destination file
 * — a real race condition, and plausibly part of what produced the
 * truncated Qwen downloads found earlier (two writers to one path).
 *
 * `startDownload` guards against exactly that: if a download for this
 * asset is already in flight, it returns the existing one instead of
 * starting a duplicate.
 */

export interface DownloadState {
  /** True while bytes are moving or being hashed (phase downloading/verifying). */
  downloading: boolean;
  /** 0..1 within the current phase. */
  progress: number;
  error: string | null;
  /**
   * "verifying" = sha256 of the finished file (streaming, native); progress
   * then counts bytes hashed. "verified" = downloaded and sha256 matched.
   */
  phase?: "downloading" | "verifying" | "verified" | "error";
  /** Set with `error`. */
  errorKind?: IntegrityErrorKind;
  /** Retrying the same source won't help; don't auto-retry (see AssetIntegrityError). */
  permanent?: boolean;
  bytesWritten?: number;
  bytesExpected?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
}

const modelManager = new ModelManager();
const state = new Map<string, DownloadState>();
const inFlight = new Map<string, Promise<void>>();
const downloadTimestamps = new Map<string, { lastBytes: number; lastTime: number; startTime: number }>();
type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeDownloads(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDownloadState(assetId: string): DownloadState | undefined {
  return state.get(assetId);
}

export function isDownloading(assetId: string): boolean {
  return inFlight.has(assetId);
}

/**
 * All currently-tracked download states, keyed by asset id. Used by
 * screens that don't already know the specific set of asset ids to watch —
 * e.g. ChatScreen surfacing a "download complete" toast for whatever
 * optional model the user started downloading from the Models screen,
 * without needing its own copy of the full catalog+discovered-models list
 * just to enumerate what to check.
 */
export function listDownloadStates(): Array<{ assetId: string; state: DownloadState }> {
  return Array.from(state.entries()).map(([assetId, s]) => ({ assetId, state: s }));
}

/**
 * Forgets all tracked download state without cancelling any in-flight
 * FileSystem transfer (there's no cancel handle stored here to call) — used
 * by appReset.ts right before deleting the model files those transfers
 * would have been writing to, so a stale/failed entry doesn't linger for a
 * file that no longer exists.
 */
export function resetDownloadState(): void {
  state.clear();
  inFlight.clear();
  downloadTimestamps.clear();
  notify();
}

/**
 * Force-restarts a download that's stuck with no error surfaced at all —
 * no progress, no failure, just inert. This can happen with no real device
 * problem: `inFlight`/`state` are module-level singletons, so a dev Fast
 * Refresh mid-download can leave a stale in-flight entry pointing at a
 * promise nothing will ever resolve, which `startDownload`'s "already
 * running" guard then treats as legitimately in progress forever. Unlike
 * `startDownload`, this doesn't check that guard — it clears the tracked
 * state unconditionally and cancels+deletes whatever ModelManager was
 * actually holding, then starts clean.
 *
 * Ordering matters: signal cancel, then AWAIT the stale in-flight promise's
 * settlement, and only then delete the file and start over. Deleting the
 * file right after signalling cancel (without waiting) races the old
 * download's writer, which doesn't stop touching the file the instant
 * pauseAsync() resolves — if it closes its stream after the new download
 * already finished, it silently truncates the file back down, and a fully-
 * downloaded model comes back verified as 0 bytes.
 */
export async function restartDownload(asset: CatalogModel): Promise<void> {
  const stale = inFlight.get(asset.id);
  await modelManager.signalCancelDownload(asset);
  if (stale) {
    await stale.catch(() => {});
  }
  await modelManager.deletePartialDownload(asset);
  inFlight.delete(asset.id);
  state.delete(asset.id);
  downloadTimestamps.delete(asset.id);
  notify();
  await startDownload(asset);
}

/** Starts a download if one isn't already running for this asset; otherwise no-ops. */
export function startDownload(asset: CatalogModel): Promise<void> {
  const existing = inFlight.get(asset.id);
  if (existing) return existing;

  const now = Date.now();
  downloadTimestamps.set(asset.id, { lastBytes: 0, lastTime: now, startTime: now });

  state.set(asset.id, {
    downloading: true,
    phase: "downloading",
    progress: 0,
    error: null,
    bytesWritten: 0,
    bytesExpected: asset.sizeBytes,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  });
  notify();

  const releaseWakeLock = holdWakeLockForDownload(asset.id);
  const promise = modelManager
    .downloadCatalogModel(asset, (p: DownloadProgress) => {
      if (p.phase === "verifying") {
        const total = p.totalBytesExpectedToWrite || asset.sizeBytes;
        state.set(asset.id, {
          downloading: true,
          phase: "verifying",
          progress: total > 0 ? Math.min(1, p.totalBytesWritten / total) : 0,
          error: null,
          bytesWritten: p.totalBytesWritten,
          bytesExpected: total,
        });
        notify();
        return;
      }
      const progress = p.totalBytesExpectedToWrite > 0 ? p.totalBytesWritten / p.totalBytesExpectedToWrite : 0;
      const ts = downloadTimestamps.get(asset.id);
      const currentTime = Date.now();
      let speedBytesPerSec = 0;
      let etaSeconds = 0;

      if (ts) {
        const timeDiffSec = (currentTime - ts.lastTime) / 1000;
        if (timeDiffSec >= 0.5) {
          const bytesDiff = p.totalBytesWritten - ts.lastBytes;
          speedBytesPerSec = Math.max(0, bytesDiff / timeDiffSec);
          ts.lastBytes = p.totalBytesWritten;
          ts.lastTime = currentTime;
        } else {
          const prev = state.get(asset.id);
          speedBytesPerSec = prev?.speedBytesPerSec ?? 0;
        }

        const remainingBytes = Math.max(0, p.totalBytesExpectedToWrite - p.totalBytesWritten);
        if (speedBytesPerSec > 0) {
          etaSeconds = Math.ceil(remainingBytes / speedBytesPerSec);
        }
      }

      state.set(asset.id, {
        downloading: true,
        phase: "downloading",
        progress,
        error: null,
        bytesWritten: p.totalBytesWritten,
        bytesExpected: p.totalBytesExpectedToWrite,
        speedBytesPerSec,
        etaSeconds,
      });
      notify();
    })
    .then(() => {
      state.set(asset.id, {
        downloading: false,
        phase: "verified",
        progress: 1,
        error: null,
        bytesWritten: asset.sizeBytes,
        bytesExpected: asset.sizeBytes,
        speedBytesPerSec: 0,
        etaSeconds: 0,
      });
      downloadTimestamps.delete(asset.id);
    })
    .catch((e: any) => {
      const { kind, permanent } = errorKindOf(e);
      state.set(asset.id, {
        downloading: false,
        phase: "error",
        progress: 0,
        error: e?.message ?? String(e),
        errorKind: kind,
        permanent,
      });
      downloadTimestamps.delete(asset.id);
    })
    .finally(() => {
      releaseWakeLock();
      inFlight.delete(asset.id);
      notify();
    });

  inFlight.set(asset.id, promise);
  return promise;
}

/**
 * Installs a model or pack from a user-picked file (content:// from the
 * document picker, or file://) with no network: copied into the app and
 * accepted only if its size + sha256 match a catalog entry. Holds the wake
 * lock like a download, since hashing a multi-GB file takes a while.
 * Rejects with AssetIntegrityError (see errorKindOf) on anything else.
 */
export async function importAssetFile(uri: string, onProgress?: HashProgress): Promise<CatalogModel> {
  const release = holdWakeLockForDownload(`import:${uri}`);
  try {
    const asset = await modelManager.importFromFile(uri, onProgress);
    state.set(asset.id, {
      downloading: false,
      phase: "verified",
      progress: 1,
      error: null,
      bytesWritten: asset.sizeBytes,
      bytesExpected: asset.sizeBytes,
    });
    notify();
    return asset;
  } finally {
    release();
  }
}
