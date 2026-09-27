import { displayNameOf, MODEL_CATALOG } from "../../models/manifest";

/**
 * The name the chat shows for a model the engine names by id + technical label (receipt,
 * effective model, downgrade): the catalog's short name ("Qwen3 4B", Ledger 1f3fd65), else the
 * label as sent (a model picked from the Hugging Face browser isn't in the catalog).
 */
export function modelNameById(id: string | undefined, label: string): string {
  const m = id ? MODEL_CATALOG.find((x) => x.id === id) : undefined;
  return m ? displayNameOf(m) : label;
}
