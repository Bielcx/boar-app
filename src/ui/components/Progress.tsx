import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import { useTheme } from "../theme";

export interface ProgressProps {
  /** 0..1. Omit for indeterminate. */
  value?: number;
  /** Spoken value, e.g. "340 of 1,020 MB". Defaults to the percentage. */
  valueText?: string;
  label: string;
  tone?: "accent" | "field" | "danger";
  height?: number;
}

/** Linear progress. Determinate when `value` is set; otherwise an indeterminate sweep (static under reduce motion). */
export function Progress({ value, valueText, label, tone = "accent", height = 6 }: ProgressProps) {
  const { tokens: t, reduceMotion } = useTheme();
  const sweep = useRef(new Animated.Value(0)).current;
  const indeterminate = value === undefined;
  const fill = tone === "danger" ? t.color.status.danger.solid : tone === "field" ? t.color.field.solid : t.color.accent.solid;

  useEffect(() => {
    if (!indeterminate || reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [indeterminate, reduceMotion, sweep]);

  const pct = value === undefined ? 0 : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: indeterminate }}
      accessibilityValue={indeterminate ? { text: valueText } : { min: 0, max: 100, now: pct, text: valueText ?? `${pct}%` }}
      style={{ height, borderRadius: height, backgroundColor: t.color.bg.sunken, overflow: "hidden" }}
    >
      {indeterminate ? (
        <Animated.View
          style={{
            width: "40%",
            height: "100%",
            borderRadius: height,
            backgroundColor: fill,
            opacity: reduceMotion ? 0.5 : 1,
            transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-160, 400] }) }],
          }}
        />
      ) : (
        <View style={{ width: `${pct}%`, height: "100%", borderRadius: height, backgroundColor: fill }} />
      )}
    </View>
  );
}
