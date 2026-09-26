import React, { memo } from "react";
import { Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Mascot, Progress, Sheet, Text, useToast } from "../components";
import { useTokens } from "../theme";
import type { RetrievedChunk } from "../../rag/retrieve.types";
import { modelErrorKind, modelErrorPrimary } from "./modelError";

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
}: {
  /** Keys (q1, q2…) validated for the active model and language; see suggestions.ts. */
  suggestions: string[];
  onAsk: (question: string) => void;
  onFill: (question: string) => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  return (
    <View style={{ flexGrow: 1, justifyContent: "center", gap: t.space.xxl, paddingVertical: t.space.xl }}>
      <View style={{ alignItems: "center", gap: t.space.xs }}>
        <Mascot />
        <Text variant="display" align="center" header accessibilityLabel={tr("chat.empty.title")}>
          {tr("chat.assistantName")}
        </Text>
        <Text variant="subhead" color="field" align="center">
          {tr("chat.empty.tagline")}
        </Text>
      </View>
      {suggestions.length > 0 && (
        <View style={{ gap: t.space.md }}>
          <Text variant="label" color="secondary" header>
            {tr("chat.empty.suggestionsLabel")}
          </Text>
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
                style={{ gap: t.space.xs }}
              >
                <Text variant="label" color="field">
                  {tr(`chat.suggestionTopics.${k}`)}
                </Text>
                <Text variant="callout" numberOfLines={2}>
                  {q}
                </Text>
              </Card>
            );
          })}
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
      <Mascot dim />
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
 * an overline, what happened in plain words, a well with what to do, and the
 * actions (the one that fixes this cause leads).
 */
export function ChatModelError({
  error,
  onOpenSettings,
  onRelaunchWizard,
  onRetry,
  compact,
}: {
  error: string;
  /** Above a conversation: no mascot, no vertical centring. */
  compact?: boolean;
  onOpenSettings: () => void;
  onRelaunchWizard?: () => void;
  onRetry: () => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const kind = modelErrorKind(error);
  const setupLeads = modelErrorPrimary(kind) === "setup" && !!onRelaunchWizard;
  return (
    <View style={compact ? undefined : { flexGrow: 1, justifyContent: "center", gap: t.space.xl, paddingVertical: t.space.xl }}>
      {!compact && (
        <View style={{ alignItems: "center" }}>
          <Mascot dim />
        </View>
      )}
      <Card
        accessibilityRole="alert"
        style={{ gap: t.space.md, borderWidth: t.size.border * 1.5, borderColor: t.color.status.danger.solid }}
      >
        <View style={{ alignSelf: "flex-start" }}>
          <Badge label={tr("chat.modelError.overline")} tone="danger" icon="alert-triangle" />
        </View>
        <View style={{ gap: t.space.xs }}>
          <Text variant="title3" header>
            {tr(`chat.modelError.${kind}.title`)}
          </Text>
          <Text variant="footnote" color="secondary">
            {tr(`chat.modelError.${kind}.body`)}
          </Text>
        </View>
        <View style={{ padding: t.space.md, borderRadius: t.radius.md, backgroundColor: t.color.bg.raised }}>
          <Text variant="footnote">{tr(`chat.modelError.${kind}.hint`)}</Text>
        </View>
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
        {/* Freeing memory can make a retry work; for the other causes two actions are enough. */}
        {setupLeads && kind === "memory" && (
          <Button label={tr("chat.actions.retry")} variant="ghost" size="sm" icon="rotate-cw" onPress={onRetry} style={{ alignSelf: "center" }} />
        )}
      </Card>
    </View>
  );
}
