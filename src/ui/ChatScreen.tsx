import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, FlatList, NativeScrollEvent, NativeSyntheticEvent, Share, TextInput, View } from "react-native";
import { KeyboardAvoidingView, KeyboardController } from "react-native-keyboard-controller";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { DrawerActions, useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { llamaEngine } from "../inference/LlamaEngine";
import { embeddingEngine } from "../rag/embed";
import { onSeedProgress, seedKnowledgeBaseIfEmpty } from "../rag/seedCorpus";
import { MODEL_CATALOG, CORPUS_CATALOG, REQUIRED_MODELS, CatalogModel } from "../models/manifest";
import { listDiscoveredModels } from "../models/discoveredModels";
import { subscribeDownloads, listDownloadStates } from "../services/downloadManager";
import {
  getActiveModelId,
  getHidePromptIdeas,
  getPersonalityId,
  getCustomSystemPrompt,
  getMaxTokens,
  getMemorySettings,
  MemorySettings as MemorySettingsType,
  DEFAULT_MEMORY_SETTINGS,
  getVoiceInputEnabled,
} from "../models/settings";
import { getPersonality } from "../constants/personalities";
import {
  createSession,
  addMessage as persistMessage,
  getMessages as getSessionMessages,
  listSessions,
  deleteSession,
  setSessionTitle,
  setSessionSummary,
  pruneSessions,
  setMessageFeedback,
  setMessageMeta,
  upsertMessage,
  ChatSession,
} from "../services/chatHistory";
import { generateSessionTitle, summarizeConversation } from "../services/summarize";
import { startAppMemoryTracking } from "../services/telemetry";
import { stripThinking } from "../services/thinking";
import { cleanCitations } from "../services/citations";
import type { RootStackParamList } from "./navigation/types";
import { publishChatBridge } from "./navigation/chatBridge";
import { EvaluationScreen } from "./EvaluationScreen";
import { takePendingEvalRequest } from "../eval/deviceEvalRequest";
import type { EvalRequest } from "../eval/deviceEvalRequest.pure";
import { ChatHeader } from "./ChatHeader";
import { Banner, Button, IconButton, Progress, Screen, Sheet, Text, useAnnounce, useToast } from "./components";
import { useTokens } from "./theme";
import { answer as runAnswer, deepen as runDeepen, type AnswerContext } from "./chat/answerApi";
import type { AnswerEvent, AnswerHandle, AnswerRequest, AnswerResult } from "./chat/answerEvents";
import { answerPhase, answerReducer, attachAnswer, initialAnswer, type AnswerState } from "./chat/answerReducer";
import { answerTextForHistory, toStoredAnswer } from "./chat/answerRecord";
import { historyTurns, itemsFromRecords, sessionToResume, updateAnswer, type ChatItem } from "./chat/chatItems";
import { phaseAnnouncement } from "./chat/presentation";
import { formatForCopy, formatForShare, type ShareLabels } from "./chat/shareFormat";
import { AssistantMessage } from "./chat/AssistantMessage";
import { ChatEmptyState, ChatModelError, ChatModelLoading, SourceSheet, UserMessage } from "./chat/ChatPieces";
import { Composer } from "./chat/Composer";
import { modelStatus } from "./chat/composerState";
import { placesForCopy, sourceName } from "./chat/placesFormat";
import { locate } from "./chat/locationApi";
import { suggestionsFor } from "./chat/suggestions";

const VERBATIM_MESSAGE_COUNT = 6;

async function resolveActiveModel(kind: "llm" | "embedding"): Promise<CatalogModel> {
  const activeId = await getActiveModelId(kind);
  const fallback = REQUIRED_MODELS.find((m) => m.kind === kind)!;
  if (!activeId) return fallback;
  // Models picked from the Hugging Face browser live in discoveredModels, not MODEL_CATALOG.
  const candidates = [...MODEL_CATALOG, ...(await listDiscoveredModels())];
  const found = candidates.find((m) => m.id === activeId && m.kind === kind);
  if (!found) console.warn(`[ChatScreen] active ${kind} model "${activeId}" not found, using ${fallback.id}`);
  return found ?? fallback;
}

/** The answer text to copy or share: the deepest pass, cleaned of reasoning and invented citations. */
function answerForCopy(a: AnswerState): string {
  return cleanCitations(stripThinking(answerTextForHistory(a)), a.sources.length);
}

interface ActiveAnswer {
  messageId: string;
  handle: AnswerHandle | null;
}

export function ChatScreen({ onRelaunchWizard }: { onRelaunchWizard?: () => void }) {
  const tk = useTokens();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const announce = useAnnounce();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const locale = i18n.language?.startsWith("pt") ? "pt-BR" : "en-US";

  const [items, setItems] = useState<ChatItem[]>([]);
  const itemsRef = useRef<ChatItem[]>([]);
  // Answers asked in this run (not restored from history): only these may take focus (the city prompt).
  const askedIds = useRef<Set<string>>(new Set());
  itemsRef.current = items;
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [loadStatus, setLoadStatus] = useState<{ label: string; progress?: number }>({ label: t("chatScreen.initializingCore") });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<CatalogModel | null>(null);
  const [voiceInputEnabled, setVoiceInputEnabledState] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [deviceEvalRequest, setDeviceEvalRequest] = useState<EvalRequest | null>(null);
  const [openSource, setOpenSource] = useState<{ messageId: string; index: number } | null>(null);

  // The running answer. `generating` mirrors it for rendering; the ref is the
  // synchronous guard that closes the double-send race (set before any await).
  const activeRef = useRef<ActiveAnswer | null>(null);
  const [active, setActive] = useState<ActiveAnswer | null>(null);
  const generating = active !== null;
  const [stopping, setStopping] = useState(false);

  const memorySettingsRef = useRef<MemorySettingsType>(DEFAULT_MEMORY_SETTINGS);
  const sessionSummaryRef = useRef<string | null>(null);
  const backgroundTaskRef = useRef<Promise<void> | null>(null);
  const showSettingsRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<ChatItem>>(null);

  // ---- list scrolling: follow the newest text unless the user scrolled up ----
  const followBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const scrollToBottom = useCallback((animated = false) => {
    // Deferred a frame: on Android the reported content size can lag one layout behind.
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);
  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    followBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 120;
    setShowJump(!followBottom.current);
  }, []);

  // ---- events: batched to one state update per frame while tokens stream ----
  const pendingEvents = useRef<{ messageId: string; event: AnswerEvent }[]>([]);
  const flushScheduled = useRef(false);
  const flushEvents = useCallback(() => {
    flushScheduled.current = false;
    const batch = pendingEvents.current;
    if (batch.length === 0) return;
    pendingEvents.current = [];
    setItems((prev) => {
      let next = prev;
      for (const { messageId, event } of batch) next = updateAnswer(next, messageId, (a) => answerReducer(a, event));
      return next;
    });
  }, []);
  const queueEvent = useCallback(
    (messageId: string, event: AnswerEvent) => {
      pendingEvents.current.push({ messageId, event });
      if (!flushScheduled.current) {
        flushScheduled.current = true;
        // ~50 ms batches: a handful of renders per second of streaming instead of one per token.
        setTimeout(flushEvents, 50);
      }
    },
    [flushEvents]
  );

  // ---- screen reader: announce stage transitions of the running answer, never tokens ----
  const activeItem = active ? items.find((m) => m.id === active.messageId) : undefined;
  const activePhase = activeItem?.kind === "assistant" ? answerPhase(activeItem.answer) : null;
  const lastAnnounced = useRef<string | null>(null);
  useEffect(() => {
    if (!activePhase || activeItem?.kind !== "assistant") return;
    const key = `${activeItem.id}:${activePhase}`;
    if (lastAnnounced.current === key) return;
    lastAnnounced.current = key;
    const a = phaseAnnouncement(activePhase, activeItem.answer, t);
    if (a) announce(a.message, { assertive: a.assertive });
  }, [activePhase, activeItem, announce, t]);

  // ---- settings, sessions, models ----
  const refreshSessions = useCallback(async () => setSessions(await listSessions()), []);

  useEffect(() => {
    (async () => {
      setShowSuggestions(!(await getHidePromptIdeas()));
      memorySettingsRef.current = await getMemorySettings();
      setVoiceInputEnabledState(await getVoiceInputEnabled());
      const list = await listSessions();
      setSessions(list);
      // Coming back soon after leaving (or after the system killed the app) continues the conversation.
      const resume = sessionToResume(list, Date.now());
      if (resume && itemsRef.current.length === 0 && !activeRef.current) {
        const records = await getSessionMessages(resume.id);
        if (itemsRef.current.length > 0 || activeRef.current) return;
        setItems(itemsFromRecords(records));
        setActiveSessionId(resume.id);
        sessionSummaryRef.current = resume.summary;
      }
    })();
  }, []);

  const initModels = useCallback(async () => {
    try {
      setLoadError(null);
      setReady(false);
      const llm = await resolveActiveModel("llm");
      const emb = await resolveActiveModel("embedding");
      setActiveModel(llm);
      setLoadStatus({ label: t("chat.model.loading", { label: llm.label }) });
      await Promise.all([llamaEngine.load(llm.filename), embeddingEngine.load(emb.filename)]);
      startAppMemoryTracking();
      const stopProgress = onSeedProgress((p) =>
        setLoadStatus({
          label: t("chat.model.indexing", { done: p.done.toLocaleString(locale), total: p.total.toLocaleString(locale) }),
          progress: p.total > 0 ? p.done / p.total : undefined,
        })
      );
      await seedKnowledgeBaseIfEmpty().finally(stopProgress);
      setReady(true);
    } catch (e: any) {
      setLoadError(e?.message ?? String(e));
    }
  }, [t, locale]);

  useEffect(() => {
    initModels();
  }, [initModels]);

  // A download started elsewhere (Settings) keeps running; toast its completion here,
  // only for a transition this screen watched and not while Settings is open.
  const seenDownloadingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    return subscribeDownloads(() => {
      for (const { assetId, state: dl } of listDownloadStates()) {
        if (dl.downloading) {
          seenDownloadingRef.current.add(assetId);
        } else if (seenDownloadingRef.current.has(assetId)) {
          seenDownloadingRef.current.delete(assetId);
          if (dl.error || showSettingsRef.current) continue;
          (async () => {
            const known = [...MODEL_CATALOG, ...CORPUS_CATALOG, ...(await listDiscoveredModels())].find((m) => m.id === assetId);
            toast({ message: t("chatScreen.modelDownloadComplete", { label: known?.label ?? assetId }), tone: "success" });
          })();
        }
      }
    });
  }, [t, toast]);

  // Development builds only: an evaluation request written over adb by scripts/eval-device.mjs.
  useEffect(() => {
    if (!__DEV__ || !ready || deviceEvalRequest) return;
    let cancelled = false;
    const check = async () => {
      if (cancelled || activeRef.current) return;
      try {
        const request = await takePendingEvalRequest();
        if (request && !cancelled) setDeviceEvalRequest(request);
      } catch (e: any) {
        console.warn("[EVAL] could not read device request:", e?.message ?? e);
      }
    };
    check();
    const id = setInterval(check, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ready, deviceEvalRequest]);

  // ---- running answers ----
  const cancelBackgroundTask = useCallback(async () => {
    if (!backgroundTaskRef.current) return;
    await llamaEngine.stop();
    await backgroundTaskRef.current.catch(() => {});
    backgroundTaskRef.current = null;
  }, []);

  const stopActive = useCallback(async () => {
    const current = activeRef.current;
    if (!current?.handle) return;
    setStopping(true);
    impact(ImpactFeedbackStyle.Heavy);
    await current.handle.stop();
  }, []);

  /**
   * Runs one answer() into message `messageId` and persists the result. The
   * caller has already claimed activeRef synchronously.
   */
  const runInto = useCallback(
    async (messageId: string, start: (onEvent: (e: AnswerEvent) => void, ctx: AnswerContext) => AnswerHandle) => {
      const [maxTokens, activePersonalityId, customPrompt] = await Promise.all([
        getMaxTokens(),
        getPersonalityId(),
        getCustomSystemPrompt(),
      ]);
      const personality = getPersonality(activePersonalityId);
      const priorItems = itemsRef.current.filter((m) => m.id !== messageId);
      const ctx: AnswerContext = {
        systemPrompt: activePersonalityId === "custom" ? customPrompt ?? undefined : personality.systemPrompt,
        styleReminder: activePersonalityId === "custom" ? undefined : personality.styleReminder,
        history: { summary: sessionSummaryRef.current, turns: historyTurns(priorItems, VERBATIM_MESSAGE_COUNT) },
        maxTokens,
      };
      // A local copy of the state, so what gets persisted doesn't depend on render timing.
      let local = (itemsRef.current.find((m) => m.id === messageId) as Extract<ChatItem, { kind: "assistant" }>).answer;
      const handle = start((event) => {
        local = answerReducer(local, event);
        queueEvent(messageId, event);
      }, ctx);
      local = attachAnswer(local, handle.answerId);
      setItems((prev) => updateAnswer(prev, messageId, (a) => attachAnswer(a, handle.answerId)));
      activeRef.current = { messageId, handle };
      setActive(activeRef.current);
      const result: AnswerResult = await handle.done;
      flushEvents();
      return { result, final: local };
    },
    [queueEvent, flushEvents]
  );

  const finish = useCallback(() => {
    activeRef.current = null;
    setActive(null);
    setStopping(false);
  }, []);

  const ask = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query || activeRef.current || !ready) return;
      // Claim the answer slot before the first await.
      const assistantId = `${Date.now()}-a`;
      activeRef.current = { messageId: assistantId, handle: null };
      askedIds.current.add(assistantId);
      setActive(activeRef.current);
      setInput("");
      // Close the keyboard through keyboard-controller so it tracks the close: when the keyboard
      // went away while the list swapped (Prism K-2: composer left floating with the keyboard shut),
      // its progress stayed at 1. The answer is read next anyway.
      KeyboardController.dismiss();
      followBottom.current = true;
      scrollToBottom(true);

      const userItem: ChatItem = { kind: "user", id: `${Date.now()}-u`, text: query };
      const assistantItem: ChatItem = {
        kind: "assistant",
        id: assistantId,
        question: query,
        answer: { answerIds: [], sources: [] },
        feedback: null,
      };
      setItems((prev) => [...prev, userItem, assistantItem]);
      itemsRef.current = [...itemsRef.current, userItem, assistantItem];

      let sessionId = activeSessionId;
      const isNewSession = !sessionId;
      try {
        await cancelBackgroundTask();
        if (!sessionId) {
          sessionId = (await createSession()).id;
          setActiveSessionId(sessionId);
        }
        await persistMessage(sessionId, "user", query, userItem.id);

        const request: AnswerRequest = { query };
        const { result, final } = await runInto(assistantId, (onEvent, ctx) => runAnswer(request, onEvent, ctx));

        await persistMessage(sessionId, "assistant", answerTextForHistory(final), assistantId);
        await setMessageMeta(assistantId, toStoredAnswer(final));
        impact(result.outcome === "success" ? ImpactFeedbackStyle.Light : ImpactFeedbackStyle.Medium);

        const settings = memorySettingsRef.current;
        const sid = sessionId;
        if (isNewSession && settings.autoGenerateTitles && result.outcome === "success") {
          backgroundTaskRef.current = generateSessionTitle(query)
            .then(async (title) => {
              await setSessionTitle(sid, title);
              await refreshSessions();
            })
            .catch(() => {})
            .finally(() => {
              backgroundTaskRef.current = null;
            });
        } else if (settings.autoSummarize && result.outcome === "success") {
          const all = itemsRef.current;
          if (Math.floor(all.length / 2) > settings.historyTurnThreshold) {
            const older = historyTurns(all.slice(0, -VERBATIM_MESSAGE_COUNT), Number.MAX_SAFE_INTEGER);
            if (older.length > 0) {
              const previousSummary = sessionSummaryRef.current;
              backgroundTaskRef.current = summarizeConversation(older, previousSummary)
                .then(async (summary) => {
                  sessionSummaryRef.current = summary;
                  await setSessionSummary(sid, summary);
                })
                .catch(() => {})
                .finally(() => {
                  backgroundTaskRef.current = null;
                });
            }
          }
        }
        await pruneSessions(settings.maxSavedSessions);
      } catch (e: any) {
        // Session or storage failures: show them on the answer instead of leaving it spinning.
        const message = e?.message ?? String(e);
        setItems((prev) =>
          updateAnswer(prev, assistantId, (a) => ({
            ...a,
            fast: { text: a.fast?.text ?? "", stage: null, outcome: "error", error: { code: "unknown", message } },
          }))
        );
      } finally {
        finish();
      }
    },
    [activeSessionId, ready, cancelBackgroundTask, runInto, refreshSessions, scrollToBottom, finish]
  );

  /**
   * A follow-up pass on an existing answer: Deepen, the model after an
   * extractive answer, or the same question again for a typed city / after
   * the location permission (that one replaces the answer in place).
   */
  const followUp = useCallback(
    async (messageId: string, kind: "deep" | "fast" | { place?: string }) => {
      const item = itemsRef.current.find((m) => m.id === messageId);
      if (!item || item.kind !== "assistant" || activeRef.current || !ready) return;
      const sessionId = activeSessionId;
      activeRef.current = { messageId, handle: null };
      setActive(activeRef.current);
      if (typeof kind === "object") {
        const fresh = (items: ChatItem[]) =>
          updateAnswer(items, messageId, () => ({ answerIds: [], sources: [] })).map((m) =>
            m.kind === "assistant" && m.id === messageId ? { ...m, interrupted: false } : m
          );
        itemsRef.current = fresh(itemsRef.current);
        setItems(fresh);
      }
      try {
        const { final } = await runInto(messageId, (onEvent, ctx) =>
          kind === "deep"
            ? runDeepen(item.question, item.answer.sources, onEvent, ctx)
            : kind === "fast"
              ? runAnswer({ query: item.question, tier: "fast" }, onEvent, ctx)
              : runAnswer({ query: item.question, place: kind.place }, onEvent, ctx)
        );
        // A redo replaces the answer: keep the saved text in step (Deepen only adds to it).
        if (typeof kind === "object" && sessionId) await upsertMessage(sessionId, "assistant", answerTextForHistory(final), messageId);
        await setMessageMeta(messageId, toStoredAnswer(final));
      } catch (e: any) {
        console.warn("[ChatScreen] follow-up failed:", e?.message ?? e);
      } finally {
        finish();
      }
    },
    [ready, runInto, finish, activeSessionId]
  );

  // "Use my location": explain in context first (only while the permission is undetermined).
  const [locationExplain, setLocationExplain] = useState<((ok: boolean) => void) | null>(null);
  const locateAndAsk = useCallback(
    async (messageId: string) => {
      const result = await locate(() => new Promise<boolean>((resolve) => setLocationExplain(() => resolve)));
      setLocationExplain(null);
      if (result.status === "ok") followUp(messageId, {});
    },
    [followUp]
  );

  // Backgrounding stops the answer (same path as Stop) and marks it interrupted.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "background" || !activeRef.current) return;
      const id = activeRef.current.messageId;
      setItems((prev) => prev.map((m) => (m.kind === "assistant" && m.id === id ? { ...m, interrupted: true } : m)));
      activeRef.current.handle?.stop();
    });
    return () => sub.remove();
  }, []);

  /** Stops whatever runs and waits for it, before swapping the conversation out. */
  const stopAndWait = useCallback(async () => {
    await activeRef.current?.handle?.stop();
    await cancelBackgroundTask();
  }, [cancelBackgroundTask]);

  const resetToNewChat = useCallback(async () => {
    await stopAndWait();
    setItems([]);
    setActiveSessionId(null);
    sessionSummaryRef.current = null;
    impact(ImpactFeedbackStyle.Medium);
  }, [stopAndWait]);

  const selectSession = useCallback(
    async (id: string) => {
      await stopAndWait();
      const records = await getSessionMessages(id);
      followBottom.current = true;
      setItems(itemsFromRecords(records));
      setActiveSessionId(id);
      sessionSummaryRef.current = sessions.find((s) => s.id === id)?.summary ?? null;
    },
    [stopAndWait, sessions]
  );

  const removeSession = useCallback(
    async (id: string) => {
      // Stop first: a finishing answer would otherwise be saved into the deleted session.
      if (id === activeSessionId) await resetToNewChat();
      await deleteSession(id);
      await refreshSessions();
    },
    [activeSessionId, refreshSessions, resetToNewChat]
  );

  const openSettings = useCallback(() => navigation.navigate("Settings"), [navigation]);

  // Set while another screen (Settings, Models, ...) is pushed on top of the chat;
  // also keeps download toasts meant for that screen out of the chat.
  useEffect(
    () =>
      navigation.addListener("blur", () => {
        showSettingsRef.current = true;
      }),
    [navigation]
  );

  // Returning from any pushed screen (drawer, error card, back gesture): pick up what may have changed there.
  useFocusEffect(
    useCallback(() => {
      if (!showSettingsRef.current) return;
      showSettingsRef.current = false;
      (async () => {
        getVoiceInputEnabled().then(setVoiceInputEnabledState);
        getHidePromptIdeas().then((hide) => setShowSuggestions(!hide));
        // Settings loads a newly chosen LLM itself; only re-run the full init if what's loaded doesn't match.
        const llm = await resolveActiveModel("llm");
        if (ready && llamaEngine.getModelInfo()?.filename === llm.filename) setActiveModel(llm);
        else initModels();
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, initModels])
  );

  useEffect(() => {
    publishChatBridge({
      sessions,
      activeSessionId,
      generating,
      newChat: resetToNewChat,
      selectSession,
      deleteSession: removeSession,
      refreshSessions,
      // Suggestions live in the empty state of a new chat.
      openPromptIdeas: resetToNewChat,
    });
  }, [sessions, activeSessionId, generating, resetToNewChat, selectSession, removeSession, refreshSessions]);

  // ---- per-message actions ----
  const shareLabels: ShareLabels = useMemo(
    () => ({
      sources: t("chat.share.sources"),
      answeredOffline: t("chat.share.answeredOffline"),
      sourcePassage: t("chat.share.sourcePassage"),
      myDocuments: t("chat.share.myDocuments"),
    }),
    [t]
  );

  const rate = useCallback(async (id: string, rating: "up" | "down") => {
    const current = itemsRef.current.find((m) => m.id === id);
    if (current?.kind !== "assistant") return;
    const next = current.feedback === rating ? null : rating;
    setItems((prev) => prev.map((m) => (m.kind === "assistant" && m.id === id ? { ...m, feedback: next } : m)));
    await setMessageFeedback(id, next);
  }, []);

  const copyText = useCallback(
    async (text: string, message: string) => {
      await Clipboard.setStringAsync(text);
      toast({ message, icon: "check" });
    },
    [toast]
  );

  // Row actions go through a ref so every row gets the same handler object:
  // memoized rows then re-render only when their own item changes, not on
  // every streamed frame of another answer.
  const rowActions = useRef<RowActions>(null as unknown as RowActions);
  rowActions.current = {
    openSource: (id, index) => setOpenSource({ messageId: id, index }),
    deepen: (id) => followUp(id, "deep"),
    askModel: (id) => followUp(id, "fast"),
    // Retry redoes the answer in place; without a saved session (it failed before one existed) it asks again.
    retry: (id, question) => (activeSessionId ? followUp(id, {}) : ask(question)),
    rate: (id, r) => rate(id, r),
    copy: (item) => copyText(copyBody(item) ?? formatForCopy(answerForCopy(item.answer), item.answer.sources, shareLabels), t("chat.actions.copied")),
    share: (item) => {
      const a = item.answer;
      const receipt = a.deep?.receipt ?? a.fast?.receipt ?? a.instantDone?.receipt;
      const places = copyBody(item);
      Share.share({
        message: places
          ? formatForShare(item.question, places, [], receipt, shareLabels, locale)
          : formatForShare(item.question, answerForCopy(a), a.sources, receipt, shareLabels, locale),
      });
    },
    city: (id, city) => followUp(id, { place: city }),
    useLocation: (id) => locateAndAsk(id),
    getMap: openSettings,
    copyReceipt: (text) => copyText(text, t("chat.receipt.copied")),
    copyQuestion: (text) => copyText(text, t("chat.actions.questionCopied")),
    editQuestion: (text) => {
      setInput(text);
      inputRef.current?.focus();
    },
  };
  function copyBody(item: Extract<ChatItem, { kind: "assistant" }>): string | null {
    const a = item.answer;
    if (!a.places?.places.length) return null;
    return [
      placesForCopy(a.places.places, a.places.area.kind === "near" ? new Date() : null, locale, t),
      a.places.attribution.map((x) => `${sourceName(x.source, t)} (${x.license})`).join(" · "),
    ].join("\n\n");
  }
  const actions = useMemo<RowActions>(
    () => ({
      openSource: (id, i) => rowActions.current.openSource(id, i),
      deepen: (id) => rowActions.current.deepen(id),
      askModel: (id) => rowActions.current.askModel(id),
      retry: (id, q) => rowActions.current.retry(id, q),
      rate: (id, r) => rowActions.current.rate(id, r),
      copy: (item) => rowActions.current.copy(item),
      share: (item) => rowActions.current.share(item),
      city: (id, c) => rowActions.current.city(id, c),
      useLocation: (id) => rowActions.current.useLocation?.(id),
      getMap: () => rowActions.current.getMap(),
      copyReceipt: (text) => rowActions.current.copyReceipt(text),
      copyQuestion: (text) => rowActions.current.copyQuestion(text),
      editQuestion: (text) => rowActions.current.editQuestion(text),
    }),
    []
  );

  const activeId = active?.messageId ?? null;
  const renderItem = useCallback(
    ({ item }: { item: ChatItem }) =>
      item.kind === "user" ? (
        <UserRow text={item.text} actions={actions} />
      ) : (
        <AssistantRow
          item={item}
          active={activeId === item.id}
          fresh={askedIds.current.has(item.id)}
          stopping={activeId === item.id && stopping}
          locale={locale}
          actions={actions}
        />
      ),
    [actions, activeId, stopping, locale]
  );

  if (deviceEvalRequest) {
    return <EvaluationScreen deviceRequest={deviceEvalRequest} onClose={() => setDeviceEvalRequest(null)} />;
  }

  const sourceItem = openSource ? items.find((m) => m.id === openSource.messageId) : undefined;
  const source = sourceItem?.kind === "assistant" ? sourceItem.answer.sources[openSource!.index] ?? null : null;

  return (
    <Screen scroll={false} padded={false} ambient edges={["top", "bottom", "left", "right"]}>
      <ChatHeader
        activeModelLabel={activeModel?.label}
        voiceEnabled={voiceInputEnabled}
        onOpenDrawer={() => {
          refreshSessions();
          navigation.dispatch(DrawerActions.openDrawer());
        }}
        onNewChat={resetToNewChat}
      />
      {/* automaticOffset: the view's onLayout y is relative to its parent (below the safe area and the
          header), so without it the padding came out short and the composer sat behind the keyboard
          (Prism K-1, Android offline 06f508b). The native window position fixes any offset above. */}
      <KeyboardAvoidingView behavior="padding" automaticOffset style={{ flex: 1 }}>
        {/* With a conversation on screen, the model state sits above it; an empty chat shows it centred instead. */}
        {items.length > 0 && loadError ? (
          <View style={{ paddingHorizontal: tk.space.gutter }}>
            <ChatModelError compact error={loadError} onOpenSettings={openSettings} onRelaunchWizard={onRelaunchWizard} onRetry={initModels} />
          </View>
        ) : items.length > 0 && !ready ? (
          <View style={{ paddingHorizontal: tk.space.gutter, paddingVertical: tk.space.sm, gap: tk.space.sm }}>
            <Text variant="footnote" color="secondary">
              {loadStatus.label}
            </Text>
            <Progress label={loadStatus.label} value={loadStatus.progress} tone="accent" height={tk.space.xs} />
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          extraData={renderItem}
          contentContainerStyle={{ paddingHorizontal: tk.space.gutter, paddingVertical: tk.space.base, gap: tk.space.xl, flexGrow: 1 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            loadError ? (
              <ChatModelError error={loadError} onOpenSettings={openSettings} onRelaunchWizard={onRelaunchWizard} onRetry={initModels} />
            ) : !ready ? (
              <ChatModelLoading label={loadStatus.label} progress={loadStatus.progress} />
            ) : (
              <ChatEmptyState
                suggestions={showSuggestions ? suggestionsFor(activeModel?.id, i18n.language) : []}
                onAsk={ask}
                onFill={(q) => {
                  setInput(q);
                  inputRef.current?.focus();
                }}
              />
            )
          }
          // Snap while streaming (animations started on every token fight each other); animate otherwise.
          onContentSizeChange={() => {
            if (followBottom.current) scrollToBottom(!generating);
          }}
          onLayout={() => {
            if (followBottom.current) scrollToBottom();
          }}
          onScroll={onListScroll}
          scrollEventThrottle={100}
        />

        {showJump && generating && (
          <View style={{ position: "absolute", right: tk.space.base, bottom: 96 }}>
            <IconButton
              icon="arrow-down"
              variant="tonal"
              label={t("chat.jumpToLatest")}
              onPress={() => {
                followBottom.current = true;
                setShowJump(false);
                scrollToBottom(true);
              }}
            />
          </View>
        )}

        <Composer
          ref={inputRef}
          value={input}
          onChange={setInput}
          onSend={() => ask(input)}
          onStop={stopActive}
          status={modelStatus(ready, loadError)}
          generating={generating}
          stopping={stopping}
          voiceEnabled={voiceInputEnabled}
        />
      </KeyboardAvoidingView>

      <Sheet
        visible={!!locationExplain}
        onClose={() => locationExplain?.(false)}
        title={t("chat.places.locationWhyTitle")}
        footer={
          <View style={{ gap: tk.space.sm }}>
            <Button label={t("chat.places.locationAllow")} fullWidth onPress={() => locationExplain?.(true)} />
            <Button label={t("chat.places.typeCity")} variant="secondary" fullWidth onPress={() => locationExplain?.(false)} />
          </View>
        }
      >
        <Text color="secondary">{t("chat.places.locationWhyBody")}</Text>
      </Sheet>

      <SourceSheet source={source} index={openSource?.index ?? 0} onClose={() => setOpenSource(null)} />
    </Screen>
  );
}

interface RowActions {
  openSource: (id: string, index: number) => void;
  deepen: (id: string) => void;
  askModel: (id: string) => void;
  retry: (id: string, question: string) => void;
  rate: (id: string, rating: "up" | "down") => void;
  copy: (item: Extract<ChatItem, { kind: "assistant" }>) => void;
  share: (item: Extract<ChatItem, { kind: "assistant" }>) => void;
  city: (id: string, city: string) => void;
  useLocation?: (id: string) => void;
  getMap: () => void;
  copyReceipt: (text: string) => void;
  copyQuestion: (text: string) => void;
  editQuestion: (text: string) => void;
}

const UserRow = memo(function UserRow({ text, actions }: { text: string; actions: RowActions }) {
  const onCopy = useCallback(() => actions.copyQuestion(text), [actions, text]);
  const onEdit = useCallback(() => actions.editQuestion(text), [actions, text]);
  return <UserMessage text={text} onCopy={onCopy} onEdit={onEdit} />;
});

/** One answer row; its callbacks are stable per item so AssistantMessage's memo holds while others stream. */
const AssistantRow = memo(function AssistantRow({
  item,
  active,
  fresh,
  stopping,
  locale,
  actions,
}: {
  item: Extract<ChatItem, { kind: "assistant" }>;
  active: boolean;
  fresh: boolean;
  stopping: boolean;
  locale: string;
  actions: RowActions;
}) {
  const itemRef = useRef(item);
  itemRef.current = item;
  const id = item.id;
  const cb = useMemo(
    () => ({
      onOpenSource: (i: number) => actions.openSource(id, i),
      onDeepen: () => actions.deepen(id),
      onAskModel: () => actions.askModel(id),
      onRetry: () => actions.retry(id, itemRef.current.question),
      onRate: (r: "up" | "down") => actions.rate(id, r),
      onCopy: () => actions.copy(itemRef.current),
      onShare: () => actions.share(itemRef.current),
      onCity: (city: string) => actions.city(id, city),
      onUseLocation: actions.useLocation ? () => actions.useLocation!(id) : undefined,
      onGetMap: actions.getMap,
      onCopyReceipt: actions.copyReceipt,
    }),
    [actions, id]
  );
  return (
    <AssistantMessage
      answer={item.answer}
      question={item.question}
      active={active}
      fresh={fresh}
      stopping={stopping}
      interrupted={item.interrupted}
      feedback={item.feedback}
      locale={locale}
      {...cb}
    />
  );
});
