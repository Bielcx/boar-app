/**
 * The one place the UI names a catalog item. The manifest's labels are English
 * technical data (Ledger): knowledge entries are prose, so they come from i18n
 * by id (Prism I18N-3); models show their short display name (Qwen3 4B), and the
 * technical label (quantization and all) is kept for detail screens (About).
 */
import type { TFunction } from "i18next";
import { displayNameOf, type CatalogModel } from "../../models/manifest";

export const TRANSLATED_LABEL_IDS = ["corpus-standard", "corpus-full", "wiki-vital5"] as const;
const TRANSLATED = new Set<string>(TRANSLATED_LABEL_IDS);

type Named = { id: string } & Pick<CatalogModel, "label" | "displayName">;

export function catalogLabel(item: Named, t: TFunction, opts?: { technical?: boolean }): string {
  if (TRANSLATED.has(item.id)) return t(`flows.catalog.label.${item.id}`);
  return opts?.technical ? item.label : displayNameOf(item);
}
