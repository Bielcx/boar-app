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
import { compressContext, selectInstant, INSTANT_FINAL_CONFIDENCE } from "./context";
import { DepthModel, planAnswer, resolveDeepModel, AnswerPlan } from "./depth";
import { buildVerificationPrompt, parseVerificationVerdict } from "./verify";
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
}

export interface AnswerEngine {
  load(filename: string): Promise<LoadResult>;
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
}

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

export function createAnswerer(deps: AnswerDeps) {
  let current: AnswerHandle | null = null;

  function answer(req: AnswerRequest, onEvent: AnswerEventHandler, ctx: AnswerContext): AnswerHandle {
    const answerId = newAnswerId();
    const previous = current;
    let stopRequested = false;
    const emit = (e: AnswerEvent) => {
      try {
        onEvent(e);
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
      return run();
    })();

    const handle: AnswerHandle = {
      answerId,
      async stop() {
        stopRequested = true;
        await deps.engine.stop();
      },
      done,
    };
    current = handle;
    done.finally(() => {
      if (current === handle) current = null;
    });
    return handle;

    async function run(): Promise<AnswerResult> {
      const t0 = deps.now();
      let firstVisibleAt: number | null = null;
      const markVisible = () => {
        if (firstVisibleAt === null) firstVisibleAt = deps.now();
      };
      const stage = (name: AnswerStageName, tier: AnswerTier, modelId?: string, detail?: { index?: number; count?: number }) =>
        emit({ type: "stage", answerId, stage: name, tier, modelId, detail, at: deps.now() });

      const [settings, installed, activeId] = await Promise.all([
        deps.getSettings(),
        deps.listInstalledLlms(),
        deps.getActiveModelId(),
      ]);
      const byId = new Map(installed.map((m) => [m.id, m]));
      const fastLlm = (activeId ? byId.get(activeId) : undefined) ?? installed.find((m) => m.isDefault) ?? installed[0];
      const toDepth = (m: InstalledLlm, fit?: MemoryFit | null): DepthModel => ({
        id: m.id,
        label: m.label,
        sizeBytes: m.sizeBytes,
        roles: m.roles,
        fit: fit?.verdict,
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
        verifiers: depthModels.filter((m) => m.roles.includes("verifier")),
        hasReusedSources: !!req.reuseSources?.length,
      });
      const reasonCodes = [`task:${taskType}`, ...plan.reasonCodes];
      const gen = plan.generation;
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
      const finish = (
        tier: AnswerTier,
        outcome: AnswerOutcome,
        text: string,
        sources: RetrievedChunk[],
        r: AnswerReceipt,
        error?: { code: AnswerErrorCode; message: string }
      ): AnswerResult => {
        emit({ type: "done", answerId, tier, outcome, receipt: r, error });
        return { answerId, tier, outcome, text, sources, receipt: r };
      };

      // 1. Sources.
      let raw: RetrievedChunk[] = req.reuseSources ?? [];
      let retrievalMs: number | undefined;
      if (plan.retrieve && gen?.mode !== "multipass") {
        stage("retrieving", plan.instant !== "off" ? "instant" : genTier);
        const rs = deps.now();
        raw = await deps.retrieve(req.query, gen?.retrieveK ?? 6).catch((e) => {
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
        Math.min(gen?.contextTokens ?? 1200, ctxSize - ctx.maxTokens - PROMPT_OVERHEAD_TOKENS)
      );
      const compressed = compressContext(req.query, raw, { tokenBudget: budget });
      let sources = compressed.chunks;
      reasonCodes.push(`context:${compressed.tokensBefore}->${compressed.tokensAfter}`);
      if (sources.length && gen?.mode !== "multipass") {
        emit({ type: "sources", answerId, tier: plan.instant !== "off" ? "instant" : genTier, sources });
      }

      // 2. Instant snippet (no LLM).
      if (plan.instant !== "off" && raw.length) {
        const snip = selectInstant(req.query, raw);
        const sourceIndex = snip ? compressed.keptIndices.indexOf(snip.sourceIndex) : -1;
        if (snip && sourceIndex >= 0) {
          markVisible();
          emit({ type: "instant", answerId, snippet: { text: snip.text, sourceIndex }, confidence: snip.confidence });
          if (plan.instant === "may-finish" && snip.confidence >= INSTANT_FINAL_CONFIDENCE) {
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

      // 3. Generation.
      if (!gen || !genLlm) {
        return finish(genTier, "error", "", sources, receipt({ retrievalMs }), {
          code: "no_model",
          message: "No language model is installed.",
        });
      }

      let loadMs = 0;
      const ensureLoaded = async (m: InstalledLlm, tier: AnswerTier): Promise<string | null> => {
        if (deps.engine.getModelInfo()?.filename === m.filename) return null;
        stage("loading_model", tier, m.id);
        const ls = deps.now();
        try {
          const r = await deps.engine.load(m.filename);
          loadMs += deps.now() - ls;
          if (r.warning) emit({ type: "warning", answerId, code: "model_streams_from_storage", message: r.warning });
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
            nPredict: ctx.maxTokens,
            onToken,
            onTimings: (t: GenerationTimings) => (timings = t),
          };
          text = await deps.engine.generate(
            useTemplate
              ? { ...common, messages: deps.assembleChatMessages(req.query, sources, ctx.systemPrompt, ctx.history, ctx.styleReminder) }
              : { ...common, prompt: deps.assemblePrompt(req.query, sources, ctx.systemPrompt, ctx.history, ctx.styleReminder) }
          );
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
      if (stopRequested) return finish(genTier, "stopped", text, sources, baseReceipt);

      // 4. Verification (complete answers only, distinct verifier).
      if (plan.verify && text.trim() && sources.length) {
        const verifier = byId.get(plan.verify.modelId);
        if (verifier) {
          const vErr = await ensureLoaded(verifier, genTier);
          if (!vErr && !stopRequested) {
            stage("verifying", genTier, verifier.id);
            const verdictText = await deps.engine
              .generate({ prompt: buildVerificationPrompt(req.query, text, sources), nPredict: 200, temperature: 0.2 })
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

  return { answer, deepen };
}
