/**
 * Capacity packages offered by the setup wizard. Every number on a package
 * card is computed here from the manifest and what is already on disk;
 * nothing is typed in by hand.
 *
 * The manifest keeps its four tiers for now. "minimum" and "standard" only
 * differ from "full" by ~3 MB of JSON packs, so the wizard shows "full" as
 * the essential package and hides the other two.
 */
import type { CatalogModel, SetupTier, TierDefinition } from "../../models/manifest";

export type PackageId = "essential" | "encyclopedia";

export const PACKAGES: { id: PackageId; tier: SetupTier }[] = [
  { id: "essential", tier: "full" },
  { id: "encyclopedia", tier: "encyclopedia" },
];

export function packageAssets(tier: TierDefinition, catalog: CatalogModel[]): CatalogModel[] {
  return [
    ...catalog.filter((m) => m.required),
    ...catalog.filter((m) => m.kind === "corpus" && tier.corpusPackIds.includes(m.id)),
  ];
}

export interface PackagePlan {
  assets: CatalogModel[];
  /** Assets still to download or import. */
  pending: CatalogModel[];
  downloadBytes: number;
  /** Disk the package takes once installed, including what is already there. */
  installedBytes: number;
  /** The biggest language model, whose memory fit decides whether the package fits. */
  largestLlm: CatalogModel | undefined;
}

export function planPackage(assets: CatalogModel[], present: Record<string, boolean>): PackagePlan {
  const pending = assets.filter((a) => !present[a.id]);
  const llms = assets.filter((a) => a.kind === "llm");
  return {
    assets,
    pending,
    downloadBytes: pending.reduce((sum, a) => sum + a.sizeBytes, 0),
    installedBytes: assets.reduce((sum, a) => sum + a.sizeBytes, 0),
    largestLlm: llms.reduce<CatalogModel | undefined>((big, m) => (!big || m.sizeBytes > big.sizeBytes ? m : big), undefined),
  };
}

/**
 * Seconds to move `bytes` at `bytesPerSec`. The card shows the speed it
 * assumed next to the result, so the estimate is a declared formula rather
 * than a promise. Undefined when the speed is unknown.
 */
export function transferSeconds(bytes: number, bytesPerSec: number | undefined): number | undefined {
  if (!bytesPerSec || bytesPerSec <= 0) return undefined;
  return bytes / bytesPerSec;
}

/** Bytes missing on the device for this download, or 0 when it fits. Unknown free space never blocks. */
export function storageShortfall(downloadBytes: number, freeBytes: number): number {
  if (freeBytes <= 0) return 0;
  return Math.max(0, downloadBytes - freeBytes);
}
