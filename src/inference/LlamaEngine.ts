import * as FileSystem from "expo-file-system/legacy";
import { initLlama, loadLlamaModelInfo, LlamaContext } from "llama.rn";
import { getAvailableRamBytes, getDeviceTotalRamBytes, getMemoryInfo } from "ram-monitor";
import {
  availableRamFrom,
  describeFit,
  estimateMemoryFit,
  GgufShape,
  MemoryFit,
  parseGgufShape,
  toGb,
} from "./memoryFit";

export interface ChatMessageInput {
  role: string;
  content: string;
}

export interface GenerateOptions {
  /** Legacy hand-built prompt string (assemblePrompt, src/rag/pure.ts). Exactly one of `prompt`/`messages` must be given. */
  prompt?: string;
  /**
   * Role-separated messages (assembleChatMessages, src/rag/pure.ts) for a
   * model that needs its own real chat/instruction template — passed
   * straight through to llama.rn's completion() with jinja enabled, which
   * applies the loaded GGUF's own embedded chat_template rather than any
   * template string this app would have to guess/hardcode. Only used for
   * models explicitly flagged `ModelCapabilities.usesChatTemplate`
   * (src/routing/types.ts) — everyone else keeps using `prompt`, unchanged.
   */
  messages?: ChatMessageInput[];
  nPredict?: number;
  temperature?: number;
  onToken?: (piece: string) => void;
  stop?: string[];
  /**
   * Safety-net budget, not a performance target — no per-generation timeout
   * existed anywhere in the app before this (see docs/ADAPTIVE_ROUTING.md
   * §14). Left unset for regular single-pass chat (already indirectly
   * bounded by nPredict); set for orchestrator.ts's multi-stage Deep
   * Research calls, where a stuck stage would otherwise compound silently
   * across several sequential model calls with no ceiling at all.
   */
  timeoutMs?: number;
  /** Called once, right before the timeout triggers stop() — lets the caller distinguish a timeout from a natural finish or a user-initiated stop. */
  onTimeout?: () => void;
  /** llama.cpp's own measurements for this completion (prompt = prefill). */
  onTimings?: (t: GenerationTimings) => void;
}

export interface GenerationTimings {
  promptTokens: number;
  promptMs: number;
  predictedTokens: number;
  predictedMs: number;
  /** Prompt tokens reused from the previous completion's KV cache (prefix cache hit). */
  cachedTokens?: number;
}

/**
 * assemblePrompt (src/rag/pure.ts) hand-builds a plain-text prompt with our
 * own "User:"/"Assistant:"/"Question:" role labels rather than using
 * llama.rn's chat-template API (which would auto-derive stop tokens from
 * the GGUF's own Jinja template) — so nothing tells the model where a turn
 * actually ends. Left unset, a model that's done answering (especially on
 * a short/trivial prompt with little else to say) just keeps predicting
 * tokens and starts hallucinating a fake continuation of the conversation,
 * inventing new "User:" turns rather than stopping. These match our own
 * template's role markers so generation halts the moment it tries to do that.
 */
const DEFAULT_STOP_SEQUENCES = ["\nUser:", "\n\nUser:", "\nQuestion:", "\n\nQuestion:"];

export interface LoadedModelInfo {
  filename: string;
  nCtx: number;
  nThreads: number;
}

/**
 * Context window when the caller does not pick one. 4GB phones (e.g. iPhone
 * 13) get 2048: the KV cache is the one allocation mmap cannot page out, and
 * with 4096 the worst case sits too close to the iOS jetsam limit (docs/IOS.md).
 */
export function defaultContextSize(): number {
  let total = 0;
  try {
    total = getDeviceTotalRamBytes();
  } catch {
    total = 0;
  }
  return total > 0 && total <= 4.5 * 1024 ** 3 ? 2048 : 4096;
}

export interface LoadResult {
  /** Memory estimate taken right before loading; null when the RAM readouts were unavailable. */
  fit: MemoryFit | null;
  /** Non-null when the model loaded but will stream from storage (slower); show it to the user. */
  warning: string | null;
}

/**
 * Thin wrapper around llama.rn. Loads a GGUF model with mmap so weights
 * stream from disk rather than being fully resident, keeping peak RAM under
 * the model's working-set size (weights touched + KV cache), not the full
 * file size. No network access anywhere in this module.
 */
export class LlamaEngine {
  private context: LlamaContext | null = null;
  private modelInfo: LoadedModelInfo | null = null;
  // load()/unload() run one at a time. Concurrent loads (e.g. switching
  // models and closing Settings quickly) used to both release, both create a
  // context, and the one overwritten in this.context was never released,
  // leaking a whole model's memory.
  private queue: Promise<void> = Promise.resolve();
  // The completion currently running, if any. Releasing a context while it
  // runs leaves its promise unsettled forever (the chat stays "generating"),
  // so unload stops it and waits for it first.
  private inFlight: Promise<unknown> | null = null;
  // generate() calls run one at a time: two completions on one llama.cpp
  // context interleave their tokens and corrupt the KV cache (double-send
  // race, review boar.md). A second call waits for the first to settle.
  private genQueue: Promise<unknown> = Promise.resolve();
  // Bumped by stop(): a generation queued before a stop resolves empty
  // instead of starting after the user already pressed Stop.
  private stopEpoch = 0;

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  private lastLoad: LoadResult = { fit: null, warning: null };

  load(modelFilename: string, opts?: { nCtx?: number; nThreads?: number }): Promise<LoadResult> {
    let result: LoadResult = { fit: null, warning: null };
    return this.enqueue(async () => {
      result = await this.loadNow(modelFilename, opts);
    }).then(() => result);
  }

  private async loadNow(modelFilename: string, opts?: { nCtx?: number; nThreads?: number }): Promise<LoadResult> {
    const nCtx = opts?.nCtx ?? defaultContextSize();
    const nThreads = opts?.nThreads ?? 4;

    // ChatScreen re-mounts (and calls load() again) every time Settings is
    // closed, even if the user didn't touch the model — re-initializing the
    // native llama.cpp context is expensive (seconds, for a multi-GB model),
    // so skip it entirely when nothing actually changed.
    if (
      this.context &&
      this.modelInfo?.filename === modelFilename &&
      this.modelInfo.nCtx === nCtx &&
      this.modelInfo.nThreads === nThreads
    ) {
      return this.lastLoad;
    }

    const modelPath = `${FileSystem.documentDirectory}${modelFilename}`;
    const info = await FileSystem.getInfoAsync(modelPath);
    if (!info.exists) {
      throw new Error(
        `Model not found at ${modelPath}. Run the setup wizard to install it first.`
      );
    }
    const fileSizeBytes = (info as { size?: number }).size ?? 0;

    // Release any previously loaded model first (e.g. actually switching
    // models from Settings) so we don't leak the old context's native memory,
    // and so the RAM readouts below no longer count the old model.
    await this.unloadNow();

    // Pre-flight check, mmap-aware (see memoryFit.ts): only the KV cache and
    // compute buffers must be resident, so only those can refuse a load. A
    // file bigger than free RAM loads with a warning (weights stream from
    // storage). Best-effort — missing readouts skip the check.
    const fit = await this.estimateFitAt(modelPath, fileSizeBytes, nCtx);
    if (fit?.verdict === "insufficient") {
      throw new Error(describeFit(modelFilename, fit)!);
    }

    try {
      this.context = await initLlama({
        model: modelPath,
        use_mmap: true,
        use_mlock: false, // avoid pinning full weights in RAM; rely on mmap streaming
        n_ctx: nCtx,
        n_threads: nThreads,
        n_gpu_layers: 0, // CPU-only for broad device compatibility; adjust per-device
      });
      this.modelInfo = { filename: modelFilename, nCtx, nThreads };
    } catch (e: any) {
      // The native error here (from llama.rn/llama.cpp) is often terse
      // ("Failed to initialize context" with no further detail) — append
      // our own RAM estimate so the user (and future debugging) has an
      // actual hypothesis instead of a dead end.
      const nativeMessage = e?.message ?? String(e);
      const hint = fit
        ? ` (this device has ~${toGb(fit.totalBytes)}GB RAM, ~${toGb(fit.availableBytes)}GB free; ` +
          `"${modelFilename}" needs ~${toGb(fit.anonBytes)}GB of buffers plus ~${toGb(fit.hotWeightBytes)}GB ` +
          `of weights per token — likely the cause if those are close)`
        : "";
      throw new Error(`Failed to load "${modelFilename}": ${nativeMessage}${hint}`);
    }
    this.lastLoad = { fit, warning: fit ? describeFit(modelFilename, fit) : null };
    return this.lastLoad;
  }

  /**
   * Memory estimate for a downloaded model without loading it (for the model
   * picker's badges). Reads only the GGUF header. Null if RAM readouts are
   * unavailable or the file is missing.
   */
  async estimateFit(modelFilename: string, opts?: { nCtx?: number }): Promise<MemoryFit | null> {
    const modelPath = `${FileSystem.documentDirectory}${modelFilename}`;
    const info = await FileSystem.getInfoAsync(modelPath);
    if (!info.exists) return null;
    return this.estimateFitAt(modelPath, (info as { size?: number }).size ?? 0, opts?.nCtx ?? defaultContextSize());
  }

  private async estimateFitAt(modelPath: string, fileBytes: number, nCtx: number): Promise<MemoryFit | null> {
    let totalRamBytes = 0;
    let rssBytes = 0;
    let availBytes = 0;
    try {
      totalRamBytes = getDeviceTotalRamBytes();
      rssBytes = getMemoryInfo().rssBytes;
      availBytes = getAvailableRamBytes();
    } catch {
      return null;
    }
    if (totalRamBytes <= 0) return null;

    let shape: GgufShape | null = null;
    try {
      shape = parseGgufShape((await loadLlamaModelInfo(modelPath)) as Record<string, unknown>);
    } catch {
      // Unreadable header: estimateMemoryFit falls back to file-size heuristics.
    }
    return estimateMemoryFit({
      fileBytes,
      nCtx,
      shape,
      totalRamBytes,
      availableRamBytes: availableRamFrom({ totalBytes: totalRamBytes, rssBytes, availBytes }),
    });
  }

  unload(): Promise<void> {
    return this.enqueue(() => this.unloadNow());
  }

  private async unloadNow() {
    // Stop takes effect between tokens, so a completion still processing its
    // prompt can run on for a while; wait for it rather than release under it.
    if (this.inFlight) {
      await this.context?.stopCompletion().catch(() => {});
      await this.inFlight.catch(() => {});
    }
    const context = this.context;
    this.context = null;
    this.modelInfo = null;
    this.lastLoad = { fit: null, warning: null };
    await context?.release();
  }

  getModelInfo(): LoadedModelInfo | null {
    return this.modelInfo;
  }

  get isLoaded(): boolean {
    return this.context !== null;
  }

  /**
   * Whether the loaded GGUF ships its own chat template (tokenizer.chat_template
   * metadata) that llama.cpp can parse as Jinja — i.e. whether generate({ messages })
   * will be formatted in the model's own instruction format.
   */
  hasEmbeddedChatTemplate(): boolean {
    return this.context?.isJinjaSupported() ?? false;
  }

  generate(opts: GenerateOptions): Promise<string> {
    const epoch = this.stopEpoch;
    const run = this.genQueue.then(() => (epoch === this.stopEpoch ? this.generateNow(opts) : ""));
    this.genQueue = run.catch(() => {});
    return run;
  }

  private async generateNow({
    prompt,
    messages,
    nPredict = 512,
    temperature = 0.7,
    onToken,
    stop,
    timeoutMs,
    onTimeout,
    onTimings,
  }: GenerateOptions): Promise<string> {
    if (!this.context) throw new Error("LlamaEngine: model not loaded");
    if (!prompt && !messages) {
      throw new Error("LlamaEngine.generate: either prompt or messages must be provided");
    }

    const timer = timeoutMs
      ? setTimeout(() => {
          onTimeout?.();
          this.context?.stopCompletion();
        }, timeoutMs)
      : null;

    // messages+jinja lets llama.cpp apply the loaded GGUF's own embedded
    // chat_template — DEFAULT_STOP_SEQUENCES exist specifically because
    // this app's hand-built "Question:/Answer:" prompt shape gives the
    // model no other signal for where a turn ends (see that constant's own
    // doc comment); a real chat template already has its own proper
    // end-of-turn token the model was fine-tuned to emit, so forcing our
    // unrelated string-based stops on top of it would be either inert or
    // could truncate genuine content that happens to contain "User:"/
    // "Question:". Only applied when the caller passes explicit `stop`.
    const completionParams = messages
      ? { messages, jinja: true, n_predict: nPredict, temperature, stop: stop ?? [] }
      : { prompt: prompt!, n_predict: nPredict, temperature, stop: stop ?? DEFAULT_STOP_SEQUENCES };

    let full = "";
    const completion = this.context.completion(completionParams, (data) => {
      full += data.token;
      onToken?.(data.token);
    });
    this.inFlight = completion;
    try {
      const result = await completion;
      const t = (result as { timings?: any; tokens_cached?: number }).timings;
      if (t && onTimings) {
        onTimings({
          promptTokens: t.prompt_n ?? 0,
          promptMs: t.prompt_ms ?? 0,
          predictedTokens: t.predicted_n ?? 0,
          predictedMs: t.predicted_ms ?? 0,
          cachedTokens: (result as { tokens_cached?: number }).tokens_cached,
        });
      }
      return result.text ?? full;
    } finally {
      if (this.inFlight === completion) this.inFlight = null;
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Signals the native completion loop to stop. The in-flight generate()
   * call's completion() promise resolves normally with whatever text was
   * generated so far — this is llama.cpp's own clean-stop behavior, not an
   * error/abort path, so no try/catch needed around a stopped generate().
   */
  async stop(): Promise<void> {
    this.stopEpoch++;
    await this.context?.stopCompletion();
  }
}

export const llamaEngine = new LlamaEngine();
