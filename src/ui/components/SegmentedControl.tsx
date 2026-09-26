import React from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { selection } from "../../services/haptics";
import { useTokens } from "../theme";
import { Icon, IconName } from "./Icon";
import { Text } from "./Text";

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
}

/**
 * 2-4 mutually exclusive options. Exposed as a radio group. Falls back to a
 * vertical list at large text sizes so long labels never truncate.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: SegmentedControlProps<T>) {
  const t = useTokens();
  const { fontScale } = useWindowDimensions();
  const vertical = fontScale >= 1.35;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{
        flexDirection: vertical ? "column" : "row",
        padding: 3,
        gap: 3,
        borderRadius: t.radius.md,
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
            onPress={() => {
              if (selected) return;
              selection();
              onChange(opt.value);
            }}
            style={({ pressed }) => [
              {
                flex: vertical ? undefined : 1,
                minHeight: t.size.touch,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: vertical ? "flex-start" : "center",
                gap: t.space.xs,
                paddingHorizontal: t.space.sm,
                borderRadius: t.radius.sm,
                backgroundColor: selected ? t.color.bg.raised : "transparent",
                // Selection is marked by border + weight + check, not by fill alone.
                borderWidth: selected ? t.size.border : 0,
                borderColor: t.color.line.strong,
                ...(selected ? (t.elevation[1] as object) : null),
              },
              pressed && !selected && { opacity: 0.6 },
            ]}
          >
            {selected && !opt.icon && <Icon name="check" size="sm" color={t.color.text.primary} />}
            {opt.icon && <Icon name={opt.icon} size="sm" color={selected ? t.color.text.primary : t.color.text.secondary} />}
            <Text variant="subhead" color={selected ? "primary" : "secondary"} weight={selected ? "semibold" : "medium"}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
