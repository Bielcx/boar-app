/**
 * Whether a layout of the chat list should pin it to the bottom again (audit #8/#10): only when its height
 * really changed (the keyboard moving), not on every layout pass that leaves it the same.
 */
export function heightChanged(previous: number | null, height: number, epsilon = 1): boolean {
  return previous == null || Math.abs(height - previous) >= epsilon;
}
