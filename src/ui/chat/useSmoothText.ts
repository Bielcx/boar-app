import { useEffect, useRef, useState } from "react";
import { fadeTail, incomingRate, nextShown, pruneMarks, REVEAL_FRAME_MS, revealRate, safeCut, type RevealMark } from "./streamReveal";

export interface SmoothText {
  /** The part of the text to draw now. */
  text: string;
  /** Characters at the end still fading in, per tone (see fadeTail). */
  tail: { tertiary: number; secondary: number };
  /** Everything received is on screen and the stream is over: render the final text as before. */
  settled: boolean;
}

const NO_TAIL = { tertiary: 0, secondary: 0 };

/**
 * The reveal clock of SEND-MOTION v2 P1 (streamReveal.ts has the rules). While `streaming`, `target` (the
 * text received so far) shows at a steady ~30 Hz pace; when it stops, the rest drains within DRAIN_MS
 * and `settled` turns true. `animate` false (reduce motion): the text shows as it comes, no pace, no fade.
 * A block mounted with text already there (history, a remount) shows it at once.
 */
export function useSmoothText(target: string, streaming: boolean, animate: boolean): SmoothText {
  const [, setFrame] = useState(0);
  const shown = useRef(streaming && animate ? 0 : target.length);
  const marks = useRef<RevealMark[]>([{ end: shown.current, at: -Infinity }]);
  const cps = useRef(0);
  const lastGrowth = useRef<{ length: number; at: number }>({ length: target.length, at: Date.now() });
  const targetRef = useRef(target);
  targetRef.current = target;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;

  // The incoming rate, measured on each batch.
  if (target.length !== lastGrowth.current.length) {
    const now = Date.now();
    cps.current = incomingRate(cps.current, target.length - lastGrowth.current.length, now - lastGrowth.current.at);
    lastGrowth.current = { length: target.length, at: now };
  }
  // The text can also be replaced (a retry): never show past its end.
  if (shown.current > target.length) shown.current = target.length;

  const behind = shown.current < target.length;
  // Until settled: revealing, streaming, or the last characters still fading in.
  const running = animate && (behind || streaming || marks.current.length > 1);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastTick = Date.now();
    const tick = () => {
      const now = Date.now();
      if (now - lastTick >= REVEAL_FRAME_MS) {
        const length = targetRef.current.length;
        const lag = length - shown.current;
        if (lag > 0) {
          const rate = revealRate(cps.current, lag, !streamingRef.current);
          shown.current = nextShown(shown.current, length, now - lastTick, rate);
          marks.current = pruneMarks([...marks.current, { end: Math.floor(shown.current), at: now }], now);
        } else {
          marks.current = pruneMarks(marks.current, now);
        }
        lastTick = now;
        // Revealing or still fading: draw. Waiting for the model with the fade over: no render.
        if (lag > 0 || marks.current.length > 1) setFrame((f) => f + 1);
        // Caught up with a finished stream and the fade is over: stop (the effect ends with `running`).
        if (!streamingRef.current && shown.current >= length && marks.current.length <= 1) {
          setFrame((f) => f + 1); // the render that reports `settled`
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  if (!animate) return { text: target, tail: NO_TAIL, settled: !streaming };
  const cut = safeCut(target, shown.current);
  const settled = !streaming && shown.current >= target.length && marks.current.length <= 1;
  return {
    text: target.slice(0, cut),
    tail: settled ? NO_TAIL : fadeTail(marks.current, cut, Date.now()),
    settled,
  };
}
