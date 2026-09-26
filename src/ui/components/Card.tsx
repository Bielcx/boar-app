import React from "react";
import { Pressable, StyleProp, View, ViewProps, ViewStyle } from "react-native";
import { useTokens } from "../theme";

export interface CardProps extends ViewProps {
  /** Elevation level. Dark mode draws levels with surface lightness, not shadows. */
  level?: 0 | 1 | 2;
  padding?: "none" | "sm" | "md";
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Grouped content on a surface with a hairline. Hairline first, shadow second. */
export function Card({ level = 1, padding = "md", onPress, style, children, ...rest }: CardProps) {
  const t = useTokens();
  const base: ViewStyle = {
    backgroundColor: level === 2 ? t.color.bg.raised : t.color.bg.surface,
    borderRadius: t.radius.lg,
    borderWidth: t.size.hairline,
    borderColor: t.color.line.hairline,
    padding: padding === "none" ? 0 : padding === "sm" ? t.space.md : t.space.base,
    ...(t.elevation[level] as ViewStyle),
  };
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [base, pressed && { backgroundColor: t.color.bg.sunken }, style]}
        {...rest}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[base, style]} {...rest}>
      {children}
    </View>
  );
}
