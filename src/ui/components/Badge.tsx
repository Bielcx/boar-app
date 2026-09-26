import React from "react";
import { View } from "react-native";
import { toneColors, Tone, useTokens } from "../theme";
import { Icon, IconName } from "./Icon";
import { Text } from "./Text";

export interface BadgeProps {
  label: string;
  tone?: Tone;
  icon?: IconName;
  /** Solid fill for high-emphasis states; soft fill by default. */
  emphasis?: "soft" | "solid";
}

/** Status marker. Always text + color (never color alone). Not interactive: use Chip for that. */
export function Badge({ label, tone = "neutral", icon, emphasis = "soft" }: BadgeProps) {
  const t = useTokens();
  const tc = toneColors(t.color, tone);
  const fg = emphasis === "solid" ? t.color.text.onAccent : tc.fg;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: t.space.xs,
        paddingHorizontal: t.space.sm,
        paddingVertical: t.space.xxs,
        borderRadius: t.radius.sm,
        backgroundColor: emphasis === "solid" ? tc.solid : tc.bg,
      }}
    >
      {icon && <Icon name={icon} size={12} color={fg} />}
      <Text variant="caption" weight="semibold" style={{ color: fg }} maxFontSizeMultiplier={1.5}>
        {label}
      </Text>
    </View>
  );
}
