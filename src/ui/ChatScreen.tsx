import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, FlatList, NativeScrollEvent, NativeSyntheticEvent, Share, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
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
  setPersonalityId,
  getCustomSystemPrompt,
  getMaxTokens,
  getMemorySettings,
  MemorySettings as MemorySettingsType,
  DEFAULT_MEMORY_SETTINGS,
  getVoiceInputEnabled,
} from "../models/settings";
import { getPersonality, PersonalityId, PERSONALITIES } from "../constants/personalities";
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
import { ModelLoadErrorCard } from "./components/ModelLoadErrorCard";
import { Banner, IconButton, Progress, Screen, useAnnounce, useToast } from "./components";
import { useTokens } from "./theme";
import { answer as runAnswer, deepen as runDeepen, type AnswerContext } from "./chat/answerApi";
import type { AnswerEvent, AnswerHandle, AnswerRequest, AnswerResult } from "./chat/answerEvents";
import { answerPhase, answerReducer, attachAnswer, initialAnswer, type AnswerState } from "./chat/answerReducer";
import { answerTextForHistory, toStoredAnswer } from "./chat/answerRecord";
import { historyTurns, itemsFromRecords, updateAnswer, type ChatItem } from "./chat/chatItems";
import { phaseAnnouncement } from "./chat/presentation";
import { formatForCopy, formatForShare, type ShareLabels } from "./chat/shareFormat";
import { AssistantMessage } from "./chat/AssistantMessage";
import { ChatEmptyState, SourceSheet, UserMessage } from "./chat/ChatPieces";
import { Composer } from "./chat/Composer";

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
  itemsRef.current = items;
  const [input, setInput] = useState("");
  const [ready, setReady] = useState(false);
  const [loadStatus, setLoadStatus] = useState<{ label: string; progress?: number }>({ label: t("chatScreen.initializingCore") });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<CatalogModel | null>(null);
  const [voiceInputEnabled, setVoiceInputEnabledState] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [personalityId, setPersonalityIdState] = useState<PersonalityId>("succinct");
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
        requestAnimationFrame(flushEvents);
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
      setPersonalityIdState(await getPersonalityId());
      memorySettingsRef.current = await getMemorySettings();
      setVoiceInputEnabledState(await getVoiceInputEnabled());
      await refreshSessions();
    })();
  }, [refreshSessions]);

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
      setActive(activeRef.current);
      setInput("");
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

  /** A follow-up pass on an existing answer: Deepen, or the model after an extractive answer. */
  const followUp = useCallback(
    async (messageId: string, kind: "deep" | "fast") => {
      const item = itemsRef.current.find((m) => m.id === messageId);
      if (!item || item.kind !== "assistant" || activeRef.current || !ready) return;
      activeRef.current = { messageId, handle: null };
      setActive(activeRef.current);
      try {
        const { final } = await runInto(messageId, (onEvent, ctx) =>
          kind === "deep"
            ? runDeepen(item.question, item.answer.sources, onEvent, ctx)
            : runAnswer({ query: item.question, tier: "fast" }, onEvent, ctx)
        );
        await setMessageMeta(messageId, toStoredAnswer(final));
      } catch (e: any) {
        console.warn("[ChatScreen] follow-up failed:", e?.message ?? e);
      } finally {
        finish();
      }
    },
    [ready, runInto, finish]
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

  const cycleTone = useCallback(async () => {
    const customPrompt = (await getCustomSystemPrompt()) ?? "";
    const order = PERSONALITIES.map((p) => p.id).filter((id) => id !== "custom" || customPrompt.trim().length > 0);
    const next = order[(order.indexOf(personalityId) + 1) % order.length];
    setPersonalityIdState(next);
    await setPersonalityId(next);
    toast({ message: t("chatScreen.toneChanged", { tone: `${getPersonality(next).icon} ${t(`personalities.${next}.label`)}` }) });
  }, [personalityId, t, toast]);

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

  const renderItem = useCallback(
    ({ item }: { item: ChatItem }) => {
      if (item.kind === "user") {
        return (
          <UserMessage
            text={item.text}
            onCopy={() => copyText(item.text, t("chat.actions.questionCopied"))}
            onEdit={() => {
              setInput(item.text);
              inputRef.current?.focus();
            }}
          />
        );
      }
      const a = item.answer;
      const receipt = a.deep?.receipt ?? a.fast?.receipt ?? a.extractiveReceipt;
      return (
        <AssistantMessage
          answer={a}
          active={active?.messageId === item.id}
          stopping={stopping}
          interrupted={item.interrupted}
          feedback={item.feedback}
          locale={locale}
          onOpenSource={(index) => setOpenSource({ messageId: item.id, index })}
          onDeepen={() => followUp(item.id, "deep")}
          onAskModel={() => followUp(item.id, "fast")}
          onRetry={() => ask(item.question)}
          onRate={(r) => rate(item.id, r)}
          onCopy={() => copyText(formatForCopy(answerForCopy(a), a.sources, shareLabels), t("chat.actions.copied"))}
          onShare={() =>
            Share.share({ message: formatForShare(item.question, answerForCopy(a), a.sources, receipt, shareLabels, locale) })
          }
          onCopyReceipt={(text) => copyText(text, t("chat.receipt.copied"))}
        />
      );
    },
    [active, stopping, locale, followUp, ask, rate, copyText, shareLabels, t]
  );

  if (deviceEvalRequest) {
    return <EvaluationScreen deviceRequest={deviceEvalRequest} onClose={() => setDeviceEvalRequest(null)} />;
  }

  const sourceItem = openSource ? items.find((m) => m.id === openSource.messageId) : undefined;
  const source = sourceItem?.kind === "assistant" ? sourceItem.answer.sources[openSource!.index] ?? null : null;

  return (
    <Screen scroll={false} padded={false} edges={["top", "bottom", "left", "right"]}>
      <ChatHeader
        activeModelLabel={activeModel?.label}
        voiceEnabled={voiceInputEnabled}
        onOpenDrawer={() => {
          refreshSessions();
          navigation.dispatch(DrawerActions.openDrawer());
        }}
        onCycleTone={cycleTone}
        onNewChat={resetToNewChat}
      />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {loadError ? (
          <View style={{ padding: tk.space.base }}>
            <ModelLoadErrorCard error={loadError} onOpenSettings={openSettings} onRelaunchWizard={onRelaunchWizard} onRetry={initModels} />
          </View>
        ) : !ready ? (
          <View style={{ padding: tk.space.base, gap: tk.space.sm }}>
            <Banner tone="info" icon="cpu" message={loadStatus.label} />
            <Progress label={loadStatus.label} value={loadStatus.progress} tone="field" height={3} />
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          extraData={active}
          contentContainerStyle={{ padding: tk.space.base, gap: tk.space.xl, flexGrow: 1 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            ready ? (
              <ChatEmptyState
                showSuggestions={showSuggestions}
                onAsk={ask}
                onFill={(q) => {
                  setInput(q);
                  inputRef.current?.focus();
                }}
              />
            ) : null
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
          ready={ready}
          generating={generating}
          stopping={stopping}
          voiceEnabled={voiceInputEnabled}
        />
      </KeyboardAvoidingView>

      <SourceSheet source={source} index={openSource?.index ?? 0} onClose={() => setOpenSource(null)} />
    </Screen>
  );
}
