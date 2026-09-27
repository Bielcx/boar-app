/**
 * The JS continuation of the native splash (FIDELITY, Iris): the same image,
 * at the same place, so the hand-over does not move, plus what the native
 * splash can't show: the tagline, an indeterminate bar and an honest status
 * while the boot reads the disk. Rendered by App.tsx only while the initial
 * route is unknown; App.tsx hides the native splash on its first layout.
 */
import React, { useMemo } from "react";
import { Image, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Progress, Text } from "../components";
import { buildTokens } from "../theme";

// The native splash per platform (app.json, expo-splash-screen): iOS, the full-screen image in cover;
// Android keeps the centred 360 pt asset (its 12+ splash API ignores cover). Drawn here the same way.
const ANDROID_W = 360;
const ANDROID_H = 366; // splash-icon-android.png is 1440×1464, shown at imageWidth 360
// The mockup's splash (393×852): tagline at y571, i.e. 145 pt below the window's centre;
// bar 140×4 at y762 and status at y776, i.e. 90 and 76 pt from the bottom.
const TAGLINE_FROM_CENTRE = 145;
const BAR_W = 140;
const BAR_FROM_BOTTOM = 90;
const STATUS_FROM_BOTTOM = 76;

export function BootSplash({ onFirstLayout, textReady = true }: { onFirstLayout?: () => void; textReady?: boolean }) {
  const { t } = useTranslation();
  // Always the native splash's colours (dark Fogueira, #17110D), whatever theme the user picked:
  // the opaque image is composed on that canvas, so any other background would show a seam.
  const tokens = useMemo(() => buildTokens("dark", "standard", "fogueira"), []);
  const { width, height } = useWindowDimensions();
  return (
    <View
      onLayout={onFirstLayout}
      accessible
      accessibilityLabel={t("flows.onboarding.bootChecking")}
      style={{ flex: 1, backgroundColor: tokens.color.bg.canvas }}
    >
      {/* Same image, same framing as the native splash; both keep the window's centre, so the offsets below hold. */}
      {Platform.OS === "android" ? (
        <Image
          source={require("../../../assets/splash-icon-android.png")}
          resizeMode="contain"
          accessible={false}
          style={{ position: "absolute", width: ANDROID_W, height: ANDROID_H, left: (width - ANDROID_W) / 2, top: (height - ANDROID_H) / 2 }}
        />
      ) : (
        <Image source={require("../../../assets/splash-icon.png")} resizeMode="cover" accessible={false} style={StyleSheet.absoluteFill} />
      )}
      {/* Text waits for the brand fonts, so it never swaps face on screen. */}
      {textReady && (
        <Text
          variant="subhead"
          align="center"
          style={{ position: "absolute", left: 0, right: 0, top: height / 2 + TAGLINE_FROM_CENTRE, color: tokens.color.field.text }}
        >
          {t("flows.onboarding.brandSub")}
        </Text>
      )}
      <View style={{ position: "absolute", width: BAR_W, left: (width - BAR_W) / 2, top: height - BAR_FROM_BOTTOM }}>
        <Progress label={t("flows.onboarding.bootChecking")} height={tokens.space.xs} />
      </View>
      {textReady && (
        <Text
          variant="footnote"
          align="center"
          style={{ position: "absolute", left: 0, right: 0, top: height - STATUS_FROM_BOTTOM, color: tokens.color.text.secondary }}
        >
          {t("flows.onboarding.bootChecking")}
        </Text>
      )}
    </View>
  );
}
