import { motionSpec, type Curve } from "../theme/motionSpec";

export interface RevealTiming {
  height: { duration: number; curve: Curve };
  opacity: { duration: number; curve: Curve };
}

/**
 * How a Reveal moves (SEND-MOTION D2), from the DS roles only (motionSpec, DS §6): its height as a
 * `layout` change, its fade as `enter` (showing) or `exit` (hiding). Reduce motion comes from the same
 * table: the height is instant and the fade stays short, nothing travels.
 */
export function revealTiming(shown: boolean, reduceMotion: boolean): RevealTiming {
  const layout = motionSpec("layout", reduceMotion);
  const fade = motionSpec(shown ? "enter" : "exit", reduceMotion);
  return {
    height: { duration: layout.duration, curve: layout.curve },
    opacity: { duration: fade.duration, curve: fade.curve },
  };
}

/**
 * What a Reveal does when its content measures `next` (it was `previous`, null before the first layout):
 * - "record": first layout of a block shown in place (restored history): nothing moves;
 * - "grow": first layout of a block that appears (asked in this run): 0 → its height;
 * - "resize": the content changed height (a preview collapsing, a count becoming a list);
 * - "none": same height.
 */
export function revealOnLayout(previous: number | null, next: number, appear: boolean, epsilon = 0.5): "record" | "grow" | "resize" | "none" {
  if (previous == null) return appear ? "grow" : "record";
  return Math.abs(next - previous) < epsilon ? "none" : "resize";
}
