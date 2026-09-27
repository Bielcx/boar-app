import { EXTRACTIVE_MODEL_ID, type AnswerReceipt } from "./answerEvents";
import { answerPhase, type AnswerPhase, type AnswerState } from "./answerReducer";
import { formatSeconds, formatTokPerSec } from "./shareFormat";
import { placesEmptyTitle } from "./placesFormat";

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
    case "locating":
      // Once, when the wait starts: what is happening and that the city can be typed.
      return { message: t("chat.announce.locating") };
    case "generating":
      return { message: t("chat.announce.answering") };
    case "done":
      if (state.places) {
        if (state.places.coverage === "needs_place") return { message: t("chat.places.whichCity") };
        // Say what the screen says: the empty-state title, or how many places are listed.
        const empty = placesEmptyTitle(state.places, t);
        return { message: empty ?? t("chat.announce.placesFound", { count: state.places.places.length }) };
      }
      if (state.weakSources) return { message: t("chat.announce.readyNoSource") };
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

export const PLACES_MODEL_ID = "places";

/**
 * The one-time notice after a model load killed the app (Boar CR-2); null when there is nothing
 * to say. Without a previous model (first load of the session) it doesn't claim a switch back.
 */
export function loadCrashMessage(crash: { crashedLabel: string; fallbackLabel: string } | null, t: T): string | null {
  if (!crash || !crash.crashedLabel.trim()) return null;
  const model = crash.crashedLabel.trim();
  const fallback = crash.fallbackLabel.trim();
  return fallback ? t("chat.loadCrash.message", { model, fallback }) : t("chat.loadCrash.messageNoFallback", { model });
}

/**
 * Total time first, since that's what a person compares: "Answered in 6.2 s ·
 * Qwen3 4B · 14.8 tok/s · started in 2.1 s · offline". The source-passage and
 * offline-map answers name their source instead of a model.
 */
export function receiptLine(r: AnswerReceipt, locale: string, t: T): string {
  const total = t("chat.receipt.answeredIn", { time: formatSeconds(r.totalMs, locale) });
  if (r.modelId === EXTRACTIVE_MODEL_ID) return [total, t("chat.receipt.sourcePassage"), t("chat.receipt.offline")].join(" · ");
  if (r.modelId === PLACES_MODEL_ID) return [total, t("chat.receipt.offlineMap"), t("chat.receipt.offline")].join(" · ");
  const parts = [total, r.modelLabel || t("chat.receipt.localModel")];
  if (r.tokPerSec > 0) parts.push(`${formatTokPerSec(r.tokPerSec, locale)} tok/s`);
  if (r.ttftMs > 0) parts.push(t("chat.receipt.started", { time: formatSeconds(r.ttftMs, locale) }));
  parts.push(t("chat.receipt.offline"));
  return parts.join(" · ");
}

/**
 * The receipt facts that sit next to the assistant's name (a MetaLine): total time, plus the
 * generation speed when a model wrote the answer ("1.4 s · 16 tok/s"). Numbers
 * only; the spoken and expanded forms use `receiptLine`.
 */
export function receiptShort(r: AnswerReceipt, locale: string): string[] {
  const parts = [formatSeconds(r.totalMs, locale)];
  if (r.modelId !== EXTRACTIVE_MODEL_ID && r.modelId !== PLACES_MODEL_ID && r.tokPerSec > 0) {
    parts.push(`${formatTokPerSec(r.tokPerSec, locale)} tok/s`);
  }
  return parts;
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

/**
 * A collapsed passage as text cut at a word ("When attempting to stop a nosebleed at…"),
 * instead of a one-line numberOfLines clamp, which on Android with the app's font drew a
 * sliver of the second line (Prism, 06f508b).
 */
export function previewText(text: string, max = 110): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/u, "")}…`;
}

/** The icon at the left of a step in the generating card (mockup: search, reasoning spark, streaming bolt). */
export function stageIcon(phase: AnswerPhase): "search" | "cpu" | "book-open" | "zap" | "check-circle" | "layers" | "map-pin" | "circle" {
  switch (phase) {
    case "searching":
      return "search";
    case "loading_model":
      return "cpu";
    case "reading":
      return "book-open";
    case "generating":
      return "zap";
    case "verifying":
      return "check-circle";
    case "synthesizing":
      return "layers";
    case "locating":
      return "map-pin";
    default:
      return "circle";
  }
}
