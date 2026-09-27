/**
 * The layered answer pipeline: classify → plan depth (depth.ts) → retrieve →
 * instant snippet → compressed-context generation (fast or deep) → optional
 * verification, all reported as AnswerEvents (events.ts).
 *
 * Dependencies are injected (createAnswerer) so the whole flow is testable
 * without native modules; answerService.ts wires the real ones.
 *
 * One answer at a time: starting a new answer stops the previous one and
 * waits for it to settle, and LlamaEngine itself serializes completions, so
 * a double send can never run two completions on one context.
 */
import { classifyTask } from "./classify";
import {
  compressContext,
  selectInstant,
  instantFinalBlock,
  INSTANT_FINAL_CONFIDENCE,
  HEALTH_GROUNDING_INSTRUCTION,
  isHealthQuestion,
  isSafetyQuery,
  ACTION_INTENT,
  MIN_TERM_COVERAGE,
  NO_SOURCE_INSTRUCTION,
  noHealthSourceAnswer,
  onTopic,
  PT_QUESTION,
  healthExtract,
  healthSourceIndex,
  healthTopicTerms,
  onHealthTopic,
  riskyHealthInstruction,
  termCoverage,
} from "./context";
import { canonicalHealthTerms, englishSearchTerms } from "./ptQuery";
import { checkCitations } from "./citations";
import { DepthModel, planAnswer, resolveDeepModel, AnswerPlan, deepAutoIneligibility } from "./depth";
import { isCompactModel, pickDefaultAnswerModel, tooBigForLowRam } from "./defaultModel";
import { buildVerificationInput, parseVerificationVerdict, VERIFICATION_INSTRUCTION } from "./verify";
import { taskRequest } from "../inference/format";
import {
  detectGeoIntent,
  distanceMeters,
  formatPlacesAnswer,
  GeoIntent,
  GeoProviders,
  needsPlaceAnswer,
  noDataAnswer,
  noPackAnswer,
  staleLocationAnswer,
  toPlace,
  toSourceChunk,
} from "./geo";
import type {
  AnswerErrorCode,
  AnswerEvent,
  AnswerEventHandler,
  AnswerHandle,
  AnswerOutcome,
  AnswerReceipt,
  AnswerRequest,
  AnswerResult,
  AnswerStageName,
  AnswerTier,
} from "./events";
import type { ModelRole } from "./types";
import type { RetrievedChunk } from "../rag/retrieve.types";
import type { ConversationHistory, ChatMessage } from "../rag/pure";
import type { GenerateOptions, GenerationTimings, LoadResult } from "../inference/LlamaEngine";
import type { MemoryFit } from "../inference/memoryFit";
import type { AnswerSettings } from "../models/settings";
import type { ResearchOptions, ResearchProgress, ResearchResult } from "../services/orchestrator";

export interface InstalledLlm {
  id: string;
  label: string;
  filename: string;
  sizeBytes: number;
  roles: ModelRole[];
  /** The app's default model (fallback when no active model is set or it vanished). */
  isDefault?: boolean;
  /** Catalog tier for the device-dependent default (see defaultModel.ts). */
  answerTier?: "default" | "compact";
}

export interface AnswerEngine {
  load(filename: string, opts?: { meta?: { modelId?: string; label?: string } }): Promise<LoadResult>;
  generate(opts: GenerateOptions): Promise<string>;
  stop(): Promise<void>;
  getModelInfo(): { filename: string } | null;
  hasEmbeddedChatTemplate(): boolean;
  estimateFit(filename: string): Promise<MemoryFit | null>;
}

export interface AnswerDeps {
  engine: AnswerEngine;
  retrieve(query: string, k: number): Promise<RetrievedChunk[]>;
  getSettings(): Promise<AnswerSettings>;
  listInstalledLlms(): Promise<InstalledLlm[]>;
  getActiveModelId(): Promise<string | null>;
  runMultipass(
    query: string,
    systemPrompt: string | undefined,
    history: ConversationHistory | undefined,
    maxTokens: number,
    onProgress: (p: ResearchProgress) => void,
    onToken: (piece: string) => void,
    shouldStop: () => boolean,
    options: ResearchOptions
  ): Promise<ResearchResult>;
  /** Prompt builders (src/rag/pure.ts), injected so tests can inspect what the model sees. */
  assemblePrompt(q: string, chunks: RetrievedChunk[], system?: string, history?: ConversationHistory, style?: string): string;
  assembleChatMessages(q: string, chunks: RetrievedChunk[], system?: string, history?: ConversationHistory, style?: string): ChatMessage[];
  now(): number;
  /** Context window the model will be loaded with (LlamaEngine defaultContextSize). */
  contextSize?(): number;
  /** Total device RAM (0 = unknown), for the device-dependent default model. */
  deviceRamBytes?(): number;
  /** Median measured tok/s per model id on this device (execution telemetry), for rule D6. */
  getModelSpeeds?(): Promise<Map<string, number>>;
  /** Offline places (POI pack + device location); null when not installed/registered. */
  getGeoProviders?(): GeoProviders | null;
}

/** GPS budget: the first useful information must appear in under a second. */
export const LOCATION_TIMEOUT_MS = 700;
/** "Near me" without a fix of 5 minutes or less: how long to wait for a new one (a cold GPS takes seconds). */
export const LOCATION_WAIT_MS = 10_000;
/** A fix that isn't in by then is not a cached one: tell the UI we're locating. */
export const LOCATING_SIGNAL_MS = 150;
/** City path: a fix that is not in by the end of the POI search is ignored for PlacesArea.deviceInside. */
export const DEVICE_INSIDE_TIMEOUT_MS = 150;
/** A named city's reach from its center for deviceInside (metro areas included). */
export const DEVICE_INSIDE_RADIUS_M = 25_000;
export const PLACES_LIMIT = 10;

/** Max <think> tokens before an answer (reasoning models only; see LlamaEngine thinkingBudget). */
export const FAST_THINKING_BUDGET = 256;
export const DEEP_THINKING_BUDGET = 1024;

/** Room kept for the system prompt, history and template tokens around the sources. */
const PROMPT_OVERHEAD_TOKENS = 512;

export interface AnswerContext {
  systemPrompt?: string;
  styleReminder?: string;
  history?: ConversationHistory;
  /** User's Max Output Tokens. */
  maxTokens: number;
}

let answerSeq = 0;
const newAnswerId = () => `ans-${Date.now().toString(36)}-${(answerSeq++).toString(36)}`;

function errorCodeOf(message: string, stage: "load" | "generate"): AnswerErrorCode {
  if (/cannot be streamed|out of memory|oom/i.test(message)) return "oom";
  return stage === "load" ? "load_failed" : "generation_failed";
}

/**
 * Which model answers, with the rules applied everywhere (the user's pick,
 * CR-1 low RAM, CR-2 crashed loads, the device default). Shared by answer()
 * and the chat header (effectiveAnswerModel), so they never disagree.
 */
async function selectAnswerModel(deps: AnswerDeps) {
  let lowRamNote: string | null = null;
  let lowRamBlocked = false;
  const [settings, allInstalled, activeId, speeds] = await Promise.all([
    deps.getSettings(),
    deps.listInstalledLlms(),
    deps.getActiveModelId(),
    deps.getModelSpeeds ? deps.getModelSpeeds().catch(() => new Map<string, number>()) : Promise.resolve(new Map<string, number>()),
  ]);
  let installed = allInstalled;
  // CR-1: on a low-RAM phone, a model above the compact size is never used unless the
  // user confirmed it: not as the saved pick, the default, a fallback, deep or verifier.
  const ram = deps.deviceRamBytes?.() ?? 0;
  const confirmed = new Set(settings.largeModelConfirmedIds ?? []);
  // CR-2: a model whose load killed the app is not loaded again on its own (crash loop);
  // the crash withdrew its confirmation, so only a new one lets it run.
  const crashed = new Set(settings.loadCrashedIds ?? []);
  const blocked = installed.filter((m) => (tooBigForLowRam(m, ram) || crashed.has(m.id)) && !confirmed.has(m.id));
  const blockedActive = activeId ? blocked.find((m) => m.id === activeId) : undefined;
  if (blocked.length) {
    installed = installed.filter((m) => !blocked.includes(m));
    lowRamBlocked = installed.length === 0;
    if (blockedActive) lowRamNote = crashed.has(blockedActive.id) ? `model:load-crashed-${blockedActive.id}` : `model:low-ram-unconfirmed-${blockedActive.id}`;
  }
  const byId = new Map(installed.map((m) => [m.id, m]));
  // The user's pick; without one (or if it was deleted), the device-dependent default:
  // Qwen3-4B where it stays resident, the compact 1.5B on 4 GB phones.
  let fastLlm = activeId ? byId.get(activeId) : undefined;
  if (!fastLlm && installed.length) {
    // Header reads only where the fit can change the pick: the default tier, and other models measured fast.
    const candidates = await Promise.all(
      installed.map(async (m) => {
        const tokPerSec = speeds.get(m.id);
        const needsFit = m.answerTier === "default" || (!m.answerTier && tokPerSec !== undefined);
        return {
          id: m.id,
          answerTier: m.answerTier,
          sizeBytes: m.sizeBytes,
          tokPerSec,
          fit: needsFit ? (await deps.engine.estimateFit(m.filename).catch(() => null))?.verdict : undefined,
        };
      })
    );
    const pick = pickDefaultAnswerModel(candidates, ram);
    fastLlm = pick ? byId.get(pick.id) : undefined;
    fastLlm ??= installed.find((m) => m.isDefault) ?? installed[0];
  }
  return { settings, installed, speeds, fastLlm, blockedActive, lowRamNote, lowRamBlocked };
}

/** What the chat header shows before any question: the model that will answer, and the saved one it replaces. */
export interface EffectiveAnswerModel {
  id: string;
  label: string;
  /** The user's saved model, not used here (low RAM without confirmation, or its load killed the app). */
  downgradedFrom?: { id: string; label: string; reason: "low-ram" | "load-crashed" };
}

export function createAnswerer(deps: AnswerDeps) {
  let current: AnswerHandle | null = null;

  function answer(req: AnswerRequest, onEvent: AnswerEventHandler, ctx: AnswerContext): AnswerHandle {
    const answerId = newAnswerId();
    const previous = current;
    let stopRequested = false;
    // Resolves on stop(), so a wait (the GPS) ends at once instead of running out its timeout.
    let signalStop: () => void = () => {};
    const stopSignal = new Promise<"stopped">((r) => (signalStop = () => r("stopped")));
    // Health, first aid or a disaster: the chat shows the emergency-services line (one classifier: this one).
    const safety = isSafetyQuery(req.query);
    const emit = (e: AnswerEvent) => {
      try {
        onEvent(e.type === "done" && safety ? { ...e, safety: true } : e);
      } catch (err) {
        console.warn("[answer] onEvent threw", err);
      }
    };

    const done = (async (): Promise<AnswerResult> => {
      // Double send: the previous answer is stopped and fully settled before
      // this one touches the model.
      if (previous) {
        await previous.stop();
        await previous.done.catch(() => {});
      }
      try {
        return await run();
      } catch (e: any) {
        // The contract promises a final done event, whatever failed.
        const message = e?.message ?? String(e);
        const receipt: AnswerReceipt = { modelId: "none", modelLabel: "", tokens: 0, tokPerSec: 0, ttftMs: 0, totalMs: 0, reasonCodes: ["error:unexpected"] };
        emit({ type: "done", answerId, tier: "fast", outcome: "error", receipt, error: { code: "unknown", message } });
        return { answerId, tier: "fast", outcome: "error", text: "", sources: [], receipt };
      }
    })();

    const handle: AnswerHandle = {
      answerId,
      async stop() {
        stopRequested = true;
        signalStop();
        await deps.engine.stop();
      },
      done,
    };
    current = handle;
    done
      .finally(() => {
        if (current === handle) current = null;
      })
      .catch(() => {});
    return handle;

    async function runGeo(
      intent: GeoIntent,
      t0: number,
      markVisible: () => void,
      visibleAt: () => number | null
    ): Promise<AnswerResult> {
      const reasonCodes = ["task:places", `near:${intent.near.kind}`, ...intent.diet.map((d) => `diet:${d}`)];
      const receipt = (retrievalMs?: number): AnswerReceipt => ({
        modelId: "places",
        modelLabel: "Offline places",
        tokens: 0,
        tokPerSec: 0,
        ttftMs: (visibleAt() ?? deps.now()) - t0,
        totalMs: deps.now() - t0,
        retrievalMs,
        reasonCodes,
      });
      const filters = intent.diet.length ? intent.diet : undefined;
      const criterion = intent.diet.length ? ("diet_match" as const) : ("distance" as const);
      const finishPlaces = (
        coverage: "ok" | "none" | "no_pack" | "needs_place",
        text: string,
        area: Extract<AnswerEvent, { type: "places" }>["area"],
        retrievalMs?: number
      ): AnswerResult => {
        markVisible();
        emit({ type: "places", answerId, tier: "instant", places: [], area, filters, criterion, coverage, attribution: [] });
        const r = receipt(retrievalMs);
        emit({ type: "done", answerId, tier: "instant", outcome: "success", receipt: r });
        return { answerId, tier: "instant", outcome: "success", text, sources: [], receipt: r };
      };

      emit({ type: "stage", answerId, stage: "retrieving", tier: "instant", at: deps.now() });
      const geo = deps.getGeoProviders?.() ?? null;
      const pt = intent.lang === "pt";
      const packInstalled = geo ? await (geo.hasPlaces?.() ?? Promise.resolve(true)).catch(() => true) : false;
      if (!geo || !packInstalled) {
        reasonCodes.push("places:no-pack");
        return finishPlaces("no_pack", noPackAnswer(intent), { kind: intent.near.kind === "device" ? "near" : "city" });
      }

      // A city written in lower case or after "de" counts only when the gazetteer knows it.
      if (intent.near.kind === "device" && intent.placeCandidates?.length) {
        for (const c of intent.placeCandidates) {
          const hit = await geo.resolvePlace(c).catch(() => null);
          // An alternate-name match on a small town is too weak ("center" -> Ózd): a city, or the same name.
          const fold = (x: string) => x.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          if (hit && (hit.kind === "city" || fold(hit.name) === fold(c))) {
            intent = { ...intent, near: { kind: "place", name: c } };
            reasonCodes.push("places:gazetteer-name");
            break;
          }
        }
      }

      let center: { lat: number; lon: number };
      let area: Extract<AnswerEvent, { type: "places" }>["area"];
      let deviceNow: { value: Awaited<ReturnType<GeoProviders["getLocation"]>> | null } | null = null;
      if (intent.near.kind === "place") {
        const place = await geo.resolvePlace(intent.near.name).catch(() => null);
        if (!place) {
          reasonCodes.push("places:unknown-place");
          return finishPlaces("none", noDataAnswer(intent, intent.near.name), { kind: "city", label: intent.near.name, place: { name: intent.near.name } });
        }
        center = { lat: place.lat, lon: place.lon };
        area = { kind: "city", label: place.name, place: { name: place.name, country: place.country } };
        // Runs alongside the POI search; never prompts (GeoProviders contract). Read only if it
        // has already answered when the search ends: the list never waits for it.
        const pending = { value: null as Awaited<ReturnType<GeoProviders["getLocation"]>> | null };
        deviceNow = pending;
        geo.getLocation({ timeoutMs: DEVICE_INSIDE_TIMEOUT_MS }).then((v) => (pending.value = v), () => {});
      } else {
        // A fix of 5 minutes or less comes back at once; otherwise wait for a new one (cold GPS),
        // telling the UI, which offers "Type the city" meanwhile. stop() ends the wait.
        const request = (
          geo.getLocationFix
            ? geo.getLocationFix({ timeoutMs: LOCATION_WAIT_MS })
            : geo.getLocation({ timeoutMs: LOCATION_TIMEOUT_MS })
        ).catch(() => ({ error: "unavailable" as const }));
        const quick = await Promise.race([request, new Promise<"pending">((r) => setTimeout(() => r("pending"), LOCATING_SIGNAL_MS)), stopSignal]);
        if (quick === "pending") {
          emit({ type: "location", answerId, status: "locating" });
          reasonCodes.push("location:locating");
        }
        const loc = quick === "pending" ? await Promise.race([request, stopSignal]) : quick;
        if (loc === "stopped") {
          reasonCodes.push("location:stopped");
          const r = receipt();
          emit({ type: "done", answerId, tier: "instant", outcome: "stopped", receipt: r });
          return { answerId, tier: "instant", outcome: "stopped", text: "", sources: [], receipt: r };
        }
        if ("error" in loc) {
          reasonCodes.push(`location:${loc.error}`);
          if (loc.error === "stale") {
            // Never list the old area by itself (a traveler would get the city they left): offer it.
            emit({ type: "location", answerId, status: "stale", ageS: loc.last.ageS });
            const city = await geo.nearestCity?.(loc.last).catch(() => null);
            const area: Extract<AnswerEvent, { type: "places" }>["area"] = { kind: "near", ...(city ? { lastKnown: { city: city.name, country: city.country, ageS: loc.last.ageS } } : {}) };
            return finishPlaces("needs_place", staleLocationAnswer(intent, city?.name ?? null, loc.last.ageS), area);
          }
          const status = loc.error === "timeout" ? "unavailable" : loc.error;
          emit({ type: "location", answerId, status });
          return finishPlaces("needs_place", needsPlaceAnswer(intent), { kind: "near" });
        }
        emit({ type: "location", answerId, status: "granted", accuracyM: loc.accuracyM, ageS: loc.ageS });
        center = { lat: loc.lat, lon: loc.lon };
        area = { kind: "near", label: pt ? "perto de você" : "near you", origin: { lat: loc.lat, lon: loc.lon, accuracyM: loc.accuracyM, ageS: loc.ageS } };
      }

      const rs = deps.now();
      const found = await geo
        .searchPois({ center, diet: intent.diet.length ? intent.diet : undefined, text: intent.text, limit: PLACES_LIMIT })
        .catch((e) => {
          console.warn("[answer] POI search failed:", e?.message ?? e);
          return null;
        });
      const retrievalMs = deps.now() - rs;
      if (!found || found.coverage === "none" || found.pois.length === 0) {
        reasonCodes.push(found ? `places:coverage-${found.coverage}` : "places:search-failed");
        const label = area.kind === "city" ? area.label! : found?.region ?? (pt ? "sua região" : "your area");
        return finishPlaces("none", noDataAnswer(intent, label), area, retrievalMs);
      }

      const byDistance = intent.near.kind === "device";
      area.radiusM = found.radiusUsedM;
      if (deviceNow) {
        const here = deviceNow.value;
        if (here && !("error" in here) && distanceMeters(here, center) <= DEVICE_INSIDE_RADIUS_M) {
          area.deviceInside = true;
          reasonCodes.push("places:device-inside");
        }
      }
      // Without a distance (city named), a place is only findable by its
      // address: exact places with an address come first, ranking kept
      // within each group; approximate guide listings stay last.
      const ranked = byDistance
        ? found.pois
        : [
            ...found.pois.filter((p) => !p.approx && p.dietFlag !== "verify" && p.address),
            ...found.pois.filter((p) => !p.approx && p.dietFlag !== "verify" && !p.address),
            // Doubtful diet tags stay after every trustworthy place, as the pack ranked them.
            ...found.pois.filter((p) => !p.approx && p.dietFlag === "verify"),
            ...found.pois.filter((p) => p.approx),
          ];
      const sources = ranked.map(toSourceChunk);
      const places = ranked.map((p, i) => toPlace(p, i, byDistance));
      const attribution: { source: "osm" | "wikivoyage"; date?: string; license: string }[] = [];
      if (ranked.some((p) => p.source.kind === "osm")) {
        attribution.push({ source: "osm", date: ranked.find((p) => p.osmDate)?.osmDate, license: "ODbL" });
      }
      if (ranked.some((p) => p.source.kind === "wikivoyage")) attribution.push({ source: "wikivoyage", license: "CC BY-SA" });

      markVisible();
      emit({ type: "sources", answerId, tier: "instant", sources });
      emit({
        type: "places",
        answerId,
        tier: "instant",
        places,
        area,
        filters,
        criterion,
        coverage: "ok",
        truncated: ranked.length >= PLACES_LIMIT,
        attribution,
      });
      reasonCodes.push(`places:${places.length}`, `places:coverage-${found.coverage}`, ...(found.region ? [`places:region-${found.region}`] : []));
      const text = formatPlacesAnswer({
        intent,
        places,
        areaLabel: area.label ?? "",
        byDistance,
        radiusM: found.radiusUsedM,
        osmDate: attribution.find((a) => a.source === "osm")?.date,
      });
      const r = receipt(retrievalMs);
      emit({ type: "done", answerId, tier: "instant", outcome: "success", receipt: r });
      return { answerId, tier: "instant", outcome: "success", text, sources, receipt: r };
    }

    async function run(): Promise<AnswerResult> {
      const t0 = deps.now();
      let firstVisibleAt: number | null = null;
      const markVisible = () => {
        if (firstVisibleAt === null) firstVisibleAt = deps.now();
      };
      const stage = (name: AnswerStageName, tier: AnswerTier, modelId?: string, detail?: { index?: number; count?: number }) =>
        emit({ type: "stage", answerId, stage: name, tier, modelId, detail, at: deps.now() });

      // Places questions never touch a model: the answer is built from the
      // POI records alone, so no name can be invented and it lands in <1s.
      const geoIntent = req.place
        ? { ...(detectGeoIntent(req.query) ?? { diet: [], wantsBest: false, lang: "en" as const }), near: { kind: "place" as const, name: req.place } }
        : req.tier === "deep" || req.reuseSources
          ? null
          : detectGeoIntent(req.query);
      if (geoIntent) return runGeo(geoIntent as GeoIntent, t0, markVisible, () => firstVisibleAt);

      const { settings, installed, speeds, fastLlm, lowRamNote, lowRamBlocked } = await selectAnswerModel(deps);
      const byId = new Map(installed.map((m) => [m.id, m]));
      const toDepth = (m: InstalledLlm, fit?: MemoryFit | null): DepthModel => ({
        id: m.id,
        label: m.label,
        sizeBytes: m.sizeBytes,
        roles: m.roles,
        fit: fit?.verdict,
        tokPerSec: speeds.get(m.id),
      });

      // Only models that could be the deep tier are worth a header read.
      const deepCandidates = installed.filter(
        (m) => m.id !== fastLlm?.id && (m.id === settings.deepModelId || m.roles.includes("reasoning") || m.roles.includes("verifier"))
      );
      const fits = new Map<string, MemoryFit | null>();
      await Promise.all(
        deepCandidates.map(async (m) => fits.set(m.id, await deps.engine.estimateFit(m.filename).catch(() => null)))
      );
      const depthModels = deepCandidates.map((m) => toDepth(m, fits.get(m.id)));
      const deepModel = resolveDeepModel(depthModels, fastLlm?.id, settings.deepModelId);
      const taskType = classifyTask(req.query);
      const plan: AnswerPlan = planAnswer({
        taskType,
        requestedTier: req.tier ?? "auto",
        quickFirst: settings.quickFirst,
        alwaysComplete: settings.alwaysComplete,
        fastModel: fastLlm ? toDepth(fastLlm) : null,
        deepModel,
        // Verification is automatic too, so the same speed rule (D6) applies: a 200-token verdict
        // at 2.7 tok/s is over a minute on top of the answer.
        verifiers: depthModels.filter((m) => m.roles.includes("verifier") && deepAutoIneligibility(m) === null),
        hasReusedSources: !!req.reuseSources?.length,
      });
      const reasonCodes = [`task:${taskType}`, ...plan.reasonCodes, ...(lowRamNote ? [lowRamNote] : [])];
      if (!deepModel && !settings.deepModelId) {
        for (const m of depthModels.filter((d) => d.roles.includes("reasoning"))) {
          const why = deepAutoIneligibility(m);
          if (why) reasonCodes.push(`deep-auto:skip-${m.id}-${why}${m.tokPerSec !== undefined ? `-${m.tokPerSec.toFixed(1)}tps` : ""}`);
        }
      }
      // Health never goes through multi-pass Deep Research: it would answer from memory past the grounding guard.
      const health = isHealthQuestion(req.query);
      const gen =
        health && plan.generation?.mode === "multipass"
          ? { ...plan.generation, mode: "single" as const, retrieveK: Math.max(plan.generation.retrieveK, 6) }
          : plan.generation;
      if (gen !== plan.generation) reasonCodes.push("grounding:health-no-multipass");
      const genTier: AnswerTier = gen?.tier ?? "fast";
      const genLlm = gen ? byId.get(gen.modelId) : undefined;

      const receipt = (over: Partial<AnswerReceipt> = {}): AnswerReceipt => ({
        modelId: genLlm?.id ?? "none",
        modelLabel: genLlm?.label ?? "",
        tokens: 0,
        tokPerSec: 0,
        ttftMs: (firstVisibleAt ?? deps.now()) - t0,
        totalMs: deps.now() - t0,
        reasonCodes,
        ...over,
      });
      /** Set when the text differs from the streamed tokens (citations removed, CT-1). */
      let finalText: string | undefined;
      const finish = (
        tier: AnswerTier,
        outcome: AnswerOutcome,
        text: string,
        sources: RetrievedChunk[],
        r: AnswerReceipt,
        error?: { code: AnswerErrorCode; message: string }
      ): AnswerResult => {
        emit({ type: "done", answerId, tier, outcome, receipt: r, error, ...(finalText !== undefined ? { finalText } : {}) });
        return { answerId, tier, outcome, text, sources, receipt: r };
      };

      // 1. Sources. A Portuguese question searches the (English) packs with English words when it has known terms.
      const pt = PT_QUESTION.test(req.query);
      const english = pt ? englishSearchTerms(req.query) : isHealthQuestion(req.query) ? canonicalHealthTerms(req.query) : null;
      if (english) reasonCodes.push("retrieve:pt-en-terms");
      /** What the sources are matched against: the English words for a translated PT question. */
      const matchQuery = english ?? req.query;
      // The packs lift an article's Treatment/Management section only when the query asks what to
      // do (Bramble b03c959); the article name alone ("snakebite") brought back "Signs and symptoms".
      const searchQuery = english && ACTION_INTENT.test(req.query) ? `${english} what to do` : matchQuery;
      let raw: RetrievedChunk[] = req.reuseSources ?? [];
      let retrievalMs: number | undefined;
      if (plan.retrieve && gen?.mode !== "multipass") {
        stage("retrieving", plan.instant !== "off" ? "instant" : genTier);
        const rs = deps.now();
        raw = await deps.retrieve(searchQuery, gen?.retrieveK ?? 6).catch((e) => {
          console.warn("[answer] retrieval failed, answering without sources:", e?.message ?? e);
          return [] as RetrievedChunk[];
        });
        retrievalMs = deps.now() - rs;
      }
      if (stopRequested) return finish(genTier, "stopped", "", [], receipt({ retrievalMs }));

      // Never let sources + answer overflow the context window (2048 on 4GB phones).
      const ctxSize = deps.contextSize?.() ?? 4096;
      const budget = Math.max(
        256,
        Math.min(
          gen?.contextTokens ?? 1200,
          ctxSize -
            Math.min(ctx.maxTokens, gen?.maxTokens ?? Infinity) -
            PROMPT_OVERHEAD_TOKENS -
            (gen?.thinking === false ? 0 : genTier === "deep" ? DEEP_THINKING_BUDGET : FAST_THINKING_BUDGET)
        )
      );
      const compressed = compressContext(matchQuery, raw, { tokenBudget: budget });
      let sources = compressed.chunks;
      reasonCodes.push(`context:${compressed.tokensBefore}->${compressed.tokensAfter}`);

      // Grounding: sources must be on topic in absolute terms, not just the best of what came back.
      // A PT question without English words can't be matched word for word against English sources: no guard.
      const guarded = gen?.mode !== "multipass" && (!pt || !!english);
      if (guarded && sources.length) {
        const kept = sources.filter((c) => onTopic(matchQuery, c));
        if (kept.length < sources.length) reasonCodes.push(`grounding:off-topic-dropped-${sources.length - kept.length}`);
        if (!kept.length) reasonCodes.push("grounding:no-good-source");
        sources = kept;
      }
      if (health) {
        reasonCodes.push("grounding:health-strict");
        // Health: only sources whose title names the health topic (never a plant, a cave or a TV show).
        const topic = healthTopicTerms(req.query, english);
        const onTopicHealth = sources.filter((c) => onHealthTopic(topic, c));
        if (onTopicHealth.length < sources.length) reasonCodes.push(`grounding:health-off-topic-dropped-${sources.length - onTopicHealth.length}`);
        sources = onTopicHealth;
      }
      if (sources.length && gen?.mode !== "multipass") {
        emit({ type: "sources", answerId, tier: plan.instant !== "off" ? "instant" : genTier, sources });
      }

      // 2. Instant snippet (no LLM): only a sentence that covers the question.
      if (plan.instant !== "off" && raw.length) {
        const snip = selectInstant(matchQuery, raw);
        const sourceIndex = snip ? sources.findIndex((c) => c.chunkId === raw[snip.sourceIndex].chunkId) : -1;
        // "From the source" only from an on-topic source (the same onTopic as the sources), and a sentence that covers the question.
        const covers =
          !!snip &&
          onTopic(matchQuery, raw[snip.sourceIndex]) &&
          termCoverage(matchQuery, `${raw[snip.sourceIndex].title} ${snip.text}`) >= MIN_TERM_COVERAGE;
        if (snip && sourceIndex >= 0 && !covers) reasonCodes.push("instant:off-topic");
        if (snip && sourceIndex >= 0 && covers) {
          markVisible();
          emit({ type: "instant", answerId, snippet: { text: snip.text, sourceIndex }, confidence: snip.confidence });
          const block = plan.instant === "may-finish" && snip.confidence >= INSTANT_FINAL_CONFIDENCE ? instantFinalBlock(req.query, snip.text) : "low";
          if (block && block !== "low") reasonCodes.push(`instant:not-final-${block}`);
          if (plan.instant === "may-finish" && block === null) {
            reasonCodes.push("instant:final");
            return finish(
              "instant",
              "success",
              snip.text,
              sources,
              receipt({ modelId: "extractive", modelLabel: "Source excerpt", retrievalMs })
            );
          }
        }
      }

      // No good source: never an answer from memory (health: point to emergency services).
      // Off-topic sources only = no source (Boar, RT-1): the model answers with the
      // "not from the offline library" instruction below, never quoting them.
      if (health && gen?.mode !== "multipass" && sources.length === 0) {
        reasonCodes.push("grounding:health-no-source");
        const text = noHealthSourceAnswer(pt);
        markVisible();
        emit({ type: "token", answerId, tier: genTier, text });
        return finish(genTier, "success", text, [], receipt({ modelId: "grounding-guard", modelLabel: "No offline source", retrievalMs }));
      }
      // Health with a good source: the answer IS the source's text, not the model's
      // retelling (Sextant: the models misplaced the pinch point, iced snake bites,
      // put cream on burns). "Deeper answer" (tier deep) lets the model summarize it, strictly.
      if (health && sources.length && req.tier !== "deep") {
        reasonCodes.push("grounding:health-extractive");
        const i = healthSourceIndex(sources);
        const full = raw.find((c) => c.chunkId === sources[i].chunkId) ?? sources[i];
        const text = healthExtract(full, i + 1, pt);
        markVisible();
        emit({ type: "token", answerId, tier: "instant", text });
        return finish("instant", "success", text, sources, receipt({ modelId: "extractive", modelLabel: "Source excerpt", retrievalMs }));
      }
      // A knowledge question with nothing retrieved: the model answers, but not as if it came from a source.
      const fromMemory =
        !health && plan.retrieve && gen?.mode !== "multipass" && sources.length === 0 && ["lookup", "research", "compare", "extract"].includes(taskType);
      if (fromMemory && genLlm && isCompactModel(genLlm) && !req.answerAnyway) {
        // Product decision (Iris/Boar): the compact model doesn't answer from memory unless asked to.
        reasonCodes.push("grounding:declined-compact");
        markVisible();
        emit({
          type: "warning",
          answerId,
          code: "weak_sources",
          declined: true,
          message: pt ? "Não encontrei isso no acervo deste celular." : "I didn't find this in this phone's library.",
        });
        return finish(genTier, "success", "", [], receipt({ retrievalMs }));
      }
      if (fromMemory) {
        reasonCodes.push("grounding:no-source-memory");
        emit({ type: "warning", answerId, code: "weak_sources", message: "No offline source covers this question." });
      }
      const styleReminder =
        [ctx.styleReminder, health ? HEALTH_GROUNDING_INSTRUCTION : fromMemory ? NO_SOURCE_INSTRUCTION : undefined].filter(Boolean).join("\n") || undefined;

      // 3. Generation.
      if (!gen || !genLlm) {
        return finish(genTier, "error", "", sources, receipt({ retrievalMs }), {
          code: "no_model",
          message: lowRamBlocked
            ? "The installed models are too large for this phone's memory. Install the Compact model, or confirm one in Models to run it anyway."
            : "No language model is installed.",
        });
      }

      let loadMs = 0;
      const ensureLoaded = async (m: InstalledLlm, tier: AnswerTier): Promise<string | null> => {
        if (deps.engine.getModelInfo()?.filename === m.filename) return null;
        stage("loading_model", tier, m.id);
        const ls = deps.now();
        try {
          const r = await deps.engine.load(m.filename, { meta: { modelId: m.id, label: m.label } });
          loadMs += deps.now() - ls;
          if (r.warning) emit({ type: "warning", answerId, code: "model_streams_from_storage", message: r.warning });
          if (r.backend?.kind === "cpu-fallback") reasonCodes.push("backend:cpu-fallback");
          return null;
        } catch (e: any) {
          return e?.message ?? String(e);
        }
      };

      const loadError = await ensureLoaded(genLlm, genTier);
      if (loadError) {
        return finish(genTier, "error", "", sources, receipt({ retrievalMs }), { code: errorCodeOf(loadError, "load"), message: loadError });
      }
      if (stopRequested) return finish(genTier, "stopped", "", sources, receipt({ retrievalMs, loadMs }));

      let text = "";
      let tokens = 0;
      let firstTokenAt: number | null = null;
      let timings: GenerationTimings | undefined;
      let timedOut = false;
      const onToken = (piece: string) => {
        if (firstTokenAt === null) {
          firstTokenAt = deps.now();
          markVisible();
          if (gen.mode === "single") stage("generating", genTier, genLlm.id);
        }
        tokens++;
        emit({ type: "token", answerId, tier: genTier, text: piece });
      };

      try {
        if (gen.mode === "multipass") {
          const r = await deps.runMultipass(
            req.query,
            ctx.systemPrompt,
            ctx.history,
            ctx.maxTokens,
            (p) => {
              if (p.stage === "synthesizing") stage("synthesizing", genTier, genLlm.id);
              else stage("retrieving", genTier, genLlm.id, { index: p.subQuestionIndex, count: p.subQuestionCount });
            },
            onToken,
            () => stopRequested,
            {
              retrieveK: gen.retrieveK,
              onSources: (s) => {
                sources = s;
                emit({ type: "sources", answerId, tier: genTier, sources: s });
              },
            }
          );
          text = r.answer;
          timedOut = !!r.timedOut;
          sources = r.citations;
        } else {
          stage("prefill", genTier, genLlm.id);
          const useTemplate = deps.engine.hasEmbeddedChatTemplate();
          const common = {
            nPredict: Math.min(ctx.maxTokens, gen.maxTokens ?? Infinity),
            // Reasoning models think before answering: bounded on the fast tier, off on the streaming MoE.
            thinkingBudget: gen.thinking ? (genTier === "deep" ? DEEP_THINKING_BUDGET : FAST_THINKING_BUDGET) : undefined,
            enableThinking: gen.thinking ? undefined : false,
            // Health: no sampling noise, and nothing reaches the screen before the safety check below.
            ...(health ? { temperature: 0 } : {}),
            onToken: health ? () => {} : onToken,
            onTimings: (t: GenerationTimings) => (timings = t),
          };
          text = await deps.engine.generate(
            useTemplate
              ? { ...common, messages: deps.assembleChatMessages(req.query, sources, ctx.systemPrompt, ctx.history, styleReminder) }
              : { ...common, prompt: deps.assemblePrompt(req.query, sources, ctx.systemPrompt, ctx.history, styleReminder) }
          );
          if (health) {
            // A known-dangerous instruction the model added ("blow your nose", "tilt the head back"): show the source instead.
            const risky = riskyHealthInstruction(text);
            if (risky && sources.length) {
              reasonCodes.push(`grounding:health-unsafe-${risky}`);
              const i = healthSourceIndex(sources);
              text = healthExtract(raw.find((c) => c.chunkId === sources[i].chunkId) ?? sources[i], i + 1, pt);
            }
            markVisible();
            emit({ type: "token", answerId, tier: genTier, text });
          }
        }
      } catch (e: any) {
        const message = e?.message ?? String(e);
        return finish(genTier, "error", text, sources, receipt({ retrievalMs, loadMs, tokens }), {
          code: errorCodeOf(message, "generate"),
          message,
        });
      }

      const genEnd = deps.now();
      const decodeMs = timings?.predictedMs ?? (firstTokenAt !== null ? genEnd - firstTokenAt : 0);
      const decodeTokens = timings?.predictedTokens ?? tokens;
      const baseReceipt = receipt({
        tokens,
        tokPerSec: decodeMs > 0 ? (decodeTokens / decodeMs) * 1000 : 0,
        retrievalMs,
        loadMs,
        prefillMs: timings?.promptMs,
        ctxTokens: timings?.promptTokens,
        cachedTokens: timings?.cachedTokens,
      });
      // CT-1: a [n] stays only where source n supports its sentence.
      if (/\[\d+\]/.test(text)) {
        const cited = sources.map((c) => raw.find((r) => r.chunkId === c.chunkId) ?? c);
        const checked = checkCitations(text, cited);
        if (checked.removed.length) {
          reasonCodes.push(`citations:removed-${checked.removed.join("-")}`);
          text = checked.text;
          finalText = text;
        }
      }
      if (stopRequested) return finish(genTier, "stopped", text, sources, baseReceipt);

      // 4. Verification (complete answers only, distinct verifier).
      if (plan.verify && text.trim() && sources.length) {
        const verifier = byId.get(plan.verify.modelId);
        if (verifier) {
          const vErr = await ensureLoaded(verifier, genTier);
          if (!vErr && !stopRequested) {
            stage("verifying", genTier, verifier.id);
            const verdictText = await deps.engine
              .generate({
                ...taskRequest(
                  VERIFICATION_INSTRUCTION,
                  buildVerificationInput(req.query, text, sources),
                  "Verdict:",
                  deps.engine.hasEmbeddedChatTemplate()
                ),
                nPredict: 200,
                thinkingBudget: 128,
                temperature: 0.2,
              })
              .catch(() => "");
            const v = parseVerificationVerdict(verdictText).status;
            if (v === "passed" || v === "failed" || v === "uncertain") baseReceipt.verification = v;
          } else if (vErr) {
            reasonCodes.push("verify:load-failed");
          }
          baseReceipt.totalMs = deps.now() - t0;
        }
      }

      const result = finish(genTier, timedOut ? "timeout" : "success", text, sources, baseReceipt);
      if (plan.offerDeep && !stopRequested) {
        emit({
          type: "deep_available",
          answerId,
          reason: deepModel ? `deep-model:${deepModel.id}` : "multipass",
        });
      }
      return result;
    }
  }

  /** "Deeper answer" on an earlier answer: same question, deep tier, same sources. */
  function deepen(
    query: string,
    sources: RetrievedChunk[],
    onEvent: AnswerEventHandler,
    ctx: AnswerContext
  ): AnswerHandle {
    return answer({ query, tier: "deep", reuseSources: sources }, onEvent, ctx);
  }

  /** The model the next answer will use (same rules as answer()); null when none can run. */
  async function effectiveModel(): Promise<EffectiveAnswerModel | null> {
    const { fastLlm, blockedActive, settings } = await selectAnswerModel(deps);
    if (!fastLlm) return null;
    return {
      id: fastLlm.id,
      label: fastLlm.label,
      ...(blockedActive && blockedActive.id !== fastLlm.id
        ? {
            downgradedFrom: {
              id: blockedActive.id,
              label: blockedActive.label,
              reason: (settings.loadCrashedIds ?? []).includes(blockedActive.id) ? ("load-crashed" as const) : ("low-ram" as const),
            },
          }
        : {}),
    };
  }

  return { answer, deepen, effectiveModel };
}
