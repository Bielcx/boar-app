/**
 * Chat layout at large text (fontScale >= LARGE_TEXT_SCALE):
 * - a suggestion shows the whole question (Prism CH-11: at 2.0 a 58-character question needs 3 lines, and
 *   tapping sent a question nobody could read in full); 2 lines at normal sizes keep the cards even;
 * - the model error's two buttons stack (Prism CH-12: side by side, "Configurar"/"Recarregar" broke mid-word).
 */
export function chatLargeText(large: boolean): { suggestionLines: number | undefined; errorButtonBasis: "100%" | "40%" } {
  return large ? { suggestionLines: undefined, errorButtonBasis: "100%" } : { suggestionLines: 2, errorButtonBasis: "40%" };
}
