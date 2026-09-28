import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTheme } from "../theme";
import { CURVE, type Curve } from "../theme/motionSpec";
import { revealOnLayout, revealTiming } from "./revealTiming";

const curves: Record<Curve, ReturnType<typeof Easing.bezier>> = {
  standard: Easing.bezier(...CURVE.standard),
  enter: Easing.bezier(...CURVE.enter),
  exit: Easing.bezier(...CURVE.exit),
};

/**
 * A block of the answer that enters, leaves or changes height without a jump (SEND-MOTION D2). Its real
 * height animates (0 ↔ the content's), on the UI thread, so the list below and the scroll anchored at
 * the end follow it frame by frame; Reanimated's `layout` only moves the drawing while the list's size
 * changes at once, which is the jump seen when sending. Durations and curves are the DS roles
 * (revealTiming → motionSpec): `layout` for the height, `enter`/`exit` for the fade.
 *
 * - `shown`: false collapses it and then unmounts the content (the last content stays on screen while
 *   it collapses, even if the caller has nothing to render any more).
 * - `appear`: grows from 0 on its first layout (asked in this run); false shows it in place (history).
 *   A block that mounts hidden and shows later always grows.
 * - `spaceBefore`: the gap above it, inside the moving height. A parent's `gap` would stay behind a
 *   block at height 0 and then vanish at once when it unmounts.
 * - `follow`: text that streams. It grows in, then keeps its own height: a 110 ms token batch must not
 *   restart a height animation (the text would lag and clip at the bottom).
 * Height changes of the content after that (a preview collapsing) animate too, except with `follow`.
 */
export function Reveal({
  shown = true,
  appear = true,
  spaceBefore = 0,
  follow = false,
  children,
}: {
  shown?: boolean;
  appear?: boolean;
  spaceBefore?: number;
  follow?: boolean;
  children?: ReactNode;
}) {
  const { reduceMotion } = useTheme();
  const [mounted, setMounted] = useState(shown);
  const grows = useRef(appear || !shown).current;
  const natural = useRef<number | null>(null);
  // Until something has to move, the block keeps its own height (no frame at 0 for history rows).
  const sized = useSharedValue(grows);
  const height = useSharedValue(0);
  const opacity = useSharedValue(grows ? 0 : 1);
  const last = useRef<ReactNode>(children);
  if (shown) last.current = children;

  const animate = useCallback(
    (toHeight: number, show: boolean) => {
      const timing = revealTiming(show, reduceMotion);
      // `follow`: once grown, back to its own height (the streamed text sizes it).
      const release = follow && show;
      height.value = withTiming(toHeight, { duration: timing.height.duration, easing: curves[timing.height.curve] }, (finished) => {
        if (finished && release) sized.value = false;
      });
      opacity.value = withTiming(
        show ? 1 : 0,
        { duration: timing.opacity.duration, easing: curves[timing.opacity.curve] },
        (finished) => {
          if (finished && !show) scheduleOnRN(setMounted, false);
        }
      );
    },
    [reduceMotion, follow, height, opacity, sized]
  );

  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (shown) {
      setMounted(true);
      // Measured before (hidden, then shown again): grow back to it; otherwise the first layout does.
      if (natural.current != null && sized.value) animate(natural.current, true);
      return;
    }
    if (natural.current == null) {
      setMounted(false);
      return;
    }
    if (!sized.value) {
      height.value = natural.current;
      sized.value = true;
    }
    animate(0, false);
  }, [shown, animate, sized, height]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const next = e.nativeEvent.layout.height;
      const step = revealOnLayout(natural.current, next, grows);
      const previous = natural.current;
      natural.current = next;
      if (!shownRef.current || step === "none") return;
      if (step === "record") {
        height.value = next;
        return;
      }
      if (step === "resize" && !sized.value) {
        // Streaming text at its own height: nothing to animate.
        if (follow) return;
        height.value = previous ?? next;
        sized.value = true;
      }
      animate(next, true);
    },
    [grows, follow, animate, height, sized]
  );

  const style = useAnimatedStyle(() => (sized.value ? { height: height.value, opacity: opacity.value } : { opacity: opacity.value }));

  const content = useMemo(() => (shown ? children : last.current), [shown, children]);
  if (!mounted && !shown) return null;
  return (
    <Animated.View
      style={[{ overflow: "hidden" }, style]}
      pointerEvents={shown ? "auto" : "none"}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!shown}
    >
      {/* Its own natural height even inside a shorter frame: that's what the frame grows to. */}
      <View onLayout={onLayout} style={{ paddingTop: spaceBefore }}>
        {content}
      </View>
    </Animated.View>
  );
}
