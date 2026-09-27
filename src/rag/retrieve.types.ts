import type { ChunkRecord } from "./db";

export interface RetrievedChunk extends ChunkRecord {
  score: number;
  matchType: "lexical" | "semantic" | "hybrid";
  /**
   * Format-2 packs only: the passage's section tells what to do (Treatment, First aid, Management, During…).
   * false for a lead or a background section; absent for sources without sections.
   */
  action?: boolean;
}
