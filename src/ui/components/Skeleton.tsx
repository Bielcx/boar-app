import React, { useEffect, useRef } from "react";
import { Animated, DimensionValue } from "react-native";
import { useTheme } from "../theme";

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
}

/**
 * Loading placeholder. Hidden from screen readers: the screen announces
 * "loading" once (useAnnounce) instead. Pulses gently; static under reduce motion.
 */
export function Skeleton({ width = "100%", height = 14, radius }: SkeletonProps) {
  const { tokens: t, reduceMotion } = useTheme();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width,
        height,
        borderRadius: radius ?? t.radius.xs,
        backgroundColor: t.color.bg.sunken,
        opacity: pulse,
      }}
    />
  );
}
