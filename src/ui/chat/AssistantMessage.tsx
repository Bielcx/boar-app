import React, { memo, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Banner, Button, Card, Chip, IconButton, Progress, Text } from "../components";
import { MarkdownMessage } from "../components/MarkdownMessage";
import { useTokens } from "../theme";
import { splitThinking } from "../../services/thinking";
import { cleanCitations } from "../../services/citations";
import { splitInlineBullets } from "../../services/answerFormat";
import { answerPhase, canDeepen, type AnswerState, type TierState } from "./answerReducer";
import { receiptDetails, receiptLine, stageLine } from "./presentation";
import { formatSeconds } from "./shareFormat";
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

function Stage({ label }: { label: string }) {
  const t = useTokens();
  return (
    <View style={{ gap: t.space.sm, paddingVertical: t.space.xs }}>
      <Text variant="callout" color="secondary">
        {label}
      </Text>
      <Progress label={label} tone="field" height={3} />
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
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const line = receiptLine(receipt, locale, tr);
  const details = receiptDetails(receipt, locale, tr);
  return (
    <View
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      accessibilityElementsHidden={hidden}
      style={{ gap: t.space.xs }}
    >
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${tr("chat.receipt.details")}: ${line}`}
        accessibilityState={{ expanded: open }}
        hitSlop={{ top: 12, bottom: 12 }}
      >
        <Text variant="caption" color="tertiary" numeric>
          {line}
        </Text>
      </Pressable>
      {open && (
        <View style={{ gap: t.space.xxs }}>
          {details.map((d) => (
            <Text key={d.label} variant="caption" color="tertiary" numeric>
              {`${d.label}: ${d.value}`}
            </Text>
          ))}
          <Button
            label={tr("chat.receipt.copy")}
            variant="ghost"
            size="sm"
            icon="copy"
            style={{ alignSelf: "flex-start" }}
            onPress={() => onCopy([line, ...details.map((d) => `${d.label}: ${d.value}`)].join("\n"))}
          />
        </View>
      )}
    </View>
  );
}

function SourceStrip({ answer, onOpenSource }: { answer: AnswerState; onOpenSource: (i: number) => void }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  return (
    <View style={{ gap: t.space.xs }}>
      <Text variant="label" color="field">
        {tr("chat.sources.title", { count: answer.sources.length })}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.space.sm }}>
        {answer.sources.map((s, i) => (
          <Chip
            key={s.chunkId}
            label={`${i + 1}  ${s.title}`}
            icon={s.collectionId ? "file-text" : "book"}
            tone="field"
            onPress={() => onOpenSource(i)}
            accessibilityLabel={tr("chat.sources.chip", { n: i + 1, title: s.title })}
          />
        ))}
      </ScrollView>
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
  const extractiveOnly = !!answer.extractiveReceipt && !answer.fast;
  const lastTier = answer.deep ?? answer.fast;
  const hasText = !!(answer.fast?.text || answer.deep?.text || answer.instant);
  const done = !active && (lastTier?.outcome || extractiveOnly);
  const stage = active ? (stopping ? tr("chat.stage.stopping") : stageLine(answer, tr)) : null;
  const fastStreaming = active && !answer.deep && !answer.fast?.outcome;
  const deepStreaming = active && !!answer.deep && !answer.deep.outcome;

  return (
    <View style={{ gap: t.space.md, alignSelf: "stretch" }}>
      {answer.streamsFromStorage && <Banner tone="info" icon="hard-drive" message={tr("chat.notice.streamsFromStorage")} />}

      {answer.instant && <InstantSnippet answer={answer} isFinal={extractiveOnly} onOpenSource={onOpenSource} />}

      {answer.fast && (
        <TierBody tier={answer.fast} streaming={fastStreaming} sourceTitles={sourceTitles} onOpenSource={onOpenSource} />
      )}
      {!answer.deep && stage && <Stage label={stage} />}
      <Notice tier={answer.fast} snippetShown={!!answer.instant} interrupted={interrupted && !answer.deep} onRetry={props.onRetry} />
      {answer.fast?.receipt && (
        <Receipt receipt={answer.fast.receipt} locale={locale} hidden={active} onCopy={props.onCopyReceipt} />
      )}

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

      {extractiveOnly && answer.extractiveReceipt && (
        <Receipt receipt={answer.extractiveReceipt} locale={locale} hidden={active} onCopy={props.onCopyReceipt} />
      )}

      {answer.sources.length > 0 && <SourceStrip answer={answer} onOpenSource={onOpenSource} />}

      {done && hasText && (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginLeft: -t.space.sm }}>
          <IconButton icon="copy" label={tr("chat.actions.copy")} onPress={props.onCopy} />
          <IconButton icon="share-2" label={tr("chat.actions.share")} onPress={props.onShare} />
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
