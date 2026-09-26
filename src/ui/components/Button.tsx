import React from "react";
import { ActivityIndicator, Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { useTokens } from "../theme";
import { Icon, IconName } from "./Icon";
import { Text } from "./Text";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: IconName;
  iconPosition?: "start" | "end";
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Text button. Height is always >= the platform touch minimum; `sm` only
 * reduces padding and type, the hit area stays 44/48 via hitSlop.
 */
export function Button({
  label,
  variant = "primary",
  size = "md",
  icon,
  iconPosition = "start",
  loading,
  disabled,
  fullWidth,
  style,
  onPress,
  ...rest
}: ButtonProps) {
  const t = useTokens();
  const c = t.color;
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: c.accent.solid, bgPressed: c.accent.pressed, fg: c.accent.on, border: "transparent" },
    secondary: { bg: c.bg.surface, bgPressed: c.bg.sunken, fg: c.text.primary, border: c.line.strong },
    ghost: { bg: "transparent", bgPressed: c.bg.sunken, fg: c.accent.text, border: "transparent" },
    destructive: { bg: c.status.danger.soft, bgPressed: c.status.danger.soft, fg: c.status.danger.solid, border: c.status.danger.solid },
  }[variant];
  const height = size === "sm" ? t.size.controlSm : t.size.touch;
  const slop = Math.max(0, (t.size.touch - height) / 2);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      hitSlop={slop}
      onPress={(e) => {
        impact(variant === "destructive" ? ImpactFeedbackStyle.Medium : ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: height,
          paddingHorizontal: size === "sm" ? t.space.md : t.space.lg,
          borderRadius: t.radius.md,
          backgroundColor: pressed ? palette.bgPressed : palette.bg,
          borderColor: palette.border,
          borderWidth: palette.border === "transparent" ? 0 : t.size.border,
          opacity: inactive && !loading ? 0.45 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={[styles.row, { gap: t.space.sm, flexDirection: iconPosition === "end" ? "row-reverse" : "row" }]}>
          {icon && <Icon name={icon} size={size === "sm" ? "sm" : "md"} color={palette.fg} />}
          <Text variant={size === "sm" ? "subhead" : "headline"} style={{ color: palette.fg }} weight="semibold" numberOfLines={2} align="center">
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", paddingVertical: 8 },
  row: { alignItems: "center", justifyContent: "center", flexShrink: 1 },
  fullWidth: { alignSelf: "stretch" },
});
