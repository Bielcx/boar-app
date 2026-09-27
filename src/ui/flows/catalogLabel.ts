/**
 * The manifest's labels are English data (Ledger). Model names are proper names
 * and stay as they are; the knowledge entries are prose, so the UI shows them
 * from i18n by id (Prism I18N-3). Anything not listed falls back to the label.
 */
import type { TFunction } from "i18next";

export const TRANSLATED_LABEL_IDS = ["corpus-standard", "corpus-full", "wiki-vital5"] as const;
const TRANSLATED = new Set<string>(TRANSLATED_LABEL_IDS);

export function catalogLabel(item: { id: string; label: string }, t: TFunction): string {
  return TRANSLATED.has(item.id) ? t(`flows.catalog.label.${item.id}`) : item.label;
}
