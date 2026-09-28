import { describe, expect, it } from "vitest";
import { motionSpec } from "../theme/motionSpec";
import { revealOnLayout, revealTiming } from "./revealTiming";

describe("revealTiming (SEND-MOTION D2, DS §6 roles)", () => {
  it("shows as a layout change plus an enter fade", () => {
    const r = revealTiming(true, false);
    expect(r.height).toEqual({ duration: motionSpec("layout", false).duration, curve: "standard" });
    expect(r.opacity).toEqual({ duration: motionSpec("enter", false).duration, curve: "enter" });
  });
  it("hides as a layout change plus an exit fade", () => {
    const r = revealTiming(false, false);
    expect(r.height.duration).toBe(motionSpec("layout", false).duration);
    expect(r.opacity).toEqual({ duration: motionSpec("exit", false).duration, curve: "exit" });
    expect(r.opacity.duration).toBeLessThan(r.height.duration);
  });
  it("under reduce motion: instant height, only the short fade", () => {
    for (const shown of [true, false]) {
      const r = revealTiming(shown, true);
      expect(r.height.duration).toBe(0);
      expect(r.opacity.duration).toBe(motionSpec(shown ? "enter" : "exit", true).duration);
      expect(r.opacity.duration).toBeGreaterThan(0);
    }
  });
});

describe("revealOnLayout", () => {
  it("grows a block asked in this run from 0, records a restored one in place", () => {
    expect(revealOnLayout(null, 110, true)).toBe("grow");
    expect(revealOnLayout(null, 110, false)).toBe("record");
  });
  it("animates later changes of the content's height, ignores sub-pixel noise", () => {
    expect(revealOnLayout(110, 60, false)).toBe("resize");
    expect(revealOnLayout(60, 180, true)).toBe("resize");
    expect(revealOnLayout(110, 110.2, true)).toBe("none");
  });
});
