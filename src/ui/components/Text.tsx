import React from "react";
import { Text as RNText, TextProps as RNTextProps } from "react-native";
import { useTokens } from "../theme";
import type { TextVariant } from "../theme";

export type TextColor = "primary" | "secondary" | "tertiary" | "accent" | "field" | "onAccent" | "danger" | "success" | "warning";

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
  /** Tabular figures for values that update in place (tok/s, sizes, counters). */
  numeric?: boolean;
  weight?: "regular" | "medium" | "semibold" | "bold";
  align?: "left" | "center" | "right";
  /** Exposes the text as a heading to screen readers. Defaults on for display/title variants. */
  header?: boolean;
}

const WEIGHTS = { regular: "400", medium: "500", semibold: "600", bold: "700" } as const;
const HEADER_VARIANTS: TextVariant[] = ["display", "title1", "title2", "title3"];

/** The only way to draw text. Respects the OS font scale and the in-app size preference. */
export function Text({
  variant = "body",
  color = "primary",
  numeric,
  weight,
  align,
  header,
  style,
  ...rest
}: TextProps) {
  const t = useTokens();
  const { maxFontSizeMultiplier, ...typeStyle } = t.type[variant];
  const colorValue = {
    primary: t.color.text.primary,
    secondary: t.color.text.secondary,
    tertiary: t.color.text.tertiary,
    accent: t.color.text.accent,
    field: t.color.text.field,
    onAccent: t.color.text.onAccent,
    danger: t.color.status.danger.solid,
    success: t.color.status.success.solid,
    warning: t.color.status.warning.solid,
  }[color];
  const isHeader = header ?? HEADER_VARIANTS.includes(variant);
  return (
    <RNText
      accessibilityRole={isHeader ? "header" : rest.accessibilityRole}
      maxFontSizeMultiplier={rest.maxFontSizeMultiplier ?? maxFontSizeMultiplier}
      style={[
        typeStyle,
        { color: colorValue },
        numeric && { fontVariant: ["tabular-nums"] },
        weight && { fontWeight: WEIGHTS[weight] },
        align && { textAlign: align },
        style,
      ]}
      {...rest}
    />
  );
}
