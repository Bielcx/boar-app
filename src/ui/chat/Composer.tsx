import React, { forwardRef } from "react";
import { TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { IconButton, Text, TextField } from "../components";
import { useTokens } from "../theme";
import { VoiceInputButton } from "../VoiceInputButton";

interface Props {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** The model is loaded: sending is possible. Typing always is. */
  ready: boolean;
  generating: boolean;
  stopping: boolean;
  voiceEnabled: boolean;
}

/**
 * Question field with send/stop. Stays editable while an answer streams so
 * the next question can be written; only sending waits.
 */
export const Composer = forwardRef<TextInput, Props>(function Composer(
  { value, onChange, onSend, onStop, ready, generating, stopping, voiceEnabled },
  ref
) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const canSend = ready && !generating && value.trim().length > 0;
  return (
    <View
      style={{
        paddingHorizontal: t.space.base,
        paddingTop: t.space.sm,
        paddingBottom: t.space.sm,
        gap: t.space.xs,
        backgroundColor: t.color.bg.canvas,
        borderTopWidth: t.size.hairline,
        borderTopColor: t.color.line.hairline,
      }}
    >
      {!ready && (
        <Text variant="caption" color="tertiary">
          {tr("chat.composer.notReady")}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: t.space.xs }}>
        {voiceEnabled && (
          <VoiceInputButton disabled={!ready} onTranscript={(text) => onChange(value ? `${value} ${text}` : text)} />
        )}
        <View style={{ flex: 1 }}>
          <TextField
            ref={ref}
            value={value}
            onChangeText={onChange}
            accessibilityLabel={tr("chat.composer.label")}
            placeholder={tr("chat.composer.placeholder")}
            autoGrow
            maxRows={5}
            multiline
            submitBehavior="newline"
          />
        </View>
        {generating ? (
          <IconButton
            icon="square"
            variant="tonal"
            label={stopping ? tr("chat.composer.stopping") : tr("chat.composer.stop")}
            accessibilityState={{ busy: stopping }}
            disabled={stopping}
            onPress={onStop}
          />
        ) : (
          <IconButton icon="arrow-up" variant="filled" label={tr("chat.composer.send")} disabled={!canSend} onPress={onSend} />
        )}
      </View>
    </View>
  );
});
