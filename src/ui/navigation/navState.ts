/**
 * Keeps the navigation state across a remount of the NavigationContainer.
 *
 * Android keeps the activity alive when the system font size changes
 * (fontScale is in configChanges, so the setup wizard is not reset), but
 * already-mounted <Text> keep the old measurements and clip ("Rea", "Bac").
 * The shell remounts the container when the font scale changes and restores
 * the stack from here, so the user stays on the same screen (Prism FS-1).
 * Pure (no RN imports) for vitest.
 */
let saved: unknown;

export function saveNavState(state: unknown): void {
  saved = state;
}

export function savedNavState<T>(): T | undefined {
  return saved as T | undefined;
}

/** Remount key for a font scale; rounded so float noise from the OS does not remount. */
export function fontScaleKey(fontScale: number): string {
  return `fs:${(Math.round(fontScale * 100) / 100).toFixed(2)}`;
}
