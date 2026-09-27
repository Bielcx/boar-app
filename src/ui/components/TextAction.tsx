import React from "react";
import { Pressable, View } from "react-native";
import { useTokens } from "../theme";
import { Icon, IconName } from "./Icon";
import { Text } from "./Text";

export interface TextActionProps {
  label: string;
  onPress: () => void;
  /** Trailing glyph: "chevron-down"/"chevron-up" for an expander, "chevron-right" for navigation. */
  icon?: IconName;
  /** Leading glyph (e.g. "arrow-left" for Back). */
  leadingIcon?: IconName;
  /** Set for an expander: exposes accessibilityState.expanded. */
  expanded?: boolean;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}

/**
 * A quiet text action in text.secondary: secondary moves that must not add an accent to the screen
 * ("Show all", "Cancel", "Open settings", "Related in your library", "Back"). The glyph is small and
 * secondary; the touch target is raised to the platform minimum with hitSlop.
 */
export function TextAction({
  label,
  onPress,
  icon,
  leadingIcon,
  expanded,
  accessibilityHint,
  accessibilityLabel,
  disabled,
}: TextActionProps) {
  const t = useTokens();
  const lineHeight = t.type.footnote.lineHeight ?? 18;
  const slop = Math.max(0, (t.size.touch - lineHeight) / 2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, ...(expanded === undefined ? null : { expanded }) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: slop, bottom: slop, left: t.space.sm, right: t.space.sm }}
      style={({ pressed }) => ({ alignSelf: "flex-start", opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.space.xs }}>
        {leadingIcon && <Icon name={leadingIcon} size="sm" color={t.color.text.secondary} />}
        <Text variant="footnote" color="secondary">
          {label}
        </Text>
        {icon && <Icon name={icon} size="sm" color={t.color.text.secondary} />}
      </View>
    </Pressable>
  );
}
