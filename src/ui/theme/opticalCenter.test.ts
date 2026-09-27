import { describe, expect, it } from "vitest";
import { baselineFromTop, opticalOffset } from "./opticalCenter";

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
