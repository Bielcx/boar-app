import React, { memo } from "react";
import { Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, EmptyState, Sheet, Text, useToast } from "../components";
import { useTokens } from "../theme";
import type { RetrievedChunk } from "../../rag/retrieve.types";

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
        borderBottomRightRadius: t.radius.xs,
        backgroundColor: t.color.accent.soft,
      }}
    >
      <Text selectable>{text}</Text>
    </Pressable>
  );
});

export const SUGGESTION_KEYS = ["q1", "q2", "q3", "q4"] as const;

/** A new chat: what the app does, and questions to start with (tap sends; the screen reader action fills the composer). */
export function ChatEmptyState({
  showSuggestions,
  onAsk,
  onFill,
}: {
  showSuggestions: boolean;
  onAsk: (question: string) => void;
  onFill: (question: string) => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  return (
    <View style={{ gap: t.space.xl, paddingTop: t.space.xxl }}>
      <EmptyState icon="book-open" title={tr("chat.empty.title")} body={tr("chat.empty.body")} />
      {showSuggestions && (
        <View style={{ gap: t.space.sm }}>
          <Text variant="label" color="secondary" header>
            {tr("chat.empty.suggestionsLabel")}
          </Text>
          {SUGGESTION_KEYS.map((k) => {
            const q = tr(`chat.suggestions.${k}`);
            return (
              <Card
                key={k}
                padding="sm"
                onPress={() => onAsk(q)}
                accessibilityLabel={tr("chat.empty.ask", { question: q })}
                accessibilityActions={[{ name: "fill", label: tr("chat.empty.fill") }]}
                onAccessibilityAction={() => onFill(q)}
              >
                <Text variant="callout">{q}</Text>
              </Card>
            );
          })}
        </View>
      )}
    </View>
  );
}
