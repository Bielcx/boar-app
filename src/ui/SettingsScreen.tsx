import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Button, ListRow, Screen, Section, SegmentedControl, Sheet, Text, useAnnounce, useToast } from "./components";
import { useTheme, useTokens } from "./theme";
import { useLanguage } from "../i18n/LanguageContext";
import {
  Appearance,
  FontScale,
  getAdaptiveRoutingEnabled,
  getDeepResearchMode,
  getHapticsEnabled,
  getMaxTokens,
  getMemorySettings,
  getPersonalityId,
  getVoiceInputEnabled,
  LanguageId,
  setAdaptiveRoutingEnabled,
  setDeepResearchMode,
  setHapticsEnabled,
  setVoiceInputEnabled,
} from "../models/settings";
import { setHapticsEnabledCache } from "../services/haptics";
import { resetAllAppData } from "../services/appReset";
import type { RootStackParamList } from "./navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface Values {
  personality: string;
  maxTokens: number;
  quickFirst: boolean;
  alwaysComplete: boolean;
  maxSavedSessions: number;
  haptics: boolean;
  voice: boolean;
}

/** Which of the four answer modes the two toggles select (see flows-spec §3.1). */
function answerModeKey(quickFirst: boolean, alwaysComplete: boolean): string {
  return `flows.settings.answerMode.${quickFirst ? "quick" : "direct"}${alwaysComplete ? "Complete" : "Model"}`;
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const tokens = useTokens();
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const announce = useAnnounce();
  const { appearance, setAppearance, fontScale, setFontScale } = useTheme();
  const { languageId, setLanguage } = useLanguage();
  const [values, setValues] = useState<Values | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [personality, maxTokens, quickFirst, alwaysComplete, memory, haptics, voice] = await Promise.all([
          getPersonalityId(),
          getMaxTokens(),
          getAdaptiveRoutingEnabled(),
          getDeepResearchMode(),
          getMemorySettings(),
          getHapticsEnabled(),
          getVoiceInputEnabled(),
        ]);
        setValues({ personality, maxTokens, quickFirst, alwaysComplete, maxSavedSessions: memory.maxSavedSessions, haptics, voice });
      })();
    }, [])
  );

  const update = async <K extends keyof Values>(key: K, value: Values[K], persist: (v: Values[K]) => Promise<void>) => {
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));
    try {
      await persist(value);
    } catch {
      toast({ message: t("flows.settings.saveFailed"), tone: "danger" });
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      await resetAllAppData();
      setResetOpen(false);
      navigation.reset({ index: 0, routes: [{ name: "Setup" }] });
    } catch (e: any) {
      setResetting(false);
      toast({ message: t("flows.settings.resetFailed", { error: e?.message ?? String(e) }), tone: "danger" });
    }
  };

  if (!values) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Section title={t("flows.settings.answers")} footer={t(answerModeKey(values.quickFirst, values.alwaysComplete))}>
        <ListRow
          icon="message-circle"
          title={t("flows.settings.tone")}
          value={t(`personalities.${values.personality}.label`)}
          onPress={() => navigation.navigate("SettingsTone")}
        />
        <ListRow
          icon="align-left"
          title={t("flows.settings.length")}
          value={t("flows.settings.tokens", { count: values.maxTokens })}
          onPress={() => navigation.navigate("SettingsLength")}
        />
        <ListRow
          icon="zap"
          title={t("flows.settings.quickFirst")}
          subtitle={t("flows.settings.quickFirstHint")}
          switch={{ value: values.quickFirst, onValueChange: (v) => {
              update("quickFirst", v, setAdaptiveRoutingEnabled);
              announce(t(answerModeKey(v, values.alwaysComplete)));
            } }}
        />
        <ListRow
          icon="layers"
          title={t("flows.settings.alwaysComplete")}
          subtitle={t("flows.settings.alwaysCompleteHint")}
          switch={{ value: values.alwaysComplete, onValueChange: (v) => {
              update("alwaysComplete", v, setDeepResearchMode);
              announce(t(answerModeKey(values.quickFirst, v)));
            } }}
        />
      </Section>

      <Section title={t("flows.settings.library")}>
        <ListRow icon="cpu" title={t("flows.settings.models")} onPress={() => navigation.navigate("Models")} />
        <ListRow icon="book-open" title={t("flows.settings.knowledge")} onPress={() => navigation.navigate("Knowledge")} />
        <ListRow
          icon="clock"
          title={t("flows.settings.history")}
          value={
            values.maxSavedSessions > 0
              ? t("flows.settings.keepLast", { count: values.maxSavedSessions })
              : t("flows.settings.keepAll")
          }
          onPress={() => navigation.navigate("SettingsHistory")}
        />
      </Section>

      <Section title={t("flows.settings.appearance")}>
        <View style={{ padding: tokens.space.base, gap: tokens.space.base }}>
          <SegmentedControl<Appearance>
            label={t("flows.settings.theme")}
            value={appearance}
            onChange={setAppearance}
            options={[
              { value: "system", label: t("flows.settings.themeSystem") },
              { value: "light", label: t("flows.settings.themeLight") },
              { value: "dark", label: t("flows.settings.themeDark") },
            ]}
          />
          <Text variant="subhead" color="secondary">
            {t("flows.settings.textSize")}
          </Text>
          <SegmentedControl<FontScale>
            label={t("flows.settings.textSize")}
            value={fontScale}
            onChange={setFontScale}
            options={[
              { value: "compact", label: t("flows.settings.textCompact") },
              { value: "standard", label: t("flows.settings.textStandard") },
              { value: "large", label: t("flows.settings.textLarge") },
            ]}
          />
          <Text variant="subhead" color="secondary">
            {t("flows.settings.language")}
          </Text>
          <SegmentedControl<LanguageId>
            label={t("flows.settings.language")}
            value={languageId}
            onChange={setLanguage}
            options={[
              { value: "en", label: "English" },
              { value: "pt", label: "Português" },
            ]}
          />
        </View>
        <ListRow
          title={t("flows.settings.haptics")} switch={{ value: values.haptics, onValueChange: (v) => {
            setHapticsEnabledCache(v);
            update("haptics", v, setHapticsEnabled);
          } }}
        />
      </Section>

      <Section title={t("flows.settings.input")} footer={t("flows.settings.voiceNote")}>
        <ListRow icon="mic" title={t("flows.settings.voice")} switch={{ value: values.voice, onValueChange: (v) => update("voice", v, setVoiceInputEnabled) }} />
      </Section>

      <Section>
        <ListRow icon="activity" title={t("flows.settings.performance")} onPress={() => navigation.navigate("Performance")} />
        <ListRow icon="info" title={t("flows.settings.about")} onPress={() => navigation.navigate("About")} />
      </Section>

      <Section title={t("flows.settings.recovery")}>
        <ListRow icon="refresh-cw" title={t("flows.settings.rerunSetup")} onPress={() => navigation.navigate("Setup")} />
        <ListRow icon="trash-2" title={t("flows.settings.eraseAll")} destructive onPress={() => setResetOpen(true)} />
      </Section>

      <Sheet
        visible={resetOpen}
        onClose={() => !resetting && setResetOpen(false)}
        dismissible={!resetting}
        title={t("flows.settings.eraseTitle")}
        description={t("flows.settings.eraseBody")}
        footer={
          <>
            <Button label={t("common.cancel")} variant="secondary" onPress={() => setResetOpen(false)} disabled={resetting} fullWidth />
            <Button label={t("flows.settings.eraseConfirm")} variant="destructive" onPress={reset} loading={resetting} fullWidth />
          </>
        }
      >
        <View style={{ gap: tokens.space.xs }}>
          {(["eraseModels", "eraseKnowledge", "eraseHistory", "eraseSettings"] as const).map((k) => (
            <Text key={k} variant="callout" color="secondary">
              • {t(`flows.settings.${k}`)}
            </Text>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
