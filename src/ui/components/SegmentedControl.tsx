import React, { useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { selection } from "../../services/haptics";
import { icon as iconTokens, useTokens } from "../theme";
import type { IconName } from "./Icon";
import { IconText } from "./IconText";
import { segmentsFit } from "./segmentFit";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Name of the group for screen readers, e.g. "Appearance". */
  label: string;
  /** `compact`: a slimmer track for forms (segments keep a full touch target via hitSlop). */
  size?: "regular" | "compact";
}

/** Compact segments are this much shorter than the touch minimum; hitSlop gives it back. */
const COMPACT_INSET = 8;

/**
 * 2-4 mutually exclusive options. Exposed as a radio group. Falls back to a
 * vertical list whenever the longest label would not fit its column, so labels never break.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label, size = "regular" }: SegmentedControlProps<T>) {
  const t = useTokens();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const compact = size === "compact";
  const inset = compact ? 2 : 3;
  // Stack when a label would not fit its column (Prism SEG-2: Android's 1.3 is under a fixed 1.35
  // threshold and 'Standard' broke inside its pill). Label size = subhead at the OS font scale.
  const vertical = !segmentsFit({
    width: width - inset * 2,
    count: options.length,
    longestLabel: Math.max(...options.map((o) => o.label.length)),
    fontSize: (t.type.subhead.fontSize ?? 14) * fontScale,
    chrome: t.space.sm * 2 + t.size.iconSm + iconTokens.gapTight,
    gap: inset,
  });
  const slop = compact ? COMPACT_INSET / 2 : 0;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        flexDirection: vertical ? "column" : "row",
        padding: inset,
        gap: inset,
        // Stacked at large text: a pill radius on a tall box bent the options (Prism SEG-1).
        borderRadius: vertical ? t.radius.card : t.radius.full,
        backgroundColor: t.color.bg.sunken,
      }}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityLabel={opt.label}
            accessibilityState={{ checked: selected, selected }}
            hitSlop={{ top: slop, bottom: slop }}
            onPress={() => {
              if (selected) return;
              selection();
              onChange(opt.value);
            }}
            style={({ pressed }) => [
              {
                flex: vertical ? undefined : 1,
                minHeight: compact ? t.size.touch - COMPACT_INSET : t.size.touch,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: vertical ? "flex-start" : "center",
                paddingHorizontal: t.space.sm,
                borderRadius: vertical ? t.radius.md : t.radius.full,
                backgroundColor: selected ? t.color.bg.raised : "transparent",
                // Selection is marked by border + weight + check, not by fill alone.
                borderWidth: selected ? t.size.border : 0,
                borderColor: t.color.line.strong,
                ...(selected ? (t.elevation[1] as object) : null),
              },
              pressed && !selected && { opacity: t.opacity.pressed },
            ]}
          >
            {/* IconText: the chip gap (6) and the glyph on the label's optical line (Prism FD-3). */}
            <IconText
              icon={opt.icon ?? (selected ? "check" : undefined)}
              variant="subhead"
              gap="tight"
              color={selected ? "primary" : "secondary"}
              iconColor={selected ? t.color.text.primary : t.color.text.secondary}
              weight={selected ? "semibold" : "medium"}
            >
              {opt.label}
            </IconText>
          </Pressable>
        );
      })}
    </View>
  );
}
