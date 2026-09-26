import { EXTRACTIVE_MODEL_ID, type AnswerReceipt } from "./answerEvents";
import { answerPhase, type AnswerPhase, type AnswerState } from "./answerReducer";
import { formatSeconds, formatTokPerSec } from "./shareFormat";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** The stage line under an answer that has no text yet (or a deep pass in progress). */
export function stageLine(state: AnswerState, t: T): string | null {
  const tier = state.deep ?? state.fast;
  const phase = answerPhase(state);
  switch (phase) {
    case "searching":
      return t("chat.stage.searching");
    case "loading_model":
      return t("chat.stage.loadingModel");
    case "reading":
      return state.sources.length > 0
        ? t("chat.stage.reading", { count: state.sources.length })
        : t("chat.stage.thinking");
    case "verifying":
      return t("chat.stage.verifying");
    case "synthesizing": {
      const d = tier?.detail;
      return d?.index != null && d.count
        ? t("chat.stage.part", { index: d.index + 1, count: d.count })
        : t("chat.stage.synthesizing");
    }
    default:
      return null;
  }
}

/**
 * What a screen reader hears when the answer moves to `phase`; null means
 * stay quiet (tokens are never announced). Errors are assertive.
 */
export function phaseAnnouncement(
  phase: AnswerPhase,
  state: AnswerState,
  t: T
): { message: string; assertive?: boolean } | null {
  switch (phase) {
    case "searching":
      return { message: t("chat.announce.searching") };
    case "generating":
      return { message: t("chat.announce.answering") };
    case "done":
      return { message: t("chat.announce.ready", { count: state.sources.length }) };
    case "stopped":
      return { message: t("chat.announce.stopped") };
    case "error":
      return { message: t("chat.error.generic"), assertive: true };
    case "timeout":
    case "interrupted":
      return { message: t(`chat.notice.${phase}`) };
    default:
      return null;
  }
}

/** "Qwen3 4B · 14.8 tok/s · started in 2.1 s · 6.2 s" (or the source-passage form). */
export function receiptLine(r: AnswerReceipt, locale: string, t: T): string {
  if (r.modelId === EXTRACTIVE_MODEL_ID) {
    return [t("chat.receipt.sourcePassage"), formatSeconds(r.totalMs, locale), t("chat.receipt.offline")].join(" · ");
  }
  const parts = [r.modelLabel || t("chat.receipt.localModel")];
  if (r.tokPerSec > 0) parts.push(`${formatTokPerSec(r.tokPerSec, locale)} tok/s`);
  if (r.ttftMs > 0) parts.push(t("chat.receipt.started", { time: formatSeconds(r.ttftMs, locale) }));
  parts.push(formatSeconds(r.totalMs, locale), t("chat.receipt.offline"));
  return parts.join(" · ");
}

/** The measured details shown when the receipt is expanded, as label/value rows. */
export function receiptDetails(r: AnswerReceipt, locale: string, t: T): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const s = (ms: number) => formatSeconds(ms, locale);
  if (r.loadMs) rows.push({ label: t("chat.receipt.load"), value: s(r.loadMs) });
  if (r.retrievalMs != null) rows.push({ label: t("chat.receipt.search"), value: s(r.retrievalMs) });
  if (r.prefillMs != null) rows.push({ label: t("chat.receipt.prefill"), value: s(r.prefillMs) });
  if (r.ctxTokens != null) rows.push({ label: t("chat.receipt.context"), value: `${r.ctxTokens} tok` });
  rows.push({ label: t("chat.receipt.firstToken"), value: s(r.ttftMs) });
  rows.push({ label: t("chat.receipt.tokens"), value: String(r.tokens) });
  rows.push({ label: t("chat.receipt.total"), value: s(r.totalMs) });
  if (r.verification) rows.push({ label: t("chat.receipt.verification"), value: t(`chat.receipt.verified.${r.verification}`) });
  return rows;
}
