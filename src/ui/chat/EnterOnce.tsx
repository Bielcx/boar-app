import React, { ReactNode, useEffect, useRef } from "react";
import Animated from "react-native-reanimated";
import { useMotion } from "../theme/motion";

/**
 * A row sent in this run enters once (SEND-MOTION S1): the DS `enter` from below. Decided at mount and
 * reported through `onEntered`, so a row the list mounts again after scrolling shows in place, and
 * history rows get no wrapper at all.
 */
export function EnterOnce({ enter, onEntered, children }: { enter: boolean; onEntered: () => void; children: ReactNode }) {
  const m = useMotion();
  const entering = useRef(enter ? m.entering({ from: "below" }) : null).current;
  useEffect(() => {
    if (entering) onEntered();
    // Once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!entering) return <>{children}</>;
  return <Animated.View entering={entering}>{children}</Animated.View>;
}
