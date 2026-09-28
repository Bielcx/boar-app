/**
 * Whether a layout of the chat list should pin it to the bottom again (audit #8/#10): only when its height
 * really changed (the keyboard moving), not on every layout pass that leaves it the same.
 */
export function heightChanged(previous: number | null, height: number, epsilon = 1): boolean {
  return previous == null || Math.abs(height - previous) >= epsilon;
}

/**
 * How long a glide (a native animated scrollToEnd) owns the list: no snap may cut it meanwhile. Not a motion
 * duration of ours: a guard a bit longer than the platforms' own smooth scroll (~250-300 ms).
 */
export const GLIDE_GUARD_MS = 350;

type Schedule = (fn: () => void, ms: number) => () => void;

const defaultSchedule: Schedule = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/**
 * Keeps the chat list anchored at its end without jumps (SEND-MOTION D4). Two moves:
 * - `pin()`: a snap, for content growing a little (a token batch, a height animating frame by frame);
 * - `glide()`: one native animated scroll, for content appearing at once below the fold (a question sent).
 * While a glide runs, pins don't cut it: they are held, and one more glide follows it if any came in.
 * Before, sending scrolled before the question was even in the list, and every layout of the closing
 * keyboard and of the new content snapped over that animation (the "things jump" of the send).
 */
export function createBottomPin(deps: {
  /** `sameFrame`: a layout of the list itself (the keyboard), where the content didn't change. */
  scrollToEnd: (animated: boolean, sameFrame?: boolean) => void;
  now?: () => number;
  schedule?: Schedule;
}) {
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? defaultSchedule;
  let glideUntil = 0;
  let held = false;
  let armed = false;
  let cancelTrailing: (() => void) | null = null;

  const gliding = () => now() < glideUntil;

  function glide(animated = true) {
    armed = false;
    // Reduce motion: the same place, reached without the movement.
    if (!animated) {
      deps.scrollToEnd(false);
      return;
    }
    glideUntil = now() + GLIDE_GUARD_MS;
    held = false;
    deps.scrollToEnd(true);
    cancelTrailing?.();
    cancelTrailing = schedule(() => {
      cancelTrailing = null;
      glideUntil = 0;
      if (held) glide(true);
    }, GLIDE_GUARD_MS);
  }

  return {
    gliding,
    glide,
    /** The next content change glides instead of snapping: the new rows are measured by then. */
    armGlide() {
      armed = true;
    },
    /**
     * A change while following the end. `animated`: false under reduce motion. A "layout" change (the list's
     * own height, the keyboard) snaps in the same frame and leaves an armed glide for the content.
     */
    pin(animated = true, from: "content" | "layout" = "content") {
      if (armed && from === "content") return glide(animated);
      if (gliding()) {
        held = true;
        return;
      }
      deps.scrollToEnd(false, from === "layout");
    },
    /** The user took the list (a drag): nothing of ours moves it any more. */
    cancel() {
      glideUntil = 0;
      held = false;
      armed = false;
      cancelTrailing?.();
      cancelTrailing = null;
    },
  };
}
