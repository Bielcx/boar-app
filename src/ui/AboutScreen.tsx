import React, { useCallback } from "react";
import { Image, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { Button, ListRow, Screen, Section, Text, useToast } from "./components";
import { useTokens } from "./theme";
import { useCatalog } from "./flows/useCatalog";
import { formatBytes } from "./flows/format";
import { MODEL_CATALOG } from "../models/manifest";
import appConfig from "../../app.json";

const REPO_URL = "github.com/rferrari/boar-app";

export function AboutScreen() {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const toast = useToast();
  const catalog = useCatalog();
  const { refresh } = catalog;

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const installed = [...MODEL_CATALOG, ...catalog.discovered].filter((m) => catalog.statuses[m.id]?.present);
  const build = __DEV__ ? t("flows.about.buildDev") : t("flows.about.buildRelease");

  return (
    <Screen>
      <View style={{ alignItems: "center", gap: tokens.space.sm }}>
        <Image
          source={require("../../assets/boar.png")}
          style={{ width: 72, height: 72, borderRadius: tokens.radius.lg }}
          accessibilityIgnoresInvertColors
          accessible={false}
        />
        <Text variant="title2" align="center">
          BOAR
        </Text>
        <Text variant="callout" color="secondary" align="center">
          {t("flows.about.tagline")}
        </Text>
        <Text variant="footnote" color="tertiary" align="center" numeric>
          {t("flows.about.version", { version: appConfig.expo.version, build })}
        </Text>
      </View>

      <Section title={t("flows.about.howTitle")}>
        <View style={{ padding: tokens.space.base, gap: tokens.space.md }}>
          {(["how1", "how2", "how3"] as const).map((k) => (
            <Text key={k} variant="callout">
              {t(`flows.about.${k}`)}
            </Text>
          ))}
        </View>
      </Section>

      <Section title={t("flows.about.installedTitle")} footer={t("flows.about.installedFooter")}>
        {installed.length === 0 ? (
          <ListRow title={t("flows.about.nothingInstalled")} />
        ) : (
          installed.map((m) => (
            <ListRow key={m.id} title={m.label} value={formatBytes(m.sizeBytes, i18n.language)} subtitle={m.license} />
          ))
        )}
      </Section>

      <Section title={t("flows.about.sourceTitle")} footer={t("flows.about.sourceFooter")}>
        <View style={{ padding: tokens.space.base, gap: tokens.space.md }}>
          <Text variant="mono" selectable>
            {REPO_URL}
          </Text>
          <Button
            size="sm"
            variant="secondary"
            icon="copy"
            label={t("flows.about.copy")}
            accessibilityHint={t("flows.about.copyHint")}
            onPress={async () => {
              await Clipboard.setStringAsync(`https://${REPO_URL}`);
              toast({ message: t("flows.about.copied"), tone: "success" });
            }}
          />
        </View>
      </Section>
    </Screen>
  );
}
