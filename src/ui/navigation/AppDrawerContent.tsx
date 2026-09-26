import React, { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { DrawerContentComponentProps, useDrawerStatus } from "@react-navigation/drawer";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { getMemorySettings } from "../../models/settings";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import { Button, IconButton, IconName, ListRow, Sheet, Text, useToast } from "../components";
import { useTokens } from "../theme";
import { useChatBridge } from "./chatBridge";
import type { RootStackParamList } from "./types";

function relativeTime(ms: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diffMin = (Date.now() - ms) / 60000;
  if (diffMin < 1) return t("time.justNow");
  if (diffMin < 60) return t("time.minutesAgo", { count: Math.floor(diffMin) });
  const diffHr = diffMin / 60;
  if (diffHr < 24) return t("time.hoursAgo", { count: Math.floor(diffHr) });
  return t("time.daysAgo", { count: Math.floor(diffHr / 24) });
}

type Destination = { route: keyof RootStackParamList; icon: IconName; label: string };

export function AppDrawerContent({ navigation }: DrawerContentComponentProps) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const status = useDrawerStatus();
  const chat = useChatBridge();
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [maxSessions, setMaxSessions] = useState<number | null>(null);
  const trashRefs = useRef(new Map<string, View | null>());
  const returnFocusRef = useRef<View | null>(null);
  const newChatRef = useRef<View | null>(null);

  useEffect(() => {
    if (status !== "open") return;
    chat.refreshSessions();
    getMemorySettings()
      .then((m) => setMaxSessions(m.maxSavedSessions))
      .catch(() => {});
    // Refresh each time the drawer opens, not on every bridge update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const destinations: Destination[] = [
    { route: "Knowledge", icon: "book-open", label: tr("nav.knowledge") },
    { route: "Settings", icon: "sliders", label: tr("nav.settings") },
    { route: "Performance", icon: "activity", label: tr("nav.performance") },
  ];
  if (__DEV__) destinations.push({ route: "Catalog", icon: "grid", label: tr("nav.catalog") });

  const go = (fn: () => void) => {
    navigation.closeDrawer();
    fn();
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.color.bg.surface, paddingTop: insets.top }}>
      <View style={[styles.brand, { paddingHorizontal: t.space.base, paddingVertical: t.space.md, gap: t.space.md }]}>
        <Image
          source={require("../../../assets/boar.png")}
          style={{ width: 40, height: 40, borderRadius: t.radius.md }}
          accessibilityIgnoresInvertColors
          accessible={false}
        />
        <View style={{ flex: 1 }} accessible accessibilityRole="header">
          <Text variant="headline">BOAR</Text>
          <Text variant="footnote" color="field">
            {tr("nav.subtitle")}
          </Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: t.space.base, paddingBottom: t.space.md }}>
        <Button ref={newChatRef} label={tr("nav.newChat")} icon="edit-3" variant="secondary" fullWidth onPress={() => go(chat.newChat)} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: t.space.base }}>
        <Text variant="label" color="tertiary" header style={{ paddingHorizontal: t.space.base, paddingVertical: t.space.sm }}>
          {tr("nav.recent")}
        </Text>
        {chat.sessions.length === 0 ? (
          <Text variant="footnote" color="tertiary" style={{ paddingHorizontal: t.space.base }}>
            {tr("nav.noHistory")}
          </Text>
        ) : (
          chat.sessions.map((s) => {
            const active = s.id === chat.activeSessionId;
            return (
              <View key={s.id} style={[styles.sessionRow, { paddingLeft: t.space.sm, paddingRight: t.space.xs }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${s.title}, ${relativeTime(s.updatedAt, tr)}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    impact(ImpactFeedbackStyle.Light);
                    go(() => chat.selectSession(s.id));
                  }}
                  style={({ pressed }) => [
                    styles.sessionMain,
                    {
                      minHeight: t.size.touch,
                      paddingHorizontal: t.space.sm,
                      borderRadius: t.radius.sm,
                      backgroundColor: active ? t.color.accent.soft : pressed ? t.color.bg.sunken : "transparent",
                    },
                  ]}
                >
                  <Text variant="callout" numberOfLines={1} weight={active ? "semibold" : "regular"}>
                    {s.title}
                  </Text>
                  <Text variant="caption" color="tertiary">
                    {relativeTime(s.updatedAt, tr)}
                  </Text>
                </Pressable>
                <IconButton
                  ref={(node) => {
                    trashRefs.current.set(s.id, node);
                  }}
                  icon="trash-2"
                  size="sm"
                  label={tr("nav.deleteChatA11y", { title: s.title })}
                  onPress={() => {
                    returnFocusRef.current = trashRefs.current.get(s.id) ?? null;
                    setPendingDelete({ id: s.id, title: s.title });
                  }}
                />
              </View>
            );
          })
        )}
        {maxSessions !== null && chat.sessions.length > 0 && (
          <Text variant="caption" color="tertiary" style={{ paddingHorizontal: t.space.base, paddingTop: t.space.sm }}>
            {tr("nav.keepingLast", { count: maxSessions })}
          </Text>
        )}
      </ScrollView>

      <View
        style={{
          borderTopWidth: t.size.hairline,
          borderTopColor: t.color.line.hairline,
          paddingBottom: insets.bottom,
        }}
      >
        {destinations.map((d) => (
          <ListRow
            key={d.route}
            title={d.label}
            icon={d.icon}
            chevron={false}
            onPress={() => go(() => navigation.getParent()?.navigate(d.route))}
          />
        ))}
      </View>

      <Sheet
        visible={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        returnFocusRef={returnFocusRef}
        title={tr("nav.deleteChatTitle")}
        description={pendingDelete ? tr("nav.deleteChatBody", { title: pendingDelete.title }) : undefined}
        footer={
          <>
            <Button label={tr("ui.cancel")} variant="ghost" fullWidth onPress={() => setPendingDelete(null)} />
            <Button
              label={tr("nav.deleteChatConfirm")}
              variant="destructive"
              icon="trash-2"
              fullWidth
              onPress={() => {
                if (pendingDelete) chat.deleteSession(pendingDelete.id);
                // The trash button goes away with the row; land focus on "New chat" instead.
                returnFocusRef.current = newChatRef.current;
                setPendingDelete(null);
                toast({ message: tr("nav.chatDeleted"), icon: "trash-2" });
              }}
            />
          </>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center" },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  sessionMain: { flex: 1, justifyContent: "center", paddingVertical: 6 },
});

