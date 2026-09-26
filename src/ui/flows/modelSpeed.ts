/**
 * Measured generation speed per model, from this phone's execution log,
 * with the same filters as Tusk's modelSpeedStats (routing uses it for the
 * automatic choice): finished answers of at least 16 tokens, the recorded
 * tokens/s when present, otherwise tokens / generation time.
 */
import type { ExecutionTelemetryRecord } from "../../services/executionTelemetry.pure";
import { median, recordTokPerSec } from "./perfBands";

/** Shorter answers time mostly overhead, not generation. */
const MIN_TOKENS = 16;

export interface ModelSpeed {
  medianTokPerSec: number;
  samples: number;
  /** When the most recent measured answer ran (ms since epoch). */
  lastAt: number;
}

export function speedsByModel(records: ExecutionTelemetryRecord[]): Record<string, ModelSpeed> {
  const byModel = new Map<string, { rates: number[]; lastAt: number }>();
  for (const r of records) {
    if (r.outcome !== "success" || !r.modelId || (r.tokensGenerated ?? 0) < MIN_TOKENS) continue;
    const rate = r.tokPerSec && r.tokPerSec > 0 ? r.tokPerSec : recordTokPerSec(r);
    if (rate == null) continue;
    const entry = byModel.get(r.modelId) ?? { rates: [], lastAt: 0 };
    entry.rates.push(rate);
    entry.lastAt = Math.max(entry.lastAt, r.createdAt);
    byModel.set(r.modelId, entry);
  }
  const out: Record<string, ModelSpeed> = {};
  for (const [id, { rates, lastAt }] of byModel) out[id] = { medianTokPerSec: median(rates)!, samples: rates.length, lastAt };
  return out;
}
