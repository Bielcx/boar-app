import { describe, expect, it } from "vitest";
import { baselineFromTop, FACE_METRICS, iosAscenderInset, opticalOffset } from "./opticalCenter";

describe("opticalOffset", () => {
  it("matches the measured iOS CTA: Baloo 17/20 caps centre ~4 pt above the box middle (ce4fe83 setup1, 'G' at -3.8)", () => {
    const capCentre = opticalOffset({ face: "display", uppercase: true, fontSize: 17, lineHeight: 20, platform: "ios" });
    expect(capCentre).toBeGreaterThan(-4.3);
    expect(capCentre).toBeLessThan(-3.5);
  });

  it("Android centres Baloo with half-leading, so the same label sits within 0.5 pt of the middle", () => {
    expect(Math.abs(opticalOffset({ face: "display", fontSize: 17, lineHeight: 20, platform: "android" }))).toBeLessThan(0.5);
  });

  it("Lexend lines are taller than the font on both platforms: same geometry, icon ~1 pt low at body 16/24", () => {
    const ios = opticalOffset({ face: "text", fontSize: 16, lineHeight: 24, platform: "ios" });
    const android = opticalOffset({ face: "text", fontSize: 16, lineHeight: 24, platform: "android" });
    expect(ios).toBe(android);
    expect(ios).toBeCloseTo(1.1, 1);
  });

  it("iOS keeps the descent at the bottom only when the line is shorter than the font", () => {
    // Baloo 1.602 em box: a 1.7 leading is taller, so iOS centres it like Android.
    const tall = { face: "display" as const, fontSize: 10, lineHeight: 17 };
    expect(baselineFromTop({ ...tall, platform: "ios" })).toBeCloseTo(baselineFromTop({ ...tall, platform: "android" }));
  });

  it("scales linearly with the text (Dynamic Type)", () => {
    const one = opticalOffset({ face: "display", fontSize: 15, lineHeight: 19, platform: "ios" });
    const two = opticalOffset({ face: "display", fontSize: 30, lineHeight: 38, platform: "ios" });
    expect(two).toBeCloseTo(one * 2, 0);
  });
});

describe("iosAscenderInset", () => {
  // Baloo 2 ExtraBold TTF: 'b' yMax 661/1000, hhea 1078/-524.
  const inkTop = (fontSize: number, lineHeight: number, platform: "ios" | "android", inset: number) =>
    inset + baselineFromTop({ face: "display", fontSize, lineHeight, platform }) - FACE_METRICS.display.ascender * fontSize;

  it("the 40/40 wordmark clips its 'b' on iOS without it (7.4 pt above the box: 'Doar')", () => {
    expect(inkTop(40, 40, "ios", 0)).toBeCloseTo(-7.4, 1);
    expect(inkTop(40, 40, "android", 0)).toBeGreaterThan(0);
  });

  it("with it the 'b' fits on iOS and sits where Android draws it, at 1.0 and at the 1.3 cap", () => {
    for (const k of [1, 1.3]) {
      const input = { face: "display" as const, fontSize: 40 * k, lineHeight: 40 * k };
      const inset = iosAscenderInset({ ...input, platform: "ios" });
      expect(inkTop(40 * k, 40 * k, "ios", inset)).toBeGreaterThanOrEqual(0);
      expect(inkTop(40 * k, 40 * k, "ios", inset)).toBeCloseTo(inkTop(40 * k, 40 * k, "android", 0), 0);
    }
    expect(iosAscenderInset({ face: "display", fontSize: 40, lineHeight: 40, platform: "ios" })).toBeCloseTo(12.0, 1);
  });

  it("is 0 on Android and for lines as tall as the font, so their layout does not move", () => {
    expect(iosAscenderInset({ face: "display", fontSize: 40, lineHeight: 40, platform: "android" })).toBe(0);
    expect(iosAscenderInset({ face: "text", fontSize: 16, lineHeight: 24, platform: "ios" })).toBe(0);
  });
});
