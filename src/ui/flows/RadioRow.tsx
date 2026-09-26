import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, Text } from "../components";
import { useTokens } from "../theme";
import { selection } from "../../services/haptics";

interface Props {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}

/** One option of a single-choice list. Wrap a group in a View with accessibilityRole="radiogroup". */
export function RadioRow({ title, subtitle, selected, onPress }: Props) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ checked: selected }}
      onPress={() => {
        selection();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        { minHeight: t.size.touch + 4, paddingHorizontal: t.space.base, paddingVertical: t.space.md, gap: t.space.md },
        pressed && { backgroundColor: t.color.bg.sunken },
      ]}
    >
      <View style={styles.body}>
        <Text variant="body">{title}</Text>
        {subtitle && (
          <Text variant="footnote" color="secondary">
            {subtitle}
          </Text>
        )}
      </View>
      <View style={{ width: 24 }}>{selected && <Icon name="check" color={t.color.accent.text} />}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  body: { flex: 1, gap: 2 },
});
