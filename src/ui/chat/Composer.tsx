import React, { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, TextInput, useWindowDimensions, View } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useTranslation } from "react-i18next";
import { IconButton, Text } from "../components";
import { footerBottom } from "../components/Screen";
import { useTokens } from "../theme";
import { useMotion } from "../theme/motion";
import { CURVE, type Curve } from "../theme/motionSpec";
import { VoiceInputButton } from "../VoiceInputButton";
import { composerNotice, composerPlaceholderKey, sendMode, type ModelStatus } from "./composerState";
import { Swap } from "./Swap";
import { composerLayout, composerPillHeight } from "./composerLayout";

const curves: Record<Curve, ReturnType<typeof Easing.bezier>> = {
  standard: Easing.bezier(...CURVE.standard),
  enter: Easing.bezier(...CURVE.enter),
  exit: Easing.bezier(...CURVE.exit),
};

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
  /** Asking works: the model loads have started (answer() waits for them) and there is no load error. */
  canSend?: boolean;
}

/**
 * Question field with send/stop. Stays editable while an answer streams so
 * the next question can be written; only sending waits.
 */
const ComposerView = forwardRef<TextInput, Props>(function Composer(
  { value, onChange, onSend, onStop, status, generating, stopping, voiceEnabled, canSend = status === "ready" },
  ref
) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const ready = status === "ready";
  const field = useRef<TextInput>(null);
  useImperativeHandle(ref, () => field.current as TextInput);
  const empty = value.trim().length === 0;
  const mode = sendMode(canSend, empty);
  const insets = useSafeAreaInsets();
  // The mockup ends the composer 30 pt above the screen's bottom (into the home-indicator inset by 4);
  // the screen leaves the bottom edge to the composer. Small insets (Android gestures) keep at least sm.
  // With the keyboard up there is no home indicator under the composer: keep the usual small gap.
  const keyboardUp = useKeyboardState((k) => k.isVisible);
  // iOS: 4 pt into the home-indicator inset, as the mockup; Android: fully above the navigation bar (Iris AN-1).
  const bottom = keyboardUp ? t.space.sm : footerBottom(insets.bottom, t.space.xs, t.space.sm);
  // Model error: the composer is dimmed and not editable; the card above is where to act (E-5, Prism).
  const blocked = status === "error";
  const keys = composerNotice(status);
  const line = keys.line ? tr(keys.line) : undefined;
  const hint = keys.hint ? tr(keys.hint) : undefined;
  const [focused, setFocused] = useState(false);
  // 14 regular, as the mockup's placeholder and text.
  const text = { ...t.type.subhead, fontFamily: t.type.body.fontFamily, fontWeight: t.type.body.fontWeight };
  const lineHeight = text.lineHeight ?? t.size.composer / 2;
  // The input sizes itself (up to 5 lines, then scrolls) and the pill follows it animated (composerLayout.ts
  // has the iOS cause: a fixed height fed by onContentSizeChange never grew past one line).
  const { fontScale } = useWindowDimensions();
  const layout = useMemo(
    () => composerLayout({ lineHeight, fontScale, composer: t.size.composer, button: t.size.composer }),
    [lineHeight, fontScale, t.size.composer]
  );
  const m = useMotion();
  const pill = useSharedValue(layout.pillMin);
  const onInputLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const target = composerPillHeight(e.nativeEvent.layout.height, layout);
      // A line more or less: the DS `layout` role (reduce motion: at once, no slide).
      const s = m.spec("layout");
      pill.value = s.duration > 0 ? withTiming(target, { duration: s.duration, easing: curves[s.curve], reduceMotion: ReduceMotion.Never }) : target;
    },
    [layout, m, pill]
  );
  const pillStyle = useAnimatedStyle(() => ({ height: pill.value }));
  return (
    <View
      style={{
        paddingHorizontal: t.space.gutterChat,
        paddingTop: t.space.sm,
        paddingBottom: bottom,
        gap: t.space.xs,
      }}
    >
      {line && (
        <Text variant="caption" color="secondary">
          {line}
        </Text>
      )}
      {/* In the model-error state the whole composer is dimmed, as the mockup: the card above is where to act (E-5). */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: t.space.sm, opacity: blocked ? t.opacity.disabled : 1 }}>
        {voiceEnabled && (
          <VoiceInputButton disabled={!ready} onTranscript={(text) => onChange(value ? `${value} ${text}` : text)} />
        )}
        {/* The mockup's question pill: 52 tall for a line, s1, hairline border (focus colour when focused), 18 side
            padding; same radius and padding at any height. The text sits on its bottom (the caret's line stays in
            view while the pill catches up with a new line) and the pill's height animates to it. */}
        <Animated.View
          style={[
            {
              flex: 1,
              justifyContent: "flex-end",
              overflow: "hidden",
              paddingBottom: layout.padV,
              borderRadius: t.size.composer / 2,
              backgroundColor: t.color.bg.surface,
              borderWidth: t.size.border,
              borderColor: focused ? t.color.line.focus : t.color.line.hairline,
              paddingHorizontal: t.space.md + t.space.xs + t.space.xxs,
            },
            pillStyle,
          ]}
        >
          <TextInput
            ref={field}
            value={value}
            onChangeText={onChange}
            accessibilityLabel={tr("chat.composer.label")}
            // Asking already works while loading (answer() waits), so the usual placeholder then.
            placeholder={tr(canSend ? "chat.composer.placeholder" : composerPlaceholderKey(status))}
            placeholderTextColor={t.color.text.secondary}
            editable={!blocked}
            accessibilityState={{ disabled: blocked }}
            multiline
            submitBehavior="newline"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onLayout={onInputLayout}
            style={{
              ...text,
              color: t.color.text.primary,
              maxHeight: layout.inputMax,
              paddingVertical: 0,
              textAlignVertical: "top",
            }}
          />
        </Animated.View>
        {/* Stop and send swap in place with the DS crossfade (Prism F2-8); the disc stays on the last line's centre. */}
        <Swap swapKey={generating ? "stop" : "send"} style={{ marginBottom: layout.buttonLift }}>
          {generating ? (
            // Stop, as the mockup (s2 disc, ember ring, 16 pt ember square): the DS's IconButton "stop" (Prism CH-29),
            // busy while the stop lands.
            <IconButton
              icon="square"
              variant="stop"
              size="lg"
              label={stopping ? tr("chat.composer.stopping") : tr("chat.composer.stop")}
              busy={stopping}
              onPress={onStop}
            />
          ) : (
            // With the model ready, send is always the ember disc (the mockup): with an empty field it puts the
            // focus there instead of sending nothing. Neutral and disabled only when the model can't answer.
            <IconButton
              icon="arrow-up"
              variant="filled"
              size="lg"
              label={tr("chat.composer.send")}
              accessibilityHint={mode === "focus" ? tr("chat.composer.focusHint") : mode === "disabled" ? hint : undefined}
              disabled={mode === "disabled"}
              onPress={() => (mode === "send" ? onSend() : field.current?.focus())}
            />
          )}
        </Swap>
      </View>
    </View>
  );
});

// Memoized: the chat screen re-renders on every streamed frame; the composer only when its props change.
export const Composer = memo(ComposerView);
