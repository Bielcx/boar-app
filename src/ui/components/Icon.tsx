import React from "react";
import Feather from "@expo/vector-icons/Feather";
import { useTokens } from "../theme";

/**
 * Single icon set for the whole app: Feather (stroke icons, consistent 2px
 * weight), bundled with the app so it works offline. No emoji as icons.
 */
export type IconName = React.ComponentProps<typeof Feather>["name"];

export interface IconProps {
  name: IconName;
  size?: "sm" | "md" | "lg" | number;
  color?: string;
  /** Icons are decorative by default; give a label only when the icon alone carries meaning. */
  label?: string;
}

export function Icon({ name, size = "md", color, label }: IconProps) {
  const t = useTokens();
  const px = typeof size === "number" ? size : { sm: t.size.iconSm, md: t.size.icon, lg: t.size.iconLg }[size];
  return (
    <Feather
      name={name}
      size={px}
      color={color ?? t.color.text.secondary}
      accessible={!!label}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
    />
  );
}
