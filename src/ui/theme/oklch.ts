/**
 * OKLCH -> sRGB hex conversion and WCAG contrast. Pure, no RN imports, so the
 * palette can be authored in OKLCH and verified in tests.
 * Math: Björn Ottosson's OKLab reference implementation.
 */

export type Oklch = readonly [l: number, c: number, h: number];

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function srgbToLinear(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Returns linear-light sRGB channels (may fall outside 0..1 when out of gamut). */
export function oklchToLinearRgb([l, c, h]: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

export function inGamut(color: Oklch, epsilon = 0.0005): boolean {
  return oklchToLinearRgb(color).every((v) => v >= -epsilon && v <= 1 + epsilon);
}

export function oklchToHex(color: Oklch): string {
  return (
    "#" +
    oklchToLinearRgb(color)
      .map((v) => Math.round(clamp01(linearToSrgb(clamp01(v))) * 255))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => srgbToLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
