import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../theme";
import { AMBIENT_LIGHT_STRENGTH, emberGradient, MOON_ALPHA } from "../theme/ambient";

/**
 * The identity's "pattern of light", drawn behind a screen's content:
 * Fogueira = ember glow rising from the bottom; Luar = a faint full moon at
 * the top right. Decorative (hidden from screen readers), static, so it
 * needs no reduce-motion handling. Uses RN's CSS radial-gradient
 * (`experimental_backgroundImage`); where unsupported it renders nothing.
 */
export function Ambient() {
  const { tokens: t, palette } = useTheme();
  const g = t.color.glow;
  const strength = t.scheme === "dark" ? 1 : AMBIENT_LIGHT_STRENGTH;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      {palette === "luar" ? (
        <View
          style={{
            position: "absolute",
            right: -80,
            top: -80,
            width: 220,
            height: 220,
            borderRadius: 999,
            backgroundColor: t.color.moon,
            opacity: MOON_ALPHA,
          }}
        />
      ) : (
        <View
          style={{
            position: "absolute",
            left: -60,
            right: -60,
            bottom: -170,
            height: 440,
            opacity: strength,
            experimental_backgroundImage: emberGradient(g),
          }}
        />
      )}
    </View>
  );
}
