import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, inGamut, oklchToHex } from "./oklch";
import { darkPalette, lightPalette, Palette, PaletteKey } from "./palette";

const palettes: [string, Palette][] = [
  ["light", lightPalette],
  ["dark", darkPalette],
];

const BACKGROUNDS: PaletteKey[] = ["canvas", "surface", "surfaceRaised", "sunken"];
const TEXT_ON_BACKGROUNDS: PaletteKey[] = [
  "textPrimary",
  "textSecondary",
  "textTertiary",
  "accentText",
  "fieldText",
  "success",
  "warning",
  "danger",
  "info",
];

describe("oklch conversion", () => {
  it("maps the OKLCH extremes to black and white", () => {
    expect(oklchToHex([0, 0, 0])).toBe("#000000");
    expect(oklchToHex([1, 0, 0])).toBe("#FFFFFF");
  });

  it("round-trips a known sRGB value within 1/255", () => {
    // oklch(0.628 0.2577 29.23) is sRGB red per the CSS Color 4 spec.
    const [r, g, b] = hexToRgb(oklchToHex([0.62796, 0.25768, 29.2339]));
    expect(r).toBeGreaterThanOrEqual(254);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(1);
  });

  it("computes the WCAG ratio of black on white as 21", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });
});

describe.each(palettes)("%s palette", (_name, palette) => {
  it("ships hex values generated from its OKLCH source", () => {
    for (const [key, entry] of Object.entries(palette)) {
      expect(`${key}:${entry.hex}`).toBe(`${key}:${oklchToHex(entry.oklch)}`);
    }
  });

  it("keeps every color inside the sRGB gamut (no silent clipping)", () => {
    for (const [key, entry] of Object.entries(palette)) {
      expect(inGamut(entry.oklch), key).toBe(true);
    }
  });

  it.each(BACKGROUNDS)("gives every text token >= 4.5:1 on %s", (bg) => {
    for (const fg of TEXT_ON_BACKGROUNDS) {
      const ratio = contrastRatio(palette[fg].hex, palette[bg].hex);
      expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives tone text >= 4.5:1 on its own soft fill", () => {
    const pairs: [PaletteKey, PaletteKey][] = [
      ["accentText", "accentSoft"],
      ["fieldText", "fieldSoft"],
      ["success", "successSoft"],
      ["warning", "warningSoft"],
      ["danger", "dangerSoft"],
      ["info", "infoSoft"],
      ["textPrimary", "accentSoft"],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrastRatio(palette[fg].hex, palette[bg].hex), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives text on the accent fill >= 4.5:1, pressed included", () => {
    expect(contrastRatio(palette.onAccent.hex, palette.accent.hex)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.onAccent.hex, palette.accentPressed.hex)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives control borders and the accent >= 3:1 against surfaces (WCAG 1.4.11)", () => {
    for (const bg of BACKGROUNDS) {
      expect(contrastRatio(palette.hairlineStrong.hex, palette[bg].hex), `hairlineStrong on ${bg}`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.accent.hex, palette[bg].hex), `accent on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});
