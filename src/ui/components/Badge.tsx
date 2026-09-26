import React from "react";
import { View } from "react-native";
import { toneColors, Tone, useTokens } from "../theme";
import { Icon, IconName } from "./Icon";
import { Text } from "./Text";

export interface BadgeProps {
  label: string;
  tone?: Tone;
  icon?: IconName;
  /**
   * Mockup status seals: `solid` = ACTIVE (ember fill), `soft` = CACHED
   * (quiet fill), `outline` = DOWNLOADING (tone outline) / NOT ON DISK (neutral outline).
   */
  emphasis?: "soft" | "solid" | "outline";
  /** Leading dot, for compatibility seals ("Fits this device"). */
  dot?: boolean;
  /** Uppercase letterspaced seal (default) or sentence case. */
  caps?: boolean;
}

/** Status marker. Always text + color (never color alone). Not interactive: use Chip for that. */
export function Badge({ label, tone = "neutral", icon, emphasis = "soft", dot, caps = true }: BadgeProps) {
  const t = useTokens();
  const tc = toneColors(t.color, tone);
  const fg = emphasis === "solid" ? t.color.text.onAccent : tone === "neutral" && emphasis === "outline" ? t.color.text.secondary : tc.fg;
  const bg = emphasis === "solid" ? tc.solid : emphasis === "outline" ? "transparent" : tc.bg;
  const border = emphasis === "outline" ? (tone === "neutral" ? t.color.line.strong : tc.fg) : "transparent";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: t.space.xs + 2,
        paddingHorizontal: t.space.sm + 2,
        paddingVertical: 3,
        borderRadius: t.radius.full,
        backgroundColor: bg,
        borderWidth: emphasis === "outline" ? t.size.border : 0,
        borderColor: border,
      }}
    >
      {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: fg }} />}
      {icon && <Icon name={icon} size={13} color={fg} />}
      <Text variant={caps ? "label" : "footnote"} weight={caps ? undefined : "semibold"} style={{ color: fg }} maxFontSizeMultiplier={1.5}>
        {label}
      </Text>
    </View>
  );
}
