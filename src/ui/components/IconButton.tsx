import React, { forwardRef } from "react";
import { Pressable, PressableProps, StyleProp, View, ViewStyle } from "react-native";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { useTokens } from "../theme";
import { Icon, IconName } from "./Icon";
import { touchSlop } from "./touchTarget";

export interface IconButtonProps extends Omit<PressableProps, "children" | "style" | "accessibilityLabel"> {
  icon: IconName;
  /** Required: an icon-only button has no other accessible name. */
  label: string;
  /**
   * plain: no fill · surface: a neutral disc (header chrome, mockup's menu button) ·
   * tonal: soft accent disc (counts as an accent) · filled: solid accent (the primary icon action).
   */
  variant?: "plain" | "surface" | "tonal" | "filled";
  /** lg = 52 (composer send), header = 42 (chat header discs), md = touch minimum, sm = 36. Touch stays >= 44/48. */
  size?: "lg" | "header" | "md" | "sm";
  selected?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

/** Icon-only button. The visual may be 36pt, the touch target is always >= 44/48. */
export const IconButton = forwardRef<View, IconButtonProps>(function IconButton({
  icon,
  label,
  variant = "plain",
  size = "md",
  selected,
  disabled,
  color,
  style,
  onPress,
  ...rest
}, ref) {
  const t = useTokens();
  const c = t.color;
  const visual =
    size === "sm" ? t.size.controlSm : size === "header" ? t.size.headerDisc : size === "lg" ? t.size.composer : t.size.touch;
  const slop = touchSlop(visual, t.size.touch);
  // A disabled filled button drops the accent entirely (raised disc, muted icon): at 45% opacity an
  // ember disc still read as "ready" on the dark canvas (Prism IX-1).
  const mutedFilled = variant === "filled" && !!disabled;
  const bg =
    mutedFilled
      ? c.bg.raised
      : variant === "filled"
      ? c.accent.solid
      : variant === "tonal" || selected
        ? c.accent.soft
        : variant === "surface"
          ? c.bg.surface
          : "transparent";
  const fg =
    color ?? (mutedFilled ? c.text.secondary : variant === "filled" ? c.accent.on : selected ? c.accent.text : variant === "surface" ? c.text.primary : c.text.secondary);
  // A surface disc lifts when pressed (dark planes read by lightness); the others sink.
  const pressedBg = variant === "filled" ? c.accent.pressed : variant === "surface" ? c.bg.raised : c.bg.sunken;

  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      hitSlop={slop}
      onPress={(e) => {
        impact(ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={({ pressed }) => [
        {
          width: visual,
          height: visual,
          borderRadius: t.radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? pressedBg : bg,
          opacity: disabled && !mutedFilled ? 0.45 : 1,
          ...(variant === "filled" && !disabled ? (t.elevation.glow as object) : null),
        },
        style,
      ]}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? "sm" : size === "lg" ? "lg" : "md"} color={fg} />
    </Pressable>
  );
});
