import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, useColorScheme } from "react-native";
import * as SystemUI from "expo-system-ui";
import { selection } from "../../services/haptics";
import {
  Appearance,
  FontScale,
  ThemeId,
  getAppearance,
  getFontScale,
  getThemeId,
  setAppearance as persistAppearance,
  setFontScale as persistFontScale,
  setThemeId as persistThemeId,
} from "../../models/settings";
import { Colors, legacyColorsFromTokens } from "./colors";
import { resolveScheme } from "./scheme";
import { buildTokens, ColorScheme, Tokens } from "./tokens";
import { getTypography, Typography } from "./typography";

interface ThemeContextType {
  /** Design tokens for the resolved scheme. Use these in new code. */
  tokens: Tokens;
  /** Resolved color scheme after applying `appearance` to the OS setting. */
  scheme: ColorScheme;
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => Promise<void>;
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => Promise<void>;
  /** OS "reduce motion" preference. Skip non-essential animation when true. */
  reduceMotion: boolean;

  /** @deprecated Legacy color shape bridged from `tokens`. Migrate to `tokens.color`. */
  colors: Colors;
  /** @deprecated Legacy type ramp. Migrate to `<Text variant>` / `tokens.type`. */
  typography: Typography;
  /** @deprecated The three dark themes were replaced by `appearance`. Kept so old settings screens compile. */
  themeId: ThemeId;
  /** @deprecated See `themeId`. */
  setTheme: (theme: ThemeId) => Promise<void>;
}

const defaultTokens = buildTokens("dark");

const ThemeContext = createContext<ThemeContextType>({
  tokens: defaultTokens,
  scheme: "dark",
  appearance: "system",
  setAppearance: async () => {},
  fontScale: "standard",
  setFontScale: async () => {},
  reduceMotion: false,
  colors: legacyColorsFromTokens(defaultTokens.color),
  typography: getTypography("standard"),
  themeId: "midnight",
  setTheme: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [appearance, setAppearanceState] = useState<Appearance>("system");
  const [fontScale, setFontScaleState] = useState<FontScale>("standard");
  const [themeId, setThemeIdState] = useState<ThemeId>("midnight");
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    (async () => {
      const [savedAppearance, savedScale, savedTheme] = await Promise.all([
        getAppearance(),
        getFontScale(),
        getThemeId(),
      ]);
      setAppearanceState(savedAppearance);
      setFontScaleState(savedScale);
      setThemeIdState(savedTheme);
    })();
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  const scheme = resolveScheme(appearance, system);
  const tokens = useMemo(() => buildTokens(scheme, fontScale), [scheme, fontScale]);

  // Root view color shows during screen transitions and behind the keyboard.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(tokens.color.bg.canvas).catch(() => {});
  }, [tokens.color.bg.canvas]);

  const setAppearance = useCallback(async (next: Appearance) => {
    setAppearanceState(next);
    selection();
    await persistAppearance(next);
  }, []);

  const setFontScale = useCallback(async (next: FontScale) => {
    setFontScaleState(next);
    selection();
    await persistFontScale(next);
  }, []);

  const setTheme = useCallback(async (next: ThemeId) => {
    setThemeIdState(next);
    await persistThemeId(next);
  }, []);

  const colors = useMemo(() => legacyColorsFromTokens(tokens.color), [tokens.color]);
  const typography = useMemo(() => getTypography(fontScale), [fontScale]);

  const value = useMemo<ThemeContextType>(
    () => ({
      tokens,
      scheme,
      appearance,
      setAppearance,
      fontScale,
      setFontScale,
      reduceMotion,
      colors,
      typography,
      themeId,
      setTheme,
    }),
    [tokens, scheme, appearance, setAppearance, fontScale, setFontScale, reduceMotion, colors, typography, themeId, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  return useContext(ThemeContext);
}

/** Shorthand for components that only need tokens. */
export function useTokens(): Tokens {
  return useContext(ThemeContext).tokens;
}
