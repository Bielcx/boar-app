import React, { memo, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Badge, Banner, Button, Card, Icon, IconButton, Text } from "../components";
import { MarkdownMessage } from "../components/MarkdownMessage";
import { useTokens } from "../theme";
import { splitThinking } from "../../services/thinking";
import { cleanCitations } from "../../services/citations";
import { splitInlineBullets } from "../../services/answerFormat";
import { answerPhase, canDeepen, type AnswerState, type TierState } from "./answerReducer";
import { receiptDetails, receiptLine, receiptShort, stageLine } from "./presentation";
import { formatSeconds } from "./shareFormat";
import { PlacesCard } from "./PlacesCard";
import type { AnswerReceipt } from "./answerEvents";

export interface AssistantMessageProps {
  answer: AnswerState;
  /** This answer is the one running now. */
  active: boolean;
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

/**
 * What the answer is doing, as the mockup's step list: earlier steps checked
 * off above the current one, which spins. Visual only; the reader hears stage
 * changes through the screen's announcer.
 */
function Stage({ label }: { label: string }) {
  const t = useTokens();
  const trail = useRef<string[]>([]);
  if (trail.current[trail.current.length - 1] !== label) trail.current = [...trail.current.filter((l) => l !== label), label];
  const done = trail.current.slice(0, -1);
  return (
    <Card padding="sm" style={{ gap: t.space.sm }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {done.map((l) => (
        <View key={l} style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
          <Icon name="check" size="sm" color={t.color.text.field} />
          <Text variant="footnote" color="secondary" style={{ flex: 1 }}>
            {l}
          </Text>
        </View>
      ))}
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
        <ActivityIndicator size="small" color={t.color.field.solid} />
        <Text variant="footnote" weight="semibold" style={{ flex: 1 }}>
          {label}
        </Text>
      </View>
    </Card>
  );
}

/** Seconds since the answer started, next to the name while it runs (the receipt takes its place when done). */
function Elapsed({ locale }: { locale: string }) {
  const seconds = useElapsedSeconds(true);
  return (
    <Text variant="mono" color="secondary" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {formatSeconds(seconds * 1000, locale)}
    </Text>
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
function useReceipt(receipt: AnswerReceipt | undefined, locale: string) {
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!receipt) return null;
  return {
    open,
    toggle: () => setOpen((o) => !o),
    short: receiptShort(receipt, locale),
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
      <Text variant="mono" color="secondary">
        {r.short}
      </Text>
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

/**
 * The answer's sources as the mockup's card: a header with the count, then
 * numbered rows that expand in place into a well with where the passage comes
 * from and its first lines. The full passage opens in the source sheet.
 */
function SourceList({ answer, onOpenSource }: { answer: AnswerState; onOpenSource: (i: number) => void }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <Card padding="sm" style={{ gap: t.space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm, paddingHorizontal: t.space.xs }}>
        <Icon name="book-open" size="sm" color={t.color.text.field} />
        <Text variant="label" color="field" header style={{ flex: 1 }}>
          {tr("chat.sources.heading")}
        </Text>
        <Badge label={String(answer.sources.length)} tone="field" />
      </View>
      {answer.sources.map((s, i) => {
        const open = expanded === i;
        const origin = s.collectionId ? tr("chat.sources.myDocuments") : s.source || tr("chat.sources.corpus");
        return (
          <View
            key={s.chunkId}
            style={{
              borderRadius: t.radius.md,
              borderWidth: t.size.border,
              borderColor: open ? t.color.field.solid : "transparent",
              backgroundColor: open ? t.color.bg.raised : undefined,
            }}
          >
            <Pressable
              onPress={() => setExpanded(open ? null : i)}
              accessibilityRole="button"
              accessibilityLabel={tr("chat.sources.chip", { n: i + 1, title: s.title })}
              accessibilityHint={tr("chat.sources.expandHint")}
              accessibilityState={{ expanded: open }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: t.space.sm,
                minHeight: t.size.touch,
                paddingHorizontal: t.space.sm,
                borderRadius: t.radius.md,
                backgroundColor: pressed ? t.color.bg.sunken : undefined,
              })}
            >
              <View
                style={{
                  minWidth: t.size.iconLg,
                  minHeight: t.size.iconLg,
                  paddingHorizontal: t.space.xs,
                  borderRadius: t.radius.full,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: t.color.field.soft,
                }}
              >
                <Text variant="caption" color="field" weight="semibold" numeric maxFontSizeMultiplier={1.5}>
                  {i + 1}
                </Text>
              </View>
              <Text variant="subhead" numberOfLines={open ? undefined : 1} style={{ flex: 1 }}>
                {s.title}
              </Text>
              <Icon name={open ? "chevron-up" : "chevron-down"} size="sm" color={t.color.text.secondary} />
            </Pressable>
            {open && (
              <View style={{ gap: t.space.xs, paddingHorizontal: t.space.md, paddingBottom: t.space.md }}>
                <Text variant="label" color="field" numberOfLines={1}>
                  {origin}
                </Text>
                <Text variant="footnote" numberOfLines={4}>
                  {s.body}
                </Text>
                <Button
                  label={tr("chat.sources.fullPassage")}
                  variant="ghost"
                  size="sm"
                  icon="maximize-2"
                  style={{ alignSelf: "flex-start", marginLeft: -t.space.md }}
                  onPress={() => onOpenSource(i)}
                />
              </View>
            )}
          </View>
        );
      })}
    </Card>
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
  // Collapses to one line once the model's answer is done, unless the user chose otherwise.
  const autoCollapsed = answer.fast?.outcome === "success" && !isFinal;
  const expanded = userExpanded ?? !autoCollapsed;
  return (
    <Card level={0} padding="sm" style={{ gap: t.space.xs, backgroundColor: t.color.field.soft, borderColor: t.color.field.soft }}>
      <Text variant="caption" color="field" weight="semibold" numberOfLines={1}>
        {source ? `${tr("chat.snippet.fromSource")} · ${source.title}` : tr("chat.snippet.fromSource")}
      </Text>
      <Text variant={isFinal ? "body" : "callout"} numberOfLines={expanded ? undefined : 1} selectable>
        {snippet.text}
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
  const sourceTitles = answer.sources.map((s) => s.title);
  const placesOnly = !!answer.places && !answer.fast;
  const extractiveOnly = !!answer.instantDone && !answer.fast && !answer.places;
  const instantOnly = !!answer.instantDone && !answer.fast;
  const lastTier = answer.deep ?? answer.fast;
  const hasText = !!(answer.fast?.text || answer.deep?.text || answer.instant || answer.places?.places.length);
  const done = !active && (lastTier?.outcome || instantOnly);
  const stage = active ? (stopping ? tr("chat.stage.stopping") : stageLine(answer, tr)) : null;
  const fastStreaming = active && !answer.deep && !answer.fast?.outcome;
  const deepStreaming = active && !!answer.deep && !answer.deep.outcome;

  const topReceipt = answer.fast?.receipt ?? (instantOnly ? answer.instantDone?.receipt : undefined);
  const receipt = useReceipt(topReceipt, locale);
  return (
    <View style={{ gap: t.space.md, alignSelf: "stretch" }}>
      <View style={{ gap: t.space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
          <View
            style={{
              width: t.space.xxl,
              height: t.space.xxl,
              borderRadius: t.radius.full,
              backgroundColor: t.color.bg.surface,
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <Image
              source={require("../../../assets/boar.png")}
              style={{ width: t.space.xl, height: t.space.xl }}
              accessibilityIgnoresInvertColors
              importantForAccessibility="no"
            />
          </View>
          <Text variant="headline" style={{ flexShrink: 1 }}>
            {tr("chat.assistantName")}
          </Text>
          {active && !answer.deep ? <Elapsed locale={locale} /> : receipt ? <ReceiptToggle r={receipt} hidden={active} /> : null}
        </View>
        {receipt && <ReceiptDetails r={receipt} onCopy={props.onCopyReceipt} />}
      </View>

      {answer.streamsFromStorage && <Banner tone="info" icon="hard-drive" message={tr("chat.notice.streamsFromStorage")} />}

      {answer.places && (
        <PlacesCard
          answer={answer}
          locale={locale}
          onOpenSource={onOpenSource}
          onCity={props.onCity}
          onUseLocation={props.onUseLocation}
          onGetMap={props.onGetMap}
        />
      )}

      {answer.instant && <InstantSnippet answer={answer} isFinal={extractiveOnly} onOpenSource={onOpenSource} />}

      {answer.fast && (
        <TierBody tier={answer.fast} streaming={fastStreaming} sourceTitles={sourceTitles} onOpenSource={onOpenSource} />
      )}
      {!answer.deep && stage && <Stage label={stage} />}
      <Notice tier={answer.fast} snippetShown={!!answer.instant} interrupted={interrupted && !answer.deep} onRetry={props.onRetry} />

      {answer.deep && (
        <View style={{ gap: t.space.sm, paddingTop: t.space.md, borderTopWidth: t.size.hairline, borderTopColor: t.color.line.hairline }}>
          <Text variant="label" color="accent" header>
            {tr("chat.deep.title")}
          </Text>
          <TierBody tier={answer.deep} streaming={deepStreaming} sourceTitles={sourceTitles} onOpenSource={onOpenSource} />
          {stage && <Stage label={stage} />}
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


      {answer.sources.length > 0 && !placesOnly && <SourceList answer={answer} onOpenSource={onOpenSource} />}

      {done && hasText && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.xs, marginLeft: -t.space.sm }}>
          <IconButton
            icon="thumbs-up"
            label={tr("chat.actions.helpful")}
            selected={feedback === "up"}
            accessibilityState={{ selected: feedback === "up" }}
            onPress={() => props.onRate("up")}
          />
          <IconButton
            icon="thumbs-down"
            label={tr("chat.actions.unhelpful")}
            selected={feedback === "down"}
            accessibilityState={{ selected: feedback === "down" }}
            onPress={() => props.onRate("down")}
          />
          <View style={{ flex: 1 }} />
          <IconButton icon="share-2" label={tr("chat.actions.share")} onPress={props.onShare} />
          <Button label={tr("chat.actions.copyAnswer")} variant="secondary" size="sm" icon="copy" onPress={props.onCopy} />
        </View>
      )}

      {!active && extractiveOnly && (
        <Button label={tr("chat.actions.askModel")} variant="secondary" icon="cpu" onPress={props.onAskModel} style={{ alignSelf: "flex-start" }} />
      )}
      {!active && phase === "done" && canDeepen(answer) && (
        <Button
          label={
            answer.deepAvailable?.estSeconds
              ? tr("chat.actions.deepenEst", { time: formatSeconds(answer.deepAvailable.estSeconds * 1000, locale) })
              : tr("chat.actions.deepen")
          }
          variant="secondary"
          icon="layers"
          onPress={props.onDeepen}
          style={{ alignSelf: "flex-start" }}
        />
      )}
    </View>
  );
});
