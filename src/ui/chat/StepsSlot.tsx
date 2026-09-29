import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { useMotion } from "../theme/motion";
import { slotHold } from "./stepsSlotHold";

/**
 * The steps card and the answer's text in one slot (SEND-MOTION v2 P3). When the text starts, the card
 * leaves with the DS crossfade (its short half) and the text enters in the same place; the slot holds the
 * card's height in that same render (a plain style, no frame where it is cut or jumps). When the answer is
 * over (`released`), the hold goes with the DS animateNextLayout. History (no card) renders the text only.
 */
export function StepsSlot({ steps, body, released }: { steps: ReactNode | null; body: ReactNode | null; released: boolean }) {
  const m = useMotion();
  const x = useMemo(() => m.crossfade("none"), [m]);
  const reserve = useRef(0);
  const [letGo, setLetGo] = useState(false);
  useEffect(() => {
    if (!released || letGo || reserve.current <= 0) return;
    m.animateNextLayout();
    setLetGo(true);
  }, [released, letGo, m]);
  const hold = slotHold(!!steps, reserve.current, letGo);
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={hold != null ? { minHeight: hold } : undefined}>
        {steps ? (
          <Animated.View key="steps" exiting={x.exiting} onLayout={(e) => (reserve.current = e.nativeEvent.layout.height)}>
            {steps}
          </Animated.View>
        ) : body ? (
          <Animated.View key="body" entering={x.entering}>
            {body}
          </Animated.View>
        ) : null}
      </View>
    </LayoutAnimationConfig>
  );
}
