/**
 * Measured generation speed per model, from this phone's execution log.
 * Only answers that finished count; the speed is the eval harness formula
 * (tokens / generation time), so labels match the reports.
 */
import type { ExecutionTelemetryRecord } from "../../services/executionTelemetry.pure";
import { median, recordTokPerSec } from "./perfBands";

export interface ModelSpeed {
  medianTokPerSec: number;
  samples: number;
  /** When the most recent measured answer ran (ms since epoch). */
  lastAt: number;
}

export function speedsByModel(records: ExecutionTelemetryRecord[]): Record<string, ModelSpeed> {
  const byModel = new Map<string, { rates: number[]; lastAt: number }>();
  for (const r of records) {
    if (r.outcome !== "success" || !r.modelId) continue;
    const rate = recordTokPerSec(r);
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
