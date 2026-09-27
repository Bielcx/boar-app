import React, { useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon, IconButton, Mascot, OfflineSeal, Sheet, Text } from "./components";
import { useTokens } from "./theme";
import { headerFit } from "./chat/headerLayout";

// Which build this is (see docs/BUILD_VARIANTS.md on feat/trust-offline). Read the
// same inlined variable here until src/config/variant.ts is on main.
const OFFLINE_BUILD = process.env.EXPO_PUBLIC_BOAR_VARIANT?.trim().toLowerCase() === "offline";

interface Props {
  activeModelLabel?: string;
  voiceEnabled: boolean;
  onOpenDrawer: () => void;
  onNewChat: () => void;
}

/**
 * Chat top bar: menu, title, the offline badge (tap for what "offline" means
 * in this build) and new chat. Tone lives in Settings > Personality (the mockup
 * has no tone button, and it cost the seal its text on 393-412pt phones). Name and model always stay readable:
 * when the width gets tight (see headerFit) the seal keeps only its icon,
 * then the avatar goes, so large text never wraps or swallows the title.
 */
export function ChatHeader({ activeModelLabel, voiceEnabled, onOpenDrawer, onNewChat }: Props) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const { width, fontScale } = useWindowDimensions();
  const [offlineOpen, setOfflineOpen] = useState(false);
  // Short "OFFLINE" like the mockup only where it is literally true (the build without INTERNET);
  // the downloader build keeps "Answers offline" (HQ honesty rule R9). Readers hear the long form.
  const sealLabel = tr(OFFLINE_BUILD ? "chat.header.offlineSeal" : "chat.header.offlineAnswersSeal");
  const sealSpoken = tr(OFFLINE_BUILD ? "chat.header.offlineSealSpoken" : "chat.header.offlineAnswersSeal");
  const fit = headerFit({
    width,
    fontScale,
    touch: t.size.touch,
    buttons: 2,
    // Row padding + the gaps between its children (outer row: 2, title group: 2).
    chrome: t.space.sm * 2 + t.space.xs * 2 + t.space.sm * 2,
    avatar: t.size.avatar + t.space.sm,
    sealChars: sealLabel.length,
  });

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: t.space.xs,
        paddingHorizontal: t.space.sm,
        paddingVertical: t.space.xs,
      }}
    >
      <IconButton icon="menu" label={tr("chat.header.menu")} onPress={onOpenDrawer} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
        {fit.avatar && (
          <Mascot size="avatar" />
        )}
        <View style={{ flexShrink: 1, flexGrow: 1 }}>
          <Text variant="headline" header numberOfLines={1}>
            boar
          </Text>
          {activeModelLabel && (
            <Text variant="mono" color="secondary" numberOfLines={1}>
              {activeModelLabel}
            </Text>
          )}
        </View>
        <Pressable
          onPress={() => setOfflineOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={tr("chat.header.offlineShort")}
          style={{ minHeight: t.size.touch, minWidth: t.size.touch, alignItems: "center", justifyContent: "center" }}
        >
          {fit.seal === "text" ? (
            <OfflineSeal label={sealLabel} accessibilityLabel={sealSpoken} />
          ) : (
            <View style={{ padding: t.space.sm, borderRadius: t.radius.full, backgroundColor: t.color.field.soft }}>
              <Icon name="wifi-off" size="sm" color={t.color.field.text} />
            </View>
          )}
        </Pressable>
      </View>
      <IconButton icon="edit-3" label={tr("chat.header.newChat")} onPress={onNewChat} />

      <Sheet visible={offlineOpen} onClose={() => setOfflineOpen(false)} title={tr("chat.header.offlineTitle")}>
        <View style={{ gap: t.space.md }}>
          <Text color="secondary">{tr(OFFLINE_BUILD ? "chat.header.offlineBody" : "chat.header.offlineBodyDownloader")}</Text>
          {activeModelLabel && (
            <Text variant="footnote" color="secondary">
              {tr("chat.header.modelLoaded", { label: activeModelLabel })}
            </Text>
          )}
          {voiceEnabled && (
            <Text variant="footnote" color="secondary">
              {tr("chat.header.voiceCaveat")}
            </Text>
          )}
        </View>
      </Sheet>
    </View>
  );
}
