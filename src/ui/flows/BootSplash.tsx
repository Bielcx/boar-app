/**
 * The JS continuation of the native splash (FIDELITY, Iris): the same image,
 * at the same place, so the hand-over does not move, plus what the native
 * splash can't show: the tagline, an indeterminate bar and an honest status
 * while the boot reads the disk. Rendered by App.tsx only while the initial
 * route is unknown; App.tsx hides the native splash on its first layout.
 */
import React from "react";
import { Image, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Progress, Text } from "../components";
import { useTokens } from "../theme";

// The native splash's image (app.json: expo-splash-screen, imageWidth 360, contain), centred in the window.
const SPLASH_W = 360;
const SPLASH_H = 366;
// The mockup's splash (393×852): tagline at y571, i.e. 145 pt below the window's centre;
// bar 140×4 at y762 and status at y776, i.e. 90 and 76 pt from the bottom.
const TAGLINE_FROM_CENTRE = 145;
const BAR_W = 140;
const BAR_FROM_BOTTOM = 90;
const STATUS_FROM_BOTTOM = 76;

export function BootSplash({ onFirstLayout }: { onFirstLayout?: () => void }) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const { width, height } = useWindowDimensions();
  return (
    <View
      onLayout={onFirstLayout}
      accessible
      accessibilityLabel={t("flows.onboarding.bootChecking")}
      style={{ flex: 1, backgroundColor: tokens.color.bg.canvas }}
    >
      <Image
        source={require("../../../assets/splash-icon.png")}
        resizeMode="contain"
        accessible={false}
        style={{ position: "absolute", width: SPLASH_W, height: SPLASH_H, left: (width - SPLASH_W) / 2, top: (height - SPLASH_H) / 2 }}
      />
      <Text
        variant="subhead"
        color="field"
        align="center"
        style={{ position: "absolute", left: 0, right: 0, top: height / 2 + TAGLINE_FROM_CENTRE }}
      >
        {t("flows.onboarding.brandSub")}
      </Text>
      <View style={{ position: "absolute", width: BAR_W, left: (width - BAR_W) / 2, top: height - BAR_FROM_BOTTOM }}>
        <Progress label={t("flows.onboarding.bootChecking")} height={tokens.space.xs} />
      </View>
      <Text
        variant="footnote"
        color="secondary"
        align="center"
        style={{ position: "absolute", left: 0, right: 0, top: height - STATUS_FROM_BOTTOM }}
      >
        {t("flows.onboarding.bootChecking")}
      </Text>
    </View>
  );
}
