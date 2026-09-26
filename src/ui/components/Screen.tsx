import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Edge, SafeAreaView } from "react-native-safe-area-context";
import { useTokens } from "../theme";
import { Ambient } from "./Ambient";

export interface ScreenProps {
  children: React.ReactNode;
  /** Scrollable content (keyboard-aware). Default true. Use false for screens that own a FlatList. */
  scroll?: boolean;
  /**
   * Safe-area edges this screen pads. Screens under the native stack header
   * don't need "top" (the header handles it); the default is bottom + sides.
   */
  edges?: Edge[];
  /** Horizontal content padding. Default true. */
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Sticky content at the bottom (primary action), above the home indicator. */
  footer?: React.ReactNode;
  /** Draw the identity's light pattern (ember / moon) behind the content. Hero screens: chat, onboarding. */
  ambient?: boolean;
  /** Center the content vertically when it is shorter than the screen (welcome, errors). Scrolls when taller. */
  center?: boolean;
}

/** Screen scaffold: canvas background, safe area, keyboard handling, content rhythm. */
export function Screen({ children, scroll = true, edges = ["bottom", "left", "right"], padded = true, contentStyle, footer, ambient, center }: ScreenProps) {
  const t = useTokens();
  const inner: ViewStyle = {
    paddingHorizontal: padded ? t.space.gutter : 0,
    paddingVertical: t.space.base,
    gap: t.space.xl,
    ...(center ? { flexGrow: 1, justifyContent: "center" } : null),
  };
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: t.color.bg.canvas }}>
      {ambient && <Ambient />}
      {scroll ? (
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentInsetAdjustmentBehavior="automatic"
          bottomOffset={t.space.base}
          contentContainerStyle={[inner, contentStyle]}
        >
          {children}
        </KeyboardAwareScrollView>
      ) : (
        <View style={[{ flex: 1 }, center && { justifyContent: "center" }, contentStyle]}>{children}</View>
      )}
      {footer && (
        <View
          style={{
            paddingHorizontal: t.space.gutter,
            paddingTop: t.space.md,
            paddingBottom: t.space.sm,
            gap: t.space.sm,
            borderTopWidth: ambient ? 0 : t.size.hairline,
            borderTopColor: t.color.line.hairline,
            backgroundColor: ambient ? "transparent" : t.color.bg.canvas,
          }}
        >
          {footer}
        </View>
      )}
    </SafeAreaView>
  );
}

