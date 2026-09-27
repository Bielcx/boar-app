import React from "react";
import { View } from "react-native";
import { useTokens } from "../theme";

/**
 * Catalog rows inside one Section. Section insets every item after the first
 * (it is made for list rows), which shifted whole catalog cards to the right
 * (Prism KN-2); here the rows are one Section item, split by inset hairlines.
 */
export function CatalogList({ children }: { children: React.ReactNode }) {
  const t = useTokens();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 && <View style={{ height: t.size.hairline, backgroundColor: t.color.line.hairline, marginLeft: t.space.base }} />}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}
