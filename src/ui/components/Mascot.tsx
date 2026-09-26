import React from "react";
import { Image } from "react-native";
import { useTokens } from "../theme";

export interface MascotProps {
  /** hero 128 (empty/loading/error states) · brand 56 (horizontal brand line) · avatar 32 · avatarSm 24. */
  size?: "hero" | "brand" | "avatar" | "avatarSm";
  /** Dimmed while waiting (model loading, failed load). */
  dim?: boolean;
}

const SIZE_TOKEN = { hero: "mascot", brand: "mascotSm", avatar: "avatar", avatarSm: "avatarSm" } as const;

/**
 * The boar on a transparent background (from the user's identity file), so it
 * sits on any surface without a box. Decorative: the text next to it carries meaning.
 */
export function Mascot({ size = "hero", dim }: MascotProps) {
  const t = useTokens();
  const side = t.size[SIZE_TOKEN[size]];
  return (
    <Image
      source={require("../../../assets/mascot.png")}
      style={{ width: side, height: side, opacity: dim ? 0.55 : 1 }}
      resizeMode="contain"
      accessible={false}
      importantForAccessibility="no"
      accessibilityIgnoresInvertColors
    />
  );
}
