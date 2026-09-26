import React, { useEffect, useRef } from "react";
import { AccessibilityInfo, findNodeHandle, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button, Icon, Progress, Text, useAnnounce } from "../components";
import { useTokens } from "../theme";
import { MODEL_CATALOG } from "../../models/manifest";
import { poiCatalogEntries } from "../../rag/poiRegions";
import { worldPlacesEntry } from "./adapters";

function labelFor(assetId: string | undefined): string | undefined {
  if (!assetId) return undefined;
  return [...MODEL_CATALOG, ...poiCatalogEntries(), worldPlacesEntry()].find((m) => m.id === assetId)?.label;
}
import type { FileImport } from "./useCatalog";

interface Props {
  imports: FileImport[];
  onPick: () => void;
  /** Stops the import in progress. */
  onCancel?: () => void;
  /** Label of the pick button; "Choose files" by default. */
  pickLabel?: string;
}

/**
 * Files chosen for import and what happened to each: hashing progress,
 * verified as a catalog item, or why it was refused. Refusals stay on
 * screen with the file name until the next pick (Prism F8).
 */
export function ImportList({ imports, onPick, onCancel, pickLabel }: Props) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const announce = useAnnounce();
  const pickRef = useRef<View>(null);
  const busy = imports.some((f) => f.status === "importing");

  // Same contract as downloads (Prism F4/F5): polite on start, every quarter
  // and when verified; assertive on a refusal, with focus on the pick button.
  const spoken = useRef<Record<string, string>>({});
  useEffect(() => {
    let refused = false;
    for (const f of imports) {
      const key = f.status === "importing" ? `q${Math.floor(f.progress * 4)}` : f.status;
      if (spoken.current[f.name] === key) continue;
      spoken.current[f.name] = key;
      if (f.status === "importing") {
        const pct = Math.floor(f.progress * 4) * 25;
        announce(pct === 0 ? t("flows.import.checking", { name: f.name }) : t("flows.import.checkingAnnounce", { name: f.name, pct }));
      } else if (f.status === "verified") {
        announce(t("flows.import.verified", { item: labelFor(f.assetId) ?? f.assetId ?? f.name }));
      } else {
        announce(`${f.name}: ${t(`flows.row.error.${f.errorKind ?? "unknown"}`)}`, { assertive: true });
        refused = true;
      }
    }
    if (refused) {
      setTimeout(() => {
        const node = pickRef.current && findNodeHandle(pickRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      }, 300);
    }
    // Forget files that left the list, so a re-pick announces again.
    for (const name of Object.keys(spoken.current)) if (!imports.some((f) => f.name === name)) delete spoken.current[name];
  }, [imports, announce, t]);
  return (
    <View style={{ gap: tokens.space.md }}>
      {imports.map((f) => {
        const label = labelFor(f.assetId);
        return (
          <View key={f.name} style={{ gap: tokens.space.xs }}>
            <View style={{ flexDirection: "row", gap: tokens.space.sm, alignItems: "center" }}>
              <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Icon
                  name={f.status === "verified" ? "check-circle" : f.status === "failed" ? "alert-octagon" : "file"}
                  color={
                    f.status === "verified"
                      ? tokens.color.status.success.solid
                      : f.status === "failed"
                        ? tokens.color.status.danger.solid
                        : tokens.color.text.secondary
                  }
                />
              </View>
              <Text variant="subhead" numberOfLines={1} ellipsizeMode="middle" accessibilityLabel={f.name} style={{ flex: 1 }}>
                {f.name}
              </Text>
            </View>
            {f.status === "importing" && (
              <Progress
                label={t("flows.import.checking", { name: f.name })}
                value={f.progress}
                valueText={t("flows.import.checkingValue", { pct: Math.round(f.progress * 100) })}
              />
            )}
            {f.status === "verified" && (
              <Text variant="footnote" color="success">
                {t("flows.import.verified", { item: label ?? f.assetId ?? "" })}
              </Text>
            )}
            {f.status === "failed" && (
              <>
                <Text variant="footnote" color="danger">
                  {t(`flows.row.error.${f.errorKind ?? "unknown"}`)}
                </Text>
                {f.message && (
                  <Text variant="caption" color="secondary" selectable>
                    {f.message}
                  </Text>
                )}
              </>
            )}
          </View>
        );
      })}
      {busy && onCancel && (
        <Button
          variant="outline"
          label={t("common.cancel")}
          accessibilityLabel={t("flows.import.cancelA11y", { name: imports.find((f) => f.status === "importing")?.name ?? "" })}
          onPress={onCancel}
        />
      )}
      <Button ref={pickRef} label={pickLabel ?? t("flows.import.pick")} icon="file-plus" variant="secondary" onPress={onPick} loading={busy} />
    </View>
  );
}
