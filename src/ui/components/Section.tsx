import React from "react";
import { View, ViewProps } from "react-native";
import { useTokens } from "../theme";
import { Text } from "./Text";

export interface SectionProps extends ViewProps {
  title?: string;
  footer?: string;
  /** Wrap children in an inset grouped surface (settings style). */
  inset?: boolean;
}

/** A titled group of rows. With `inset`, rows sit on one rounded surface separated by hairlines. */
export function Section({ title, footer, inset = true, children, style, ...rest }: SectionProps) {
  const t = useTokens();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ gap: t.space.sm }, style]} {...rest}>
      {title && (
        <Text variant="label" color="tertiary" header style={{ paddingHorizontal: t.space.base }}>
          {title}
        </Text>
      )}
      {inset ? (
        <View
          style={{
            backgroundColor: t.color.bg.surface,
            borderRadius: t.radius.md,
            borderWidth: t.size.hairline,
            borderColor: t.color.line.hairline,
            overflow: "hidden",
          }}
        >
          {items.map((child, i) => (
            <View
              key={i}
              style={
                i > 0
                  ? { borderTopWidth: t.size.hairline, borderTopColor: t.color.line.hairline, marginLeft: t.space.base }
                  : undefined
              }
            >
              {child}
            </View>
          ))}
        </View>
      ) : (
        items
      )}
      {footer && (
        <Text variant="footnote" color="tertiary" style={{ paddingHorizontal: t.space.base }}>
          {footer}
        </Text>
      )}
    </View>
  );
}
