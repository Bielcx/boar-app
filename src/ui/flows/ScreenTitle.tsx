/**
 * LT-1 fallback: the screen's own large title when the native header shows only
 * Back. 18 pt below the header like the setup (Screen pads 16, plus 2), 14 pt to
 * the first block through screenRhythm. It must be the content's first child so
 * it is first in reading order, and it takes accessibility focus whenever the
 * screen gains focus (Prism, same as the setup's titleRef).
 */
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef } from "react";
import { AccessibilityInfo, findNodeHandle, type Text as RNText } from "react-native";
import { Text } from "../components";
import { useTokens } from "../theme";

export function ScreenTitle({ children }: { children: string }) {
  const tokens = useTokens();
  const ref = useRef<RNText>(null);
  useFocusEffect(
    useCallback(() => {
      const node = ref.current && findNodeHandle(ref.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, []),
  );
  return (
    <Text ref={ref} variant="title1" header style={{ marginTop: tokens.space.xxs }}>
      {children}
    </Text>
  );
}
