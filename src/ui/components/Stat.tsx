import React from "react";
import { View } from "react-native";
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

const VALUE_VARIANT = { xl: "hero", lg: "display", md: "title1", sm: "headline" } as const;
const UNIT_VARIANT = { xl: "title2", lg: "title3", md: "headline", sm: "footnote" } as const;

/** A number that leads: big, tabular, with its unit and an optional overline. One per card at most. */
export function Stat({ value, unit, label, size = "md", align = "left", color = "primary" }: StatProps) {
  const t = useTokens();
  return (
    <View
      accessible
      accessibilityLabel={[label, unit ? `${value} ${unit}` : value].filter(Boolean).join(": ")}
      style={{ alignItems: align === "right" ? "flex-end" : "flex-start", gap: t.space.xs }}
    >
      {label ? <Text variant="label" color="field">{label}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: t.space.xxs }}>
        <Text variant={VALUE_VARIANT[size]} color={color} numeric header={false}>
          {value}
        </Text>
        {unit ? (
          <Text variant={UNIT_VARIANT[size]} color="secondary" numeric>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
