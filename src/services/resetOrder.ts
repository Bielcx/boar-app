/**
 * The order of "Erase everything" (appReset.ts), pure so it's testable.
 *
 * Nothing on disk is deleted while something may still read or write it:
 * running downloads are stopped, native model contexts released, every
 * SQLite connection closed (each one only after its calls in flight finish;
 * closing under a live query crashed natively, Prism RS-1), and only then
 * the files go. A failing step stops the reset: deleting files under a
 * connection that didn't close is the crash this order exists to prevent.
 */
export interface ResetSteps {
  /** Stop running downloads and wait for their writers to settle. */
  cancelDownloads(): Promise<void>;
  /** Release the llama.cpp contexts, which keep model files mapped. */
  unloadEngines(): Promise<void>;
  /** Close read-only connections: knowledge packs, places packs, gazetteer. */
  closeStores(): Promise<void>;
  /** Stop indexing, close the shared database once, then delete it. */
  resetDatabase(): Promise<void>;
  /** Delete downloaded and imported files (models, packs, places). */
  deleteFiles(): Promise<void>;
  /** Settings and other small JSON state. */
  clearSettings(): Promise<void>;
}

export const RESET_ORDER: ReadonlyArray<keyof ResetSteps> = [
  "cancelDownloads",
  "unloadEngines",
  "closeStores",
  "resetDatabase",
  "deleteFiles",
  "clearSettings",
];

export async function runReset(steps: ResetSteps): Promise<void> {
  for (const name of RESET_ORDER) await steps[name]();
}

type Closer = () => Promise<void>;
const closers = new Map<string, Closer>();

/**
 * A module that keeps its own SQLite connections (e.g. src/rag/pois.ts)
 * registers how to close them, so the reset closes it without importing it.
 * Call at module load; the same name replaces the earlier closer.
 */
export function registerStoreCloser(name: string, close: Closer): void {
  closers.set(name, close);
}

export function closeRegisteredStores(): Promise<void> {
  return Promise.all([...closers.values()].map((close) => close())).then(() => {});
}
