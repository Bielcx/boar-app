import React from "react";
import { Pressable, View, ViewStyle } from "react-native";
import { selection } from "../../services/haptics";
import { useTokens } from "../theme";
import { Icon } from "./Icon";
import { MetaLine } from "./MetaLine";
import { Text } from "./Text";

export interface OptionCardProps {
  title: string;
  selected: boolean;
  onPress: () => void;
  /** Sits on the title's line, right after it (e.g. a RECOMMENDED `<Badge>`). */
  badge?: React.ReactNode;
  /** Right-aligned on the title's line: the figure that decides (size, speed). A string renders as a tabular headline. */
  trailing?: React.ReactNode;
  description?: string;
  /** One line of secondary facts (see `MetaLine`). */
  meta?: (string | false | null | undefined)[];
  /** Before the title, e.g. a language monogram. */
  leading?: React.ReactNode;
  /** `radio` (default) on the left for lists; `check` on the right for compact side-by-side cards; `none`. */
  indicator?: "radio" | "check" | "none";
  disabled?: boolean;
  accessibilityHint?: string;
  children?: React.ReactNode;
}

/**
 * A choice among siblings (install tier, model, language). Selection is carried
 * by three cues at once: accent border, raised surface, filled indicator;
 * never the border alone.
 */
export function OptionCard({
  title,
  selected,
  onPress,
  badge,
  trailing,
  description,
  meta,
  leading,
  indicator = "radio",
  disabled,
  accessibilityHint,
  children,
}: OptionCardProps) {
  const t = useTokens();
  const restBorder = t.scheme === "light" ? t.color.line.hairline : "transparent";
  const frame = (pressed: boolean): ViewStyle => ({
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.space.md,
    minHeight: t.size.touch,
    padding: t.space.base,
    borderRadius: t.radius.lg,
    borderWidth: 1.5,
    borderColor: selected ? t.color.accent.solid : restBorder,
    // Selected rises to `raised` (mockup): an accent.soft wash would swallow soft accent badges.
    backgroundColor: selected || pressed ? t.color.bg.raised : t.color.bg.surface,
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected, disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={() => {
        if (!selected) selection();
        onPress();
      }}
      style={({ pressed }) => frame(pressed)}
    >
      {indicator === "radio" && <Radio on={selected} />}
      {leading}
      <View style={{ flex: 1, gap: t.space.xs }}>
        {/* Title and badge wrap together; the deciding figure keeps its column on the right. */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: t.space.sm }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: t.space.sm, rowGap: t.space.xs }}>
            <Text variant="headline" style={{ flexShrink: 1 }}>
              {title}
            </Text>
            {badge}
          </View>
          {trailing !== undefined && (
            <View style={{ flexShrink: 0 }}>
              {typeof trailing === "string" ? (
                <Text variant="headline" numeric>
                  {trailing}
                </Text>
              ) : (
                trailing
              )}
            </View>
          )}
        </View>
        {description ? (
          <Text variant="footnote" color="secondary">
            {description}
          </Text>
        ) : null}
        {meta ? <MetaLine items={meta} /> : null}
        {children}
      </View>
      {indicator === "check" && (
        <View style={{ width: t.size.icon, opacity: selected ? 1 : 0 }}>
          <Icon name="check" color={t.color.accent.text} />
        </View>
      )}
    </Pressable>
  );
}

function Radio({ on }: { on: boolean }) {
  const t = useTokens();
  const d = t.size.icon + 2;
  return (
    <View
      style={{
        width: d,
        height: d,
        // Optically centred on the headline's first line.
        marginTop: 1,
        borderRadius: d / 2,
        borderWidth: 2,
        borderColor: on ? t.color.accent.solid : t.color.line.strong,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && <View style={{ width: d / 2, height: d / 2, borderRadius: d / 4, backgroundColor: t.color.accent.solid }} />}
    </View>
  );
}
