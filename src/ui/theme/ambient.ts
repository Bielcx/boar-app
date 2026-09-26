/**
 * Ember glow of the Fogueira light pattern. The designer's gradient peaks at
 * 0.32 alpha; text can sit over it, so the peak is capped where every text
 * token still clears AA over the glow (ambient.test.ts).
 */
export const EMBER_PEAK_ALPHA = 0.25;
/** Opacity of the Luar moon disc (designer: .13). */
export const MOON_ALPHA = 0.13;
/** Light mode draws the pattern at this strength (designer: .6). */
export const AMBIENT_LIGHT_STRENGTH = 0.6;

export function emberGradient(glowRgb: string, peak = EMBER_PEAK_ALPHA): string {
  const mid = (peak * 0.25).toFixed(3);
  return `radial-gradient(ellipse at 50% 100%, rgba(${glowRgb}, ${peak}) 0%, rgba(${glowRgb}, ${mid}) 45%, rgba(${glowRgb}, 0) 70%)`;
}
