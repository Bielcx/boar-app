import React, { forwardRef } from "react";
import { TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { IconButton, Text, TextField } from "../components";
import { useTokens } from "../theme";
import { VoiceInputButton } from "../VoiceInputButton";
import { composerNotice, type ModelStatus } from "./composerState";

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
  return (
    <View
      style={{
        paddingHorizontal: t.space.gutter,
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
            // While generating, Stop is the screen's accent (send is gone): ember ring and square, as in the mockup.
            variant="plain"
            color={t.color.accent.solid}
            style={{ borderWidth: t.size.border * 1.5, borderColor: t.color.accent.solid }}
            label={stopping ? tr("chat.composer.stopping") : tr("chat.composer.stop")}
            accessibilityState={{ busy: stopping }}
            disabled={stopping}
            onPress={onStop}
          />
        ) : (
          <IconButton
            icon="arrow-up"
            variant="filled"
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
