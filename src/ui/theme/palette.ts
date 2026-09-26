/**
 * BOAR palette — authored in OKLCH, shipped as sRGB hex.
 *
 * Direction: "field instrument". Warm paper and ink in light mode, warm
 * charcoal (not OLED black) in dark mode. Two brand hues taken from the
 * mascot: terracotta (the boar's hide) is the single action accent, olive
 * (the field hat) marks provenance — sources, offline, verified-on-device.
 * Status hues are separate so "accent" never doubles as "success".
 *
 * `hex` is generated from `oklch`; palette.test.ts re-derives every value and
 * checks WCAG contrast of every text/background pair, so edit both together.
 */
import type { Oklch } from "./oklch";

export interface PaletteEntry {
  hex: string;
  oklch: Oklch;
}

export const lightPalette = {
  canvas: { hex: "#F8F5F1", oklch: [0.972, 0.007, 80] },
  surface: { hex: "#FEFCF9", oklch: [0.992, 0.004, 80] },
  surfaceRaised: { hex: "#FFFFFF", oklch: [1, 0, 0] },
  sunken: { hex: "#F1EDE7", oklch: [0.948, 0.009, 78] },
  hairline: { hex: "#DED8D1", oklch: [0.885, 0.011, 72] },
  hairlineStrong: { hex: "#8C857E", oklch: [0.62, 0.014, 65] },
  textPrimary: { hex: "#231C18", oklch: [0.235, 0.014, 55] },
  textSecondary: { hex: "#574E47", oklch: [0.43, 0.016, 58] },
  textTertiary: { hex: "#726A64", oklch: [0.53, 0.014, 62] },
  textDisabled: { hex: "#A9A39E", oklch: [0.72, 0.01, 65] },
  accent: { hex: "#B15229", oklch: [0.55, 0.135, 42] },
  accentPressed: { hex: "#994222", oklch: [0.49, 0.125, 40] },
  accentSoft: { hex: "#FBE4D8", oklch: [0.935, 0.03, 50] },
  accentText: { hex: "#9E4421", oklch: [0.5, 0.13, 40] },
  onAccent: { hex: "#FFFDFA", oklch: [0.995, 0.004, 80] },
  field: { hex: "#626834", oklch: [0.5, 0.075, 115] },
  fieldSoft: { hex: "#E9ECD5", oklch: [0.935, 0.03, 112] },
  fieldText: { hex: "#545A2A", oklch: [0.45, 0.07, 115] },
  success: { hex: "#227240", oklch: [0.49, 0.11, 152] },
  successSoft: { hex: "#DBF2E0", oklch: [0.94, 0.035, 152] },
  warning: { hex: "#8D5E00", oklch: [0.52, 0.11, 75] },
  warningSoft: { hex: "#FEEDC9", oklch: [0.95, 0.05, 85] },
  danger: { hex: "#B6322D", oklch: [0.52, 0.17, 27] },
  dangerSoft: { hex: "#FDE7E4", oklch: [0.945, 0.025, 25] },
  info: { hex: "#326893", oklch: [0.5, 0.09, 245] },
  infoSoft: { hex: "#E2EFFA", oklch: [0.945, 0.02, 245] },
  scrim: { hex: "#1A1512", oklch: [0.2, 0.01, 55] },
} as const satisfies Record<string, PaletteEntry>;

export const darkPalette = {
  canvas: { hex: "#110E0B", oklch: [0.165, 0.008, 62] },
  surface: { hex: "#191512", oklch: [0.2, 0.009, 62] },
  surfaceRaised: { hex: "#221D19", oklch: [0.235, 0.01, 62] },
  sunken: { hex: "#0B0907", oklch: [0.14, 0.007, 62] },
  hairline: { hex: "#2F2A26", oklch: [0.29, 0.01, 62] },
  hairlineStrong: { hex: "#6E6862", oklch: [0.52, 0.012, 65] },
  textPrimary: { hex: "#F0ECE7", oklch: [0.945, 0.008, 78] },
  textSecondary: { hex: "#BFB9B2", oklch: [0.79, 0.012, 72] },
  textTertiary: { hex: "#9D9791", oklch: [0.68, 0.012, 68] },
  textDisabled: { hex: "#5C5752", oklch: [0.46, 0.01, 65] },
  accent: { hex: "#DE845A", oklch: [0.7, 0.125, 45] },
  accentPressed: { hex: "#C8724E", oklch: [0.64, 0.12, 43] },
  accentSoft: { hex: "#3E2418", oklch: [0.29, 0.045, 45] },
  accentText: { hex: "#EA9B72", oklch: [0.76, 0.11, 48] },
  onAccent: { hex: "#190F0A", oklch: [0.18, 0.02, 45] },
  field: { hex: "#A9B273", oklch: [0.74, 0.085, 115] },
  fieldSoft: { hex: "#282B16", oklch: [0.28, 0.035, 115] },
  fieldText: { hex: "#B5BE7F", oklch: [0.78, 0.085, 115] },
  success: { hex: "#6CC185", oklch: [0.74, 0.12, 152] },
  successSoft: { hex: "#142D1B", oklch: [0.27, 0.045, 152] },
  warning: { hex: "#E6B55D", oklch: [0.8, 0.12, 80] },
  warningSoft: { hex: "#38280A", oklch: [0.29, 0.05, 80] },
  danger: { hex: "#F1786D", oklch: [0.71, 0.15, 27] },
  dangerSoft: { hex: "#421C19", oklch: [0.28, 0.06, 25] },
  info: { hex: "#79B1E0", oklch: [0.74, 0.09, 245] },
  infoSoft: { hex: "#152839", oklch: [0.27, 0.04, 245] },
  scrim: { hex: "#020201", oklch: [0.08, 0.005, 60] },
} as const satisfies Record<string, PaletteEntry>;

export type PaletteKey = keyof typeof lightPalette;
export type Palette = Record<PaletteKey, PaletteEntry>;
