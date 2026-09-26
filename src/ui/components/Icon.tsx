import React from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useTokens } from "../theme";
import { iconA11yProps } from "./iconA11y";

/**
 * Single icon set for the whole app: Feather (stroke icons, consistent 2px
 * weight), bundled with the app so it works offline. No emoji as icons.
 * This is the only file allowed to import @expo/vector-icons (iconA11y.test.ts).
 */
export type IconName = React.ComponentProps<typeof Feather>["name"];

export interface IconProps {
  name: IconName;
  size?: "sm" | "md" | "lg" | number;
  color?: string;
  /**
   * Icons are decorative by default and removed from the accessibility tree.
   * Give a label only when the icon alone carries meaning outside a control
   * (a status glyph with no text). Icon-only buttons use IconButton, whose
   * `label` is required.
   */
  label?: string;
}

export function Icon({ name, size = "md", color, label }: IconProps) {
  const t = useTokens();
  const px = typeof size === "number" ? size : { sm: t.size.iconSm, md: t.size.icon, lg: t.size.iconLg }[size];
  const a11y = iconA11yProps(label);
  return (
    <View {...a11y.wrapper} pointerEvents="none" style={{ width: px, height: px, alignItems: "center", justifyContent: "center" }}>
      <Feather name={name} size={px} color={color ?? t.color.text.secondary} {...a11y.glyph} />
    </View>
  );
}
