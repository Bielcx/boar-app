import React, { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Badge, Banner, Button, Card, Icon, IconButton, Mascot, MetaLine, Text, type IconName } from "../components";
import { MarkdownMessage } from "../components/MarkdownMessage";
import { useTheme, useTokens } from "../theme";
import { splitThinking } from "../../services/thinking";
import { cleanCitations } from "../../services/citations";
import { splitInlineBullets } from "../../services/answerFormat";
import { answerPhase, canDeepen, isLocating, type AnswerState, type TierState } from "./answerReducer";
import { generatingSteps, previewText, receiptDetails, receiptLine, receiptShort, type GeneratingStep } from "./presentation";
import { groupSources, relevancePercents, sourceParts } from "./sourceLabel";
import { showsEmergencyNote } from "./safetyNote";
import { formatSeconds } from "./shareFormat";
import { LocatingPrompt, PlacesCard } from "./PlacesCard";
import type { AnswerReceipt } from "./answerEvents";

export interface AssistantMessageProps {
  answer: AnswerState;
  /** This answer is the one running now. */
  active: boolean;
  /** Asked in this run (not restored from history): it may take focus, e.g. the city prompt. */
  fresh?: boolean;
  /** The question this answers (health questions get the emergency note). */
  question?: string;
  stopping: boolean;
  /** Stopped because the app went to the background. */
  interrupted?: boolean;
  feedback?: "up" | "down" | null;
  locale: string;
  onOpenSource: (index: number) => void;
  onDeepen: () => void;
  onAskModel: () => void;
  onRetry: () => void;
  onRate: (rating: "up" | "down") => void;
  onCopy: () => void;
  onShare: () => void;
  onCopyReceipt: (text: string) => void;
  /** Places answers: re-ask for a typed city, or with the device position. */
  onCity: (city: string) => void;
  /** Weak-sources state A: generate anyway for the same question. */
  onAnswerAnyway?: () => void;
  onUseLocation?: () => void;
  onGetMap?: () => void;
}

function useElapsedSeconds(running: boolean): number {
  const started = useRef(Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  return seconds;
}

/** The mockup's step indicator: an ember ring turning (static under reduce motion). */
function StepSpinner() {
  const t = useTokens();
  const { reduceMotion } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const side = t.size.iconSm - t.space.xxs;
  return (
    <Animated.View
      style={{
        width: side,
        height: side,
        borderRadius: t.radius.full,
        borderWidth: t.size.focusRing,
        borderColor: t.color.accent.solid,
        borderTopColor: "transparent",
        transform: [{ rotate }],
      }}
    />
  );
}

/**
 * What the answer is doing, as the mockup's step card: every step from the start (generatingSteps), each
 * with its icon; on the right a check when done, the turning ring on the current one, a small dot for the
 * ones still to come. Visual only; the reader hears stage changes through the screen's announcer.
 */
function StepsCard({ steps }: { steps: GeneratingStep[] }) {
  const t = useTokens();
  return (
    <Card padding="compact" radius="card" style={{ gap: t.space.sm }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {steps.map((s) => (
        <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
          <Icon name={s.icon} size="sm" color={s.status === "active" ? t.color.accent.solid : t.color.text.secondary} />
          <Text variant="footnote" weight={s.status === "active" ? "semibold" : "regular"} color={s.status === "pending" ? "secondary" : "primary"} style={{ flex: 1 }}>
            {s.label}
          </Text>
          {s.status === "active" ? (
            <StepSpinner />
          ) : s.status === "done" ? (
            <Icon name="check" size="sm" color={t.color.status.success.solid} />
          ) : (
            <View style={{ width: t.space.sm, height: t.space.sm, borderRadius: t.radius.full, backgroundColor: t.color.line.hairline }} />
          )}
        </View>
      ))}
    </Card>
  );
}

/** Seconds since the answer started, as the mockup's pill at the right of the name (the receipt takes its place when done). */
function Elapsed({ locale, step }: { locale: string; step?: string }) {
  const t = useTokens();
  const seconds = useElapsedSeconds(true);
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        marginLeft: "auto",
        flexDirection: "row",
        alignItems: "center",
        gap: t.space.xs,
        paddingHorizontal: t.space.sm,
        paddingVertical: t.space.xs,
        borderRadius: t.radius.full,
        backgroundColor: t.color.bg.surface,
      }}
    >
      <Icon name="loader" size="sm" color={t.color.text.secondary} />
      <MetaLine items={[step, formatSeconds(seconds * 1000, locale)]} variant="caption" />
    </View>
  );
}

function Reasoning({ thinking, inProgress, streaming }: { thinking: string; inProgress: boolean; streaming: boolean }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const seconds = useElapsedSeconds(streaming && inProgress);
  // The spoken label stays fixed while the counter ticks, so it isn't re-read every second.
  const visible = streaming && inProgress ? tr("chat.reasoning.thinking", { seconds }) : open ? tr("chat.reasoning.hide") : tr("chat.reasoning.show");
  return (
    <View style={{ gap: t.space.xs }}>
      <Button
        label={visible}
        variant="ghost"
        size="sm"
        icon="message-circle"
        onPress={() => setOpen((o) => !o)}
        accessibilityLabel={open ? tr("chat.reasoning.hide") : tr("chat.reasoning.show")}
        accessibilityState={{ expanded: open }}
        style={{ alignSelf: "flex-start" }}
      />
      {open && (
        <Text
          variant="footnote"
          color="secondary"
          style={{ paddingLeft: t.space.md, borderLeftWidth: 2, borderLeftColor: t.color.line.hairline }}
        >
          {thinking}
        </Text>
      )}
    </View>
  );
}

function TierBody({
  tier,
  streaming,
  sourceTitles,
  onOpenSource,
}: {
  tier: TierState;
  streaming: boolean;
  sourceTitles: string[];
  onOpenSource: (index: number) => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const split = splitThinking(tier.text);
  // Invented citations are cleaned only once the answer is done (sources are final then).
  const shown = streaming ? split.answer : splitInlineBullets(cleanCitations(split.answer, sourceTitles.length));
  return (
    <View style={{ gap: t.space.sm }}>
      {split.thinking || split.thinkingInProgress ? (
        <Reasoning thinking={split.thinking ?? ""} inProgress={split.thinkingInProgress && !split.answer} streaming={streaming} />
      ) : null}
      {!streaming && split.thinkingInProgress && !split.answer ? (
        <Text variant="footnote" color="secondary">
          {tr("chat.reasoning.unfinished")}
        </Text>
      ) : null}
      {shown.length > 0 && (
        <MarkdownMessage
          content={shown}
          sourceTitles={sourceTitles}
          onCitationPress={(n) => onOpenSource(n - 1)}
          isStreaming={streaming}
        />
      )}
    </View>
  );
}

/**
 * The measured receipt: a short numbers-only line ("1.4 s · 16 tok/s") that
 * sits by the name and opens the full measurement below the header row.
 */
function useReceipt(receipt: AnswerReceipt | undefined, locale: string, generalKnowledge = false) {
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!receipt) return null;
  return {
    open,
    toggle: () => setOpen((o) => !o),
    // "general knowledge" when no offline source covered the question (weak-sources spec).
    short: generalKnowledge ? [...receiptShort(receipt, locale), tr("chat.weak.receipt")] : receiptShort(receipt, locale),
    line: receiptLine(receipt, locale, tr),
    details: receiptDetails(receipt, locale, tr),
  };
}

function ReceiptToggle({ r, hidden }: { r: NonNullable<ReturnType<typeof useReceipt>>; hidden: boolean }) {
  const { t: tr } = useTranslation();
  return (
    <Pressable
      onPress={r.toggle}
      accessibilityRole="button"
      accessibilityLabel={`${tr("chat.receipt.details")}: ${r.line}`}
      accessibilityState={{ expanded: r.open }}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      accessibilityElementsHidden={hidden}
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
    >
      <MetaLine items={r.short} variant="caption" numberOfLines={1} />
    </Pressable>
  );
}

function ReceiptDetails({ r, onCopy }: { r: NonNullable<ReturnType<typeof useReceipt>>; onCopy: (text: string) => void }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  if (!r.open) return null;
  const rows = [r.line, ...r.details.map((d) => `${d.label}: ${d.value}`)];
  return (
    <View style={{ gap: t.space.xxs, padding: t.space.md, borderRadius: t.radius.md, backgroundColor: t.color.bg.surface }}>
      {rows.map((row) => (
        <Text key={row} variant="mono" color="secondary">
          {row}
        </Text>
      ))}
      <Button
        label={tr("chat.receipt.copy")}
        variant="ghost"
        size="sm"
        icon="copy"
        style={{ alignSelf: "flex-start", marginLeft: -t.space.md }}
        onPress={() => onCopy(rows.join("\n"))}
      />
    </View>
  );
}

/** A small receipt line for the deep tier, which has its own section. */
function Receipt({
  receipt,
  locale,
  hidden,
  onCopy,
}: {
  receipt: AnswerReceipt;
  locale: string;
  hidden: boolean;
  onCopy: (text: string) => void;
}) {
  const t = useTokens();
  const r = useReceipt(receipt, locale)!;
  return (
    <View style={{ gap: t.space.xs }}>
      <ReceiptToggle r={r} hidden={hidden} />
      <ReceiptDetails r={r} onCopy={onCopy} />
    </View>
  );
}

/** The mockup's relevance bar and percentage; nothing when there is no measured value. */
function RelevanceBar({ pct }: { pct: number | null }) {
  const t = useTokens();
  if (pct == null) return null;
  const track = t.space.xxl + t.space.xs;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={{ width: track, height: t.space.xs, borderRadius: t.radius.full, backgroundColor: t.color.bg.raised, overflow: "hidden" }}>
        <View style={{ width: (track * pct) / 100, height: "100%", borderRadius: t.radius.full, backgroundColor: t.color.field.solid }} />
      </View>
      <Text variant="caption" weight="semibold" color="field" numeric>
        {`${pct}%`}
      </Text>
    </View>
  );
}

/**
 * The answer's sources as the mockup's card: a header with the count, then one
 * row per article (passages of the same article are grouped, Iris) that
 * expands in place into a well: the source's name as the overline, its URL in
 * normal case (Prism S-2), and each passage with its citation number and first
 * lines. The full passage opens in the source sheet.
 */
function SourceList({ answer, onOpenSource }: { answer: AnswerState; onOpenSource: (i: number) => void }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = groupSources(answer.sources);
  // Measured relevance only (Boar): 0-100 within the answer; a row without it has no bar.
  const pct = relevancePercents(answer.sources);
  return (
    <Card padding="sm" style={{ gap: t.space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm, paddingHorizontal: t.space.xs }}>
        <Icon name="book-open" size="sm" color={t.color.text.field} />
        <Text variant="label" header style={{ flex: 1 }}>
          {tr("chat.sources.heading")}
        </Text>
        <Badge label={String(answer.sources.length)} tone="field" emphasis="solid" />
      </View>
      {groups.map((g) => {
        const open = expanded === g.key;
        const first = answer.sources[g.indexes[0]];
        const parts = sourceParts(first.source);
        const origin = first.collectionId ? tr("chat.sources.myDocuments") : parts.name ?? tr("chat.sources.corpus");
        const numbers = g.indexes.map((i) => i + 1).join(", ");
        const passages = g.indexes.length;
        const groupPct = Math.max(0, ...g.indexes.map((i) => pct[i] ?? 0)) || null;
        return (
          <View
            key={g.key}
            style={{
              borderRadius: t.radius.md,
              borderWidth: t.size.border,
              borderColor: open ? t.color.field.solid : "transparent",
              // The mockup's source rows sit in canvas wells inside the card.
              backgroundColor: t.color.bg.canvas,
            }}
          >
            <Pressable
              onPress={() => setExpanded(open ? null : g.key)}
              accessibilityRole="button"
              accessibilityLabel={
                tr("chat.sources.groupLabel", { numbers, title: g.title, origin, count: passages }) +
                (groupPct ? `, ${tr("chat.sources.relevance", { pct: groupPct })}` : "")
              }
              accessibilityHint={tr("chat.sources.expandHint")}
              accessibilityState={{ expanded: open }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: t.space.sm,
                minHeight: t.size.controlSm,
                paddingHorizontal: t.space.sm,
                paddingVertical: t.space.xs,
                borderRadius: t.radius.md,
                backgroundColor: pressed ? t.color.bg.sunken : undefined,
              })}
              hitSlop={{ top: (t.size.touch - t.size.controlSm) / 2, bottom: (t.size.touch - t.size.controlSm) / 2 }}
            >
              <View
                style={{
                  minWidth: t.size.iconLg,
                  minHeight: t.size.iconLg,
                  paddingHorizontal: t.space.xs,
                  borderRadius: t.radius.full,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: t.color.bg.raised,
                }}
              >
                <Text variant="caption" weight="semibold" numeric maxFontSizeMultiplier={1.5}>
                  {g.indexes[0] + 1}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="footnote" numberOfLines={open ? undefined : 1}>
                  {g.title}
                </Text>
                {passages > 1 && <MetaLine items={[tr("chat.sources.passages", { count: passages })]} variant="caption" numberOfLines={1} />}
              </View>
              <RelevanceBar pct={groupPct} />
              <Icon name={open ? "chevron-up" : "chevron-down"} size="sm" color={t.color.text.secondary} />
            </Pressable>
            {open && (
              <View style={{ gap: t.space.sm, paddingHorizontal: t.space.md, paddingBottom: t.space.md }}>
                {/* The mockup's overline line: where it comes from on the left, its path on the right. */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
                  <Text variant="label" color="field" numberOfLines={1} style={{ flexShrink: 0 }}>
                    {origin}
                  </Text>
                  {parts.url && (
                    <Text variant="caption" color="secondary" numberOfLines={1} ellipsizeMode="middle" selectable style={{ flex: 1, textAlign: "right" }}>
                      {parts.url.replace(/^https?:\/\/(www\.)?/, "")}
                    </Text>
                  )}
                </View>
                {/* The passage itself opens the full source (no extra "Full passage" line, as in the mockup). */}
                {g.indexes.map((i) => (
                  <Pressable
                    key={answer.sources[i].chunkId}
                    onPress={() => onOpenSource(i)}
                    accessibilityRole="button"
                    accessibilityLabel={answer.sources[i].body}
                    accessibilityHint={tr("chat.sources.openHint")}
                  >
                    <Text variant="footnote" numberOfLines={4}>
                      {passages > 1 ? `[${i + 1}] ${answer.sources[i].body}` : answer.sources[i].body}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

/**
 * No strong source on this phone (Iris, specs/weak-sources.md): in the source card's slot, a
 * neutral note (no amber: amber means provenance, and there is none), one focus for readers.
 * "Show closest passages" only when the engine still returned some, marked as weak, unnumbered.
 */
function WeakSourceNote({ answer }: { answer: AnswerState }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = groupSources(answer.sources);
  return (
    <Card style={{ gap: t.space.sm }}>
      <View accessible accessibilityLabel={`${tr("chat.weak.title")}. ${tr("chat.weak.body")}`} style={{ gap: t.space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
          <Icon name="book" size="sm" color={t.color.text.secondary} />
          <Text variant="label" color="secondary" style={{ flex: 1 }}>
            {tr("chat.weak.title")}
          </Text>
        </View>
        <Text variant="footnote" color="secondary">
          {tr("chat.weak.body")}
        </Text>
      </View>
      {groups.length > 0 && (
        <Button
          label={tr(open ? "chat.weak.hideClosest" : "chat.weak.showClosest")}
          variant="ghost"
          size="sm"
          accessibilityState={{ expanded: open }}
          style={{ alignSelf: "flex-start", marginLeft: -t.space.md }}
          onPress={() => setOpen((o) => !o)}
        />
      )}
      {open && (
        <View style={{ gap: t.space.sm }}>
          <Text variant="label" color="secondary" header>
            {tr("chat.weak.closestTitle")}
          </Text>
          {groups.map((g) => (
            <View key={g.key} style={{ gap: t.space.xxs }}>
              <Text variant="subhead" numberOfLines={2}>
                {g.title}
              </Text>
              <MetaLine items={[sourceParts(answer.sources[g.indexes[0]].source).name, tr("chat.weak.weakMatch")]} variant="caption" />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/**
 * Weak-sources state A (Iris spec, Boar's decision): the compact model found nothing in this phone's
 * library and didn't guess. The card is the answer; "Answer anyway (may be wrong)" generates for the
 * same question (state B). No receipt, no primary ember, no amber.
 */
function DeclinedNoSource({ answer, onAnswerAnyway }: { answer: AnswerState; onAnswerAnyway?: () => void }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = groupSources(answer.sources);
  return (
    <Card style={{ gap: t.space.sm }}>
      <View accessible accessibilityLabel={`${tr("chat.weak.declinedTitle")}. ${tr("chat.weak.declinedBody")}`} style={{ gap: t.space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
          <Icon name="search" size="sm" color={t.color.text.secondary} />
          <Text variant="headline" style={{ flex: 1 }}>
            {tr("chat.weak.declinedTitle")}
          </Text>
        </View>
        <Text variant="footnote" color="secondary">
          {tr("chat.weak.declinedBody")}
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space.sm }}>
        {onAnswerAnyway && <Button label={tr("chat.weak.answerAnyway")} variant="secondary" size="sm" onPress={onAnswerAnyway} />}
        {groups.length > 0 && (
          <Button
            label={tr(open ? "chat.weak.hideClosest" : "chat.weak.showClosest")}
            variant="ghost"
            size="sm"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((o) => !o)}
          />
        )}
      </View>
      {open && (
        <View style={{ gap: t.space.sm }}>
          <Text variant="label" color="secondary" header>
            {tr("chat.weak.closestTitle")}
          </Text>
          {groups.map((g) => (
            <View key={g.key} style={{ gap: t.space.xxs }}>
              <Text variant="subhead" numberOfLines={2}>
                {g.title}
              </Text>
              <MetaLine items={[sourceParts(answer.sources[g.indexes[0]].source).name, tr("chat.weak.weakMatch")]} variant="caption" />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** "Not a substitute for emergency services": under health and preparedness answers (Boar E-1). */
function EmergencyNote() {
  const t = useTokens();
  const { t: tr } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={tr("chat.safety.emergencyNote")}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: t.space.sm, paddingHorizontal: t.space.xs }}
    >
      <Icon name="alert-circle" size="sm" color={t.color.text.secondary} />
      <Text variant="footnote" color="secondary" style={{ flex: 1 }}>
        {tr("chat.safety.emergencyNote")}
      </Text>
    </View>
  );
}

function Notice({ tier, snippetShown, interrupted, onRetry }: { tier?: TierState; snippetShown: boolean; interrupted?: boolean; onRetry: () => void }) {
  const { t: tr } = useTranslation();
  if (!tier?.outcome) return null;
  if (interrupted || tier.outcome === "interrupted") {
    return <Banner tone="warning" message={tr("chat.notice.interrupted")} actionLabel={tr("chat.actions.retry")} onAction={onRetry} />;
  }
  switch (tier.outcome) {
    case "stopped":
      return <Banner tone="info" icon="square" message={tr(snippetShown && !tier.text ? "chat.notice.stoppedSnippet" : "chat.notice.stopped")} />;
    case "timeout":
      return <Banner tone="warning" message={tr("chat.notice.timeout")} actionLabel={tr("chat.actions.retry")} onAction={onRetry} />;
    case "error":
      return (
        <Banner
          tone="danger"
          message={tr(`chat.error.${tier.error?.code ?? "generic"}`)}
          actionLabel={tr("chat.actions.retry")}
          onAction={onRetry}
        />
      );
    default:
      return null;
  }
}

function InstantSnippet({
  answer,
  isFinal,
  onOpenSource,
}: {
  answer: AnswerState;
  isFinal: boolean;
  onOpenSource: (i: number) => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const snippet = answer.instant!;
  const source = answer.sources[snippet.sourceIndex - 1];
  // Collapses to a short preview once the model's answer is done, unless the user chose otherwise.
  const autoCollapsed = answer.fast?.outcome === "success" && !isFinal;
  const expanded = userExpanded ?? !autoCollapsed;
  return (
    <Card padding="sm" style={{ gap: t.space.xs }}>
      <Text variant="caption" color="field" weight="semibold" numberOfLines={1}>
        {source ? `${tr("chat.snippet.fromSource")} · ${source.title}` : tr("chat.snippet.fromSource")}
      </Text>
      <Text variant={isFinal ? "body" : "callout"} selectable>
        {expanded ? snippet.text : previewText(snippet.text)}
      </Text>
      <View style={{ flexDirection: "row", gap: t.space.sm, marginLeft: -t.space.md }}>
        {!isFinal && (
          <Button
            label={expanded ? tr("chat.snippet.showLess") : tr("chat.snippet.showMore")}
            variant="ghost"
            size="sm"
            accessibilityState={{ expanded }}
            onPress={() => setUserExpanded(!expanded)}
          />
        )}
        {source && (
          <Button
            label={`[${snippet.sourceIndex}]`}
            variant="ghost"
            size="sm"
            icon="book"
            accessibilityLabel={tr("chat.snippet.openSource", { n: snippet.sourceIndex, title: source.title })}
            onPress={() => onOpenSource(snippet.sourceIndex - 1)}
          />
        )}
      </View>
    </Card>
  );
}

export const AssistantMessage = memo(function AssistantMessage(props: AssistantMessageProps) {
  const { answer, active, stopping, interrupted, feedback, locale, onOpenSource } = props;
  const t = useTokens();
  const { t: tr } = useTranslation();
  const phase = answerPhase(answer);
  // No strong source: no [n] citations, even if weak passages came back (weak-sources spec rule 4).
  const sourceTitles = answer.weakSources ? [] : answer.sources.map((s) => s.title);
  const placesOnly = !!answer.places && !answer.fast;
  const extractiveOnly = !!answer.instantDone && !answer.fast && !answer.places;
  const instantOnly = !!answer.instantDone && !answer.fast;
  const lastTier = answer.deep ?? answer.fast;
  const hasText = !!(answer.fast?.text || answer.deep?.text || answer.instant || answer.places?.places.length);
  const done = !active && (lastTier?.outcome || instantOnly);
  const steps = active && !stopping ? generatingSteps(answer, tr) : null;
  const fastStreaming = active && !answer.deep && !answer.fast?.outcome;
  const deepStreaming = active && !!answer.deep && !answer.deep.outcome;

  const topReceipt = answer.fast?.receipt ?? (instantOnly ? answer.instantDone?.receipt : undefined);
  const receipt = useReceipt(topReceipt, locale, !!answer.weakSources);
  const locating = isLocating(answer);
  const waitingForCity = answer.places?.coverage === "needs_place" || locating;
  return (
    <View style={{ gap: t.space.md, alignSelf: "stretch" }}>
      <View style={{ gap: t.space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
          <Mascot size="avatarSm" />
          {/* The mockup's name in ember (Boar: the artifact wins over "one accent per screen"). */}
          <Text variant="headline" color="accent" style={{ flexShrink: 1 }}>
            {tr("chat.assistantName")}
          </Text>
          {/* Waiting for the user to pick a city: no clock, no receipt (nothing was answered yet). */}
          {waitingForCity || answer.weakDeclined ? null : active && !answer.deep ? <Elapsed locale={locale} step={steps?.find((x) => x.status === "active")?.short} /> : receipt ? <ReceiptToggle r={receipt} hidden={active} /> : null}
        </View>
        {receipt && !waitingForCity && !answer.weakDeclined && <ReceiptDetails r={receipt} onCopy={props.onCopyReceipt} />}
      </View>

      {answer.streamsFromStorage && <Banner tone="info" icon="hard-drive" message={tr("chat.notice.streamsFromStorage")} />}

      {locating && <LocatingPrompt onCity={props.onCity} />}

      {answer.places && (
        <PlacesCard
          answer={answer}
          locale={locale}
          onOpenSource={onOpenSource}
          onCity={props.onCity}
          onUseLocation={props.onUseLocation}
          onGetMap={props.onGetMap}
          focusCity={!!props.fresh}
        />
      )}

      {answer.instant && !answer.weakSources && <InstantSnippet answer={answer} isFinal={extractiveOnly} onOpenSource={onOpenSource} />}

      {/* The mockup's order: the steps above the streaming text, the sources below it. */}
      {!answer.deep && steps && <StepsCard steps={steps} />}
      {answer.fast && (
        <TierBody tier={answer.fast} streaming={fastStreaming} sourceTitles={sourceTitles} onOpenSource={onOpenSource} />
      )}
      <Notice tier={answer.fast} snippetShown={!!answer.instant} interrupted={interrupted && !answer.deep} onRetry={props.onRetry} />

      {answer.deep && (
        <View style={{ gap: t.space.sm, paddingTop: t.space.md, borderTopWidth: t.size.hairline, borderTopColor: t.color.line.hairline }}>
          <Text variant="label" color="accent" header>
            {tr("chat.deep.title")}
          </Text>
          {steps && <StepsCard steps={steps} />}
          <TierBody tier={answer.deep} streaming={deepStreaming} sourceTitles={sourceTitles} onOpenSource={onOpenSource} />
          <Notice tier={answer.deep} snippetShown={false} interrupted={interrupted} onRetry={props.onRetry} />
          {answer.deep.receipt && (
            <Receipt receipt={answer.deep.receipt} locale={locale} hidden={active} onCopy={props.onCopyReceipt} />
          )}
        </View>
      )}

      {instantOnly && answer.instantDone && answer.instantDone.outcome !== "success" && (
        <Banner
          tone={answer.instantDone.outcome === "error" ? "danger" : "info"}
          message={
            answer.instantDone.outcome === "error"
              ? tr(`chat.error.${answer.instantDone.error?.code ?? "generic"}`)
              : tr(`chat.notice.${answer.instantDone.outcome}`)
          }
          actionLabel={answer.instantDone.outcome === "stopped" ? undefined : tr("chat.actions.retry")}
          onAction={props.onRetry}
        />
      )}


      {answer.sources.length > 0 && !placesOnly && !answer.weakSources && <SourceList answer={answer} onOpenSource={onOpenSource} />}
      {answer.weakDeclined && !active && <DeclinedNoSource answer={answer} onAnswerAnyway={props.onAnswerAnyway} />}
      {answer.weakSources && !answer.weakDeclined && done && !placesOnly && <WeakSourceNote answer={answer} />}
      {showsEmergencyNote({
        question: props.question ?? "",
        sources: answer.sources,
        hasModelText: !!(answer.fast?.text || answer.deep?.text),
        hasSnippet: !!answer.instant,
        placesOnly,
        safety: answer.safety,
      }) && <EmergencyNote />}

      {done && hasText && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
          <IconButton
            icon="thumbs-up"
            variant="surface"
            size="sm"
            label={tr("chat.actions.helpful")}
            selected={feedback === "up"}
            accessibilityState={{ selected: feedback === "up" }}
            onPress={() => props.onRate("up")}
          />
          <IconButton
            icon="thumbs-down"
            variant="surface"
            size="sm"
            label={tr("chat.actions.unhelpful")}
            selected={feedback === "down"}
            accessibilityState={{ selected: feedback === "down" }}
            onPress={() => props.onRate("down")}
          />
          <IconButton icon="share-2" variant="surface" size="sm" label={tr("chat.actions.share")} onPress={props.onShare} />
          <View style={{ flex: 1 }} />
          {/* The mockup's "Copy response" pill: s1, caption in secondary. */}
          <Pressable
            onPress={props.onCopy}
            accessibilityRole="button"
            accessibilityLabel={tr("chat.actions.copyAnswer")}
            hitSlop={{ top: (t.size.touch - t.size.controlSm) / 2, bottom: (t.size.touch - t.size.controlSm) / 2 }}
            style={({ pressed }) => ({
              height: t.size.controlSm,
              flexDirection: "row",
              alignItems: "center",
              gap: t.space.xs,
              paddingHorizontal: t.space.md,
              borderRadius: t.radius.full,
              backgroundColor: pressed ? t.color.bg.raised : t.color.bg.surface,
            })}
          >
            <Icon name="copy" size="sm" color={t.color.text.secondary} />
            <Text variant="caption" color="secondary">
              {tr("chat.actions.copyAnswer")}
            </Text>
          </Pressable>
        </View>
      )}

      {!active && extractiveOnly && (
        <Button label={tr("chat.actions.askModel")} variant="secondary" icon="cpu" onPress={props.onAskModel} style={{ alignSelf: "flex-start" }} />
      )}
      {!active && phase === "done" && canDeepen(answer) && (
        // Not in the mockup: a quiet text link under the actions, so it doesn't compete with copying (Iris).
        <Pressable
          onPress={props.onDeepen}
          accessibilityRole="button"
          hitSlop={{ top: t.space.md, bottom: t.space.md }}
          style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: t.space.xs }}
        >
          <Icon name="layers" size="sm" color={t.color.text.secondary} />
          <Text variant="caption" color="secondary">
            {answer.deepAvailable?.estSeconds
              ? tr("chat.actions.deepenEst", { time: formatSeconds(answer.deepAvailable.estSeconds * 1000, locale) })
              : tr("chat.actions.deepen")}
          </Text>
        </Pressable>
      )}
    </View>
  );
});
