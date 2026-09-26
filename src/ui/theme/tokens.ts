/**
 * BOAR design tokens. One object per color scheme; everything a component
 * needs to draw itself comes from here (via `useTheme().tokens`), never from
 * literals. See docs/DESIGN_SYSTEM.md for usage rules.
 */
import { Easing, Platform, StyleSheet, TextStyle } from "react-native";
import type { FontScale } from "../../models/settings";
import { darkPalette, lightPalette, Palette } from "./palette";

export type ColorScheme = "light" | "dark";

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `${hex}${a}`;
}

function buildColors(p: Palette, scheme: ColorScheme) {
  const hex = (k: keyof Palette) => p[k].hex;
  return {
    bg: {
      /** Screen background. */
      canvas: hex("canvas"),
      /** Cards, list groups, input fields. */
      surface: hex("surface"),
      /** Sheets, menus, toasts: anything floating above content. */
      raised: hex("surfaceRaised"),
      /** Wells, code blocks, pressed rows. */
      sunken: hex("sunken"),
      /** Backdrop behind sheets and the drawer. */
      scrim: withAlpha(hex("scrim"), scheme === "dark" ? 0.6 : 0.36),
    },
    text: {
      primary: hex("textPrimary"),
      secondary: hex("textSecondary"),
      /** Still AA (>= 4.5:1) on every surface: metadata, placeholders. */
      tertiary: hex("textTertiary"),
      /** Decorative / disabled only. Fails AA on purpose; never carry information with it. */
      disabled: hex("textDisabled"),
      accent: hex("accentText"),
      field: hex("fieldText"),
      onAccent: hex("onAccent"),
    },
    line: {
      /** Default separator. Decorative: never the only affordance of a control. */
      hairline: hex("hairline"),
      /** Control borders (inputs, switches off-state): >= 3:1 against the surface. */
      strong: hex("hairlineStrong"),
      focus: hex("accent"),
    },
    accent: {
      solid: hex("accent"),
      pressed: hex("accentPressed"),
      soft: hex("accentSoft"),
      text: hex("accentText"),
      on: hex("onAccent"),
    },
    /** Olive: provenance. Sources, offline, verified on device. */
    field: {
      solid: hex("field"),
      soft: hex("fieldSoft"),
      text: hex("fieldText"),
    },
    status: {
      success: { solid: hex("success"), soft: hex("successSoft") },
      warning: { solid: hex("warning"), soft: hex("warningSoft") },
      danger: { solid: hex("danger"), soft: hex("dangerSoft") },
      info: { solid: hex("info"), soft: hex("infoSoft") },
    },
  };
}

export type ColorTokens = ReturnType<typeof buildColors>;
export type Tone = "neutral" | "accent" | "field" | "success" | "warning" | "danger" | "info";

/** Foreground / background pair for a semantic tone (badges, banners, chips). */
export function toneColors(c: ColorTokens, tone: Tone): { fg: string; bg: string; solid: string } {
  switch (tone) {
    case "neutral":
      return { fg: c.text.secondary, bg: c.bg.sunken, solid: c.text.secondary };
    case "accent":
      return { fg: c.accent.text, bg: c.accent.soft, solid: c.accent.solid };
    case "field":
      return { fg: c.field.text, bg: c.field.soft, solid: c.field.solid };
    default:
      return { fg: c.status[tone].solid, bg: c.status[tone].soft, solid: c.status[tone].solid };
  }
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const fontFamily = {
  sans: Platform.select({ ios: "System", default: "sans-serif" }),
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
};

/** In-app text size preference, applied on top of the OS font scale. */
export const APP_FONT_SCALE: Record<FontScale, number> = {
  compact: 0.94,
  standard: 1,
  large: 1.12,
};

/** Informative text never renders below this, whatever the app scale. */
export const MIN_FONT_SIZE = 12;

type TypeSpec = {
  size: number;
  /** Line height as a ratio of size, so it tracks every scale. */
  leading: number;
  weight: TextStyle["fontWeight"];
  tracking?: number;
  mono?: boolean;
  uppercase?: boolean;
  /** Cap for OS font scaling. Undefined = unlimited (the default for content). */
  maxScale?: number;
};

const TYPE_SCALE = {
  display: { size: 32, leading: 1.2, weight: "700", tracking: -0.5, maxScale: 1.5 },
  title1: { size: 26, leading: 1.23, weight: "700", tracking: -0.3 },
  title2: { size: 21, leading: 1.28, weight: "600", tracking: -0.2 },
  title3: { size: 18, leading: 1.33, weight: "600", tracking: -0.1 },
  headline: { size: 16, leading: 1.375, weight: "600" },
  body: { size: 16, leading: 1.5, weight: "400" },
  callout: { size: 15, leading: 1.45, weight: "400" },
  subhead: { size: 14, leading: 1.43, weight: "500" },
  footnote: { size: 13, leading: 1.38, weight: "400" },
  caption: { size: 12, leading: 1.33, weight: "400" },
  /** Section overlines and instrument labels. */
  label: { size: 12, leading: 1.33, weight: "600", tracking: 0.6, uppercase: true },
  /** Code, raw values, hashes. For numbers in UI prefer `numeric` on a sans variant. */
  mono: { size: 13, leading: 1.46, weight: "400", mono: true },
} satisfies Record<string, TypeSpec>;

export type TextVariant = keyof typeof TYPE_SCALE;

export type TypeStyle = TextStyle & { maxFontSizeMultiplier?: number };

function buildType(fontScale: FontScale): Record<TextVariant, TypeStyle> {
  const k = APP_FONT_SCALE[fontScale];
  const out = {} as Record<TextVariant, TypeStyle>;
  for (const [name, spec] of Object.entries(TYPE_SCALE) as [TextVariant, TypeSpec][]) {
    const fontSize = Math.max(MIN_FONT_SIZE, Math.round(spec.size * k * 2) / 2);
    out[name] = {
      fontFamily: spec.mono ? fontFamily.mono : fontFamily.sans,
      fontSize,
      lineHeight: Math.round(fontSize * spec.leading),
      fontWeight: spec.weight,
      letterSpacing: spec.tracking ?? 0,
      ...(spec.uppercase ? { textTransform: "uppercase" as const } : null),
      ...(spec.maxScale ? { maxFontSizeMultiplier: spec.maxScale } : null),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Space, radius, size
// ---------------------------------------------------------------------------

/** 4pt grid. Names kept compatible with the legacy `spacing` export. */
export const space = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  giant: 64,
} as const;

export const radius = {
  xs: 4,
  /** Chips, badges, small controls. */
  sm: 8,
  /** Buttons, inputs, list groups. */
  md: 12,
  /** Cards. */
  lg: 16,
  /** Sheets (top corners). */
  xl: 24,
  full: 999,
} as const;

/** Minimum touch target per platform guideline (Apple HIG 44pt, Material 48dp). */
export const MIN_TOUCH = Platform.OS === "ios" ? 44 : 48;

export const size = {
  touch: MIN_TOUCH,
  iconSm: 16,
  icon: 20,
  iconLg: 24,
  controlSm: 36,
  control: 48,
  hairline: StyleSheet.hairlineWidth,
  border: 1,
  focusRing: 2,
} as const;

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------

/**
 * Light mode separates planes with soft shadows + hairlines. Dark mode never
 * uses shadows (they vanish on charcoal); it steps surface lightness instead
 * (canvas -> surface -> raised) and keeps the hairline.
 */
function buildElevation(scheme: ColorScheme) {
  if (scheme === "dark") {
    return { 0: {}, 1: {}, 2: {}, 3: {} } as const;
  }
  return {
    0: {},
    1: { boxShadow: "0px 1px 2px rgba(40, 28, 20, 0.06)" },
    2: { boxShadow: "0px 4px 16px rgba(40, 28, 20, 0.10), 0px 1px 3px rgba(40, 28, 20, 0.06)" },
    3: { boxShadow: "0px 12px 32px rgba(40, 28, 20, 0.16), 0px 2px 6px rgba(40, 28, 20, 0.08)" },
  } as const;
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export const motion = {
  duration: { instant: 90, fast: 150, base: 220, slow: 320 },
  /** Material 3 "standard" / "emphasized decelerate" curves. */
  easing: {
    standard: Easing.bezier(0.2, 0, 0, 1),
    enter: Easing.bezier(0.05, 0.7, 0.1, 1),
    exit: Easing.bezier(0.3, 0, 0.8, 0.15),
  },
  spring: { damping: 22, stiffness: 240, mass: 1 },
} as const;

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildTokens(scheme: ColorScheme, fontScale: FontScale = "standard") {
  return {
    scheme,
    color: buildColors(scheme === "dark" ? darkPalette : lightPalette, scheme),
    type: buildType(fontScale),
    space,
    radius,
    size,
    elevation: buildElevation(scheme),
    motion,
  };
}

export type Tokens = ReturnType<typeof buildTokens>;
