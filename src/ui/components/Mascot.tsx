import React from "react";
import { Image, View } from "react-native";
import { useTokens } from "../theme";
import { mascotGlow } from "../theme/ambient";
import { discImage } from "./mascotFrame";

export interface MascotProps {
  /**
   * Whole boar: hero 170 (chat empty state), md 120 (model loading/error, download hero).
   * Face in an accent disc: brand 48 (setup brand line), avatar 42 (chat header), avatarSm 26 (message row).
   */
  size?: "hero" | "md" | "brand" | "avatar" | "avatarSm";
  /** Whole boar only: the ember glow under it (empty state, download hero). */
  glow?: boolean;
  /** Dimmed while waiting (model loading, failed load). */
  dim?: boolean;
}

const SIZE_TOKEN = { hero: "mascot", md: "mascotMd", brand: "mascotSm", avatar: "avatar", avatarSm: "avatarSm" } as const;
const SOURCE = require("../../../assets/mascot.png");

/**
 * The boar from the user's identity file (transparent asset), drawn the two
 * ways the mockup does: whole at hero size, or the face framed in an accent
 * disc at small sizes. Decorative: the text next to it carries the meaning.
 */
export function Mascot({ size = "hero", glow, dim }: MascotProps) {
  const t = useTokens();
  const side = t.size[SIZE_TOKEN[size]];
  const hidden = { accessible: false, importantForAccessibility: "no-hide-descendants" as const, accessibilityElementsHidden: true };

  if (size !== "hero" && size !== "md") {
    const img = discImage(side);
    return (
      <View
        {...hidden}
        style={{
          width: side,
          height: side,
          borderRadius: side / 2,
          overflow: "hidden",
          backgroundColor: t.color.accent.solid,
          opacity: dim ? 0.55 : 1,
        }}
      >
        <Image
          source={SOURCE}
          style={{ position: "absolute", width: img.size, height: img.size, left: img.left, top: img.top }}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }

  return (
    <View {...hidden} style={{ width: side, height: side, opacity: dim ? 0.55 : 1 }}>
      {glow && !dim && (
        // An ellipse 10% wider than the boar whose peak (60% down the box) sits at its feet;
        // the box spans 0.5..1.3 of the boar's height so the glow fades out inside it.
        <View
          style={{
            position: "absolute",
            left: -side * 0.05,
            right: -side * 0.05,
            top: side * 0.5,
            height: side * 0.8,
            experimental_backgroundImage: mascotGlow(t.color.glow),
          }}
        />
      )}
      <Image source={SOURCE} style={{ width: side, height: side }} resizeMode="contain" accessibilityIgnoresInvertColors />
    </View>
  );
}
