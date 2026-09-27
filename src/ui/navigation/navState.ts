/**
 * Keeps the navigation state across a remount of the NavigationContainer.
 * Android recreates the Activity when the system font size changes (FS-1,
 * plan B); the JS context survives but the React tree mounts again, and this
 * puts the user back on the same screen (Settings, Models…). Pure for vitest.
 */
let saved: unknown;

export function saveNavState(state: unknown): void {
  saved = state;
}

export function savedNavState<T>(): T | undefined {
  return saved as T | undefined;
}
