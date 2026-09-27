/**
 * The JS continuation of the native splash (FIDELITY, Iris): the same image,
 * at the same place, so the hand-over does not move, plus what the native
 * splash can't show: the tagline, an indeterminate bar and an honest status
 * while the boot reads the disk. Rendered by App.tsx only while the initial
 * route is unknown. onFirstLayout (name kept for App.tsx) fires once the splash image is decoded, and App.tsx hides the native splash then.
 */
import React, { useMemo } from "react";
import { Image, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Progress, Text } from "../components";
import { buildTokens } from "../theme";

// The native splash on both platforms (Iris 227c6c6): one 360×366 pt image, centred in the window
// (the iOS storyboard draws a fixed-size centred image, and Android 12+ ignores cover). Drawn here the same way.
const SPLASH_W = 360;
const SPLASH_H = 366;
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
      accessible
      accessibilityLabel={t("flows.onboarding.bootChecking")}
      style={{ flex: 1, backgroundColor: tokens.color.bg.canvas }}
    >
      {/* Same image, same size and place as the native splash, so the hand-over does not move. */}
      {/* The native splash hides only once this image is decoded: hiding on the first layout showed a frame
          with the text and bar but no boar (Prism/Harbor, 37a935e). An error still hands over. */}
      <Image
        source={require("../../../assets/splash-icon.png")}
        resizeMode="contain"
        accessible={false}
        fadeDuration={0}
        onLoad={onFirstLayout}
        onError={onFirstLayout}
        style={{ position: "absolute", width: SPLASH_W, height: SPLASH_H, left: (width - SPLASH_W) / 2, top: (height - SPLASH_H) / 2 }}
      />
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
