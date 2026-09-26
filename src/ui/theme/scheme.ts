import type { Appearance } from "../../models/settings";
import type { ColorScheme } from "./tokens";

/** Applies the user's appearance choice to the OS scheme. Unknown OS value falls back to dark (the app's historical look). */
export function resolveScheme(appearance: Appearance, system: string | null | undefined): ColorScheme {
  if (appearance === "light" || appearance === "dark") return appearance;
  return system === "light" ? "light" : "dark";
}
