/**
 * The "Ethereum and cryptography" knowledge pack (scripts/fetch-crypto.mjs,
 * docs/KNOWLEDGE_PACKS.md): catalog entry and sources for the Knowledge card
 * and the About screen. Values are the measured build of 2026-09-26. No native
 * imports.
 */
import type { CatalogModel } from "../models/manifest";
import { registerAssetProvider } from "../models/assetRegistry";

export const CRYPTO_PACK = {
  id: "boar-crypto",
  name: { en: "Ethereum and cryptography", pt: "Ethereum e criptografia" },
  filename: "corpus/boar-crypto.sqlite",
  sizeBytes: 35962880,
  sha256: "fe75514ed407ea5f9c0310d3261407c9e779719b7787c2d8c4e7f584dae12c5e",
  /** Pinned to the upload commit on the Hugging Face dataset r4topunk/boar-packs. */
  sourceUrl: "https://huggingface.co/datasets/r4topunk/boar-packs/resolve/b309ba92d7392c6a36f0c186dbcb3ce67966a339/topics/boar-crypto.sqlite",
  docCount: 3141,
  builtAt: "2026-09-26",
};

/** Every source in the pack, for attribution (each passage also carries its own page URL and license). */
export const CRYPTO_SOURCES: Array<{ name: string; license: string; url?: string; documents: number }> = [
  { name: "Ethereum Improvement Proposals (EIPs)", license: "CC0 1.0", url: "https://eips.ethereum.org", documents: 591 },
  { name: "Ethereum Requests for Comment (ERCs)", license: "CC0 1.0", url: "https://ercs.ethereum.org", documents: 617 },
  { name: "Ethereum consensus, execution, API and Portal Network specifications", license: "CC0 1.0", url: "https://github.com/ethereum/consensus-specs", documents: 129 },
  { name: "Ethereum Yellow Paper", license: "CC BY-SA 4.0", url: "https://github.com/ethereum/yellowpaper", documents: 27 },
  { name: "ethereum.org", license: "MIT", url: "https://ethereum.org", documents: 228 },
  { name: "Bitcoin Improvement Proposals (permissively licensed)", license: "BSD, MIT, CC0, CC BY or public domain (per BIP)", url: "https://github.com/bitcoin/bips", documents: 180 },
  { name: "Wikipedia", license: "CC BY-SA 4.0", url: "https://en.wikipedia.org", documents: 1369 },
];

export function cryptoEntry(): CatalogModel {
  return {
    id: CRYPTO_PACK.id,
    kind: "corpus",
    format: "sqlite-pack",
    label: CRYPTO_PACK.name.en,
    filename: CRYPTO_PACK.filename,
    sizeBytes: CRYPTO_PACK.sizeBytes,
    sha256: CRYPTO_PACK.sha256,
    sourceUrl: CRYPTO_PACK.sourceUrl,
    license: "CC0 1.0 (EIPs, ERCs, specs), CC BY-SA 4.0 (Wikipedia, Yellow Paper), MIT (ethereum.org), per-BIP permissive licenses",
    description: `${CRYPTO_PACK.docCount.toLocaleString("en-US")} documents: Ethereum EIPs, ERCs and specs, ethereum.org, Bitcoin BIPs and Wikipedia on cryptography`,
    required: false,
  };
}

registerAssetProvider("crypto", () => [cryptoEntry()]);
