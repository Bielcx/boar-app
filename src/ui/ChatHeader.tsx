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
}

/**
 * Chat top bar, as the mockup: menu, avatar, name + model, and the offline
 * badge (tap for what "offline" means in this build). New chat lives in the
 * drawer (first item), per Boar's fidelity decision. Tone lives in Settings > Personality (the mockup
 * has no tone button, and it cost the seal its text on 393-412pt phones). Name and model always stay readable:
 * when the width gets tight (see headerFit) the seal keeps only its icon,
 * then the avatar goes, so large text never wraps or swallows the title.
 */
export function ChatHeader({ activeModelLabel, voiceEnabled, onOpenDrawer }: Props) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const { width, fontScale } = useWindowDimensions();
  const [offlineOpen, setOfflineOpen] = useState(false);
  // Short "OFFLINE" like the mockup only where it is literally true (the build without INTERNET);
  // the downloader build keeps "Answers offline" (HQ honesty rule R9). Readers hear the long form.
  const sealLabel = tr(OFFLINE_BUILD ? "chat.header.offlineSeal" : "chat.header.offlineAnswersSeal");
  const sealSpoken = tr(OFFLINE_BUILD ? "chat.header.offlineSealSpoken" : "chat.header.offlineAnswersSeal");
  // The mockup's header: padding 4/16/10, 10 between items, 42 pt discs (touch comes from hitSlop).
  const itemGap = t.space.sm + t.space.xxs;
  const fit = headerFit({
    width,
    fontScale,
    touch: t.size.headerDisc,
    buttons: 1,
    // Row padding + the gaps menu|title and title|seal; the avatar brings its own gap.
    chrome: t.space.gutterChat * 2 + itemGap * 2,
    avatar: t.size.avatar + itemGap,
    sealChars: sealLabel.length,
  });

  return (
    <View
      // Top-aligned: with large text the title block grows downward, never above the menu (Prism AX-1).
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: itemGap,
        paddingHorizontal: t.space.gutterChat,
        paddingTop: t.space.xs,
        paddingBottom: itemGap,
      }}
    >
      <IconButton icon="menu" variant="surface" size="header" label={tr("chat.header.menu")} onPress={onOpenDrawer} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", gap: itemGap }}>
        {fit.avatar && <Mascot size="avatar" />}
        <View style={{ flexShrink: 1, flexGrow: 1, minHeight: t.size.headerDisc, justifyContent: "center", gap: t.space.xxs }}>
          <Text variant="title2" header numberOfLines={1}>
            boar
          </Text>
          {activeModelLabel && (
            // The mockup's model line: caps, secondary, raised from 9.5 px to the 12 pt floor.
            <Text variant="capsMeta" color="secondary" numberOfLines={1}>
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
