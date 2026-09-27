import React from "react";
import { Platform, View } from "react-native";
import { useTokens } from "../theme";
import { Text } from "./Text";
import type { TextColor } from "./Text";

export interface StatProps {
  /** The number, already formatted ("978", "62", "1.4"). */
  value: string;
  /** Unit drawn smaller after the number ("MB", "%", "tok/s"). */
  unit?: string;
  /** Overline above the number ("DOWNLOAD", "DOWNLOADING WEIGHTS"). */
  label?: string;
  /** xl = the screen's one figure (56, download %), lg = 34, md = card lead (26), sm = inline trailing figure (17). */
  size?: "xl" | "lg" | "md" | "sm";
  align?: "left" | "right";
  color?: TextColor;
}

/** Trim of the hero's extra leading, per platform (measured on device against the mockup). */
function xlTrim(size: number) {
  return Platform.OS === "android"
    ? { marginTop: -size * 0.125, marginBottom: -size * 0.13 }
    : { marginTop: size * 0.09, marginBottom: -size * 0.325 };
}

const VALUE_VARIANT = { xl: "hero", lg: "display", md: "title1", sm: "headline" } as const;
const UNIT_VARIANT = { xl: "title2", lg: "title3", md: "headline", sm: "footnote" } as const;

/** A number that leads: big, tabular, with its unit and an optional overline. One per card at most. */
export function Stat({ value, unit, label, size = "md", align = "left", color = "primary" }: StatProps) {
  const t = useTokens();
  // Mockup: a percentage is one run ("62%" at the figure's size); other units ("MB", "tok/s") sit smaller.
  const joined = unit === "%";
  const shown = joined ? `${value}%` : value;
  return (
    <View
      accessible
      accessibilityLabel={[label, unit ? `${value} ${unit}` : value].filter(Boolean).join(": ")}
      style={{ alignItems: align === "right" ? "flex-end" : "flex-start", gap: t.space.sm + t.space.xxs }}
    >
      {label ? <Text variant="label" color="field">{label}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: t.space.xxs }}>
        <Text
          variant={VALUE_VARIANT[size]}
          color={color}
          numeric
          header={false}
          // xl: `hero` keeps a 1.2 line box so iOS doesn't clip Baloo's ascenders; the digits sit high in
          // it, so the trim is asymmetric (measured on device vs the mockup, Prism 2e7a026): +0.09 of the
          // size above (overline → digits 21.5 pt) and -0.325 below (digits → bar 21 pt).
          // Android centres the digits in the line box, so there the trim is symmetric (Prism A3-1, 34efdf8:
          // overline→digits 33.5 and digits→bar 10 with the iOS values).
          style={size === "xl" ? xlTrim(t.type.hero.fontSize ?? 0) : undefined}
        >
          {shown}
        </Text>
        {unit && !joined ? (
          <Text variant={UNIT_VARIANT[size]} color="secondary" numeric>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
