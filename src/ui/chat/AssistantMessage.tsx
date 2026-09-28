import React, { memo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Badge, Banner, Button, Card, Icon, IconButton, IconSlot, IconText, LARGE_TEXT_SCALE, LineSlot, Mascot, MetaLine, Text, TextAction, useOpticalLine, type IconName } from "../components";
import { MarkdownMessage } from "../components/MarkdownMessage";
import { icon, useTheme, useTokens } from "../theme";
import { META_SEPARATOR, metaItems } from "../components/metaItems";
import { splitThinking } from "../../services/thinking";
import { cleanCitations } from "../../services/citations";
import { splitInlineBullets } from "../../services/answerFormat";
import { answerPhase, canDeepen, isLocating, noSourceKind, type AnswerState, type TierState } from "./answerReducer";
import { declineAfterSnippet, declineCopy, generatingSteps, showsAnswerBody, noSourceNote, offersAskModel, receiptTagKey, showsInstantSnippet, sourceLanguageLead, previewText, receiptDetails, receiptLine, receiptShort, type GeneratingStep } from "./presentation";
import { answerSourceSplit, groupSources, sourcesCardMode, relevanceBands, bestBand, BAND_FILL, sourceParts, type RelevanceBand } from "./sourceLabel";
import { answerShowsEmergencyNote } from "./safetyNote";
import { weakNoteShowsBody } from "./uncitedPreface";
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
  /** Waiting for the offline library to be ready before searching (first boot); the current status line. */
  waitingLibrary?: string;
  /** The library's indexing failed part-way: "not found" must say the library is incomplete (Prism). */
  libraryIncomplete?: boolean;
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
  // Icon-align round: leading icon and trailing status on the optical centre of the label's first line.
  const line = useOpticalLine("footnote");
  return (
    <Card padding="compact" radius="card" style={{ gap: t.space.sm }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {steps.map((s) => (
        <View key={s.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: icon.gap }}>
          <IconSlot name={s.icon} line={line} color={s.status === "active" ? t.color.accent.solid : t.color.text.secondary} />
          <Text variant="footnote" weight={s.status === "active" ? "semibold" : "regular"} color={s.status === "pending" ? "secondary" : "primary"} style={{ flex: 1 }}>
            {s.label}
          </Text>
          {s.status === "done" ? (
            <IconSlot name="check" line={line} color={t.color.status.success.solid} edge="end" />
          ) : (
            <LineSlot line={line}>
              {s.status === "active" ? (
                <StepSpinner />
              ) : (
                <View style={{ width: t.space.sm, height: t.space.sm, borderRadius: t.radius.full, backgroundColor: t.color.line.hairline }} />
              )}
            </LineSlot>
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
        justifyContent: "center",
        paddingHorizontal: t.space.sm,
        paddingVertical: t.space.xs,
        borderRadius: t.radius.full,
        backgroundColor: t.color.bg.surface,
      }}
    >
      {/* A pill (Iris icon-align): seal-sized icon, tight gap, the pair on the pill's optical middle. */}
      <IconText icon="loader" variant="caption" color="secondary" iconColor={t.color.text.secondary} iconRole="seal" gap="tight" centerOnBox numeric>
        {metaItems([step, formatSeconds(seconds * 1000, locale)]).join(META_SEPARATOR)}
      </IconText>
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
function useReceipt(receipt: AnswerReceipt | undefined, locale: string, tagKey: string | null = null) {
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!receipt) return null;
  return {
    open,
    toggle: () => setOpen((o) => !o),
    // "general knowledge" / "no source cited" after the numbers (weak-sources spec, Iris CT-5).
    short: tagKey ? [...receiptShort(receipt, locale), tr(tagKey)] : receiptShort(receipt, locale),
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

const BANDS: RelevanceBand[] = ["high", "medium", "low"];

/**
 * The mockup's relevance bar, in three steps with the band's name; nothing without a measured value.
 * Iris: the label column is as wide as the widest band in this language (all three share one cell,
 * the others invisible at zero height), so bars line up across rows and at any font size; it never
 * shrinks (the title gives way); "Low" is secondary, amber reads as strong provenance.
 */
function RelevanceBar({ band }: { band: RelevanceBand | null }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  if (band == null) return null;
  const track = t.space.xxl + t.space.xs;
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm, flexShrink: 0 }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <View style={{ width: track, height: t.space.xs, borderRadius: t.radius.full, backgroundColor: t.color.bg.raised, overflow: "hidden" }}>
        <View style={{ width: track * BAND_FILL[band], height: "100%", borderRadius: t.radius.full, backgroundColor: t.color.field.solid }} />
      </View>
      <View>
        {BANDS.map((b) => (
          <Text
            key={b}
            variant="caption"
            weight="semibold"
            color={band === "low" ? "secondary" : "field"}
            numberOfLines={1}
            style={b === band ? undefined : { height: 0, opacity: 0 }}
            // Sizing only: never read (the row's label already says "relevance high").
            accessibilityElementsHidden={b !== band}
            importantForAccessibility={b === band ? "auto" : "no-hide-descendants"}
          >
            {tr(`chat.sources.band.${b}`)}
          </Text>
        ))}
      </View>
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
function SourceList({
  answer,
  onOpenSource,
  only,
  related,
}: {
  answer: AnswerState;
  onOpenSource: (i: number) => void;
  /** CT-2: only the sources the final text cites; undefined shows every source. */
  only?: number[];
  related?: number[];
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = groupSources(answer.sources, only);
  const labelLine = useOpticalLine("label");
  // Prism AX-2/AX-3: at large text the row stacks (number + title on the full width, up to 2 lines;
  // band and chevron below) and the title loses the number's indent, so no word breaks mid-way.
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= LARGE_TEXT_SCALE;
  // Measured relevance only (Boar), as a band (Tusk: the raw value's scale depends on the query); none without it.
  const bands = relevanceBands(answer.sources);
  return (
    <Card padding="sm" style={{ gap: t.space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm, paddingHorizontal: t.space.xs }}>
        {/* Icon on the label's optical line; the count badge centres on the row. */}
        <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", gap: icon.gap }}>
          <IconSlot name="book-open" line={labelLine} color={t.color.text.field} />
          <Text variant="label" header style={{ flex: 1 }}>
            {tr("chat.sources.heading")}
          </Text>
        </View>
        <Badge label={String(only?.length ?? answer.sources.length)} tone="field" emphasis="solid" />
      </View>
      {groups.map((g) => {
        const open = expanded === g.key;
        const first = answer.sources[g.indexes[0]];
        const parts = sourceParts(first.source);
        const origin = first.collectionId ? tr("chat.sources.myDocuments") : parts.name ?? tr("chat.sources.corpus");
        const numbers = g.indexes.map((i) => i + 1).join(", ");
        const passages = g.indexes.length;
        const groupBand = bestBand(g.indexes.map((i) => bands[i]));
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
                (groupBand ? `, ${tr("chat.sources.relevance", { band: tr(`chat.sources.band.${groupBand}`) })}` : "")
              }
              accessibilityHint={tr("chat.sources.expandHint")}
              accessibilityState={{ expanded: open }}
              style={({ pressed }) => ({
                flexDirection: stacked ? "column" : "row",
                alignItems: stacked ? "stretch" : "center",
                gap: t.space.sm,
                minHeight: t.size.controlSm,
                paddingHorizontal: t.space.sm,
                paddingVertical: t.space.xs,
                borderRadius: t.radius.md,
                backgroundColor: pressed ? t.color.bg.sunken : undefined,
              })}
              hitSlop={{ top: (t.size.touch - t.size.controlSm) / 2, bottom: (t.size.touch - t.size.controlSm) / 2 }}
            >
              {stacked ? (
                <>
                  <Text variant="footnote" numberOfLines={open ? undefined : 2}>
                    <Text variant="footnote" weight="semibold" numeric>{`${g.indexes[0] + 1}  `}</Text>
                    {g.title}
                  </Text>
                  {passages > 1 && <MetaLine items={[tr("chat.sources.passages", { count: passages })]} variant="caption" />}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
                    <RelevanceBar band={groupBand} />
                    <View style={{ flex: 1 }} />
                    <Icon name={open ? "chevron-up" : "chevron-down"} size="sm" color={t.color.text.secondary} edge="end" />
                  </View>
                </>
              ) : (
                <>
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
                <RelevanceBar band={groupBand} />
                <Icon name={open ? "chevron-up" : "chevron-down"} size="sm" color={t.color.text.secondary} edge="end" />
                </>
              )}
            </Pressable>
            {open && (
              <View style={{ gap: t.space.sm, paddingHorizontal: t.space.md, paddingBottom: t.space.md }}>
                {/* The mockup's overline line: where it comes from on the left, its path on the right. */}
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: icon.gap }}>
                  {/* Iris: the caps origin shrinks before it touches the icon; one gap token. */}
                  <Text variant="label" color="field" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {origin}
                  </Text>
                  {parts.url && (
                    <Text variant="caption" color="secondary" numberOfLines={1} ellipsizeMode="middle" selectable style={{ flex: 1, textAlign: "right" }}>
                      {parts.url.replace(/^https?:\/\/(www\.)?/, "")}
                    </Text>
                  )}
                  {/* Says the passage below opens the full source (Iris). */}
                  {!parts.url && <View style={{ flex: 1 }} />}
                  <IconSlot name="maximize-2" line={labelLine} color={t.color.text.secondary} edge="end" />
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
      {related && related.length > 0 && <RelatedSources answer={answer} indexes={related} />}
    </Card>
  );
}

/**
 * Retrieved but not cited (Prism CT-2): collapsed under "Related in your library", no number
 * (they are not citations), no percentage, no amber. Inside the sources card, or alone in its
 * slot when the answer cites nothing.
 */
function RelatedSources({ answer, indexes }: { answer: AnswerState; indexes: number[] }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = groupSources(answer.sources, indexes);
  return (
    <View style={{ gap: t.space.sm }}>
      {/* Neutral text action, no ember inside the amber card (Iris). */}
      <View style={{ paddingHorizontal: t.space.sm }}>
        <TextAction
          label={tr(open ? "chat.sources.hideRelated" : "chat.sources.related", { count: groups.length })}
          icon={open ? "chevron-up" : "chevron-down"}
          expanded={open}
          onPress={() => setOpen((o) => !o)}
        />
      </View>
      {open &&
        groups.map((g) => (
          <View key={g.key} style={{ gap: t.space.xxs, paddingHorizontal: t.space.sm }}>
            <Text variant="footnote" numberOfLines={2}>
              {g.title}
            </Text>
            <MetaLine items={[sourceParts(answer.sources[g.indexes[0]].source).name ?? tr("chat.sources.corpus")]} variant="caption" />
          </View>
        ))}
    </View>
  );
}

/**
 * No strong source on this phone (Iris, specs/weak-sources.md): in the source card's slot, a
 * neutral note (no amber: amber means provenance, and there is none), one focus for readers.
 * "Show closest passages" only when the engine still returned some, marked as weak, unnumbered.
 */
function WeakSourceNote({ answer, incomplete, uncited }: { answer: AnswerState; incomplete?: boolean; uncited?: boolean }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = groupSources(answer.sources);
  // The engine's text already opens with "not from an offline source" (Tusk 4375d76): keep only the
  // marker where the sources would be, not the same sentence twice (Iris).
  const saidInText = !weakNoteShowsBody((answer.deep ?? answer.fast)?.text);
  // CT-5: passages on the topic were found but the model cited none: say that, not "nothing matched".
  const title = tr(uncited ? "chat.weak.titleUncited" : "chat.weak.title");
  const body = tr(uncited ? "chat.weak.bodyUncited" : incomplete ? "chat.weak.bodyIncomplete" : "chat.weak.body");
  return (
    <Card radius="card" padding="compact" style={{ gap: t.space.sm }}>
      {/* The marker is read, never decorative (Iris/Prism): "No strong source on this phone". */}
      <View accessible accessibilityRole="text" accessibilityLabel={saidInText ? title : `${title}. ${body}`} style={{ gap: t.space.sm }}>
        <IconText icon="book" variant="label" color="secondary" iconColor={t.color.text.secondary}>
          {title}
        </IconText>
        {!saidInText && (
          <Text variant="footnote" color="secondary">
            {body}
          </Text>
        )}
      </View>
      {groups.length > 0 && (
        <TextAction
          // CT-5 (Iris): these are the passages found, not the closest of a weak search.
          label={
            uncited
              ? tr(open ? "chat.weak.hideFound" : "chat.weak.showFound", { count: groups.length })
              : tr(open ? "chat.weak.hideClosest" : "chat.weak.showClosest")
          }
          icon={open ? "chevron-up" : "chevron-down"}
          expanded={open}
          onPress={() => setOpen((o) => !o)}
        />
      )}
      {open && (
        <View style={{ gap: t.space.sm }}>
          <Text variant="label" color="secondary" header>
            {tr(uncited ? "chat.weak.foundTitle" : "chat.weak.closestTitle")}
          </Text>
          {groups.map((g) => (
            <View key={g.key} style={{ gap: t.space.xxs }}>
              <Text variant="footnote" numberOfLines={2}>
                {g.title}
              </Text>
              <MetaLine
                items={uncited ? [sourceParts(answer.sources[g.indexes[0]].source).name] : [sourceParts(answer.sources[g.indexes[0]].source).name, tr("chat.weak.weakMatch")]}
                variant="caption"
              />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/**
 * The decline under the library's own passage (declineAfterSnippet): one quiet line, no card, no
 * error icon. The passage above is the answer; "Answer anyway" is a link in the passage's own link
 * style ("Show more": ghost, ember text), so it reads as tappable next to the grey line (Boar, prints v1.1).
 */
function HeldAfterSnippet({ onAnswerAnyway }: { onAnswerAnyway?: () => void }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  return (
    <View style={{ alignItems: "flex-start" }}>
      <Text variant="footnote" color="secondary">
        {tr("chat.weak.heldAfterSnippet")}
      </Text>
      {onAnswerAnyway && (
        <View style={{ marginLeft: -t.space.md }}>
          <Button label={tr("chat.weak.answerAnyway")} accessibilityHint={tr("chat.weak.answerAnywayHint")} variant="ghost" size="sm" onPress={onAnswerAnyway} />
        </View>
      )}
    </View>
  );
}

/**
 * Weak-sources state A (Iris spec, Boar's decision): the compact model found nothing in this phone's
 * library and didn't guess. The card is the answer; "Answer anyway (may be wrong)" generates for the
 * same question (state B). No receipt, no primary ember, no amber.
 */
function DeclinedNoSource({ answer, onAnswerAnyway, incomplete }: { answer: AnswerState; onAnswerAnyway?: () => void; incomplete?: boolean }) {
  // Found but unsupported (Tusk 237764a) or nothing found: the card says which.
  const { title, body } = declineCopy(answer, incomplete);
  const found = answer.sources.length > 0;
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = groupSources(answer.sources);
  return (
    <Card radius="card" padding="compact" style={{ gap: t.space.sm }}>
      <View accessible accessibilityLabel={`${tr(title)}. ${tr(body)}`} style={{ gap: t.space.sm }}>
        <IconText icon="search" variant="cardTitle" iconColor={t.color.text.secondary}>
          {tr(title)}
        </IconText>
        <Text variant="footnote" color="secondary">
          {tr(body)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space.sm }}>
        {onAnswerAnyway && (
          <Button
            label={tr("chat.weak.answerAnyway")}
            accessibilityHint={tr("chat.weak.answerAnywayHint")}
            variant="secondary"
            size="sm"
            onPress={onAnswerAnyway}
          />
        )}
        {groups.length > 0 && (
          <Button
            label={found ? tr(open ? "chat.weak.hideFound" : "chat.weak.showFound", { count: groups.length }) : tr(open ? "chat.weak.hideClosest" : "chat.weak.showClosest")}
            variant="ghost"
            size="sm"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((o) => !o)}
          />
        )}
      </View>
      {/* The warning lives under the button, not inside it (Boar copy rule). */}
      {onAnswerAnyway && (
        <Text variant="caption" color="secondary" importantForAccessibility="no" accessibilityElementsHidden>
          {tr("chat.weak.answerAnywayHint")}
        </Text>
      )}
      {open && (
        <View style={{ gap: t.space.sm }}>
          <Text variant="label" color="secondary" header>
            {tr(found ? "chat.weak.foundTitle" : "chat.weak.closestTitle")}
          </Text>
          {groups.map((g) => (
            <View key={g.key} style={{ gap: t.space.xxs }}>
              <Text variant="footnote" numberOfLines={2}>
                {g.title}
              </Text>
              <MetaLine
                items={found ? [sourceParts(answer.sources[g.indexes[0]].source).name] : [sourceParts(answer.sources[g.indexes[0]].source).name, tr("chat.weak.weakMatch")]}
                variant="caption"
              />
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
      style={{ paddingHorizontal: t.space.xs }}
    >
      <IconText icon="alert-circle" variant="footnote" color="secondary" iconColor={t.color.text.secondary}>
        {tr("chat.safety.emergencyNote")}
      </IconText>
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
  // The engine's "(em inglês)" lead moves to the header; the body is the passage itself.
  const { lang, body } = sourceLanguageLead(snippet.text);
  // 0-based, as the engine sends it ("[n]" = sourceIndex + 1).
  const source = answer.sources[snippet.sourceIndex];
  // Collapses to a short preview once the model's answer is done, unless the user chose otherwise.
  const autoCollapsed = answer.fast?.outcome === "success" && !isFinal;
  const expanded = userExpanded ?? !autoCollapsed;
  return (
    <Card padding="sm" style={{ gap: t.space.xs }}>
      <Text variant="caption" color="field" weight="semibold" numberOfLines={1}>
        {[lang ? `${tr("chat.snippet.fromSource")} (${lang})` : tr("chat.snippet.fromSource"), source?.title].filter(Boolean).join(" · ")}
      </Text>
      <Text variant={isFinal ? "body" : "callout"} selectable>
        {/* FMT-1: a pack's list flattened to " - " reads as a list again. */}
        {expanded ? splitInlineBullets(body) : previewText(body)}
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
            label={`[${snippet.sourceIndex + 1}]`}
            variant="ghost"
            size="sm"
            icon="book"
            accessibilityLabel={tr("chat.snippet.openSource", { n: snippet.sourceIndex + 1, title: source.title })}
            onPress={() => onOpenSource(snippet.sourceIndex)}
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
  // Nothing on the topic ("weak") or found but not cited ("uncited"): no sources card, a note instead.
  const sourceless = noSourceKind(answer);
  // No strong source: no [n] citations (weak-sources spec rule 4).
  const sourceTitles = sourceless === "weak" ? [] : answer.sources.map((s) => s.title);

  const placesOnly = !!answer.places && !answer.fast;
  const largeText = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;
  const note = noSourceNote(answer, placesOnly);
  const split = answerSourceSplit(answer);
  const cardMode = sourcesCardMode(!!active, split);
  const extractiveOnly = !!answer.instantDone && !answer.fast && !answer.places;
  const instantOnly = !!answer.instantDone && !answer.fast;
  const lastTier = answer.deep ?? answer.fast;
  // A decline has no answer of its own to rate, share or copy: its card is the whole message.
  const hasText =
    showsAnswerBody(answer) && !!(answer.fast?.text || answer.deep?.text || answer.instant || answer.extract || answer.places?.places.length);
  const done = !active && (lastTier?.outcome || instantOnly);
  const steps = active && !stopping ? generatingSteps(answer, tr) : null;
  const fastStreaming = active && !answer.deep && !answer.fast?.outcome;
  const deepStreaming = active && !!answer.deep && !answer.deep.outcome;

  const topReceipt = answer.fast?.receipt ?? (instantOnly ? answer.instantDone?.receipt : undefined);
  const receipt = useReceipt(topReceipt, locale, receiptTagKey(answer));
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
          {waitingForCity || answer.weakDeclined ? null : active && !answer.deep ? (
            <Elapsed
              locale={locale}
              // Waiting for the library, nothing is searched yet: the pill says so (Prism HX-2).
              step={props.waitingLibrary ? tr("chat.stepShort.prepare") : steps?.find((x) => x.status === "active")?.short}
            />
          ) : receipt ? <ReceiptToggle r={receipt} hidden={active} /> : null}
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

      {showsInstantSnippet(answer) && <InstantSnippet answer={answer} isFinal={extractiveOnly} onOpenSource={onOpenSource} />}
      {/* NB-1: health/safety answers are the source's literal excerpt, with its [n], no model. */}
      {answer.extract ? (
        <TierBody
          tier={{ text: answer.extract, stage: null, outcome: answer.instantDone?.outcome }}
          streaming={!answer.instantDone}
          sourceTitles={sourceTitles}
          onOpenSource={onOpenSource}
        />
      ) : null}

      {/* First boot: the question waits for the library to be indexed, instead of searching an empty one. */}
      {props.waitingLibrary ? (
        <Card padding="compact" radius="card" style={{ gap: t.space.xs }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
            <StepSpinner />
            <Text variant="footnote" weight="semibold" style={{ flex: 1 }}>
              {tr("chat.stage.waitingLibrary")}
            </Text>
          </View>
          <Text variant="caption" color="secondary">
            {props.waitingLibrary}
          </Text>
        </Card>
      ) : null}
      {/* The mockup's order: the steps above the streaming text, the sources below it. */}
      {!answer.deep && steps && !props.waitingLibrary && <StepsCard steps={steps} />}
      {answer.fast && showsAnswerBody(answer) && (
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


      {/* Right under the text, before the sources (Iris, Prism NB-1): on a risky answer it weighs more than the list. */}
      {answerShowsEmergencyNote(answer, props.question ?? "", placesOnly) && <EmergencyNote />}

      {answer.sources.length > 0 && !placesOnly && !sourceless && (
        // CT-2: once the engine says which [n] stayed, the card lists only those; nothing cited = no card.
        // While it writes, only the count (Prism): no list that could shrink, no passage shown as a source yet.
        cardMode === "found" ? (
          <Card radius="card" padding="compact">
            <IconText icon="book-open" variant="footnote" color="secondary" iconColor={t.color.text.secondary}>
              {tr("chat.sources.found", { count: answer.sources.length })}
            </IconText>
          </Card>
        ) : cardMode === "related" && split ? (
          <Card radius="card" padding="compact">
            <RelatedSources answer={answer} indexes={split.related} />
          </Card>
        ) : (
          <SourceList answer={answer} onOpenSource={onOpenSource} only={split?.cited} related={split?.related} />
        )
      )}
      {answer.weakDeclined && !active &&
        (declineAfterSnippet(answer) ? (
          <HeldAfterSnippet onAnswerAnyway={props.onAnswerAnyway} />
        ) : (
          <DeclinedNoSource answer={answer} onAnswerAnyway={props.onAnswerAnyway} incomplete={props.libraryIncomplete} />
        ))}
      {note && done && <WeakSourceNote answer={answer} incomplete={props.libraryIncomplete} uncited={note === "uncited"} />}

      {done && hasText && (
        // Prism AX-1: the row wraps; at large text "Copy answer" takes a line of its own, label kept.
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: t.space.sm }}>
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
          <View style={largeText ? { flexBasis: "100%", height: 0 } : { flex: 1 }} />
          {/* The mockup's "Copy response" pill: s1, caption in secondary. */}
          <Pressable
            onPress={props.onCopy}
            accessibilityRole="button"
            accessibilityLabel={tr("chat.actions.copyAnswer")}
            hitSlop={{ top: (t.size.touch - t.size.controlSm) / 2, bottom: (t.size.touch - t.size.controlSm) / 2 }}
            style={({ pressed }) => ({
              minHeight: t.size.controlSm,
              paddingVertical: largeText ? t.space.xs : 0,
              justifyContent: "center",
              paddingHorizontal: t.space.md,
              borderRadius: t.radius.full,
              backgroundColor: pressed ? t.color.bg.raised : t.color.bg.surface,
            })}
          >
            {/* In a pill: icon + text move together onto the pill's middle (iOS draws the label high). */}
            <IconText icon="copy" variant="caption" color="secondary" iconColor={t.color.text.secondary} centerOnBox>
              {tr("chat.actions.copyAnswer")}
            </IconText>
          </Pressable>
        </View>
      )}

      {!active && offersAskModel(answer) && (
        <Button label={tr("chat.actions.askModel")} variant="secondary" icon="cpu" onPress={props.onAskModel} style={{ alignSelf: "flex-start" }} />
      )}
      {!active && phase === "done" && canDeepen(answer) && (
        // Not in the mockup: a quiet text link under the actions, so it doesn't compete with copying (Iris).
        <Pressable
          onPress={props.onDeepen}
          accessibilityRole="button"
          hitSlop={{ top: t.space.md, bottom: t.space.md }}
          style={{ alignSelf: "flex-start" }}
        >
          <IconText icon="layers" variant="caption" color="secondary" iconColor={t.color.text.secondary}>
            {answer.deepAvailable?.estSeconds
              ? tr("chat.actions.deepenEst", { time: formatSeconds(answer.deepAvailable.estSeconds * 1000, locale) })
              : tr("chat.actions.deepen")}
          </IconText>
        </Pressable>
      )}
    </View>
  );
});
