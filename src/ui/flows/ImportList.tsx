import React from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button, Icon, Progress, Text } from "../components";
import { useTokens } from "../theme";
import { MODEL_CATALOG } from "../../models/manifest";
import type { FileImport } from "./useCatalog";

interface Props {
  imports: FileImport[];
  onPick: () => void;
  /** Label of the pick button; "Choose files" by default. */
  pickLabel?: string;
}

/**
 * Files chosen for import and what happened to each: hashing progress,
 * verified as a catalog item, or why it was refused. Refusals stay on
 * screen with the file name until the next pick (Prism F8).
 */
export function ImportList({ imports, onPick, pickLabel }: Props) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const busy = imports.some((f) => f.status === "importing");
  return (
    <View style={{ gap: tokens.space.md }}>
      {imports.map((f) => {
        const asset = f.assetId ? MODEL_CATALOG.find((m) => m.id === f.assetId) : undefined;
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
                        : tokens.color.text.tertiary
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
                {t("flows.import.verified", { item: asset?.label ?? f.assetId ?? "" })}
              </Text>
            )}
            {f.status === "failed" && (
              <>
                <Text variant="footnote" color="danger">
                  {t(`flows.row.error.${f.errorKind ?? "unknown"}`)}
                </Text>
                {f.message && (
                  <Text variant="caption" color="tertiary" selectable>
                    {f.message}
                  </Text>
                )}
              </>
            )}
          </View>
        );
      })}
      <Button label={pickLabel ?? t("flows.import.pick")} icon="file-plus" variant="secondary" onPress={onPick} loading={busy} />
    </View>
  );
}
