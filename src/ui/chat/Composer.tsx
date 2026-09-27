import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
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
  const field = useRef<TextInput>(null);
  useImperativeHandle(ref, () => field.current as TextInput);
  const empty = value.trim().length === 0;
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
      {/* In the model-error state the whole composer is dimmed, as the mockup: the card above is where to act (E-5). */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: t.space.sm, opacity: status === "error" ? 0.45 : 1 }}>
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
            ref={field}
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
          // With the model ready, send is always the ember disc (the mockup): with an empty field it puts the
          // focus there instead of sending nothing. Neutral and disabled only when the model can't answer.
          <IconButton
            icon="arrow-up"
            variant="filled"
            size="lg"
            label={tr("chat.composer.send")}
            accessibilityHint={!ready ? hint : empty ? tr("chat.composer.focusHint") : undefined}
            disabled={!ready}
            onPress={() => (empty ? field.current?.focus() : onSend())}
          />
        )}
      </View>
    </View>
  );
});
