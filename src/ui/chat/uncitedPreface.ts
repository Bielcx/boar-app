import { uncitedPreface } from "../../routing/context";

/**
 * Whether the answer text already opens with the engine's "not from an offline source" line
 * (Tusk 4375d76). Then the weak-source note keeps only its marker in the sources' slot, without
 * repeating the sentence (Iris); otherwise it keeps its body, the only warning on screen.
 */
export function hasUncitedPreface(text: string | undefined): boolean {
  const start = (text ?? "").trimStart();
  return [uncitedPreface(true), uncitedPreface(false)].some((p) => start.startsWith(p));
}

/** The weak-source note shows its body unless the text already carries the engine's line. */
export function weakNoteShowsBody(text: string | undefined): boolean {
  return !hasUncitedPreface(text);
}
