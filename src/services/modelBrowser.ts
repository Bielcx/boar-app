import { CatalogModel } from "../models/manifest";
import { networkAllowed } from "../config/variant";

/**
 * Search Hugging Face for GGUF models beyond the fixed, hand-picked
 * MODEL_CATALOG. This is the app's second and ONLY OTHER source of network
 * access besides the model-setup downloads — used exclusively when the user
 * explicitly searches/downloads here, never automatically and never during
 * chat/inference.
 *
 * Unlike MODEL_CATALOG entries, these aren't vetted by anyone who's run
 * them — no one has confirmed they actually fit typical phone RAM, run
 * cleanly in llama.rn, or aren't mislabeled. The download URL is pinned to
 * the repo commit seen when the files were listed, and when Hugging Face's
 * LFS metadata gives a sha256 (siblings[].lfs.oid) ModelManager verifies it
 * after download like any catalog entry; without one, only the size is
 * checked. Disabled entirely in the offline build (no INTERNET permission).
 */

const HF_API = "https://huggingface.co/api";

export interface HFModelSummary {
  id: string; // e.g. "bartowski/Llama-3.2-3B-Instruct-GGUF"
  downloads?: number;
  likes?: number;
}

export interface HFGgufFile {
  filename: string;
  sizeBytes: number;
  sha256: string | null;
  /** Repo commit the listing came from, so the download can't drift from what was shown. */
  revision: string | null;
}

function assertNetwork(): void {
  if (!networkAllowed()) throw new Error("Model search is not available in the offline build of BOAR.");
}

export async function searchModels(query: string, limit = 15): Promise<HFModelSummary[]> {
  assertNetwork();
  const url = `${HF_API}/models?search=${encodeURIComponent(query)}&filter=gguf&limit=${limit}&sort=downloads&direction=-1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hugging Face search failed (${res.status})`);
  const data = await res.json();
  return (data as any[]).map((m) => ({ id: m.id, downloads: m.downloads, likes: m.likes }));
}

export async function listGgufFiles(repoId: string): Promise<HFGgufFile[]> {
  assertNetwork();
  const url = `${HF_API}/models/${repoId}?blobs=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to list files for ${repoId} (${res.status})`);
  const data = await res.json();
  const siblings: any[] = data.siblings ?? [];
  const revision = typeof data.sha === "string" && /^[0-9a-f]{40}$/.test(data.sha) ? data.sha : null;
  return siblings
    .filter((s) => typeof s.rfilename === "string" && s.rfilename.toLowerCase().endsWith(".gguf"))
    .map((s) => ({
      filename: s.rfilename,
      sizeBytes: s.size ?? 0,
      sha256: s.lfs?.oid ?? null,
      revision,
    }))
    .sort((a, b) => a.sizeBytes - b.sizeBytes);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function toCatalogModel(repoId: string, file: HFGgufFile): CatalogModel {
  const id = `hf-${slug(repoId)}-${slug(file.filename)}`.slice(0, 120);
  return {
    id,
    kind: "llm",
    label: file.filename.replace(/\.gguf$/i, ""),
    filename: `models/${id}.gguf`,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256 ?? "",
    sourceUrl: `https://huggingface.co/${repoId}/resolve/${file.revision ?? "main"}/${file.filename}`,
    license: "Unknown — check the model's Hugging Face page",
    description: `${repoId} — added via model search, not vetted by aoair`,
    required: false,
  };
}
