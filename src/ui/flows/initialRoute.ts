/**
 * Where the app opens, and which answer model the chat will load. The boot
 * gate and the chat must agree: the gate accepts any answer model on disk
 * (default 4B or compact 1.5B), while the chat, with no active model saved,
 * falls back to the default 4B. A phone with only the compact model (files
 * imported outside setup, or a setup killed before its last step) passed the
 * gate and then opened the chat on "model missing". When the saved model is
 * absent, Tusk's rankAnswerModels picks among the installed ones. No native
 * imports.
 */
import { AnswerModelCandidate, rankAnswerModels } from "../../routing/defaultModel";

export interface BootState {
  /** Every `required` asset (the embedding model) and one answer model are on disk and complete (the boot gate). */
  requiredPresent: boolean;
  /** Language models complete on disk: catalog tiers, other catalog models, Hugging Face models. */
  installedLlms: AnswerModelCandidate[];
  /** Device RAM for the ranking (0 = unknown). */
  totalRamBytes: number;
  /** The saved active LLM id, or null when none was ever chosen. */
  activeLlmId: string | null;
}

export interface BootDecision {
  route: "Main" | "Setup";
  /** Answer model to save as active before the chat mounts, when the saved one is absent. */
  setActiveLlmId?: string;
}

export function decideInitialRoute(s: BootState): BootDecision {
  if (!s.requiredPresent) return { route: "Setup" };
  if (s.activeLlmId && s.installedLlms.some((m) => m.id === s.activeLlmId)) return { route: "Main" };
  // Nothing the chat could load: setup, never a chat that opens on an error.
  if (!s.installedLlms.length) return { route: "Setup" };
  const pick = rankAnswerModels(s.installedLlms, s.totalRamBytes).pick;
  return { route: "Main", setActiveLlmId: pick?.id ?? s.installedLlms[0].id };
}
