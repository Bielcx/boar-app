import { describe, expect, it } from "vitest";
import { COMPOSER_MAX_LINES, composerLayout, composerPillHeight } from "./composerLayout";

// The DS numbers: pill 52 around a 20 pt line (subhead 14 × 1.43), send/stop disc 52.
const base = { lineHeight: 20, composer: 52, button: 52 };

describe("composerLayout (r4to: the composer only fit one line)", () => {
  it("one line is the mockup's 52 pill, the disc centred on it", () => {
    const l = composerLayout({ ...base, fontScale: 1 });
    expect(l.padV).toBe(16);
    expect(composerPillHeight(20, l)).toBe(52);
    expect(l.buttonLift).toBe(0);
  });
  it("grows a line at a time, same padding", () => {
    const l = composerLayout({ ...base, fontScale: 1 });
    expect(composerPillHeight(40, l)).toBe(72);
    expect(composerPillHeight(60, l)).toBe(92);
  });
  it("stops at five lines; the input scrolls past that (a long paste)", () => {
    const l = composerLayout({ ...base, fontScale: 1 });
    expect(l.inputMax).toBe(20 * COMPOSER_MAX_LINES);
    expect(composerPillHeight(20 * COMPOSER_MAX_LINES, l)).toBe(l.pillMax);
    expect(composerPillHeight(20 * 12, l)).toBe(l.pillMax);
  });
  it("an empty field (or a tiny first measure) is never below one line", () => {
    const l = composerLayout({ ...base, fontScale: 1 });
    expect(composerPillHeight(0, l)).toBe(52);
  });
  it("at text size 1.3 the line, the pill and the cap scale; the disc rises to the last line's centre", () => {
    const l = composerLayout({ ...base, fontScale: 1.3 });
    expect(composerPillHeight(26, l)).toBeCloseTo(58);
    expect(l.inputMax).toBeCloseTo(26 * COMPOSER_MAX_LINES);
    expect(l.pillMax).toBeCloseTo(26 * COMPOSER_MAX_LINES + 32);
    // Last line centre 16 + 13 = 29 above the bottom; disc centre 26: rise 3.
    expect(l.buttonLift).toBeCloseTo(3);
  });
});
