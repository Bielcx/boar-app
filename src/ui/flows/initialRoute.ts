/**
 * Where the app opens, and which answer model the chat will load. The boot
 * gate and the chat must agree: the gate accepts any answer model on disk
 * (default 4B or compact 1.5B), while the chat, with no active model saved,
 * falls back to the default 4B. A phone with only the compact model (files
 * imported outside setup, or a setup killed before its last step) passed the
 * gate and then opened the chat on "model missing". No native imports.
 */
export interface BootState {
  /** Every `required` asset (the embedding model) is on disk and complete. */
  requiredPresent: boolean;
  /** Answer models complete on disk, in preference order (default first). */
  presentAnswerIds: string[];
  /** The saved active LLM id, or null when none was ever chosen. */
  activeLlmId: string | null;
  /** Whether the saved active LLM is complete on disk (catalog or Hugging Face model). */
  activeLlmPresent: boolean;
}

export interface BootDecision {
  route: "Main" | "Setup";
  /** Answer model to save as active before the chat mounts, when the saved one is absent. */
  setActiveLlmId?: string;
}

export function decideInitialRoute(s: BootState): BootDecision {
  if (!s.requiredPresent) return { route: "Setup" };
  if (s.activeLlmId && s.activeLlmPresent) return { route: "Main" };
  const answer = s.presentAnswerIds[0];
  // Nothing the chat could load: setup, never a chat that opens on an error.
  if (!answer) return { route: "Setup" };
  return { route: "Main", setActiveLlmId: answer };
}
