import React, { memo, useState } from "react";
import { Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Icon, Mascot, Progress, Sheet, Text, useToast } from "../components";
import { useTokens } from "../theme";
import type { RetrievedChunk } from "../../rag/retrieve.types";
import { modelErrorKind, modelErrorPrimary, showsRawError, type ModelErrorKind } from "./modelError";
import { showsKnowledgeHint } from "./suggestions";

/** The source behind a citation: title, where it comes from, and the passage. */
export function SourceSheet({ source, index, onClose }: { source: RetrievedChunk | null; index: number; onClose: () => void }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const toast = useToast();
  return (
    <Sheet
      visible={!!source}
      onClose={onClose}
      title={source ? source.title : ""}
      description={tr("chat.sources.sheetTitle", { n: index + 1 })}
      footer={
        source ? (
          <Button
            label={tr("chat.sources.copyPassage")}
            variant="secondary"
            icon="copy"
            fullWidth
            onPress={async () => {
              await Clipboard.setStringAsync(source.body);
              toast({ message: tr("chat.sources.passageCopied") });
            }}
          />
        ) : null
      }
    >
      {source && (
        <View style={{ gap: t.space.md }}>
          <Badge
            label={source.collectionId ? tr("chat.sources.myDocuments") : source.source || tr("chat.sources.corpus")}
            icon={source.collectionId ? "file-text" : "book"}
            tone="field"
          />
          <Text selectable>{source.body}</Text>
        </View>
      )}
    </Sheet>
  );
}

/**
 * The user's question. Long-press (or the screen reader's actions menu)
 * copies it or puts it back in the composer.
 */
export const UserMessage = memo(function UserMessage({
  text,
  onCopy,
  onEdit,
}: {
  text: string;
  onCopy: () => void;
  onEdit: () => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  return (
    <Pressable
      onLongPress={onEdit}
      delayLongPress={350}
      accessibilityLabel={text}
      accessibilityHint={tr("chat.actions.editQuestion")}
      accessibilityActions={[
        { name: "copy", label: tr("chat.actions.copyQuestion") },
        { name: "edit", label: tr("chat.actions.editQuestion") },
      ]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === "copy" ? onCopy() : onEdit())}
      style={{
        alignSelf: "flex-end",
        maxWidth: "88%",
        paddingHorizontal: t.space.base,
        paddingVertical: t.space.md,
        borderRadius: t.radius.lg,
        borderBottomRightRadius: t.radius.sm,
        backgroundColor: t.color.bg.raised,
      }}
    >
      <Text selectable>{text}</Text>
    </Pressable>
  );
});

/**
 * A new chat, laid out like the mockup: mascot, wordmark and tagline centred,
 * then questions to start with as cards (topic overline + the question). Tap
 * sends; long-press or the screen reader action fills the composer.
 */
export function ChatEmptyState({
  suggestions,
  onAsk,
  onFill,
  onAddKnowledge,
}: {
  /** Keys (q1, q2…) validated for the active model and language; see suggestions.ts. */
  suggestions: string[];
  onAsk: (question: string) => void;
  onFill: (question: string) => void;
  /** With fewer than 3 suggestions, a neutral card says why and opens Knowledge (Iris). Omit when suggestions are turned off. */
  onAddKnowledge?: () => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  return (
    // The mockup's layout (spec-chat-vazio): mascot, wordmark, tagline, then the suggestions.
    <View
      style={{
        flexGrow: 1,
        // Top-aligned under the header, as the mockup; what is left over stays above the composer (Iris).
        justifyContent: "flex-start",
        gap: t.space.lg,
        marginTop: -t.space.xs,
      }}
    >
      <View style={{ alignItems: "center" }}>
        <Mascot glow />
        {/* The wordmark sits 6 below the hero box (the mascot image spills over the box, as in the mockup). Starts with the
            visible word, then the
            screen's title for readers (Prism, in the spirit of WCAG 2.5.3). */}
        <Text
          variant="wordmark"
          align="center"
          header
          accessibilityLabel={`${tr("chat.assistantName")}, ${tr("chat.empty.title")}`}
          style={{ marginTop: t.space.xs + t.space.xxs }}
        >
          {tr("chat.assistantName")}
        </Text>
        <Text variant="footnote" weight="medium" color="field" align="center" style={{ marginTop: t.space.xs + t.space.xxs }}>
          {tr("chat.empty.tagline")}
        </Text>
      </View>
      {(suggestions.length > 0 || (onAddKnowledge && showsKnowledgeHint(suggestions.length))) && (
        <View style={{ gap: t.space.cardGap }}>
          {suggestions.length > 0 && (
            <Text variant="label" color="secondary" header style={{ paddingHorizontal: t.space.xs }}>
              {tr("chat.empty.suggestionsLabel")}
            </Text>
          )}
          {suggestions.map((k) => {
            const q = tr(`chat.suggestions.${k}`);
            return (
              <Card
                key={k}
                onPress={() => onAsk(q)}
                onLongPress={() => onFill(q)}
                accessibilityHint={tr("chat.empty.fill")}
                accessibilityLabel={tr("chat.empty.ask", { question: q })}
                accessibilityActions={[{ name: "fill", label: tr("chat.empty.fill") }]}
                onAccessibilityAction={() => onFill(q)}
                radius="card"
                padding="compact"
                style={{ gap: t.space.xs }}
              >
                <Text variant="caption" weight="semibold" color="field">
                  {tr(`chat.suggestionTopics.${k}`)}
                </Text>
                <Text variant="footnote" numberOfLines={2}>
                  {q}
                </Text>
              </Card>
            );
          })}
          {/* Few questions are covered by the knowledge on this phone: say why, and where to get more. */}
          {onAddKnowledge && showsKnowledgeHint(suggestions.length) && (
            <Card
              onPress={onAddKnowledge}
              radius="card"
              padding="compact"
              accessibilityLabel={tr("chat.empty.addKnowledge")}
              accessibilityHint={tr("chat.empty.addKnowledgeHint")}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
                <Icon name="book-open" size="sm" color={t.color.text.secondary} />
                <Text variant="footnote" color="secondary" style={{ flex: 1 }}>
                  {tr("chat.empty.addKnowledge")}
                </Text>
              </View>
            </Card>
          )}
        </View>
      )}
    </View>
  );
}

/** The model is still loading: the dimmed mascot with what is happening, centred where the answers will be. */
export function ChatModelLoading({ label, progress }: { label: string; progress?: number }) {
  const t = useTokens();
  return (
    <View style={{ flexGrow: 1, justifyContent: "center", alignItems: "center", gap: t.space.md }}>
      <Mascot size="md" dim />
      <Text variant="footnote" color="secondary" align="center">
        {label}
      </Text>
      <View style={{ alignSelf: "stretch", paddingHorizontal: t.space.xxl }}>
        <Progress label={label} value={progress} tone="accent" height={t.space.xs} />
      </View>
    </View>
  );
}

/**
 * The model didn't load: the dimmed mascot over a danger-bordered card with
 * an overline, what happened in plain words, a well with what to do (and the
 * engine's own error when the file is fine), and two actions: Settings, then
 * Set up the model only when the file is missing or damaged, Try again otherwise.
 */
export function ChatModelError({
  error,
  kind: engineKind,
  onOpenSettings,
  onRelaunchWizard,
  onRetry,
  compact,
  modelLabel,
}: {
  error: string;
  /** The engine's classified cause (ModelLoadError.kind); without it the text is read (modelErrorKind). */
  kind?: ModelErrorKind;
  /** Above a conversation: no mascot, no vertical centring. */
  compact?: boolean;
  /** Names the model in the status line under the mascot ("Qwen3 4B not loaded"). */
  modelLabel?: string;
  onOpenSettings: () => void;
  onRelaunchWizard?: () => void;
  onRetry: () => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const kind = engineKind ?? modelErrorKind(error);
  const setupLeads = modelErrorPrimary(kind) === "setup" && !!onRelaunchWizard;
  const [details, setDetails] = useState(false);
  const raw = showsRawError(kind) ? error.trim() : "";
  // The mockup's rhythm (spec-chat-erro): mascot 120, status 6 below, card 14 below, the block centred.
  return (
    <View style={compact ? undefined : { flexGrow: 1, justifyContent: "center", paddingVertical: t.space.xl }}>
      {!compact && (
        <View style={{ alignItems: "center", gap: t.space.xs + t.space.xxs, marginBottom: t.space.cardGap }}>
          <Mascot size="md" dim />
          {modelLabel ? (
            <Text variant="footnote" color="secondary" align="center">
              {tr("chat.modelError.status", { model: modelLabel })}
            </Text>
          ) : null}
        </View>
      )}
      <Card
        accessibilityRole="alert"
        radius="hero"
        style={{ gap: t.space.md, borderWidth: t.size.border, borderColor: t.color.status.danger.solid }}
      >
        {/* "Details" rides on the chip's line (Iris): the card keeps the mockup's 278 pt height. */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Badge label={tr("chat.modelError.overline")} tone="danger" icon="alert-triangle" />
          {raw.length > 0 && (
            // As tall as the chip, so the line doesn't grow; the touch area reaches the minimum through hitSlop.
            <Pressable
              onPress={() => setDetails((d) => !d)}
              accessibilityRole="button"
              accessibilityLabel={tr(details ? "chat.modelError.hideDetails" : "chat.modelError.details")}
              accessibilityState={{ expanded: details }}
              hitSlop={{ top: t.space.md, bottom: t.space.md, left: t.space.sm, right: t.space.sm }}
              style={{ flexDirection: "row", alignItems: "center", gap: t.space.xxs }}
            >
              <Text variant="caption" weight="semibold" color="secondary">
                {tr(details ? "chat.modelError.hideDetails" : "chat.modelError.details")}
              </Text>
              <Icon name={details ? "chevron-up" : "chevron-down"} size="sm" color={t.color.text.secondary} />
            </Pressable>
          )}
        </View>
        <View style={{ gap: t.space.xs }}>
          <Text variant="title2" header>
            {tr(`chat.modelError.${kind}.title`)}
          </Text>
          <Text variant="subhead" weight="regular">
            {tr(`chat.modelError.${kind}.body`)}
          </Text>
        </View>
        <View style={{ padding: t.space.md, borderRadius: t.radius.md, backgroundColor: t.color.bg.canvas }}>
          <Text variant="footnote" color="secondary">{tr(`chat.modelError.${kind}.hint`)}</Text>
        </View>
        {/* The engine's own words stay available (selectable, to report them) behind "Details", closed by default,
            so the card keeps the mockup's height (Iris). */}
        {/* Expanded: the engine's own words under the well, selectable so they can be reported. */}
        {raw.length > 0 && details && (
          <View style={{ gap: t.space.xs }}>
            {kind === "engine" && (
              <Text variant="footnote" color="secondary">
                {tr("chat.modelError.engine.details")}
              </Text>
            )}
            <Text variant="code" color="secondary" selectable accessibilityLabel={tr("chat.modelError.rawLabel", { error: raw })}>
              {raw}
            </Text>
          </View>
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space.sm }}>
          <View style={{ flexGrow: 1, flexBasis: "40%" }}>
            <Button label={tr("chat.modelError.settings")} variant="secondary" fullWidth onPress={onOpenSettings} />
          </View>
          <View style={{ flexGrow: 1, flexBasis: "40%" }}>
            {setupLeads ? (
              <Button label={tr("chat.modelError.setup")} fullWidth onPress={onRelaunchWizard} />
            ) : (
              <Button label={tr("chat.actions.retry")} fullWidth onPress={onRetry} />
            )}
          </View>
        </View>
      </Card>
    </View>
  );
}
