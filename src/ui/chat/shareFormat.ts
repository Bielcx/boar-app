import type { RetrievedChunk } from "../../rag/retrieve.types";
import type { AnswerReceipt as Receipt } from "./answerEvents";
import { EXTRACTIVE_MODEL_ID } from "./answerEvents";

/** Labels come from i18n so the text reads in the app's language. */
export interface ShareLabels {
  sources: string;
  /** e.g. "Answered offline by BOAR" */
  answeredOffline: string;
  /** e.g. "Source passage" — shown instead of a model name for extractive answers. */
  sourcePassage: string;
  /** e.g. "My documents" — origin of a chunk from a user-imported collection. */
  myDocuments: string;
}

function sourceLine(chunk: RetrievedChunk, n: number, labels: ShareLabels): string {
  const origin = chunk.collectionId ? labels.myDocuments : chunk.source;
  return origin ? `[${n}] ${chunk.title} — ${origin}` : `[${n}] ${chunk.title}`;
}

/** Answer text plus the sources its "[n]" point to, for the clipboard. */
export function formatForCopy(answer: string, sources: RetrievedChunk[], labels: ShareLabels): string {
  const body = answer.trim();
  if (sources.length === 0) return body;
  const list = sources.map((c, i) => sourceLine(c, i + 1, labels)).join("\n");
  return `${body}\n\n${labels.sources}:\n${list}`;
}

export function formatSeconds(ms: number, locale: string): string {
  const s = ms / 1000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: s < 10 ? 1 : 0 }).format(s)} s`;
}

export function formatTokPerSec(tokPerSec: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(tokPerSec);
}

/** Question, answer, sources and a one-line provenance note, for the system share sheet. */
export function formatForShare(
  question: string,
  answer: string,
  sources: RetrievedChunk[],
  receipt: Receipt | undefined,
  labels: ShareLabels,
  locale: string
): string {
  const parts = [question.trim(), formatForCopy(answer, sources, labels)];
  if (receipt) {
    const who = receipt.modelId === EXTRACTIVE_MODEL_ID ? labels.sourcePassage : receipt.modelLabel;
    parts.push(`${labels.answeredOffline} · ${who} · ${formatSeconds(receipt.totalMs, locale)}`);
  }
  return parts.join("\n\n");
}
