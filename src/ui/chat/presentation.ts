import { CALCULATOR_MODEL_ID, EXTRACTIVE_MODEL_ID, GROUNDING_GUARD_MODEL_ID, type AnswerReceipt } from "./answerEvents";
import { answerPhase, noSourceKind, type AnswerPhase, type AnswerState } from "./answerReducer";
import { formatSeconds, formatTokPerSec } from "./shareFormat";
import { placesEmptyTitle } from "./placesFormat";
import { chatModelName, chatModelNameById, type NameableModel } from "./modelName";
import { answerSourceSplit } from "./sourceLabel";

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
  t: T,
  /** The library's indexing failed part-way: "not found" says so. */
  libraryIncomplete = false
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
      if (state.weakDeclined) {
        const c = declineCopy(state, libraryIncomplete);
        return { message: `${t(c.title)}. ${t(c.body)}` };
      }
      if (state.weakSources) return { message: t("chat.announce.readyNoSource") };
      {
        // CT-2: count what the card shows, the cited sources; none cited reads as no source.
        const cited = answerSourceSplit(state)?.cited.length ?? state.sources.length;
        if (cited === 0 && state.sources.length > 0) return { message: t("chat.announce.readyNoSource") };
        // No sources at all (a calculation, a fixed answer): just "ready", never "0 sources".
        if (cited === 0) return { message: t("chat.announce.readyPlain") };
        return { message: t("chat.announce.ready", { count: cited }) };
      }
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
/**
 * The display name for a model the crash marker names by id, label or file path (Prism CR-3: the
 * banner showed "models/qwen3-4b-instruct-2507-q4km.gguf"). Catalog (and discovered) label first;
 * otherwise the file's name without folder or ".gguf", never an internal path.
 */
export function modelDisplayName(
  ref: string,
  models: (NameableModel & { filename?: string })[],
  t: T
): string {
  const key = ref.trim();
  if (!key) return "";
  const found = models.find((m) => m.id === key || m.label === key || (!!m.filename && m.filename === key));
  if (found) return chatModelName(found, t);
  if (key.includes("/") || /\.gguf$/i.test(key)) return key.split("/").pop()!.replace(/\.gguf$/i, "");
  return key;
}

/** The crash with the chat's names for both models (CR-3; tier names, r4to). */
export function withDisplayNames<C extends { crashedLabel: string; fallbackLabel: string }>(
  crash: C | null,
  models: Parameters<typeof modelDisplayName>[1],
  t: T
): C | null {
  if (!crash) return null;
  return { ...crash, crashedLabel: modelDisplayName(crash.crashedLabel, models, t), fallbackLabel: modelDisplayName(crash.fallbackLabel, models, t) };
}

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
  // I18N-2: the engine's label is English; say it in the app's language.
  if (r.modelId === GROUNDING_GUARD_MODEL_ID) return [total, t("chat.receipt.noOfflineSource"), t("chat.receipt.offline")].join(" · ");
  if (r.modelId === CALCULATOR_MODEL_ID) return [total, t("chat.receipt.calculator"), t("chat.receipt.offline")].join(" · ");
  const parts = [total, (r.modelLabel && chatModelNameById(r.modelId, r.modelLabel, t)) || t("chat.receipt.localModel")];
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

export type StepStatus = "done" | "active" | "pending";
export interface GeneratingStep {
  key: "search" | "read" | "write";
  label: string;
  /** Short form for the pill next to the name ("Reading…"). */
  short: string;
  icon: "search" | "cpu" | "book-open" | "zap" | "check-circle" | "layers";
  status: StepStatus;
}

/**
 * The generating card as the mockup: every step from the start, done / active / pending. The steps are
 * the answer's real phases: searching this phone's library, reading the sources (or loading the model),
 * writing the answer (or checking it / researching part n of m). Null outside a running answer.
 */
export function generatingSteps(state: AnswerState, t: T): GeneratingStep[] | null {
  const phase = answerPhase(state);
  const order: Record<string, number> = { searching: 0, loading_model: 1, reading: 1, generating: 2, verifying: 2, synthesizing: 2 };
  const at = order[phase];
  if (at == null) return null;
  const status = (i: number): StepStatus => (i < at ? "done" : i === at ? "active" : "pending");
  const n = state.sources.length;
  const read =
    phase === "loading_model"
      ? { label: t("chat.stage.loadingModel"), icon: "cpu" as const }
      : n > 0
        ? { label: t("chat.stage.reading", { count: n }), icon: "book-open" as const }
        : { label: t("chat.stage.thinking"), icon: "book-open" as const };
  const write =
    phase === "verifying"
      ? { label: t("chat.stage.verifying"), icon: "check-circle" as const }
      : phase === "synthesizing"
        ? { label: stageLine(state, t) ?? t("chat.stage.synthesizing"), icon: "layers" as const }
        : { label: t("chat.stage.writing"), icon: "zap" as const };
  return [
    { key: "search", label: t("chat.stage.searching"), short: t("chat.stepShort.search"), icon: "search", status: status(0) },
    { key: "read", label: read.label, short: t(phase === "loading_model" ? "chat.stepShort.load" : "chat.stepShort.read"), icon: read.icon, status: status(1) },
    { key: "write", label: write.label, short: t("chat.stepShort.write"), icon: write.icon, status: status(2) },
  ];
}

/**
 * The mascot's entrance right after boot (Iris, transition splash → chat): wait, then fade in, so it never
 * overlaps or jumps from the native splash's boar. Under reduce motion the wait stays (a delay is not
 * motion, and it is what keeps the two boars apart) and the fade goes: it appears at once. Null = show at
 * once: not the first mount after launch.
 */
export function bootEntranceTiming(
  firstAfterBoot: boolean,
  reduceMotion: boolean,
  duration: { slow: number; base: number }
): { delay: number; fade: number } | null {
  if (!firstAfterBoot) return null;
  return { delay: duration.slow, fade: reduceMotion ? 0 : duration.base };
}

/**
 * Whether an instant answer offers "Answer with the model": after a source passage, yes; not after
 * the engine's fixed answer (grounding-guard: a current-events question, Prism CT-4), where a model
 * would only guess what an offline snapshot can't know.
 */
export function offersAskModel(a: { instantDone?: { receipt: AnswerReceipt }; fast?: unknown; places?: unknown }): boolean {
  if (!a.instantDone || a.fast || a.places) return false;
  // Nor after the exact arithmetic (calculator): a model would only be less exact.
  return a.instantDone.receipt.modelId !== GROUNDING_GUARD_MODEL_ID && a.instantDone.receipt.modelId !== CALCULATOR_MODEL_ID;
}

/**
 * The tag after the receipt's numbers (Iris): "general knowledge" only when nothing on the phone
 * covered the question, where it is true; "no source cited" when passages on the topic were found
 * but the model cited none (it may have used them, so "general knowledge" could be false).
 */
export function receiptTagKey(a: AnswerState): "chat.weak.receipt" | "chat.weak.receiptUncited" | "chat.receipt.calculator" | null {
  // The exact conversion (Prism CALC-1): say by the name that no model wrote it, as the other tags do.
  if (!a.fast && a.instantDone?.receipt.modelId === CALCULATOR_MODEL_ID) return "chat.receipt.calculator";
  const kind = noSourceKind(a);
  return kind === "weak" ? "chat.weak.receipt" : kind === "uncited" ? "chat.weak.receiptUncited" : null;
}

/**
 * Which note sits in the sources' slot of a finished answer (the tag changes, the warning never
 * goes, Prism): "weak" (nothing on the topic: note B), "uncited" (passages found, none cited:
 * CT-5 note), or none. A declined answer has its own card, a places list its own card.
 */
export function noSourceNote(a: AnswerState, placesOnly: boolean): "weak" | "uncited" | null {
  if (placesOnly || a.weakDeclined) return null;
  return noSourceKind(a);
}

/**
 * The "From the source" card shows the instant passage unless the engine's literal excerpt answers
 * (Prism DUP-1: a health question got both, the same instruction twice, pushing the emergency note
 * off screen; the excerpt is the engine's final answer, with [n], language label and emergency line),
 * or nothing on the phone was on the topic.
 */
export function showsInstantSnippet(a: AnswerState): boolean {
  return !!a.instant && !a.extract && noSourceKind(a) !== "weak";
}

/**
 * The engine's language lead on an instant passage (Tusk 29d7e52): "Da fonte offline (em inglês):" or
 * "From the offline source (in Portuguese):" as the first line when the passage's language differs
 * from the question's. The card shows the language by its header ("From the source (in Portuguese) ·
 * Title") instead of saying "from the source" twice; copy and share keep the text as it came.
 */
export function sourceLanguageLead(text: string): { lang: string | null; body: string } {
  const m = /^(?:Da fonte offline|From the offline source) \(([^)]+)\):[ \t]*\n/.exec(text);
  return m ? { lang: m[1], body: text.slice(m[0].length) } : { lang: null, body: text };
}

/**
 * Why the compact model's answer was withheld (weak_sources declined), which the card and the
 * announcement must say truthfully: "none" = nothing on the topic in this phone's library;
 * "unsupported" = passages on the topic were found, but every citation the model made was removed
 * as unsupported (Tusk 237764a, grounding:all-citations-removed-declined-compact). Off-topic
 * passages never reach the chat (Tusk 404d688), so the sources tell the two apart.
 */
export function declineCopy(a: AnswerState, libraryIncomplete = false): { title: string; body: string } {
  if (a.sources.length > 0) return { title: "chat.weak.unsupportedTitle", body: "chat.weak.unsupportedBody" };
  return libraryIncomplete
    ? { title: "chat.weak.declinedTitleIncomplete", body: "chat.weak.declinedBodyIncomplete" }
    : { title: "chat.weak.declinedTitle", body: "chat.weak.declinedBody" };
}

/**
 * Whether the model tier's text shows as the answer body. Not on a decline (weak_sources declined):
 * the engine now puts the decline's own sentence in done.finalText (Tusk 05d1e6b, "never an empty
 * screen") for readers that don't know the card (history, share, screen runners); on screen the
 * decline card already says it, so the body would repeat it.
 */
export function showsAnswerBody(a: AnswerState): boolean {
  return !a.weakDeclined;
}
