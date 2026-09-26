import React, { useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Badge, Icon, IconButton, Sheet, Text } from "./components";
import { useTokens } from "./theme";

// Which build this is (see docs/BUILD_VARIANTS.md on feat/trust-offline). Read the
// same inlined variable here until src/config/variant.ts is on main.
const OFFLINE_BUILD = process.env.EXPO_PUBLIC_BOAR_VARIANT?.trim().toLowerCase() === "offline";

interface Props {
  activeModelLabel?: string;
  voiceEnabled: boolean;
  onOpenDrawer: () => void;
  onCycleTone: () => void;
  onNewChat: () => void;
}

/**
 * Chat top bar: menu, title, the offline badge (tap for what "offline" means
 * in this build), tone and new chat. When the width in points divided by the
 * text scale gets tight, the title goes first and the badge keeps only its
 * icon, so large text never wraps the bar.
 */
export function ChatHeader({ activeModelLabel, voiceEnabled, onOpenDrawer, onCycleTone, onNewChat }: Props) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const { width, fontScale } = useWindowDimensions();
  const [offlineOpen, setOfflineOpen] = useState(false);
  const room = width / Math.max(1, fontScale);
  const showTitle = room >= 330;
  const badgeText = room >= 380;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: t.space.xs,
        paddingHorizontal: t.space.xs,
        paddingVertical: t.space.xxs,
        backgroundColor: t.color.bg.canvas,
        borderBottomWidth: t.size.hairline,
        borderBottomColor: t.color.line.hairline,
      }}
    >
      <IconButton icon="menu" label={tr("chat.header.menu")} onPress={onOpenDrawer} />
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: t.space.sm }}>
        {showTitle && (
          <Text variant="headline" header numberOfLines={1}>
            BOAR
          </Text>
        )}
        <Pressable
          onPress={() => setOfflineOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={tr("chat.header.offlineShort")}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
        >
          {badgeText ? (
            <Badge label={tr("chat.header.offline")} icon="wifi-off" tone="field" />
          ) : (
            <View style={{ padding: t.space.xs, borderRadius: t.radius.sm, backgroundColor: t.color.field.soft }}>
              <Icon name="wifi-off" size="sm" color={t.color.field.text} />
            </View>
          )}
        </Pressable>
      </View>
      <IconButton icon="type" label={tr("chat.header.tone")} onPress={onCycleTone} />
      <IconButton icon="edit-3" label={tr("chat.header.newChat")} onPress={onNewChat} />

      <Sheet visible={offlineOpen} onClose={() => setOfflineOpen(false)} title={tr("chat.header.offlineTitle")}>
        <View style={{ gap: t.space.md }}>
          <Text color="secondary">{tr(OFFLINE_BUILD ? "chat.header.offlineBody" : "chat.header.offlineBodyDownloader")}</Text>
          {activeModelLabel && (
            <Text variant="footnote" color="tertiary">
              {tr("chat.header.modelLoaded", { label: activeModelLabel })}
            </Text>
          )}
          {voiceEnabled && (
            <Text variant="footnote" color="tertiary">
              {tr("chat.header.voiceCaveat")}
            </Text>
          )}
        </View>
      </Sheet>
    </View>
  );
}
