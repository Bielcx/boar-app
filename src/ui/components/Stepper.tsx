import React from "react";
import { View } from "react-native";
import { useTokens } from "../theme";
import { Text } from "./Text";

export interface StepperProps {
  /** Short step names, already translated ("Hardware", "Model", "Install", "Index"). */
  steps: string[];
  /** 0-based index of the current step. Steps before it read as done. */
  current: number;
  /** Spoken summary, e.g. "Step 2 of 4: Model". The visual labels are hidden from screen readers. */
  accessibilityLabel: string;
}

/**
 * Segmented progress for a linear flow. Labels are sentence case at caption size:
 * the mockup's 10.5pt caps overline does not fit four columns at our 12pt floor.
 */
export function Stepper({ steps, current, accessibilityLabel }: StepperProps) {
  const t = useTokens();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}
      style={{ flexDirection: "row", gap: t.space.sm }}
    >
      {steps.map((step, i) => (
        <View key={step} style={{ flex: 1, gap: t.space.sm }} importantForAccessibility="no-hide-descendants">
          <View
            style={{
              height: 3,
              borderRadius: t.radius.full,
              backgroundColor: i <= current ? t.color.accent.solid : t.color.bg.raised,
            }}
          />
          <Text
            variant="caption"
            weight={i === current ? "semibold" : "regular"}
            color={i === current ? "primary" : "secondary"}
            numberOfLines={2}
            maxFontSizeMultiplier={1.3}
          >
            {step}
          </Text>
        </View>
      ))}
    </View>
  );
}
