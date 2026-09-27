import React, { forwardRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { IconButton, Text } from "../components";
import { useTokens } from "../theme";
import { VoiceInputButton } from "../VoiceInputButton";
import { composerNotice, composerPlaceholderKey, type ModelStatus } from "./composerState";

interface Props {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** Sending needs a loaded model; typing never waits. */
  status: ModelStatus;
  generating: boolean;
  stopping: boolean;
  voiceEnabled: boolean;
}

/**
 * Question field with send/stop. Stays editable while an answer streams so
 * the next question can be written; only sending waits.
 */
export const Composer = forwardRef<TextInput, Props>(function Composer(
  { value, onChange, onSend, onStop, status, generating, stopping, voiceEnabled },
  ref
) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const ready = status === "ready";
  const canSend = ready && !generating && value.trim().length > 0;
  const keys = composerNotice(status);
  const line = keys.line ? tr(keys.line) : undefined;
  const hint = keys.hint ? tr(keys.hint) : undefined;
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState<number>(t.size.composer);
  // 14 regular, as the mockup's placeholder and text.
  const text = { ...t.type.subhead, fontFamily: t.type.body.fontFamily, fontWeight: t.type.body.fontWeight };
  const lineHeight = text.lineHeight ?? t.size.composer / 2;
  const maxHeight = lineHeight * 5 + (t.size.composer - lineHeight);
  return (
    <View
      style={{
        paddingHorizontal: t.space.gutterChat,
        paddingTop: t.space.sm,
        paddingBottom: t.space.md,
        gap: t.space.xs,
      }}
    >
      {line && (
        <Text variant="caption" color="secondary">
          {line}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: t.space.sm }}>
        {voiceEnabled && (
          <VoiceInputButton disabled={!ready} onTranscript={(text) => onChange(value ? `${value} ${text}` : text)} />
        )}
        {/* The mockup's question pill: 52 tall, s1, hairline border (focus colour when focused), 18 side padding. */}
        <View
          style={{
            flex: 1,
            minHeight: t.size.composer,
            justifyContent: "center",
            borderRadius: t.size.composer / 2,
            backgroundColor: t.color.bg.surface,
            borderWidth: t.size.border,
            borderColor: focused ? t.color.line.focus : t.color.line.hairline,
            paddingHorizontal: t.space.md + t.space.xs + t.space.xxs,
          }}
        >
          <TextInput
            ref={ref}
            value={value}
            onChangeText={onChange}
            accessibilityLabel={tr("chat.composer.label")}
            placeholder={tr(composerPlaceholderKey(status))}
            placeholderTextColor={t.color.text.secondary}
            multiline
            submitBehavior="newline"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onContentSizeChange={(e) => setHeight(e.nativeEvent.contentSize.height)}
            style={{
              ...text,
              color: t.color.text.primary,
              maxHeight,
              height: Math.min(maxHeight, Math.max(lineHeight, height)),
              paddingVertical: 0,
              textAlignVertical: "center",
            }}
          />
        </View>
        {generating ? (
          // Stop, as the mockup: s2 disc, ember ring, 16 pt ember square.
          <Pressable
            onPress={onStop}
            disabled={stopping}
            accessibilityRole="button"
            accessibilityLabel={stopping ? tr("chat.composer.stopping") : tr("chat.composer.stop")}
            accessibilityState={{ busy: stopping, disabled: stopping }}
            style={({ pressed }) => ({
              width: t.size.composer,
              height: t.size.composer,
              borderRadius: t.radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? t.color.bg.sunken : t.color.bg.raised,
              borderWidth: t.size.border,
              borderColor: t.color.accent.solid,
              opacity: stopping ? 0.6 : 1,
            })}
          >
            <View style={{ width: t.space.base, height: t.space.base, borderRadius: t.space.xs, backgroundColor: t.color.accent.solid }} />
          </Pressable>
        ) : (
          <IconButton
            icon="arrow-up"
            variant="filled"
            size="lg"
            label={tr("chat.composer.send")}
            // Why sending is off, for screen readers (visually: the line above, or the error card).
            accessibilityHint={hint}
            disabled={!canSend}
            onPress={onSend}
          />
        )}
      </View>
    </View>
  );
});
