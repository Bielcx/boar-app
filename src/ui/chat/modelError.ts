/**
 * Why the model didn't load, from the engine's error text, and which action
 * leads: reinstalling (setup) when the file is missing or damaged or too big
 * for this phone, retrying when the cause is unknown.
 */
export type ModelErrorKind = "memory" | "corrupt" | "missing" | "general";

export function modelErrorKind(error: string): ModelErrorKind {
  const e = error.toLowerCase();
  if (/size mismatch|verification|hash|corrupt|truncat/.test(e)) return "corrupt";
  if (/not found|no such file|enoent|missing/.test(e)) return "missing";
  if (/memory|\boom\b|allocate|\bram\b/.test(e)) return "memory";
  return "general";
}

export function modelErrorPrimary(kind: ModelErrorKind): "setup" | "retry" {
  return kind === "general" ? "retry" : "setup";
}
