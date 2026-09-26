import React, { forwardRef } from "react";
import { Pressable, PressableProps, StyleProp, View, ViewStyle } from "react-native";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { useTokens } from "../theme";
import { Icon, IconName } from "./Icon";

export interface IconButtonProps extends Omit<PressableProps, "children" | "style" | "accessibilityLabel"> {
  icon: IconName;
  /** Required: an icon-only button has no other accessible name. */
  label: string;
  variant?: "plain" | "tonal" | "filled";
  size?: "md" | "sm";
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
  const visual = size === "sm" ? t.size.controlSm : t.size.touch;
  const slop = Math.max(0, (t.size.touch - visual) / 2);
  const bg =
    variant === "filled" ? c.accent.solid : variant === "tonal" || selected ? c.accent.soft : "transparent";
  const fg = color ?? (variant === "filled" ? c.accent.on : selected ? c.accent.text : c.text.secondary);

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
          backgroundColor: pressed ? (variant === "filled" ? c.accent.pressed : c.bg.sunken) : bg,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? "sm" : "md"} color={fg} />
    </Pressable>
  );
});
