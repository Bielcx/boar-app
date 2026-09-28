import React from "react";
import { Pressable, View, ViewStyle } from "react-native";
import { selection } from "../../services/haptics";
import { useTokens } from "../theme";
import { IconSlot, LineSlot, useOpticalLine } from "./IconText";
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
  // Mockup: a title-only card (language) centres its row; with a description the radio sits at the top.
  const titleOnly = !description && !meta && !children;
  // Radio and check sit on the title's first line (iOS draws Baloo ~3.6 pt above its box middle).
  const line = useOpticalLine("cardTitle");
  const frame = (pressed: boolean): ViewStyle => ({
    flexDirection: "row",
    alignItems: titleOnly ? "center" : "flex-start",
    // Mockup: 10/12 padding, radius 18, 2 pt border, 10 pt from the radio to the text.
    gap: t.space.sm + t.space.xxs,
    minHeight: t.size.touch,
    paddingVertical: t.space.sm + t.space.xxs,
    paddingHorizontal: t.space.md,
    borderRadius: t.radius.card,
    borderWidth: t.size.focusRing,
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
      {indicator === "radio" && (
        <LineSlot line={line}>
          <Radio on={selected} />
        </LineSlot>
      )}
      {/* A title-only card centres its row on the box; the title's glyphs ride on its optical line
          (iOS ~3.6 pt high), so a leading disc moves with them (Prism FL-21). */}
      {leading && titleOnly ? <View style={{ transform: [{ translateY: line.offset }] }}>{leading}</View> : leading}
      <View style={{ flex: 1, gap: t.space.xxs }}>
        {/* Title and badge wrap together; the deciding figure keeps its column on the right. */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: t.space.sm }}>
          {/* The badge sits on the title's optical line, not its box middle (Prism FD-2, icon-align §7). */}
          <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", columnGap: t.space.sm, rowGap: t.space.xs }}>
            <Text
              variant="cardTitle"
              style={{ flexShrink: 1 }}
              // A title-only card is one line in the mockup; a long translation shrinks instead of wrapping.
              {...(titleOnly ? { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.8 } : null)}
            >
              {title}
            </Text>
            {badge ? <LineSlot line={line}>{badge}</LineSlot> : null}
          </View>
          {trailing !== undefined && (
            <View style={{ flexShrink: 0 }}>
              {typeof trailing === "string" ? (
                // Mockup: the size sits small and quiet on the right (11 px mu → 12 pt floor).
                <Text variant="caption" color="secondary" numeric>
                  {trailing}
                </Text>
              ) : (
                trailing
              )}
            </View>
          )}
        </View>
        {description ? (
          <Text variant="caption" color="secondary">
            {description}
          </Text>
        ) : null}
        {meta ? <MetaLine items={meta} /> : null}
        {children}
      </View>
      {/* Mockup: only the selected card shows the check, so an unselected title keeps the full width. */}
      {indicator === "check" && selected && (
        <IconSlot name="check" line={line} color={t.color.accent.text} edge="end" />
      )}
    </Pressable>
  );
}

function Radio({ on }: { on: boolean }) {
  const t = useTokens();
  // Mockup: 18 pt ring, 2 pt border, 8 pt dot.
  const d = t.size.iconSm + t.space.xxs;
  return (
    <View
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        borderWidth: t.size.focusRing,
        // Unselected ring keeps the 3:1 control border (the mockup's bd would fail WCAG 1.4.11).
        borderColor: on ? t.color.accent.solid : t.color.line.strong,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && <View style={{ width: t.space.sm, height: t.space.sm, borderRadius: t.radius.full, backgroundColor: t.color.accent.solid }} />}
    </View>
  );
}
