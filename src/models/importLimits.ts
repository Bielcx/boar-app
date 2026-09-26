import type { CatalogModel } from "./manifest";

/**
 * Size ceilings for anything a user brings in from a file. Assets matched
 * against the catalog are streamed (never loaded into memory), so their caps
 * only reject absurd files before the hash starts; documents are read whole
 * into JS memory, so theirs are tight. Pure; tested in importLimits.test.ts.
 */
export type ImportKind =
  | "llm"
  | "embedding"
  | "knowledge-pack"
  | "places-pack"
  | "corpus-json"
  | "document-text"
  | "document-pdf";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

export const IMPORT_LIMITS: Record<ImportKind, number> = {
  // Largest model worth running in 12 GB of RAM is ~13 GB on disk (35B-A3B at 2-bit); leave room.
  llm: 24 * GiB,
  embedding: 2 * GiB,
  // Full English Wikipedia with its index is ~20 GB.
  "knowledge-pack": 30 * GiB,
  // A continent of OSM food places is hundreds of MB.
  "places-pack": 4 * GiB,
  // Parsed with JSON.parse in one go.
  "corpus-json": 64 * MiB,
  // .txt/.md/.csv/.json notes: read into memory, then chunked and embedded one by one.
  "document-text": 25 * MiB,
  "document-pdf": 100 * MiB,
};

const LABEL: Record<ImportKind, string> = {
  llm: "Language models",
  embedding: "Embedding models",
  "knowledge-pack": "Knowledge packs",
  "places-pack": "Places packs",
  "corpus-json": "Topic lists",
  "document-text": "Notes and text documents",
  "document-pdf": "PDFs",
};

const HINT: Record<ImportKind, string> = {
  llm: "Pick a smaller quantization.",
  embedding: "Pick the model listed in docs/OFFLINE_INSTALL.md.",
  "knowledge-pack": "Pick a smaller pack.",
  "places-pack": "Pick a smaller region.",
  "corpus-json": "Split it into smaller files.",
  "document-text": "Split it into smaller files.",
  "document-pdf": "Split it into smaller PDFs.",
};

/** The largest cap of any asset kind: a file above it can't be anything installable. */
export const MAX_ASSET_IMPORT_BYTES = Math.max(
  IMPORT_LIMITS.llm,
  IMPORT_LIMITS.embedding,
  IMPORT_LIMITS["knowledge-pack"],
  IMPORT_LIMITS["places-pack"],
  IMPORT_LIMITS["corpus-json"]
);

export function importKindOfAsset(asset: Pick<CatalogModel, "kind" | "format">): ImportKind {
  if (asset.kind === "llm") return "llm";
  if (asset.kind === "embedding") return "embedding";
  if (asset.format === "poi-pack") return "places-pack";
  if (asset.format === "sqlite-pack") return "knowledge-pack";
  return "corpus-json";
}

/** For personal documents (src/services/documentImporter.ts), by file name. */
export function importKindOfDocument(filename: string): ImportKind {
  return filename.toLowerCase().endsWith(".pdf") ? "document-pdf" : "document-text";
}

export function formatBytes(bytes: number): string {
  if (bytes >= GiB) return `${(bytes / GiB).toFixed(1)} GB`;
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type SizeCheck = { ok: true } | { ok: false; limitBytes: number; message: string };

export function checkImportSize(kind: ImportKind, bytes: number): SizeCheck {
  const limit = IMPORT_LIMITS[kind];
  if (bytes <= limit) return { ok: true };
  return {
    ok: false,
    limitBytes: limit,
    message: `This file is ${formatBytes(bytes)}. ${LABEL[kind]} can be at most ${formatBytes(limit)}. ${HINT[kind]}`,
  };
}
